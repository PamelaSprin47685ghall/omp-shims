// Model traits for routing.
//
// The compiled OMP gateway does not expose ModelRegistry to the preload hook,
// so no single source is complete:
//   host      live ModelRegistry snapshots, when a registry is captured;
//   official  models.db, the authoritative built-in capability cache;
//   custom    models.yml providers published by host-bridge;
//   gateway   the gateway's own /v1/models rows (limits and modalities only);
//   extension installed plugin providers, rows only.
//
// A lookup tries host, official, custom, gateway, then extension. The source
// functions are injected so a test can supply plain arrays.

import {
  getExtensionProvider,
  getHostModelSnapshot,
  listCustomProviders,
  listExtensionProviders,
} from "../host-bridge.mjs";
import { modelsDbPath, officialModels } from "./model-cache.mjs";

/** Return "provider/model-id" split at the first slash. */
export function splitModelRef(ref) {
  const slash = typeof ref === "string" ? ref.indexOf("/") : -1;
  if (slash <= 0) return { provider: undefined, id: typeof ref === "string" ? ref : "" };
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** Levels a plugin's thinkingLevelMap accepts. A null entry refuses a level. */
function levelMapEfforts(levelMap) {
  return Object.entries(levelMap)
    .filter(([level, value]) => level !== "off" && value !== null && value !== undefined)
    .map(([level]) => level);
}

/** Normalize a live host model object into routing traits. */
export function traitsOfHost(model) {
  const levelMap = model.thinkingLevelMap && typeof model.thinkingLevelMap === "object" ? model.thinkingLevelMap : null;
  const declared = Array.isArray(model.thinking?.efforts) ? model.thinking.efforts : null;
  const accepted = levelMap ? levelMapEfforts(levelMap) : null;
  const efforts =
    declared && accepted ? declared.filter((level) => accepted.includes(level)) : [...(declared ?? accepted ?? [])];
  const mustThink = model.thinking?.requiresEffort === true || (levelMap !== null && levelMap.off === null);
  return {
    ref: `${model.provider}/${model.id}`,
    provider: model.provider,
    contextWindow: Number(model.contextWindow) || 0,
    maxTokens: Number(model.maxTokens) || 0,
    input: Array.isArray(model.input) ? [...model.input] : ["text"],
    reasoning: model.reasoning === true,
    efforts,
    canDisable: model.reasoning === true && !mustThink,
    ...(typeof model.baseUrl === "string" && model.baseUrl ? { baseUrl: model.baseUrl } : {}),
  };
}

/** Normalize one /v1/models row into routing traits. */
export function traitsOfRow(row) {
  const { provider } = splitModelRef(row?.id);
  if (!provider) return undefined;
  return {
    ref: row.id,
    provider,
    contextWindow: Number(row.context_length) || 0,
    maxTokens: Number(row.max_output_tokens) || 0,
    input: Array.isArray(row.input_modalities) ? [...row.input_modalities] : ["text"],
    reasoning: false,
    efforts: [],
    canDisable: false,
  };
}

/** Convert one custom provider descriptor into models and rows. */
function customEntries(descriptors) {
  const models = new Map();
  const rows = [];
  for (const provider of descriptors ?? []) {
    if (!provider || typeof provider.name !== "string" || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!model || typeof model.id !== "string" || model.id === "") continue;
      const ref = `${provider.name}/${model.id}`;
      const source = {
        ...model,
        provider: provider.name,
        ...(typeof model.baseUrl === "string" && model.baseUrl ? {} : { baseUrl: provider.baseUrl }),
      };
      models.set(ref, traitsOfHost(source));
      rows.push({
        id: ref,
        object: "model",
        owned_by: provider.name,
        api: provider.api ?? model.api ?? "openai-completions",
        context_length: Number(model.contextWindow) || 0,
        max_output_tokens: Number(model.maxTokens) || 0,
        input_modalities: Array.isArray(model.input) ? [...model.input] : ["text"],
      });
    }
  }
  return { models, rows };
}

/** Store only the trait corrections from the plan; keys starting with "$" are notes. */
function correctionsOf(overrides) {
  const entries = Object.entries(overrides ?? {})
    .filter(([ref]) => !ref.startsWith("$"))
    .map(([ref, fields]) => [ref, Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith("$")))]);
  return Object.fromEntries(entries);
}

