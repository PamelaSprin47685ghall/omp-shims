// Models bridge: expose custom models declared in models.yml to the gateway.
//
// The auth-gateway constructs its ModelRegistry with `ignoreLocalModelConfig:
// true`, which deliberately skips loading ~/.omp/agent/models.yml to prevent
// local config from redirecting broker-backed traffic. As a result, custom
// providers in models.yml only work inside interactive omp and return
// `Unknown model` through the gateway.
//
// This feature registers those providers through the public `registerProvider`
// method (which bypasses ignoreLocalModelConfig). It preserves every field of
// the provider entry, including transport, remoteCompaction, requestMetadata,
// headers, authHeader, compat, modelOverrides, guardrailIdentifier, discovery
// and disableStrictTools. `apiKey: "!command"` is passed through unchanged: the
// host's own resolve-config-value.ts runs the command. This module never calls
// execSync.
//
// The full provider config is also published to lib/host-bridge.mjs at install
// time. The lazy router reads that registry directly, so models.yml providers
// stay routable even when the host never captures ModelRegistry.
//
// Known upstream limitation: `gatewayRoutableProviders()` in auth-gateway-cli
// reads only `storage.credentials.snapshot()`. It has no extension point, so a
// provider that exists only in models.yml is in the registry but not in the
// gateway's routable-provider set. This module does not fabricate a snapshot
// row (the v1 `id: -1` bug). It reports the provider through
// `hostBridge.routableProviders()` so the router can admit it, and the gap
// stays visible in this comment instead of being papered over.
//
// A models.yml provider with `auth: "oauth"` has no runtime representation:
// `registerProvider` requires an apiKey or an OAuth config object, and
// inventing either would shadow the broker credential. Its registration is
// reported and skipped; the provider stays usable inside interactive omp,
// which loads the file with the full models.yml schema.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { NO_AUTH_SENTINEL, verboseLog } from "../lib/contracts.mjs";
import { getAgentDir, getHostBridge, installHostBridge, registerCustomProviderMeta } from "../lib/host-bridge.mjs";

const require_ = createRequire(import.meta.url);
const SOURCE_ID = "omp-shims:models-bridge";

/**
 * Resolve models.yml or models.yaml.
 *
 * An explicit path wins. Otherwise the agent directory selected by the
 * runtime path contract (`context.paths.agentDbPath`) or `getAgentDir()`
 * supplies `models.yml` / `models.yaml`. No environment variable selects the
 * file: the feature config is the only switch.
 */
export function findModelsPath(configuredPath, { agentDir } = {}) {
  if (configuredPath) return existsSync(configuredPath) ? configuredPath : null;

  const directory = agentDir ?? getAgentDir();
  const candidates = [join(directory, "models.yml"), join(directory, "models.yaml")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Parse a YAML string with Bun's parser or the `yaml` package. */
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
    return require_("yaml").parse(text);
  } catch {
    return null;
  }
}

