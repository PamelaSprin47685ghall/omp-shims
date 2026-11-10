// Host bridge: one owner for the vendor packages and the ModelRegistry hooks.
//
// Two features need the same host surface:
//   - the plugin bridge registers plugin providers and OAuth configs;
//   - the models bridge registers providers declared in models.yml.
//
// If each feature wrapped ModelRegistry.prototype, the wrappers would layer and
// would disagree about source order. This module is the only writer. It wraps
// `refresh`, `getAll`, `getAvailable`, `getAvailableForProviders` and
// `syncExtensionSources` at most once per process, keeps one oldest-first
// source order for every path, and stores the previous functions on the
// prototype behind a symbol, so a second install sees the first one and does
// nothing.
//
// The vendor packages are also installed here. The primary path maps the
// package names to the local `vendor/<package>/index.mjs` files in memory with
// `Bun.plugin` + `build.module`. No `node_modules` directory is written, so a
// gateway restart, a broker start and several workers cannot race over a
// delete-and-copy. Bun 1.4.x does not run a runtime plugin's `onResolve` for a
// bare specifier without an extension, so `build.module` is the mechanism that
// works today; `onResolve` stays registered for runtimes that fix that filter.
//
// The copy fallback exists only for a runtime without `Bun.plugin`. It checks a
// content hash first, stages into a temp directory inside the plugins
// workspace, and swaps with rename. It never deletes a live target in place.

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NO_AUTH_SENTINEL, report, verboseLog } from "./contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_ROOT = resolve(HERE, "..", "vendor");

/** One vendored package: its directory, package name, entry and subpath entries. */
const VENDOR_PACKAGES = Object.freeze([
  Object.freeze({
    directory: "earendil-works-pi-ai",
    name: "@earendil-works/pi-ai",
    entry: "index.mjs",
    subpaths: Object.freeze({ compat: "compat.mjs" }),
  }),
  Object.freeze({
    directory: "earendil-works-pi-coding-agent",
    name: "@earendil-works/pi-coding-agent",
    entry: "index.mjs",
    subpaths: Object.freeze({}),
  }),
]);

/** The state shared by every copy of this module in one process. */
const STATE_KEY = Symbol.for("omp-shims.host-bridge.state");
/** The marker stored on a wrapped prototype. */
const PROTOTYPE_KEY = Symbol.for("omp-shims.host-bridge.prototype");
/** The marker for the process-wide vendor plugin. */
const VENDOR_KEY = Symbol.for("omp-shims.host-bridge.vendor");

/** The descriptor composeModelCatalog adds once for the Copilot alias. */
const COPILOT_AUTO_ROW = Object.freeze({
  id: "github-copilot/auto",
  object: "model",
  owned_by: "github-copilot",
  api: "openai-completions",
  display_name: "Copilot Auto",
  context_length: 1_050_000,
  max_output_tokens: 128_000,
  input_modalities: Object.freeze(["text", "image"]),
});

/** Methods the host bridge observes on ModelRegistry.prototype. */
const WRAPPED_METHODS = Object.freeze(["refresh", "getAll", "getAvailable", "getAvailableForProviders"]);