/** How long one host snapshot is reused. */
export const CATALOG_SNAPSHOT_TTL_MS = 5_000;
/** How long a gateway /v1/models snapshot counts as fresh. */
export const GATEWAY_SNAPSHOT_TTL_MS = 30_000;

export class ModelCatalog {
  /**
   * @param {{overrides?: Record<string, object>, now?: () => number,
   *   agentDbPath?: string|null, hostSnapshot?: () => object[],
   *   extensionProviders?: () => object[], customProviders?: () => object[],
   *   extensionProvider?: (name: string) => object|undefined,
   *   isRouteModel?: (id: string) => boolean}} [options]
   */
  constructor({
    overrides = {},
    now = Date.now,
    agentDbPath = null,
    hostSnapshot = getHostModelSnapshot,
    extensionProviders = listExtensionProviders,
    customProviders = listCustomProviders,
    extensionProvider = getExtensionProvider,
    isRouteModel = () => false,
  } = {}) {
    this.now = now;
    this.agentDbPath = agentDbPath;
    this.cachePath = modelsDbPath(agentDbPath);
    this.hostSnapshot = hostSnapshot;
    this.extensionProviders = extensionProviders;
    this.extensionProvider = extensionProvider;
    this.customProviders = customProviders;
    this.isRouteModel = isRouteModel;
    this.corrections = correctionsOf(overrides);
    this.host = new Map();
    this.extension = new Map();
    this.extensionRows = [];
    this.custom = new Map();
    this.customRows = [];
    this.gateway = new Map();
    this.extensionNames = new Set();
    this.extensionProviderNames = new Map();
    this.gatewayAt = 0;
    this.snapshotAt = 0;
    this.refreshed = false;
  }

  /** Re-read the host, custom, and extension snapshots. */
  refresh() {
    const at = this.now();
    if (this.refreshed && at - this.snapshotAt < CATALOG_SNAPSHOT_TTL_MS) return this;
    this.snapshotAt = at;
    this.refreshed = true;

    const host = new Map();
    let models = [];
    try {
      models = this.hostSnapshot() ?? [];
    } catch {
      models = [];
    }
    for (const model of models) {
      if (model?.provider && model?.id) host.set(`${model.provider}/${model.id}`, model);
    }
    this.host = host;

    let rows = [];
    try {
      rows = this.extensionProviders() ?? [];
    } catch {
      rows = [];
    }
    const extension = new Map();
    const extensionNames = new Set();
    for (const row of rows) {
      if (row?.object !== "model" || typeof row.id !== "string") continue;
      const traits = traitsOfRow(row);
      if (traits) {
        extension.set(row.id, traits);
        if (traits.provider) extensionNames.add(traits.provider);
      }
    }
    this.extension = extension;
    this.extensionRows = rows.filter((row) => row?.object === "model" && typeof row.id === "string");
    this.extensionNames = extensionNames;
    this.extensionProviderNames = new Map();

    let descriptors = [];
    try {
      descriptors = this.customProviders() ?? [];
    } catch {
      descriptors = [];
    }
    const custom = customEntries(descriptors);
    this.custom = custom.models;
    this.customRows = custom.rows;
    return this;
  }

  /** True when at least one trait source can answer. */
  get ready() {
    return (
      this.host.size > 0 ||
      this.extension.size > 0 ||
      this.custom.size > 0 ||
      this.gateway.size > 0 ||
      typeof this.agentDbPath === "string"
    );
  }

