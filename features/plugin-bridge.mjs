// Plugin bridge: expose installed OMP plugins to the auth-gateway.
//
// The gateway builds its model table from providers it can see at startup, so
// plugin-provided providers are absent and every request for them fails with
// `Unknown model`. This feature loads the installed plugins the same way the
// agent does and registers their providers through the registry's own public
// `registerProvider` method, so models, API adapters and the routing table all
// come from stock OMP code.
//
// Every registration goes through host-bridge.mjs. That module owns the single
// ModelRegistry.prototype hook, the one source order, the one-model guard and
// the vendor package mapping. This file only discovers plugins, prepares their
// providers and supplies credentials.
//
// Credentials are resolved from `CredentialRepository.resolveTokenSpec`; no
// database row is written by this bridge.
//
// Each provider's full transport and token resolver is published to
// lib/host-bridge.mjs, so the lazy router can serve it without a captured
// ModelRegistry.
//
// Known upstream gap: the auth-broker refresh sweep resolves OAuth providers
// from its own built-in registry and never constructs a ModelRegistry, so a
// plugin OAuth provider that the broker does not know is refreshed as a
// built-in and fails. The plugin bridge registers the config with the host's
// captured `registerOAuthProvider` export as soon as it exists; it does not
// imitate a broker fix.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { activePin, report, verboseLog } from "../lib/contracts.mjs";
import {
  getHostBridge,
  installHostBridge,
  installVendorPlugin,
  loadVendorShim,
  registerExtensionProviderMeta,
} from "../lib/host-bridge.mjs";

const PLUGIN_SOURCE = "omp-shims:plugin-bridge";
const DEFAULT_EAGER_TIMEOUT_MS = 15_000;

/** Read one JSON file. Undefined on any failure. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** True when a manifest value declares at least one entry. */
function hasEntries(value) {
  return typeof value === "string" || (Array.isArray(value) && value.length > 0);
}