/** Load and parse one models file. */
export function loadModelsConfig(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    return parseYaml(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Copy provider-level fields onto one model when the model does not set them. */
function inheritProviderFields(model, provider) {
  for (const key of ["requestMetadata", "guardrailIdentifier", "guardrailVersion", "guardrailTrace"]) {
    if (model[key] === undefined && provider[key] !== undefined) model[key] = provider[key];
  }
  return model;
}

/**
 * Build the provider config passed to `registerProvider`.
 *
 * The shape stays as close to the file as possible. `models` is merged with
 * `modelOverrides`, and the missing `api` defaults come from provider level.
 */
export function providerConfigOf(providerName, rawConfig) {
  if (!rawConfig || typeof rawConfig !== "object") return undefined;
  if (!Array.isArray(rawConfig.models) || rawConfig.models.length === 0) return undefined;

  const baseUrl = rawConfig.baseUrl || rawConfig.models.find((model) => model?.baseUrl)?.baseUrl;
  if (!baseUrl || typeof baseUrl !== "string") return undefined;
  const api = rawConfig.api || rawConfig.models.find((model) => model?.api)?.api || "openai-completions";

  const overrides =
    rawConfig.modelOverrides && typeof rawConfig.modelOverrides === "object" ? rawConfig.modelOverrides : {};
  const models = [];
  for (const rawModel of rawConfig.models) {
    if (!rawModel || typeof rawModel !== "object" || typeof rawModel.id !== "string" || rawModel.id === "") continue;
    const override = overrides[rawModel.id];
    const merged = inheritProviderFields(
      { ...rawModel, ...(override && typeof override === "object" ? override : {}) },
      rawConfig,
    );
    if (!merged.api) merged.api = api;
    models.push(merged);
  }
  if (models.length === 0) return undefined;

  const { models: _models, auth, ...providerFields } = rawConfig;
  // OMP's own models.yml loader folds `disableStrictTools` into `compat`, but
  // the runtime `registerProvider` path does not read the top-level field.
  // Fold it here so the preserved setting has its documented effect.
  const compat = providerFields.disableStrictTools
    ? {
        ...(providerFields.compat && typeof providerFields.compat === "object" ? providerFields.compat : {}),
        disableStrictTools: true,
      }
    : providerFields.compat;
  const config = {
    ...providerFields,
    baseUrl,
    api,
    ...(compat === undefined ? {} : { compat }),
    models,
  };
  if (rawConfig.apiKey === undefined && auth === "none") config.apiKey = NO_AUTH_SENTINEL;
  if (config.apiKey !== undefined && typeof config.apiKey !== "string") delete config.apiKey;

  return { name: providerName, config, models, ...(typeof auth === "string" ? { auth } : {}) };
}

/** Extract providers that declare at least one model. */
export function extractCustomProviders(doc) {
  if (!doc || typeof doc !== "object") return [];
  const providers = doc.providers;
  if (!providers || typeof providers !== "object") return [];

  const result = [];
  for (const [name, rawConfig] of Object.entries(providers)) {
    if (name === "" || !rawConfig || typeof rawConfig !== "object") continue;
    const built = providerConfigOf(name, rawConfig);
    if (built) result.push(built);
  }
  return result;
}

/**
 * Install the models bridge.
 *
 * @param {{modelsPath?: string | null, excludeProviders?: string[]}} config
 * @param {{log?: Function, storage?: object}} context
 * @returns {() => void} a disposer
 */
export function install(config = {}, context = {}) {
  const log = context.log ?? verboseLog;
  const configuredPath = config.modelsPath ?? null;
  const agentDir = context.paths?.agentDbPath ? dirname(context.paths.agentDbPath) : undefined;
  const excluded = new Set(
    Array.isArray(config.excludeProviders)
      ? config.excludeProviders
          .filter((name) => typeof name === "string" && name.trim() !== "")
          .map((name) => name.trim())
      : [],
  );

  const locateModels = () => findModelsPath(configuredPath, { agentDir });

  // Publish the file's providers before any ModelRegistry exists. The router
  // reads this registry directly, so a custom provider stays routable even
  // when the host never captures ModelRegistry.
  const customDisposers = [];
  const initialFile = locateModels();
  if (initialFile) {
    const doc = loadModelsConfig(initialFile);
    if (!doc) log(`models-bridge: cannot parse ${initialFile}`);
    const providers = doc ? extractCustomProviders(doc) : [];
    for (const { name, config: providerConfig, models, auth } of providers) {
      if (excluded.has(name)) {
        log(`models-bridge: skipped local provider ${name} (excluded by config)`);
        continue;
      }
      customDisposers.push(registerCustomProviderMeta(name, { ...providerConfig, auth }));
      verboseLog(`models-bridge: published ${name} (${models.length} models) from ${initialFile}`);
    }
  } else {
    verboseLog("models-bridge: no models.yml found");
  }

  const bridge = getHostBridge() ?? installHostBridge({ storage: context.storage });
  /** registry -> provider names this source registered on its last pass */
  const registeredNames = new WeakMap();

  const removeSource = bridge.registerProviderSource({
    id: "models-bridge",
    register(registry, helpers) {
      const modelsFile = locateModels();
      if (!modelsFile) {
        verboseLog("models-bridge: no models.yml found");
        return;
      }
      const doc = loadModelsConfig(modelsFile);
      if (!doc) {
        log(`models-bridge: cannot parse ${modelsFile}`);
        return;
      }
      const providers = extractCustomProviders(doc);
      if (providers.length === 0) {
        verboseLog(`models-bridge: no custom providers with models found in ${modelsFile}`);
      }

      const current = new Set();
      for (const { name, config: providerConfig, models } of providers) {
        current.add(name);
        if (excluded.has(name)) {
          log(`models-bridge: skipped local provider ${name} (excluded by config)`);
          continue;
        }
        try {
          helpers.registerProvider(registry, name, providerConfig, SOURCE_ID);
          helpers.keepSource(SOURCE_ID);
          // Explicit routability allowance for the router. Nothing is written
          // to storage.credentials.snapshot().
          helpers.noteRoutable(name);
          log(`models-bridge: registered ${name} (${models.length} models) from ${modelsFile}`);
        } catch (error) {
          log(`models-bridge: registerProvider(${name}) failed: ${error.message}`);
        }
      }

      // A provider removed from the file (or newly excluded) must not keep a
      // runtime override that routes traffic to a stale base URL or key.
      const previous = registeredNames.get(registry) ?? new Set();
      for (const name of previous) {
        if (current.has(name)) continue;
        if (typeof registry.unregisterProvider !== "function") continue;
        try {
          registry.unregisterProvider(name);
          log(`models-bridge: removed local provider ${name}`);
        } catch (error) {
          log(`models-bridge: unregisterProvider(${name}) failed: ${error.message}`);
        }
      }
      registeredNames.set(registry, current);
    },
  });

  return () => {
    removeSource();
    for (const removeMetadata of customDisposers.splice(0)) removeMetadata();
  };
}
