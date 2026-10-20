// Models bridge: expose custom models declared in models.yml to the auth-gateway.
//
// The auth-gateway constructs its ModelRegistry with `ignoreLocalModelConfig: true`,
// which deliberately skips loading ~/.omp/agent/models.yml to prevent local config
// from redirecting broker-backed traffic. As a result, custom providers and models
// manually specified in models.yml only work inside interactive omp, returning
// `Unknown model` when requested through the auth-gateway reverse proxy.
//
// Furthermore, the gateway restricts routable models to providers present in the
// auth-broker credential snapshot (`storage.credentials.snapshot().credentials`).
// Providers configured solely via models.yml have no broker row and would otherwise
// be pruned from the gateway's routable catalog.
//
// This feature bridges that gap:
//   1. Reads models.yml from the agent directory (or configured path);
//   2. Registers each custom provider and its models into the gateway's ModelRegistry
//      using the public `registerProvider` method (which bypasses ignoreLocalModelConfig);
//   3. Supplies the provider's API key into `authStorage.keys` via `setConfig`;
//   4. Augments `authStorage.credentials.snapshot` so the gateway's routability filter
//      includes these custom providers in its route table.
//
// Only public, stable surface is used: ModelRegistry.registerProvider and
// authStorage.keys.setConfig. No minified identifiers are referenced.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const SOURCE_ID = "omp-shims:models-bridge";

/** Resolve the active agent state directory. */
export function getAgentDir() {
  const override = process.env.OMP_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? process.env.PI_CODING_AGENT_DIR;
  if (override) return override;
  return join(homedir(), ".omp", "agent");
}