  /**
   * True when the host bridge currently has a live plugin provider of this
   * name. Its model list is authoritative over the stale official cache.
   */
  #isExtensionProvider(provider) {
    if (typeof provider !== "string" || provider === "") return false;
    const cached = this.extensionProviderNames.get(provider);
    if (cached !== undefined) return cached;
    let live = this.extensionNames.has(provider);
    if (!live) {
      try {
        live = Boolean(this.extensionProvider?.(provider));
      } catch {
        live = false;
      }
    }
    this.extensionProviderNames.set(provider, live);
    return live;
  }

  /** True when the gateway snapshot is recent. */
  get gatewaySnapshotFresh() {
    return this.gatewayAt > 0 && this.now() - this.gatewayAt < GATEWAY_SNAPSHOT_TTL_MS;
  }

  /** Keep the model rows returned by the gateway's own /v1/models answer. */
  ingestGatewayModels(rows) {
    if (!Array.isArray(rows)) return false;
    const models = new Map();
    for (const row of rows) {
      if (row?.object !== "model" || typeof row.id !== "string" || !row.id.includes("/")) continue;
      if (this.isRouteModel(row.id)) continue;
      const traits = traitsOfRow(row);
      if (!traits || traits.contextWindow <= 0 || traits.maxTokens <= 0) continue;
      models.set(row.id, traits);
    }
    if (models.size === 0) return false;
    this.gateway = models;
    this.gatewayAt = this.now();
    return true;
  }

  /** True when a native, official, custom, or extension source owns the model. */
  hasNativeModel(ref) {
    if (typeof ref !== "string" || ref === "") return false;
    this.refresh();
    const { provider } = splitModelRef(ref);
    if (this.#isExtensionProvider(provider)) {
      return this.host.has(ref) || this.extension.has(ref);
    }
    if (this.host.has(ref) || this.custom.has(ref) || this.gateway.has(ref) || this.extension.has(ref)) return true;
    return officialModels(provider, { path: this.cachePath, now: this.now }).has(ref);
  }

  /**
   * Traits for "provider/model-id", or undefined when no source knows it.
   * @param {string} ref
   */
  find(ref) {
    if (typeof ref !== "string" || ref === "") return undefined;
    this.refresh();
    const host = this.host.get(ref);
    if (host) return { ...traitsOfHost(host), ...this.corrections[ref] };

    const { provider } = splitModelRef(ref);
    // A registered plugin provider supplies its own live model list. Only the
    // host snapshot and that list answer for it; the official models.db row
    // (and any gateway row built from it) may predate a plugin update.
    if (this.#isExtensionProvider(provider)) {
      const extension = this.extension.get(ref);
      return extension ? { ...extension, ...this.corrections[ref] } : undefined;
    }

    const official = officialModels(provider, { path: this.cachePath, now: this.now }).get(ref);
    if (official) return { ...traitsOfHost(official), ...this.corrections[ref] };

    const custom = this.custom.get(ref);
    if (custom) return { ...custom, ...this.corrections[ref] };

    const gateway = this.gateway.get(ref);
    if (gateway) return { ...gateway, ...this.corrections[ref] };

    const extension = this.extension.get(ref);
    if (extension) return { ...extension, ...this.corrections[ref] };

    return undefined;
  }

  /** The provider-qualified base URL of one model, when a source publishes it. */
  baseUrlOf(ref) {
    this.refresh();
    const host = this.host.get(ref);
    if (typeof host?.baseUrl === "string" && host.baseUrl) return host.baseUrl;
    const { provider } = splitModelRef(ref);
    if (this.#isExtensionProvider(provider)) return undefined;
    const official = officialModels(provider, { path: this.cachePath, now: this.now }).get(ref);
    if (typeof official?.baseUrl === "string" && official.baseUrl) return official.baseUrl;
    return undefined;
  }

  /** /v1/models rows from every source, deduped by id. */
  rows() {
    this.refresh();
    const rows = [];
    const seen = new Set();
    const push = (row) => {
      if (!row || typeof row.id !== "string" || seen.has(row.id)) return;
      seen.add(row.id);
      rows.push(row);
    };
    for (const model of this.host.values()) {
      push({
        id: `${model.provider}/${model.id}`,
        object: "model",
        owned_by: model.provider,
        api: model.api ?? "openai-completions",
        ...(typeof model.name === "string" && model.name ? { display_name: model.name } : {}),
        context_length: Number(model.contextWindow) || 0,
        max_output_tokens: Number(model.maxTokens) || 0,
        input_modalities: Array.isArray(model.input) ? [...model.input] : ["text"],
      });
    }
    for (const row of this.gateway.values()) {
      push({
        id: row.ref,
        object: "model",
        owned_by: row.provider,
        context_length: row.contextWindow,
        max_output_tokens: row.maxTokens,
        input_modalities: row.input,
      });
    }
    for (const row of this.customRows) push(row);
    for (const row of this.extensionRows) push(row);
    return rows;
  }
}