function state() {
  let current = globalThis[STATE_KEY];
  if (current) return current;

  current = {
    /** Provider sources in registration order (oldest first). */
    sources: [],
    nextSourceId: 1,
    /** Bumped on every source change; a registry registers again when it changed. */
    generation: 0,
    /** Provider source ids to keep alive across syncExtensionSources(). */
    keepSources: new Set(),
    /** Providers this bridge makes routable even without a broker row. */
    routable: new Set(),
    /** name -> provider metadata supplied by a feature. */
    extensionProviders: new Map(),
    /** name -> refresh bookkeeping for dynamic extension models. */
    extensionRefreshes: new Map(),
    /** name -> custom (models.yml) provider metadata. */
    customProviders: new Map(),
    /** registry -> generation it was last registered against. */
    applied: new WeakMap(),
    /** one record per wrapped ModelRegistry prototype */
    prototypes: new Set(),
    /** Latest ModelRegistry.getAll()/getAvailable() result per kind. */
    snapshots: new Map(),
    /** The most recently active registry instance. */
    lastRegistry: undefined,
    /** The storage the gateway passed, when it did. */
    storage: undefined,
    /** The live bridge handle. */
    bridge: undefined,
    /** Vendor package state: loaded modules and whether the plugin was installed. */
    vendor: { modules: new Map(), pluginInstalled: false, mode: undefined },
    /** Cached agent directory, keyed by the environment it was computed from. */
    agentDir: { key: undefined, value: undefined },
  };
  Object.defineProperty(globalThis, STATE_KEY, { value: current, configurable: true });
  return current;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isThenable(value) {
  return (
    value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function"
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Encode one id list as a plain array of non-empty strings. */
function idList(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value[Symbol.iterator] !== "function") return [];
  return [...value].filter((item) => typeof item === "string" && item !== "");
}

/** Resolve a task, or the timeout marker, after `timeoutMs`. */
const TIMEOUT = Symbol.for("omp-shims.timeout");

async function withTimeout(task, timeoutMs) {
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(TIMEOUT), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([Promise.resolve(task), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Add a provider to the routable set. */
function addRoutable(shared, provider) {
  if (typeof provider === "string" && provider !== "") shared.routable.add(provider);
}

/** Guard against a path that would escape its root. */
function assertInside(root, target, label) {
  const rel = relative(resolve(root), resolve(target));
  if (rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) return;
  throw new Error(`${label} escapes ${root}: ${target}`);
}

/**
 * Register one provider without letting a one-model plugin registration wipe a
 * full built-in catalog.
 *
 * OMP's `registerProvider` replaces every model of the provider once the
 * catalog is materialized. A plugin that ships `oauth: true` commonly registers
 * one alias model (for example `github-copilot/auto`) and would delete the
 * provider's whole catalog. Keep the existing catalog and apply only the
 * provider-level transport/URL settings. A boolean `oauth` is not a valid OMP
 * OAuth config, so it is dropped.
 *
 * @returns {boolean} true when the provider was registered
 */
function registerProviderSafely(registry, provider, config, sourceId, label = "host-bridge") {
  if (!registry || typeof registry.registerProvider !== "function") return false;
  if (typeof provider !== "string" || provider === "" || !config || typeof config !== "object") {
    report(`${label}: invalid provider registration`, { provider });
    return false;
  }

  let next = config;
  if (config.oauth === true) {
    const { oauth: _oauth, ...rest } = config;
    next = rest;
    verboseLog(`${label}: dropped boolean oauth for ${provider}; OMP expects an OAuth config object`);
  }

  if (Array.isArray(next.models) && next.models.length === 1 && typeof registry.getProviderModels === "function") {
    let existing = [];
    try {
      existing = registry.getProviderModels(provider) ?? [];
    } catch {
      existing = [];
    }
    if (existing.length > 1) {
      const { models: _models, ...withoutModels } = next;
      const skippedId = next.models?.[0]?.id ?? "unknown";
      next = withoutModels;
      report(
        `${label}: kept ${existing.length} existing models for ${provider}; ` +
          `skipped a one-model replacement (${skippedId})`,
      );
    }
  }

  registry.registerProvider(provider, next, sourceId);
  return true;
}

// ---------------------------------------------------------------------------
// ModelRegistry hook
// ---------------------------------------------------------------------------

/** Store the model list of one kind for getHostModelSnapshot(). */
function recordModels(shared, models, kind) {
  if (!Array.isArray(models)) return;
  shared.snapshots.set(typeof kind === "string" && kind !== "" ? kind : "chat", [...models]);
}

/** Remember the live registry and, when the caller supplied none, its storage. */
function noteRegistry(shared, registry) {
  shared.lastRegistry = registry;
  if (!shared.storage && registry?.authStorage) shared.storage = registry.authStorage;
}

/** Read the source list without being disturbed by a source that registers another. */
function sourceSnapshot(shared) {
  return [...shared.sources];
}

function sourceHelpers(shared, source) {
  return {
    get storage() {
      return shared.storage;
    },
    /** Keep a provider source alive across syncExtensionSources(). */
    keepSource(id) {
      const ids = idList(id);
      for (const item of ids) {
        shared.keepSources.add(item);
        source.kept.add(item);
      }
    },
    /** Make a provider routable for the router even without a broker row. */
    noteRoutable(provider) {
      addRoutable(shared, provider);
    },
    /** Register a provider with the one-model guard. */
    registerProvider(registry, provider, config, sourceId) {
      return registerProviderSafely(registry, provider, config, sourceId, source.id);
    },
  };
}

/** Rebuild the kept-source set from the sources that still exist. */
function recomputeKeptSources(shared) {
  const next = new Set();
  for (const source of shared.sources) {
    for (const id of source.kept) next.add(id);
  }
  shared.keepSources = next;
}

/** Remove one source and forget the ids only it kept. */
function removeSource(shared, source) {
  const index = shared.sources.findIndex((item) => item.id === source.id && item === source);
  if (index === -1) return false;
  shared.sources.splice(index, 1);
  recomputeKeptSources(shared);
  shared.generation += 1;
  return true;
}

/** Call one source. A source failure is reported and does not stop its siblings. */
function callSource(shared, source, registry) {
  try {
    return source.register(registry, sourceHelpers(shared, source));
  } catch (error) {
    report(`provider source "${source.id}" failed`, { error: errorMessage(error) });
    return undefined;
  }
}

/** Apply every source in order, synchronously. */
function applySources(shared, registry) {
  for (const source of sourceSnapshot(shared)) callSource(shared, source, registry);
  shared.applied.set(registry, shared.generation);
}

/** Apply every source in order, awaiting any asynchronous source. */
async function applySourcesAsync(shared, registry) {
  for (const source of sourceSnapshot(shared)) {
    const result = callSource(shared, source, registry);
    if (isThenable(result)) {
      try {
        await result;
      } catch (error) {
        report(`provider source "${source.id}" rejected`, { error: errorMessage(error) });
      }
    }
  }
  shared.applied.set(registry, shared.generation);
}

/** Ensure the registry saw the current source generation. */
function ensureApplied(shared, registry, asynchronous) {
  if (shared.applied.get(registry) === shared.generation) return undefined;
  return asynchronous ? applySourcesAsync(shared, registry) : applySources(shared, registry);
}

/**
 * Install the prototype wrappers once.
 *
 * The previous functions live on the prototype next to the marker, so a second
 * copy of this module (or a second installation step) reuses them instead of
 * stacking another layer.
 */
function ensurePrototypeHooks(ModelRegistryClass) {
  const proto = ModelRegistryClass?.prototype;
  if (!proto) return undefined;
  if (proto[PROTOTYPE_KEY]) return proto[PROTOTYPE_KEY];

  const shared = state();
  const previous = {};
  for (const method of WRAPPED_METHODS) {
    if (typeof proto[method] === "function") previous[method] = proto[method];
  }
  if (typeof proto.syncExtensionSources === "function") {
    previous.syncExtensionSources = proto.syncExtensionSources;
  }
  if (!previous.getAll && !previous.refresh) return undefined;

  const installed = { previous, proto, wrappers: {}, state: shared };
  Object.defineProperty(proto, PROTOTYPE_KEY, {
    value: installed,
    configurable: true,
    enumerable: false,
    writable: false,
  });

  if (previous.getAll) {
    installed.wrappers.getAll = function getAll(...args) {
      noteRegistry(shared, this);
      ensureApplied(shared, this, false);
      const models = previous.getAll.apply(this, args);
      recordModels(shared, models, args[0]);
      return models;
    };
    proto.getAll = installed.wrappers.getAll;
  }

  if (previous.refresh) {
    installed.wrappers.refresh = function refresh(...args) {
      noteRegistry(shared, this);
      return Promise.resolve(previous.refresh.apply(this, args)).then(async (result) => {
        // refresh() rebuilds the catalog; every source must register again even
        // when the source list itself did not change.
        await applySourcesAsync(shared, this);
        return result;
      });
    };
    proto.refresh = installed.wrappers.refresh;
  }

  for (const method of ["getAvailable", "getAvailableForProviders"]) {
    const original = previous[method];
    if (!original) continue;
    installed.wrappers[method] = function available(...args) {
      noteRegistry(shared, this);
      ensureApplied(shared, this, false);
      const models = original.apply(this, args);
      recordModels(shared, models, "available");
      return models;
    };
    proto[method] = installed.wrappers[method];
  }

  if (previous.syncExtensionSources) {
    installed.wrappers.syncExtensionSources = function syncExtensionSources(activeSourceIds) {
      const merged = new Set(idList(activeSourceIds));
      for (const id of shared.keepSources) merged.add(id);
      return previous.syncExtensionSources.call(this, [...merged]);
    };
    proto.syncExtensionSources = installed.wrappers.syncExtensionSources;
  }

  shared.prototypes.add(installed);
  verboseLog("host-bridge: wrapped ModelRegistry.prototype", { methods: Object.keys(previous) });
  return installed;
}

/** Put the original methods back when this prototype still holds our wrappers. */
function restorePrototypeHooks(record) {
  const { proto, previous, wrappers } = record;
  if (!proto) return;
  for (const [method, wrapper] of Object.entries(wrappers)) {
    const original = previous[method];
    if (proto[method] !== wrapper || typeof original !== "function") continue;
    proto[method] = original;
  }
  if (proto[PROTOTYPE_KEY] === record) delete proto[PROTOTYPE_KEY];
  record.state?.prototypes.delete(record);
}

/** Walk the constructor chain until a class with a ModelRegistry-shaped prototype appears. */
function registryClassOf(value) {
  if (typeof value === "function" && value.prototype) return value;
  if (value && typeof value === "object" && value.constructor && typeof value.constructor === "function") {
    return value.constructor;
  }
  return undefined;
}

/** Subscribe to one captured host export. Return an unsubscribe function. */
function subscribeHostExport(name, observer) {
  const host = globalThis.__OMP_SHIMS_HOST__;
  if (!host || typeof host.observe !== "function") {
    report(`host-bridge: capture unavailable; cannot observe ${name}`);
    return () => {};
  }
  try {
    const unsubscribe = host.observe(name, observer);
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  } catch (error) {
    report(`host-bridge: cannot observe ${name}`, { error: errorMessage(error) });
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Public host bridge
// ---------------------------------------------------------------------------

/** Return the active bridge, or undefined before installHostBridge(). */
export function getHostBridge() {
  return state().bridge;
}

/**
 * Install (or reuse) the host bridge.
 *
 * `registry` may be the ModelRegistry class or an instance. When absent, the
 * captured `ModelRegistry` export is observed and the prototype is wrapped the
 * moment it appears.
 *
 * @param {{registry?: Function | object, storage?: object}} [options]
 */
export function installHostBridge({ registry, storage } = {}) {
  const shared = state();
  if (storage !== undefined) shared.storage = storage;

  const install = (value) => {
    const ModelRegistryClass = registryClassOf(value);
    if (!ModelRegistryClass) return false;
    return ensurePrototypeHooks(ModelRegistryClass);
  };

  if (registry) {
    install(registry);
  } else {
    const host = globalThis.__OMP_SHIMS_HOST__;
    const captured = host?.captured?.get?.("ModelRegistry") ?? host?.resolve?.("ModelRegistry");
    if (captured) install(captured);
  }

  // Repeated installation is the normal gateway/broker/multi-worker case. The
  // sources and the prototype hook already exist; return the live handle.
  if (shared.bridge) return shared.bridge;

  // A late ModelRegistry export is announced by registry-capture.mjs; wrap it
  // then. A mirror registry may appear after a worker restart, so the
  // subscription outlives individual sources and is removed only on dispose.
  const unsubscribeRegistry = subscribeHostExport("ModelRegistry", install);
  const ownedSources = new Set();

  const bridge = {
    registerProviderSource(source) {
      const normalized = normalizeSource(source, shared);
      const index = shared.sources.findIndex((item) => item.id === normalized.id);
      if (index === -1) shared.sources.push(normalized);
      else shared.sources[index] = normalized;
      ownedSources.add(normalized);
      for (const id of normalized.sourceIds) shared.keepSources.add(id);
      shared.generation += 1;
      return () => {
        ownedSources.delete(normalized);
        removeSource(shared, normalized);
      };
    },

    /** Announce a provider set that changed without a source re-registration. */
    sourceChanged() {
      shared.generation += 1;
    },

    observeExport(name, fn) {
      return subscribeHostExport(name, fn);
    },

    composeModelCatalog(options) {
      return composeModelCatalog(options);
    },

    getHostModelSnapshot(kind) {
      return getHostModelSnapshot(kind);
    },

    routableProviders() {
      const providers = new Set(shared.routable);
      try {
        const snapshot = shared.storage?.credentials?.snapshot?.();
        for (const entry of snapshot?.credentials ?? []) {
          if (typeof entry?.provider === "string" && entry.provider !== "") providers.add(entry.provider);
        }
      } catch {
        // A storage that cannot answer is not a routability signal.
      }
      return providers;
    },

    dispose() {
      for (const source of [...ownedSources]) removeSource(shared, source);
      ownedSources.clear();
      for (const record of [...shared.prototypes]) restorePrototypeHooks(record);
      if (shared.bridge === bridge) shared.bridge = undefined;
      unsubscribeRegistry();
    },
  };

  shared.bridge = bridge;
  return bridge;
}

/** Normalize the two accepted source shapes. */
function normalizeSource(source, shared) {
  if (typeof source === "function") {
    return {
      id: `source-${shared.nextSourceId++}`,
      sourceIds: [],
      kept: new Set(),
      register: source,
    };
  }
  if (source && typeof source === "object" && typeof source.register === "function") {
    const sourceIds = idList(source.sourceIds ?? source.sourceId);
    return {
      id: typeof source.id === "string" && source.id !== "" ? source.id : `source-${shared.nextSourceId++}`,
      sourceIds,
      kept: new Set(sourceIds),
      register: source.register,
    };
  }
  throw new TypeError("registerProviderSource expects a function or an object with register()");
}

/** The latest models the live registry returned for one kind. */
export function getHostModelSnapshot(kind) {
  const shared = state();
  const snapshot = () => {
    if (typeof kind === "string" && kind !== "") {
      return [...(shared.snapshots.get(kind) ?? [])];
    }
    const byRef = new Map();
    for (const models of shared.snapshots.values()) {
      for (const model of models) {
        if (!model || typeof model !== "object") continue;
        const ref = `${model.provider ?? ""}/${model.id ?? ""}`;
        byRef.set(ref, model);
      }
    }
    return [...byRef.values()];
  };

  let models = snapshot();
  if (models.length === 0 && shared.lastRegistry && typeof shared.lastRegistry.getAll === "function") {
    // A caller can ask before the gateway's first catalog read. One lazy read
    // through the wrapper records the snapshot without bypassing the sources.
    const requestedKind = typeof kind === "string" && kind !== "chat" && kind !== "available" ? kind : undefined;
    try {
      shared.lastRegistry.getAll(requestedKind);
    } catch {
      // A registry that cannot answer leaves the snapshot empty.
    }
    models = snapshot();
  }
  return models;
}

/**
 * Merge base `/v1/models` rows with extension rows.
 *
 * Exactly one `github-copilot/auto` row is present when any GitHub Copilot row
 * exists. The row is added here and nowhere else, so two callers cannot produce
 * two descriptors.
 *
 * @param {{base?: object[], extension?: object[]} | object[]} [options]
 */
export function composeModelCatalog(options = {}) {
  const input = Array.isArray(options) ? { base: options } : (options ?? {});
  const base = Array.isArray(input.base) ? input.base : [];
  const extension = Array.isArray(input.extension) ? input.extension : listExtensionProviders();
  const seen = new Set();
  const rows = [];

  const add = (row) => {
    if (!row || typeof row !== "object") return;
    const id = typeof row.id === "string" ? row.id : undefined;
    if (id !== undefined && seen.has(id)) return;
    if (id !== undefined) seen.add(id);
    rows.push(row);
  };
  for (const row of base) add(row);
  for (const row of extension) add(row);

  const isCopilot = (row) =>
    row?.owned_by === "github-copilot" ||
    row?.provider === "github-copilot" ||
    (typeof row?.id === "string" && row.id.startsWith("github-copilot/"));
  const hasAuto = (row) =>
    row?.id === "github-copilot/auto" ||
    (row?.id === "auto" && (row.owned_by === "github-copilot" || row.provider === "github-copilot"));

  if (rows.some(isCopilot) && !rows.some(hasAuto)) add({ ...COPILOT_AUTO_ROW });
  return rows;
}

// ---------------------------------------------------------------------------
// Extension provider metadata (the router reads this, not a feature module)
// ---------------------------------------------------------------------------

/** How long a dynamic extension model refresh stays valid. */
const EXTENSION_REFRESH_TTL_MS = 60_000;
/** Hard deadline for one extension provider's dynamic model fetch. */
const EXTENSION_REFRESH_TIMEOUT_MS = 15_000;

/** Copy one extension entry into the router-facing descriptor. */
function extensionDescriptor(entry) {
  return {
    id: entry.name,
    api: entry.api,
    baseUrl: entry.baseUrl,
    headers: entry.headers && typeof entry.headers === "object" ? { ...entry.headers } : entry.headers,
    streamSimple: entry.streamSimple,
    models: (entry.models ?? []).map((model) => ({ ...model })),
    fetchDynamicModels: entry.fetchDynamicModels,
    resolveApiKey: entry.resolveApiKey,
  };
}

/**
 * Publish the model metadata and transport of one extension provider.
 *
 * The router reads this registry instead of a feature module, so a plugin
 * provider stays fully usable when the host never captures ModelRegistry.
 *
 * @param {string} name
 * @param {{api?: string, baseUrl?: string, headers?: object, models?: object[],
 *   streamSimple?: Function, fetchDynamicModels?: Function,
 *   resolveApiKey?: () => string | undefined}} meta
 * @returns {() => void} a disposer for this exact entry
 */
export function registerExtensionProviderMeta(name, meta) {
  if (typeof name !== "string" || name === "" || !meta || typeof meta !== "object") {
    throw new TypeError("registerExtensionProviderMeta expects a provider name and a metadata object");
  }
  const shared = state();
  const entry = {
    name,
    ...meta,
    models: Array.isArray(meta.models) ? meta.models.map((model) => ({ ...model })) : [],
    headers: meta.headers && typeof meta.headers === "object" ? { ...meta.headers } : meta.headers,
  };
  shared.extensionProviders.set(name, entry);
  // A fresh registration starts a new refresh window.
  shared.extensionRefreshes.delete(name);
  addRoutable(shared, name);
  return () => {
    if (shared.extensionProviders.get(name) === entry) shared.extensionProviders.delete(name);
  };
}

/** Return the metadata of one extension provider, or undefined. */
export function getExtensionProviderMeta(name) {
  const entry = state().extensionProviders.get(name);
  if (!entry) return undefined;
  return { ...entry, models: entry.models.map((model) => ({ ...model })) };
}

/** Return the transport descriptor of one extension provider, or undefined. */
export function getExtensionProvider(name) {
  const entry = state().extensionProviders.get(name);
  return entry ? extensionDescriptor(entry) : undefined;
}

/** List every registered extension provider as a transport descriptor. */
export function listRegisteredExtensionProviders() {
  return [...state().extensionProviders.values()].map(extensionDescriptor);
}

/**
 * Refresh the models of extension providers that declare `fetchDynamicModels`.
 *
 * The token comes from the provider's own `resolveApiKey` or, when that
 * returns nothing, from `credentials.resolve(provider)`. One provider refresh
 * runs at a time, stays valid for 60 seconds and has a 15 second deadline.
 * The method never throws.
 *
 * @param {{credentials?: {resolve?: Function}}} [options]
 * @returns {Promise<void>}
 */
export async function refreshExtensionProviders({ credentials } = {}) {
  const shared = state();
  const entries = [...shared.extensionProviders.values()].filter(
    (entry) => typeof entry.fetchDynamicModels === "function",
  );
  await Promise.all(entries.map((entry) => refreshExtensionProvider(shared, entry, credentials)));
}

/** Refresh one extension provider inside its TTL window. Never rejects. */
async function refreshExtensionProvider(shared, entry, credentials) {
  const record = shared.extensionRefreshes.get(entry.name) ?? { at: 0, running: undefined };
  if (record.running) return record.running;
  const now = Date.now();
  if (now - record.at < EXTENSION_REFRESH_TTL_MS) return undefined;
  record.at = now;
  shared.extensionRefreshes.set(entry.name, record);

  const task = (async () => {
    try {
      let token = entry.resolveApiKey?.();
      if (isThenable(token)) token = await token;
      if (!token && typeof credentials?.resolve === "function") {
        const credential = await credentials.resolve(entry.name);
        token = typeof credential === "string" ? credential : credential?.secret;
      }
      if (typeof token !== "string" || token === "") return;

      const fresh = await withTimeout(entry.fetchDynamicModels(token), EXTENSION_REFRESH_TIMEOUT_MS);
      if (fresh === TIMEOUT || !Array.isArray(fresh) || fresh.length === 0) return;
      if (shared.extensionProviders.get(entry.name) !== entry) return;

      const models = fresh.filter((model) => model && typeof model === "object").map((model) => ({ ...model }));
      if (models.length > 0) entry.models = models;
    } catch (error) {
      verboseLog("host-bridge: dynamic extension model refresh failed", {
        provider: entry.name,
        error: errorMessage(error),
      });
    }
  })();
  record.running = task;
  const settle = () => {
    if (record.running === task) record.running = undefined;
  };
  task.then(settle, settle);
  return task;
}

/**
 * List extension-provider models as OpenAI `/v1/models` rows.
 *
 * A model without a positive context window is not advertised: the router and
 * the gateway cannot route it.
 */
export function listExtensionProviders() {
  const rows = [];
  for (const [name, meta] of state().extensionProviders) {
    for (const model of meta.models ?? []) {
      if (!model || typeof model.id !== "string") continue;
      if (!Number.isFinite(model.contextWindow) || model.contextWindow <= 0) continue;
      rows.push({
        id: `${name}/${model.id}`,
        object: "model",
        owned_by: name,
        api: model.api ?? meta.api,
        context_length: model.contextWindow,
        max_output_tokens: Number.isFinite(model.maxTokens) ? model.maxTokens : 0,
        input_modalities: ["text"],
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Custom (models.yml) provider metadata
// ---------------------------------------------------------------------------

/** How long one resolved `!command` key stays cached. */
const COMMAND_KEY_TTL_MS = 60_000;
/** Hard deadline for one `!command` key. */
const COMMAND_KEY_TIMEOUT_MS = 5_000;

/** Copy one custom provider entry into the router-facing descriptor. */
function customDescriptor(entry) {
  return {
    name: entry.name,
    baseUrl: entry.baseUrl,
    api: entry.api,
    apiKey: entry.apiKey,
    resolveApiKey: entry.resolveApiKey,
    headers: entry.headers && typeof entry.headers === "object" ? { ...entry.headers } : entry.headers,
    authHeader: entry.authHeader,
    compat: entry.compat && typeof entry.compat === "object" ? { ...entry.compat } : entry.compat,
    models: entry.models.map((model) => ({ ...model })),
  };
}

/**
 * Publish one custom provider from models.yml.
 *
 * `config` is the provider config the models bridge registers with the host.
 * The key is resolved lazily: a `!command` runs here, never at import time,
 * never through execSync and never more than once per minute.
 *
 * @param {string} name
 * @param {object} config
 * @returns {() => void} a disposer for this exact entry
 */
export function registerCustomProviderMeta(name, config) {
  if (typeof name !== "string" || name === "" || !config || typeof config !== "object") {
    throw new TypeError("registerCustomProviderMeta expects a provider name and a config object");
  }
  const shared = state();
  const entry = {
    name,
    baseUrl: config.baseUrl,
    api: config.api,
    apiKey: config.apiKey,
    auth: config.auth,
    headers: config.headers,
    authHeader: config.authHeader,
    compat: config.compat,
    models: Array.isArray(config.models) ? config.models.map((model) => ({ ...model })) : [],
    command: { at: 0, value: undefined, pending: undefined },
  };
  entry.resolveApiKey = () => resolveCustomApiKey(entry);
  shared.customProviders.set(name, entry);
  addRoutable(shared, name);
  return () => {
    if (shared.customProviders.get(name) === entry) shared.customProviders.delete(name);
  };
}

/** Return the descriptor of one custom provider, or undefined. */
export function getCustomProvider(name) {
  const entry = state().customProviders.get(name);
  return entry ? customDescriptor(entry) : undefined;
}

/** List every registered custom provider as a descriptor. */
export function listCustomProviders() {
  return [...state().customProviders.values()].map(customDescriptor);
}

/** Resolve one custom provider key. Never throws. */
async function resolveCustomApiKey(entry) {
  const raw = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
  if (raw.startsWith("!")) {
    const command = raw.slice(1).trim();
    return command === "" ? undefined : resolveCommandKey(entry, command);
  }
  if (raw !== "" && raw !== NO_AUTH_SENTINEL && process.env[raw]) return process.env[raw];
  if (entry.auth === "none" || raw === NO_AUTH_SENTINEL) return NO_AUTH_SENTINEL;
  return raw === "" ? undefined : raw;
}

/** Run one command key, cached for 60 seconds. */
async function resolveCommandKey(entry, command) {
  const cache = entry.command;
  const now = Date.now();
  if (cache.at !== 0 && now - cache.at < COMMAND_KEY_TTL_MS) return cache.value;
  if (cache.pending) return cache.pending;

  cache.at = now;
  const task = runCommand(command).then(
    (value) => {
      cache.value = value;
      cache.pending = undefined;
      return value;
    },
    () => {
      cache.value = undefined;
      cache.pending = undefined;
      return undefined;
    },
  );
  cache.pending = task;
  return task;
}

/** Run one shell command with a 5 second deadline. Never throws. */
async function runCommand(command) {
  if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") return undefined;
  let child;
  try {
    child = Bun.spawn(["sh", "-c", command], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    return undefined;
  }
  if (!child?.stdout) return undefined;

  const output = (async () => {
    try {
      const text = await new Response(child.stdout).text();
      return text.trim() || undefined;
    } catch {
      return undefined;
    }
  })();
  const result = await withTimeout(output, COMMAND_KEY_TIMEOUT_MS);
  if (result !== TIMEOUT) return result;
  try {
    child.kill();
  } catch {}
  return undefined;
}

// ---------------------------------------------------------------------------
// Agent directory
// ---------------------------------------------------------------------------

/**
 * Return the agent state directory, cached per environment.
 *
 * Precedence matches OMP: `PI_CODING_AGENT_DIR`, then `OMP_AGENT_DIR`, then
 * `PI_AGENT_DIR`, then `~/.omp/agent`. The cache key includes all three
 * variables, so a test or a profile switch that changes them sees the new path.
 */
export function getAgentDir() {
  const shared = state();
  const env = process.env;
  const key = `${env.PI_CODING_AGENT_DIR ?? ""}\0${env.OMP_AGENT_DIR ?? ""}\0${env.PI_AGENT_DIR ?? ""}`;
  if (shared.agentDir.key === key) return shared.agentDir.value;

  const override = env.PI_CODING_AGENT_DIR || env.OMP_AGENT_DIR || env.PI_AGENT_DIR;
  const value = override || join(homedir(), ".omp", "agent");
  shared.agentDir.key = key;
  shared.agentDir.value = value;
  return value;
}

// ---------------------------------------------------------------------------
// Vendor packages
// ---------------------------------------------------------------------------

/** Import one vendored shim by package name. */
export async function loadVendorShim(name = "@earendil-works/pi-ai") {
  const pkg = VENDOR_PACKAGES.find((candidate) => candidate.name === name);
  if (!pkg) throw new Error(`Unknown vendored package: ${name}`);
  const shared = state();
  const cached = shared.vendor.modules.get(name);
  if (cached) return cached;
  const entry = join(VENDOR_ROOT, pkg.directory, pkg.entry);
  const module = await import(pathToFileURL(entry).href);
  shared.vendor.modules.set(name, module);
  return module;
}

/** Load every vendor module and return a package-name -> namespace map. */
async function loadVendorModules() {
  const modules = new Map();
  for (const pkg of VENDOR_PACKAGES) {
    const root = resolve(VENDOR_ROOT, pkg.directory);
    assertInside(VENDOR_ROOT, root, "vendor package");
    const entry = resolve(root, pkg.entry);
    assertInside(root, entry, "vendor entry");
    modules.set(pkg.name, { entry, module: await import(pathToFileURL(entry).href) });
    for (const [subpath, file] of Object.entries(pkg.subpaths)) {
      const target = resolve(root, file);
      assertInside(root, target, "vendor subpath");
      modules.set(`${pkg.name}/${subpath}`, { entry: target, module: await import(pathToFileURL(target).href) });
    }
  }
  return modules;
}

/** Escape one literal string for use in a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Register the in-memory package mapping with Bun.
 *
 * `build.module` maps the bare specifier to the already-loaded namespace.
 * `onResolve` is registered as well for future Bun versions where the runtime
 * prefilter lets a bare specifier reach it. Both paths target the same files.
 */
function installBunVendorPlugin(modules) {
  const shared = state();
  const existing = globalThis[VENDOR_KEY];
  if (existing?.installed || shared.vendor.pluginInstalled) return;

  Bun.plugin({
    name: "omp-shims:vendor-packages",
    setup(build) {
      for (const pkg of VENDOR_PACKAGES) {
        const root = resolve(VENDOR_ROOT, pkg.directory);
        const rootModule = modules.get(pkg.name);
        if (rootModule) {
          build.module(pkg.name, () => ({ exports: rootModule.module, loader: "object" }));
        }
        for (const [subpath, file] of Object.entries(pkg.subpaths)) {
          const subModule = modules.get(`${pkg.name}/${subpath}`);
          if (!subModule) continue;
          build.module(`${pkg.name}/${subpath}`, () => ({ exports: subModule.module, loader: "object" }));
          void file;
        }
        if (typeof build.onResolve === "function") {
          build.onResolve({ filter: new RegExp(`^${escapeRegExp(pkg.name)}(?:/.*)?$`), namespace: "file" }, (args) => {
            const suffix = args.path === pkg.name ? "" : args.path.slice(pkg.name.length + 1);
            if (suffix === "") return { path: resolve(root, pkg.entry) };
            const file = pkg.subpaths[suffix];
            if (!file) return undefined;
            return { path: resolve(root, file) };
          });
        }
      }
    },
  });

  shared.vendor.pluginInstalled = true;
  shared.vendor.mode = "plugin";
  Object.defineProperty(globalThis, VENDOR_KEY, {
    value: { installed: true },
    configurable: true,
  });
}

/** Hash one directory tree. Symlinks are hashed by their target text, not followed. */
export function hashTree(root) {
  const hash = createHash("sha256");
  let files = 0;
  const walk = (directory, prefix) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        hash.update(`link\0${relativePath}\0${readlinkSync(absolutePath)}\0`);
        continue;
      }
      if (entry.isDirectory()) {
        hash.update(`dir\0${relativePath}\0`);
        walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = readFileSync(absolutePath);
      hash.update(`file\0${relativePath}\0${content.length}\0`);
      hash.update(content);
      files += 1;
    }
  };
  walk(root, "");
  hash.update(`count\0${files}\0`);
  return hash.digest("hex");
}

/** Hash a directory, or null when the path is missing or not a directory. */
function directoryHashOrNull(path) {
  try {
    return statSync(path).isDirectory() ? hashTree(path) : null;
  } catch {
    return null;
  }
}

/** Split `@scope/name` into its two path segments. */
function packageSegments(name) {
  const parts = name.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") throw new Error(`Invalid package name: ${name}`);
  return parts;
}

/** Copy one package with hash comparison and an atomic rename swap. */
function copyVendorPackage(shared, pluginsDir, pkg) {
  const source = resolve(VENDOR_ROOT, pkg.directory);
  assertInside(VENDOR_ROOT, source, "vendor source");
  if (!existsSync(source)) {
    report(`vendor package ${pkg.name} is missing`, { source });
    return false;
  }

  const nodeModules = resolve(pluginsDir, "node_modules");
  const [scope, name] = packageSegments(pkg.name);
  const target = resolve(nodeModules, scope, name);
  assertInside(nodeModules, target, "vendor target");

  const sourceHash = hashTree(source);
  if (existsSync(target) && directoryHashOrNull(target) === sourceHash) {
    verboseLog(`vendor package ${pkg.name} is current`);
    return true;
  }

  const nonce = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const stagingRoot = resolve(pluginsDir, `.omp-shims-vendor-${nonce}`);
  assertInside(pluginsDir, stagingRoot, "vendor staging");
  const staged = join(stagingRoot, "package");
  const backup = resolve(dirname(target), `.${basename(target)}.old-${nonce}`);
  assertInside(nodeModules, backup, "vendor backup");

  let movedOld = false;
  try {
    mkdirSync(stagingRoot, { recursive: true });
    cpSync(source, staged, { recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    if (existsSync(target)) {
      renameSync(target, backup);
      movedOld = true;
    }
    renameSync(staged, target);
    if (movedOld) rmSync(backup, { recursive: true, force: true });
    shared.vendor.mode = "copy";
    return true;
  } catch (error) {
    report(`cannot install vendored ${pkg.name}`, { error: errorMessage(error) });
    if (movedOld && !existsSync(target)) {
      try {
        renameSync(backup, target);
      } catch {
        // The old copy stays at the backup path; the next start installs again.
      }
    }
    return false;
  } finally {
    try {
      rmSync(stagingRoot, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Install the vendored host-compatibility packages.
 *
 * The primary path registers an in-process Bun plugin that resolves the two
 * package names to `vendor/<package>/index.mjs`. It writes nothing to disk. When
 * `Bun.plugin` is unavailable, the packages are copied into
 * `<pluginsDir>/node_modules` with a content-hash check and an atomic rename.
 *
 * A second call in the same process, or in a second worker, sees the marker and
 * leaves the installed state alone.
 *
 * @param {{pluginsDir: string}} options
 * @returns {Promise<{installed: string[], dispose: () => void}>}
 */
export async function installVendorPlugin({ pluginsDir } = {}) {
  const shared = state();
  const directory = pluginsDir;
  const installed = VENDOR_PACKAGES.map((pkg) => pkg.name);
  if (typeof directory !== "string" || directory === "") {
    report("installVendorPlugin requires the runtime plugins directory");
    return { installed: [], dispose() {} };
  }

  let modules;
  try {
    modules = await loadVendorModules();
  } catch (error) {
    report("vendored packages are unavailable", { error: errorMessage(error) });
    return { installed: [], dispose() {} };
  }

  if (typeof Bun !== "undefined" && typeof Bun.plugin === "function") {
    try {
      installBunVendorPlugin(modules);
      return { installed, dispose() {} };
    } catch (error) {
      report("Bun.plugin vendor mapping failed; falling back to a copy", {
        error: errorMessage(error),
      });
    }
  }

  const result = [];
  for (const pkg of VENDOR_PACKAGES) {
    if (copyVendorPackage(shared, directory, pkg)) result.push(pkg.name);
  }
  return { installed: result, dispose() {} };
}