/** True when `value` names a file or directory inside `root`. */
function isInside(root, value) {
  const rel = relative(resolve(root), resolve(value));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Resolve a declared extension entry. Directories expand to their index file. */
function resolveEntryFile(packageDir, entry) {
  if (typeof entry !== "string" || entry === "" || isAbsolute(entry)) return undefined;
  const candidate = resolve(packageDir, entry);
  if (!isInside(packageDir, candidate)) return undefined;

  let stat;
  try {
    stat = statSync(candidate);
  } catch {
    return undefined;
  }
  if (stat.isFile()) return candidate;
  if (!stat.isDirectory()) return undefined;

  for (const name of ["index.js", "index.mjs", "index.ts", "index.cjs"]) {
    const index = join(candidate, name);
    try {
      if (statSync(index).isFile()) return index;
    } catch {}
  }
  return undefined;
}

/** Append resolved entries from one manifest value. */
function addManifestEntries(out, packageDir, value) {
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    const resolved = resolveEntryFile(packageDir, entry);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
}

/**
 * Extension entry points of one installed plugin.
 *
 * Preference: `omp.extensions`, then `pi.extensions`, then `main`. A bare
 * `index.js` in the package directory is never assumed to be an extension.
 * Feature entries follow the lockfile's enabled-feature selection: an array
 * selects exactly those features; null selects features with `default: true`.
 */
export function entryPointsOf(packageDir, packageJson, manifest, enabledFeatures = null) {
  if (!packageDir || !packageJson || typeof packageJson !== "object") return [];
  const out = [];

  if (hasEntries(packageJson.omp?.extensions)) {
    addManifestEntries(out, packageDir, packageJson.omp.extensions);
  } else if (hasEntries(packageJson.pi?.extensions)) {
    addManifestEntries(out, packageDir, packageJson.pi.extensions);
  } else if (typeof packageJson.main === "string" && packageJson.main !== "") {
    addManifestEntries(out, packageDir, packageJson.main);
  }

  const features = manifest?.features;
  if (features && typeof features === "object") {
    const enabled = Array.isArray(enabledFeatures)
      ? enabledFeatures
      : enabledFeatures === null
        ? Object.keys(features).filter((name) => features[name]?.default === true)
        : [];
    for (const name of enabled) {
      const feature = features[name];
      if (feature && hasEntries(feature.extensions)) addManifestEntries(out, packageDir, feature.extensions);
    }
  }

  return out;
}

/** Resolve one package name under node_modules without allowing `..` escapes. */
function packagePath(nodeModules, name) {
  if (typeof name !== "string" || name === "" || isAbsolute(name)) return undefined;
  const candidate = resolve(nodeModules, name);
  if (!isInside(nodeModules, candidate) || candidate === resolve(nodeModules)) return undefined;
  return candidate;
}

/**
 * Enumerate enabled plugins.
 *
 * Names come from the plugins workspace `package.json` dependencies and from
 * `omp-plugins.lock.json`. A lock entry with `enabled: false` is skipped. A
 * package without an `omp` or `pi` manifest is not an OMP plugin and is left
 * alone, so unrelated dependencies never run in the gateway.
 *
 * @returns {Array<{name: string, version: string, packageDir: string, entries: string[], enabledFeatures: string[] | null}>}
 */
export function discoverPlugins(pluginsDir) {
  const nodeModules = join(pluginsDir, "node_modules");
  if (!existsSync(nodeModules)) return [];

  const packageJson = readJson(join(pluginsDir, "package.json")) ?? {};
  const lock = readJson(join(pluginsDir, "omp-plugins.lock.json")) ?? {};
  const lockPlugins = lock.plugins && typeof lock.plugins === "object" ? lock.plugins : {};

  const names = new Set(Object.keys(packageJson.dependencies ?? {}));
  for (const name of Object.keys(lockPlugins)) names.add(name);
  names.delete("omp-shims");

  const plugins = [];
  for (const name of names) {
    const runtime = lockPlugins[name];
    if (runtime && runtime.enabled === false) {
      verboseLog(`plugin ${name} is disabled in the lockfile`);
      continue;
    }
    const packageDir = packagePath(nodeModules, name);
    if (!packageDir || !existsSync(packageDir)) continue;

    const manifestJson = readJson(join(packageDir, "package.json"));
    if (!manifestJson) {
      report(`plugin ${name} has no readable package.json`);
      continue;
    }
    const manifest = manifestJson.omp ?? manifestJson.pi;
    if (!manifest || typeof manifest !== "object") continue;

    const enabledFeatures = Array.isArray(runtime?.enabledFeatures) ? runtime.enabledFeatures : null;
    const entries = entryPointsOf(packageDir, manifestJson, manifest, enabledFeatures);
    if (entries.length === 0) {
      verboseLog(`plugin ${name} declares no extension entry`);
      continue;
    }
    plugins.push({
      name,
      version: typeof manifestJson.version === "string" ? manifestJson.version : "0.0.0",
      packageDir,
      entries,
      enabledFeatures,
    });
  }
  return plugins;
}

/**
 * Minimal plugin host for the gateway.
 *
 * Interactive-only methods are reported, not silently ignored. Unknown
 * properties stay undefined so a plugin's feature probe reports the truth.
 */
export function createPluginHost(onProvider, { onUnregister } = {}) {
  const eventHandlers = new Map();
  const reported = new Set();

  const unsupported = (name) => {
    if (reported.has(name)) return;
    reported.add(name);
    report(`plugin host: ${name}() is not implemented in the gateway; ignored`);
  };

  const on = (event, handler) => {
    if (typeof event !== "string" || typeof handler !== "function") {
      unsupported("on");
      return () => {};
    }
    let handlers = eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) eventHandlers.delete(event);
    };
  };

  return {
    registerProvider(id, config) {
      if (typeof id !== "string" || id === "" || !config || typeof config !== "object") {
        report("plugin host: registerProvider expects a provider name and a config object", { id });
        return;
      }
      onProvider(id, config);
    },
    unregisterProvider(id) {
      if (typeof id !== "string" || id === "") {
        report("plugin host: unregisterProvider expects a provider name");
        return;
      }
      onUnregister?.(id);
    },
    registerCommand() {
      unsupported("registerCommand");
    },
    registerTool() {
      unsupported("registerTool");
    },
    registerHook() {
      unsupported("registerHook");
    },
    registerSkill() {
      unsupported("registerSkill");
    },
    registerTheme() {
      unsupported("registerTheme");
    },
    on,
    events: {
      on,
      emit(event, ...args) {
        for (const handler of eventHandlers.get(event) ?? []) {
          try {
            handler(...args);
          } catch (error) {
            report(`plugin event "${event}" handler failed`, { error: errorMessage(error) });
          }
        }
      },
    },
  };
}

