import { mistralFallbackTraits } from "./mistral-native-fallback.js";
import { customModelTraits } from "./custom-provider-fallback.js";
import { extensionTraits } from "./extension-providers.js";
// Model traits, read from the gateway's own ModelRegistry.
//
// Capabilities (context window, image input, reasoning levels) are never
// hardcoded in the route tables: they come from the same registry the gateway
// routes with, so the vision route and effort fitting follow the catalog when
// providers change their models. registry-capture.js announces the
// ModelRegistry class; the first instance that serves `getAll` is the live one.

/** Registry methods the gateway calls early; any of them reveals the live instance. */
const OBSERVED_METHODS = ["getAll", "getAvailable", "refresh", "find", "registerProvider"];

/** Split "provider/model-id" at the first slash (model ids may contain more). */
export function splitModelRef(ref) {
  const slash = ref.indexOf("/");
  if (slash <= 0) return { provider: undefined, id: ref };
  return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

/** Levels a plugin's thinkingLevelMap accepts (a null entry marks a refused level). */
function levelMapEfforts(levelMap) {
  return Object.entries(levelMap)
    .filter(([level, value]) => level !== "off" && value !== null && value !== undefined)
    .map(([level]) => level);
}

/**
 * Normalize a registry model into the traits the router needs.
 *
 * Reasoning levels come from `thinking.efforts` (what the gateway validates
 * against). A plugin model may also carry a `thinkingLevelMap` (e.g. qoder-cn)
 * describing what its upstream really accepts; the plugin rounds anything else
 * UP, so the router uses the levels both agree on.
 *
 * @returns {{ref: string, provider: string, contextWindow: number, maxTokens: number, input: string[],
 *   reasoning: boolean, efforts: string[], canDisable: boolean, baseUrl?: string}}
 */
export function traitsOf(model) {
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

/** Trait corrections from the policy; keys starting with "$" are annotations. */
function correctionsOf(overrides) {
  return Object.fromEntries(
    Object.entries(overrides).map(([ref, fields]) => [
      ref,
      Object.fromEntries(Object.entries(fields).filter(([key]) => !key.startsWith("$"))),
    ]),
  );
}

/**
 * How long one registry listing is reused. getAll() is not free (other layers
 * hook it), and a status view or a request looks up dozens of models at once.
 */
export const CATALOG_SNAPSHOT_TTL_MS = 5_000;

/** Live view over the gateway's ModelRegistry. */
export class ModelCatalog {
  /**
   * @param {{overrides?: Record<string, object>, now?: () => number}} [options]
   *   overrides: per-model trait corrections ("provider/id" → fields)
   */
  constructor({ overrides = {}, now = Date.now } = {}) {
    /** @type {WeakRef<object>|null} */
    this.registryRef = null;
    this.corrections = correctionsOf(overrides);
    this.now = now;
    /** @type {{registry: object, at: number, byRef: Map<string, object>}|undefined} */
    this.snapshot = undefined;
    // Stock OMP 18.14 no longer exposes ModelRegistry through a lazy getter.
    // Its authenticated /v1/models is the authority for routable native models.
    this.gatewayModels = new Map();
    this.gatewayModelsAt = 0;
  }

  /** Cache only the exact model capabilities returned by the live gateway. */
  ingestGatewayModels(rows) {
    if (!Array.isArray(rows)) return false;
    const models = new Map();
    for (const row of rows) {
      if (row?.object !== "model" || typeof row.id !== "string"
        || !row.id.includes("/") || row.owned_by === "lazy-router"
        || !Number.isFinite(row.context_length) || row.context_length <= 0
        || !Number.isFinite(row.max_output_tokens) || row.max_output_tokens <= 0
        || !Array.isArray(row.input_modalities)) continue;
      const { provider } = splitModelRef(row.id);
      if (!provider) continue;
      models.set(row.id, {
        ref: row.id, provider,
        contextWindow: row.context_length, maxTokens: row.max_output_tokens,
        input: row.input_modalities,
        // /v1/models intentionally has no reasoning/effort fields. Never
        // claim the host supports a level that it did not advertise.
        reasoning: false, efforts: [], canDisable: false,
      });
    }
    this.gatewayModels = models;
    this.gatewayModelsAt = this.now();
    return true;
  }

  get gatewaySnapshotFresh() {
    return this.gatewayModelsAt > 0 && this.now() - this.gatewayModelsAt < 30_000;
  }

  /** Remember the live registry instance. */
  attach(registry) {
    if (registry && typeof registry.getAll === "function") this.registryRef = new WeakRef(registry);
  }

  get ready() {
    return Boolean(this.registryRef?.deref()) || this.gatewayModels.size > 0;
  }

  /** True only when the live host, rather than a shim fallback, owns the model. */
  hasNativeModel(ref) {
    return this.#listing()?.has(ref) === true || this.gatewayModels.has(ref);
  }

  /**
   * Traits for "provider/model-id", or undefined when the gateway cannot route it.
   * @param {string} ref
   */
  find(ref) {
    const model = this.#listing()?.get(ref);
    return model ? { ...traitsOf(model), ...this.corrections[ref] }
      : this.gatewayModels.get(ref)
        ? { ...this.gatewayModels.get(ref), ...this.corrections[ref] }
        : extensionTraits(ref) ?? customModelTraits(ref) ?? mistralFallbackTraits(ref);
  }

  /** The registry's models by "provider/id", listed at most once per TTL. */
  #listing() {
    const registry = this.registryRef?.deref();
    if (!registry) return undefined;
    const held = this.snapshot;
    if (held?.registry === registry && this.now() - held.at < CATALOG_SNAPSHOT_TTL_MS) return held.byRef;
    let models;
    try {
      models = registry.getAll();
    } catch {
      return held?.byRef;
    }
    const byRef = new Map();
    for (const model of models ?? []) {
      if (model?.provider && model?.id) byRef.set(`${model.provider}/${model.id}`, model);
    }
    this.snapshot = { registry, at: this.now(), byRef };
    return byRef;
  }

  /**
   * Hook a ModelRegistry class so its live instance is attached on first use.
   * Mirrors models-bridge: the class arrives through registry-capture.js.
   */
  observe(host) {
    if (!host?.observe) return false;
    const hooked = new WeakSet();
    const attachFrom = (RegistryClass) => {
      const proto = RegistryClass?.prototype;
      if (!proto || hooked.has(proto)) return;
      hooked.add(proto);
      const catalog = this;
      for (const method of OBSERVED_METHODS) {
        const original = proto[method];
        if (typeof original !== "function") continue;
        proto[method] = function observedRegistryMethod(...args) {
          catalog.attach(this);
          return original.apply(this, args);
        };
      }
    };
    host.observe("ModelRegistry", attachFrom);
    attachFrom(host.captured?.get("ModelRegistry"));
    return true;
  }
}