/** Locate models.yml or models.yaml, respecting explicit paths and environment overrides. */
export function findModelsPath(configuredPath) {
  if (configuredPath) {
    return existsSync(configuredPath) ? configuredPath : null;
  }

  const envPath = process.env.OMP_SHIMS_MODELS_PATH ?? process.env.OMP_MODELS_PATH ?? process.env.PI_MODELS_PATH;
  if (envPath) {
    return existsSync(envPath) ? envPath : null;
  }

  const agentDir = getAgentDir();
  const candidates = [
    join(agentDir, "models.yml"),
    join(agentDir, "models.yaml"),
    join(homedir(), ".omp", "agent", "models.yml"),
    join(homedir(), ".omp", "agent", "models.yaml"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Parse a YAML string into a JS object using Bun's native parser or a fallback. */
export function parseYaml(text) {
  if (!text || typeof text !== "string") return null;
  if (typeof Bun !== "undefined" && typeof Bun.YAML?.parse === "function") {
    try {
      return Bun.YAML.parse(text);
    } catch {
      return null;
    }
  }
  try {
    const yaml = require_("yaml");
    return yaml.parse(text);
  } catch {
    return null;
  }
}

/** Load and parse models.yml from disk. */
export function loadModelsConfig(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf8");
    return parseYaml(content);
  } catch {
    return null;
  }
}

/**
 * Resolve an API key string: honours command-backed keys (`!command`),
 * environment variable names, or literal tokens.
 */
export function resolveApiKey(rawKey) {
  if (typeof rawKey !== "string") return undefined;
  const trimmed = rawKey.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("!")) {
    try {
      const cmd = trimmed.slice(1).trim();
      const { execSync } = require_("node:child_process");
      const output = execSync(cmd, { encoding: "utf8", timeout: 5000 });
      const val = output.trim();
      return val || undefined;
    } catch {
      return undefined;
    }
  }

  if (process.env[trimmed]) return process.env[trimmed];
  return trimmed;
}

/**
 * Extract custom providers that have `models` defined from a parsed models.yml document.
 * Providers without custom models (e.g. override-only entries) are ignored.
 */
export function extractCustomProviders(doc) {
  if (!doc || typeof doc !== "object") return [];
  const providers = doc.providers;
  if (!providers || typeof providers !== "object") return [];

  const results = [];
  for (const [providerName, rawConfig] of Object.entries(providers)) {
    if (!rawConfig || typeof rawConfig !== "object") continue;
    if (!Array.isArray(rawConfig.models) || rawConfig.models.length === 0) continue;

    const baseUrl = rawConfig.baseUrl || rawConfig.models.find((m) => m?.baseUrl)?.baseUrl;
    if (!baseUrl || typeof baseUrl !== "string") continue;

    const api = rawConfig.api || rawConfig.models.find((m) => m?.api)?.api || "openai-completions";
    const apiKey = resolveApiKey(rawConfig.apiKey) || (rawConfig.auth === "none" ? "none" : undefined);

    const models = [];
    for (const rawModel of rawConfig.models) {
      if (!rawModel || typeof rawModel !== "object" || !rawModel.id) continue;
      const override = rawConfig.modelOverrides?.[rawModel.id];
      const merged = override ? { ...rawModel, ...override } : { ...rawModel };
      if (!merged.api) merged.api = api;
      models.push(merged);
    }
    if (models.length === 0) continue;

    results.push({
      name: providerName,
      config: {
        baseUrl,
        api,
        apiKey: apiKey || (rawConfig.auth ? "no-auth" : undefined),
        headers: rawConfig.headers,
        compat: rawConfig.compat,
        authHeader: rawConfig.authHeader,
        models,
      },
    });
  }
  return results;
}

export function install(config, context) {
  const log = context.log ?? (() => {});
  const configuredPath = config?.modelsPath ?? process.env.OMP_SHIMS_MODELS_PATH;

  const registeredProviders = new Set();
  const tokens = new Map();
  /** Registries that already hold the custom providers. */
  const populated = new WeakSet();
  /** Registries whose syncExtensionSources already keeps our source. */
  const syncHooked = new WeakSet();
  let running = false;

  function registerInto(registry) {
    if (running || !registry) return;
    running = true;

    try {
      const modelsFile = findModelsPath(configuredPath);
      if (!modelsFile) {
        log("models-bridge: no models.yml found");
        return;
      }

      const parsedDoc = loadModelsConfig(modelsFile);
      if (!parsedDoc) {
        log(`models-bridge: cannot parse ${modelsFile}`);
        return;
      }

      const customProviders = extractCustomProviders(parsedDoc);
      if (customProviders.length === 0) {
        log(`models-bridge: no custom providers with models found in ${modelsFile}`);
        return;
      }

      const sources = new Set();
      for (const { name, config: providerConfig } of customProviders) {
        try {
          registry.registerProvider(name, providerConfig, SOURCE_ID);
          registeredProviders.add(name);
          sources.add(SOURCE_ID);
          if (providerConfig.apiKey) {
            tokens.set(name, providerConfig.apiKey);
          }
          log(`models-bridge: registered ${name} (${providerConfig.models.length} models) from ${modelsFile}`);
        } catch (error) {
          log(`models-bridge: registerProvider(${name}) failed: ${error.message}`);
        }
      }

      // Preserve registered provider source so syncExtensionSources doesn't drop it
      // Once per registry: every wrap adds a layer every later call walks through.
      const sync = registry.syncExtensionSources?.bind(registry);
      if (typeof sync === "function" && sources.size > 0 && !syncHooked.has(registry)) {
        syncHooked.add(registry);
        registry.syncExtensionSources = (enabled) => {
          const merged = enabled instanceof Set ? new Set(enabled) : new Set(enabled ?? []);
          for (const source of sources) merged.add(source);
          return sync(merged);
        };
      }

      // Install API keys into authStorage.keys so resolveGatewayApiKey can resolve them
      const keys = registry.authStorage?.keys;
      if (keys && typeof keys.setConfig === "function") {
        for (const [provider, token] of tokens) {
          try {
            keys.setConfig(provider, token);
            log(`models-bridge: credential configured for ${provider}`);
          } catch (error) {
            log(`models-bridge: setConfig(${provider}) failed: ${error.message}`);
          }
        }
      }

      // Hook authStorage.credentials.snapshot so gatewayRoutableProviders recognizes these providers
      const credentials = registry.authStorage?.credentials;
      if (credentials && typeof credentials.snapshot === "function" && !credentials.__modelsBridgeHooked) {
        credentials.__modelsBridgeHooked = true;
        const origSnapshot = credentials.snapshot.bind(credentials);
        credentials.snapshot = (...args) => {
          const snap = origSnapshot(...args);
          if (!snap || !Array.isArray(snap.credentials)) return snap;
          const existing = new Set(snap.credentials.map((c) => c.provider));
          const extra = [];
          for (const provider of registeredProviders) {
            if (!existing.has(provider)) {
              extra.push({
                id: -1,
                provider,
                credential: { type: "api_key", key: tokens.get(provider) ?? "" },
                identityKey: null,
              });
            }
          }
          if (extra.length === 0) return snap;
          return {
            ...snap,
            credentials: [...snap.credentials, ...extra],
          };
        };
        log(`models-bridge: hooked authStorage.credentials.snapshot for ${registeredProviders.size} providers`);
      }
    } finally {
      // Also when models.yml is missing or empty: getAll stays cheap, and a
      // file added later is picked up on the next refresh().
      populated.add(registry);
      running = false;
    }
  }

  const hooks = new WeakSet();

  function hookRegistryClass(ModelRegistryClass) {
    const proto = ModelRegistryClass?.prototype;
    if (!proto || hooks.has(proto)) return;
    hooks.add(proto);

    for (const method of ["refresh", "getAll"]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function (...args) {
        if (method === "getAll") {
          // getAll is a hot read path (called per lookup): populate a registry
          // once; refresh(), which may rebuild the provider list, re-registers.
          if (!populated.has(this)) registerInto(this);
          return original.apply(this, args);
        }
        return Promise.resolve(original.apply(this, args)).then((res) => {
          registerInto(this);
          return res;
        });
      };
    }
    log("models-bridge: hooked ModelRegistry refresh/getAll");
  }

  const host = globalThis.__OMP_SHIMS_HOST__;
  if (!host?.observe) {
    log("models-bridge: host capture unavailable (is registry-capture.js preloaded first?)");
    return;
  }
  host.observe("ModelRegistry", hookRegistryClass);
  hookRegistryClass(host.captured?.get("ModelRegistry"));
  log("models-bridge: observing ModelRegistry");
}