/** Run one asynchronous step with a hard deadline. Never rejects on timeout. */
async function withDeadline(task, timeoutMs) {
  const TIMEOUT = Symbol.for("omp-shims.timeout");
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(TIMEOUT), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Install the plugin bridge.
 *
 * @param {{pluginsDir?: string | null, plugins?: string[] | null, eagerTimeoutMs?: number}} config
 * @param {{log?: Function, tokens?: Record<string, unknown>, storage?: object, paths?: {pluginsDir?: string, agentDbPath?: string, brokerTokenPath?: string}}} context
 * @returns {Promise<() => void>} a disposer
 */
export async function install(config = {}, context = {}) {
  const log = context.log ?? verboseLog;
  const pluginsDir = config.pluginsDir ?? context.paths?.pluginsDir;
  if (typeof pluginsDir !== "string" || pluginsDir === "") {
    log("plugin-bridge: no plugins directory configured");
    return () => {};
  }
  const tokenSpecs = context.tokens ?? {};
  const only = Array.isArray(config.plugins) ? new Set(config.plugins) : null;

  const advertised = discoverPlugins(pluginsDir).filter((plugin) => !only || only.has(plugin.name));
  if (advertised.length === 0) log("plugin-bridge: no external plugins found", { pluginsDir });
  else log(`plugin-bridge: discovered ${advertised.length} plugin(s) in ${pluginsDir}`);

  // A plugin imports `@earendil-works/pi-ai` at module load, so the mapping has
  // to exist before the first plugin import. This is the only caller of the
  // vendor installer.
  const vendor = await installVendorPlugin({ pluginsDir });
  if (vendor.installed.length > 0) verboseLog("plugin-bridge: vendor packages ready", { packages: vendor.installed });

  const bridge = getHostBridge() ?? installHostBridge({ storage: context.storage });
  const shim = await loadVendorShim("@earendil-works/pi-ai");
  let unsubscribeHostStream = () => {};
  if (typeof shim?.setHostStream === "function") {
    unsubscribeHostStream = bridge.observeExport("streamSimple", (fn) => {
      if (typeof fn === "function") {
        shim.setHostStream(fn);
        verboseLog("plugin-bridge: host streamSimple connected");
      }
    });
  }

  /** provider id -> { config, sourceId, packageName } */
  const prepared = new Map();
  /** provider id -> disposer for its extension metadata */
  const metaDisposers = new Map();
  /** provider ids removed by a plugin and still registered in a live registry */
  const removedProviders = new Set();
  /** provider id -> OAuth config waiting for registerOAuthProvider */
  const pendingOauth = new Map();
  const registeredOauth = new Set();
  let registerOauthExport;
  let oauthUnavailableReported = false;
  let stopped = false;
  let timedOut = false;

  const unsubscribeOauth = bridge.observeExport("registerOAuthProvider", (fn) => {
    registerOauthExport = fn;
    if (typeof fn === "function") flushOauth(fn);
  });

  function flushOauth(register) {
    if (typeof register !== "function") return;
    for (const [id, oauth] of pendingOauth) {
      if (registeredOauth.has(id)) {
        pendingOauth.delete(id);
        continue;
      }
      try {
        register({ ...oauth, id, sourceId: `${PLUGIN_SOURCE}:oauth` });
        registeredOauth.add(id);
        pendingOauth.delete(id);
        verboseLog(`plugin-bridge: registered OAuth provider ${id}`);
      } catch (error) {
        report(`plugin-bridge: registerOAuthProvider(${id}) failed`, { error: errorMessage(error) });
      }
    }
  }

  function bridgeOauth(id, oauth) {
    if (registeredOauth.has(id) || !oauth || typeof oauth !== "object") return;
    pendingOauth.set(id, oauth);
    if (typeof registerOauthExport === "function") flushOauth(registerOauthExport);
    else if (!oauthUnavailableReported) {
      oauthUnavailableReported = true;
      log("plugin-bridge: host registerOAuthProvider unavailable; OAuth registration deferred");
    }
  }

  /** Resolve configured token specs. Loaded lazily so a missing module never blocks install. */
  let resolveTokenSpec = () => undefined;
  async function loadCredentialResolver() {
    try {
      const { CredentialRepository } = await import("../lib/credentials.mjs");
      const repository = new CredentialRepository({
        agentDbPath: context.paths?.agentDbPath,
        brokerTokenPath: context.paths?.brokerTokenPath,
      });
      resolveTokenSpec = (spec) => repository.resolveTokenSpec(spec);
    } catch (error) {
      report("plugin-bridge: credential repository unavailable", { error: errorMessage(error) });
    }
  }

  function applyConfiguredToken(registry, id) {
    if (!tokenSpecs || typeof tokenSpecs !== "object" || !Object.hasOwn(tokenSpecs, id)) return;
    const token = resolveTokenSpec(tokenSpecs[id]);
    if (!token) {
      verboseLog(`plugin-bridge: no credential configured for ${id}`);
      return;
    }
    const keys = registry?.authStorage?.keys;
    if (!keys || typeof keys.setConfig !== "function") {
      verboseLog(`plugin-bridge: registry has no authStorage.keys.setConfig for ${id}`);
      return;
    }
    try {
      keys.setConfig(id, token);
    } catch (error) {
      report(`plugin-bridge: setConfig(${id}) failed`, { error: errorMessage(error) });
    }
  }

  /** Resolve one provider token from the configured token specs. */
  function resolveConfiguredToken(id) {
    if (!tokenSpecs || typeof tokenSpecs !== "object" || !Object.hasOwn(tokenSpecs, id)) return undefined;
    return resolveTokenSpec(tokenSpecs[id]);
  }

  /** Prepare one provider config. No event-shape rewriting is done. */
  function prepareProvider(id, rawConfig, packageName) {
    if (!rawConfig || typeof rawConfig !== "object") return undefined;
    if (
      !Array.isArray(rawConfig.models) &&
      typeof rawConfig.streamSimple !== "function" &&
      typeof rawConfig.fetchDynamicModels !== "function"
    ) {
      log(`plugin-bridge: ignoring ${id} from ${packageName} (no models or transport)`);
      return undefined;
    }

    const providerConfig = { ...rawConfig };
    if (providerConfig.oauth === true) delete providerConfig.oauth;
    if (
      providerConfig.oauth !== undefined &&
      (typeof providerConfig.oauth !== "object" || providerConfig.oauth === null)
    ) {
      delete providerConfig.oauth;
    }

    if (typeof providerConfig.streamSimple === "function") {
      const transport = providerConfig.streamSimple;
      const wrapped = (model, streamContext, options) => {
        const pin = activePin(id);
        const next = pin?.secret ? { ...options, apiKey: pin.secret } : options;
        return transport(model, streamContext, next);
      };
      providerConfig.streamSimple = wrapped;
      if (typeof providerConfig.api === "string" && providerConfig.api !== "") {
        shim.registerTransport?.(providerConfig.api, wrapped);
      }
    }

    const sourceId = `${PLUGIN_SOURCE}:${packageName}`;
    return { id, config: providerConfig, sourceId, packageName };
  }

  function rememberProvider(id, providerConfig, packageName) {
    const entry = prepareProvider(id, providerConfig, packageName);
    if (!entry) return;
    prepared.set(id, entry);

    if (providerConfig.oauth && typeof providerConfig.oauth === "object") {
      bridgeOauth(id, providerConfig.oauth);
    }

    metaDisposers.get(id)?.();
    metaDisposers.set(
      id,
      registerExtensionProviderMeta(id, {
        api: entry.config.api,
        baseUrl: entry.config.baseUrl,
        headers: entry.config.headers,
        models: entry.config.models,
        streamSimple: entry.config.streamSimple ?? shim?.streamSimple,
        fetchDynamicModels: providerConfig.fetchDynamicModels,
        resolveApiKey: () => resolveConfiguredToken(id),
      }),
    );
    // A provider may be registered after eager init (OAuth-only first, models
    // after login, or a slow plugin that outlived the deadline). Bump the
    // generation so the next getAll applies the new set.
    bridge.sourceChanged();
  }

  /** Create the host bridge source. Called again after eager init to bump the generation. */
  let sourceDispose;
  function publishSource() {
    sourceDispose?.();
    sourceDispose = bridge.registerProviderSource({
      id: "plugin-bridge",
      register(registry, helpers) {
        if (removedProviders.size > 0) {
          for (const id of removedProviders) {
            if (typeof registry.unregisterProvider !== "function") continue;
            try {
              registry.unregisterProvider(id);
            } catch (error) {
              report(`plugin-bridge: unregisterProvider(${id}) failed`, { error: errorMessage(error) });
            }
          }
          removedProviders.clear();
        }
        for (const [id, entry] of prepared) {
          if (stopped) return;
          try {
            helpers.registerProvider(registry, id, entry.config, entry.sourceId);
            helpers.keepSource(entry.sourceId);
            helpers.noteRoutable(id);
            applyConfiguredToken(registry, id);
            if (entry.config.oauth && typeof entry.config.oauth === "object") {
              bridgeOauth(id, entry.config.oauth);
            }
          } catch (error) {
            report(`plugin-bridge: registerProvider(${id}) failed`, { error: errorMessage(error) });
          }
        }
      },
    });
  }

  publishSource();
  await loadCredentialResolver();

  const eagerTimeoutMs =
    Number.isFinite(config.eagerTimeoutMs) && config.eagerTimeoutMs > 0
      ? config.eagerTimeoutMs
      : DEFAULT_EAGER_TIMEOUT_MS;

  const eager = (async () => {
    for (const plugin of advertised) {
      for (const entry of plugin.entries) {
        if (stopped || timedOut) return;
        let module;
        try {
          module = await import(entry);
        } catch (error) {
          report(`plugin-bridge: cannot import ${entry}`, { error: errorMessage(error) });
          continue;
        }
        const init = module?.default ?? module;
        if (typeof init !== "function") {
          verboseLog(`plugin-bridge: ${entry} has no initializer function`);
          continue;
        }
        try {
          await init(
            createPluginHost((id, providerConfig) => rememberProvider(id, providerConfig, plugin.name), {
              onUnregister(id) {
                prepared.delete(id);
                pendingOauth.delete(id);
                registeredOauth.delete(id);
                removedProviders.add(id);
                metaDisposers.get(id)?.();
                metaDisposers.delete(id);
                bridge.sourceChanged();
              },
            }),
          );
        } catch (error) {
          report(`plugin-bridge: ${plugin.name} threw during init`, { error: errorMessage(error) });
        }
      }
    }
  })();

  const outcome = await withDeadline(
    eager.catch((error) => {
      report("plugin-bridge: eager init failed", { error: errorMessage(error) });
      return undefined;
    }),
    eagerTimeoutMs,
  );
  if (outcome === Symbol.for("omp-shims.timeout")) {
    timedOut = true;
    report(`plugin-bridge: eager init exceeded ${eagerTimeoutMs}ms; continuing with ${prepared.size} provider(s)`);
    // The import/init that outlived the deadline may still add providers. Bump
    // the source generation once it settles so the next getAll sees them.
    void eager
      .then(() => {
        if (!stopped) publishSource();
      })
      .catch(() => {});
  } else {
    log(`plugin-bridge: prepared ${prepared.size} provider(s)`);
  }

  // Eager init may have completed after the deadline or added providers; make
  // every live registry apply the current set on its next getAll/refresh.
  publishSource();

  return () => {
    stopped = true;
    sourceDispose?.();
    for (const disposeMeta of metaDisposers.values()) disposeMeta();
    metaDisposers.clear();
    unsubscribeOauth();
    unsubscribeHostStream?.();
  };
}
