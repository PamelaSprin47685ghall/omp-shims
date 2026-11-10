// Feature configuration: one source of truth for every shim toggle.
//
// Resolution order (last wins):
//   1. the defaults below;
//   2. the JSON file at CONFIG_PATH;
//   3. OMP_SHIMS_<FEATURE> (true/false, 1/0, on/off, yes/no).
//
// loadConfig() adds `sources`: one "default" | "file" | "env" label per
// feature, so a caller can say which layer decided the state.
//
// The v2 format is strict. A corrupt file, an unknown top-level key, an unknown
// feature name, or a v1 legacy key raises ConfigValidationError. The loader
// never resets a broken file to {}. Run scripts/migrate-v2.mjs to convert a v1
// configuration.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PHASES, verboseLog } from "./contracts.mjs";

/**
 * Read one bundled preset. The module-relative path is canonical. When a test
 * copies this module alone into a sandbox, the package root is still the
 * working directory, so that copy is the fallback. A missing preset there is
 * an error, never an empty policy.
 */
function loadPreset(relativePath) {
  const local = new URL(relativePath, import.meta.url);
  if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  try {
    const root = process.cwd();
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (manifest?.name === "omp-shims") {
      const fallback = new URL(relativePath.replace(/^\.\.\//, ""), pathToFileURL(`${root}/`));
      if (existsSync(fallback)) return JSON.parse(readFileSync(fallback, "utf8"));
    }
  } catch {}
  throw new Error(`omp-shims: cannot read preset ${relativePath}`);
}

const antigravityPolicy = loadPreset("../presets/antigravity.json");
const clinePolicy = loadPreset("../presets/cline.json");
const copilotPolicy = loadPreset("../presets/copilot.json");
const rankingPolicy = loadPreset("../presets/ranking.json");
const routePolicy = loadPreset("../presets/routes.json");

export const CONFIG_PATH = process.env.OMP_SHIMS_CONFIG ?? join(homedir(), ".omp", "shims.json");

/** The config format version. */
const CONFIG_VERSION = 2;

/** The runtime default: OMP's own thinking-loop guard stays as OMP set it. */
const DEFAULT_RUNTIME = Object.freeze({ thinkingLoopGuard: false });

const TOP_LEVEL_KEYS = new Set(["version", "runtime", "stateDbPath", "features", "pluginBridge"]);

/** v1 feature names and what replaced them. */
const LEGACY_FEATURES = new Map([
  ["antigravity-system-instruction", "antigravity"],
  ["antigravity-routing", "antigravity"],
  ["antigravity-continuation", "antigravity"],
  ["antigravity-capture", "antigravity"],
  ["antigravity-account-routing", "antigravity"],
  ["vendor-shims", null],
  ["native-loop-guard", null],
]);

/**
 * Feature settings whose keys are user-chosen maps, not a fixed schema.
 * Paths are relative to the feature root.
 */
const FEATURE_OPEN_MAPS = Object.freeze({
  "lazy-router": Object.freeze(["providerHeaderTimeoutMs", "upstreamHosts", "maxInFlight", "testFaults"]),
  "cline-pin-upstream": Object.freeze(["modelChannels"]),
});

/**
 * One entry per autonomous feature, in install order inside each phase.
 * - phase: the install phase (EDGE, OUTBOUND, PROCESS, BACKGROUND);
 * - summary: one line for /omp-shims and the CLI;
 * - defaults: the complete settings object for the feature.
 */
export const FEATURE_CATALOG = deepFreeze({
  "gateway-compat": {
    phase: PHASES.EDGE,
    summary: "Drop known optional JSON null fields at the inbound edge before request validation.",
    defaults: { enabled: true },
  },
  "sse-heartbeat": {
    phase: PHASES.EDGE,
    summary: "Write an SSE keep-alive comment when a gateway event stream has been idle.",
    defaults: { enabled: true, intervalMs: 15_000 },
  },
  "reasoning-order": {
    phase: PHASES.EDGE,
    summary: "Emit all typed reasoning before visible body in Chat, Responses and Messages SSE.",
    defaults: { enabled: true, maxBufferBytes: 16 * 1024 * 1024 },
  },
  "tool-id-hash": {
    phase: PHASES.OUTBOUND,
    summary: "Give every tool-call id a short stable id so upstream accepts long or colliding ids.",
    defaults: { enabled: true },
  },
  antigravity: {
    phase: PHASES.OUTBOUND,
    summary: "Unified Antigravity shim: system instruction, tier routing, continuation recovery, capture.",
    defaults: {
      enabled: true,
      systemInstruction: true,
      forceSystemInstruction: false,
      routing: false,
      effort: "high",
      continuation: true,
      maxContinuations: 3,
      locationRetries: 3,
      idleTimeoutMs: 0,
      capture: false,
      captureOut: null,
      sampleEvery: 0,
      accountRouting: true,
      ultraAccounts: [],
      proAccounts: [],
      cooldownMs: 60_000,
      tieredPattern: antigravityPolicy.tieredPattern,
      ultraModelPattern: antigravityPolicy.ultraModelPattern,
      accountsOut: null,
      continuationOut: null,
    },
  },
  "copilot-auto": {
    phase: PHASES.OUTBOUND,
    summary: "Negotiate GitHub Copilot Auto model routing and inject the required session token.",
    defaults: {
      enabled: true,
      apiVersion: copilotPolicy.apiVersion,
      autoBootstrapModel: copilotPolicy.autoBootstrapModel,
    },
  },
  "lazy-router": {
    phase: PHASES.OUTBOUND,
    summary: "Serve the configured virtual-model routes with online ranking and probe-driven failover.",
    defaults: {
      enabled: false,
      store: "sqlite",
      routesFile: null,
      holidaysFile: null,
      statusPath: "/v1/lazy/status",
      clientOnlyPrefix: routePolicy.clientOnlyPrefix,
      allowNonChatPassThrough: true,
      probeIntervalMs: 1_800_000,
      probeTimeoutMs: 90_000,
      probePrompt: "Reply OK",
      probeMaxTokens: 32,
      tierRefreshMs: 21_600_000,
      tierRecheckMs: 60_000,
      headerTimeoutMs: 300_000,
      providerHeaderTimeoutMs: routePolicy.providerHeaderTimeouts ?? {},
      upstreamHosts: {},
      codexHttpTransport: true,
      logUpstreamBody: false,
      maxInFlight: {},
      affinityTtlMs: 300_000,
      affinityMaxEntries: 50_000,
      affinityMinPrefixBytes: 1_024,
      admissionWindowMs: 300_000,
      perfHistoryHalfLifeMs: 86_400_000,
      perfHistoryWeightCap: 8,
      out: null,
      testFaults: {},
      routing: cloneValue(rankingPolicy.routing),
    },
  },
  "cline-pin-upstream": {
    phase: PHASES.OUTBOUND,
    summary: "Pin ClinePass chat/completions to a fixed upstream channel.",
    defaults: {
      enabled: true,
      host: clinePolicy.host,
      baseURL: clinePolicy.baseURL,
      upstream: clinePolicy.upstream,
      modelChannels: cloneValue(clinePolicy.modelChannels),
      models: "",
      apiKey: null,
    },
  },
  "ipv6-first": {
    phase: PHASES.OUTBOUND,
    summary: "Resolve IPv6 first for outbound requests, falling back to IPv4 per address.",
    defaults: { enabled: true, ttlMs: 60_000 },
  },
  "plugin-bridge": {
    phase: PHASES.PROCESS,
    summary: "Expose installed OMP plugins to the auth-gateway model registry and supply credentials.",
    defaults: { enabled: true, pluginsDir: null, plugins: null, eagerTimeoutMs: 15_000 },
  },
  "models-bridge": {
    phase: PHASES.PROCESS,
    summary: "Expose custom models from models.yml to the auth-gateway model registry.",
    defaults: { enabled: true, modelsPath: null, excludeProviders: [] },
  },
  "traffic-log": {
    phase: PHASES.PROCESS,
    summary: "Log every inbound gateway request to a rolling hourly JSONL file.",
    defaults: { enabled: false, dir: null, maxAgeMs: 3_600_000, sweepMs: 300_000, logBody: false },
  },
  "kiro-credential-sync": {
    phase: PHASES.BACKGROUND,
    summary: "Sync kiro-cli's rotated token into the auth-broker credential store.",
    defaults: { enabled: true, dbPath: null, pollMs: 60_000 },
  },
});

/** The default settings of every feature, keyed by feature name. */
export const DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(FEATURE_CATALOG).map(([name, entry]) => [name, entry.defaults])),
);

/** The one environment variable that turns one feature on or off. */
export const FEATURE_ENV_VARS = Object.freeze(
  Object.fromEntries(
    Object.keys(FEATURE_CATALOG).map((name) => [name, `OMP_SHIMS_${name.toUpperCase().replaceAll("-", "_")}`]),
  ),
);

/** Environment variables that are not feature toggles but are still valid in v2. */
const GLOBAL_ENV_VARS = ["OMP_SHIMS_CONFIG", "OMP_SHIMS_VERBOSE", "OMP_SHIMS_REUSE_PORT"];

const KNOWN_ENV_VARS = new Set([...Object.values(FEATURE_ENV_VARS), ...GLOBAL_ENV_VARS]);

const TRUE_ENV_VALUES = new Set(["true", "1", "on", "yes"]);
const FALSE_ENV_VALUES = new Set(["false", "0", "off", "no"]);

/** A configuration error the user can fix. */
export class ConfigValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ConfigValidationError";
  }
}

function fail(message, options) {
  throw new ConfigValidationError(message, options);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Define an own data property. This keeps a "__proto__" key inert. */
function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Copy JSON data, and keep every key an own data property. */
function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const copy = {};
    for (const [key, item] of Object.entries(value)) setOwn(copy, key, cloneValue(item));
    return copy;
  }
  return value;
}

/** Merge nested plain objects. An array or a scalar replaces the old value. */
function mergeDeep(base, patch) {
  const result = isPlainObject(base) ? cloneValue(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    const current = Object.hasOwn(result, key) ? result[key] : undefined;
    setOwn(result, key, isPlainObject(value) && isPlainObject(current) ? mergeDeep(current, value) : cloneValue(value));
  }
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Parse a toggle value. Return undefined for anything else. */
function parseEnvToggle(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(text)) return true;
  if (FALSE_ENV_VALUES.has(text)) return false;
  return undefined;
}

/** True for every environment variable v2 reads. */
export function isKnownV2EnvVar(name) {
  return typeof name === "string" && KNOWN_ENV_VARS.has(name);
}

/** Every OMP_SHIMS_* variable that v2 does not read, sorted. */
export function listLegacyShimEnvVars(env = process.env) {
  return Object.keys(env)
    .filter((name) => name.startsWith("OMP_SHIMS_") && !KNOWN_ENV_VARS.has(name))
    .sort();
}

function migrationHint(path) {
  return path
    ? `Run scripts/migrate-v2.mjs to convert ${path} to the v2 format.`
    : "Run scripts/migrate-v2.mjs to convert the v1 configuration to the v2 format.";
}

/**
 * Apply OMP_SHIMS_<FEATURE> on top of the resolved features.
 * Return one source label per feature for the CLI.
 */
function applyEnvOverrides(config, fileFeatures) {
  const sources = {};
  for (const name of Object.keys(FEATURE_CATALOG)) {
    sources[name] = Object.hasOwn(fileFeatures, name) ? "file" : "default";
    const envName = FEATURE_ENV_VARS[name];
    const rawValue = process.env[envName];
    if (rawValue === undefined) continue;

    const enabled = parseEnvToggle(rawValue);
    if (enabled === undefined) {
      verboseLog(`ignoring ${envName}=${JSON.stringify(rawValue)}; use true/false, 1/0, on/off, or yes/no`);
      continue;
    }
    config.features[name].enabled = enabled;
    sources[name] = "env";
  }
  return sources;
}

function unknownFeature(name, path) {
  if (LEGACY_FEATURES.has(name)) {
    const replacement = LEGACY_FEATURES.get(name);
    const detail = replacement
      ? `v2 merged this feature into "${replacement}"`
      : "v2 removed this feature; no shim replaces it";
    fail(`Feature "${name}" is a v1 legacy key; ${detail}. ${migrationHint(path)}`);
  }
  fail(`Unknown feature "${name}". ${migrationHint(path)}`);
}

/** Reject a setting that is not in the feature schema, and name its full path. */
function rejectUnknownSetting(name, segments, path) {
  const setting = `features["${name}"]${segments.map((segment) => `.${segment}`).join("")}`;
  fail(`Unknown setting ${setting}. ${migrationHint(path)}`);
}

/**
 * Compare one user feature object with its defaults.
 * A fixed key must exist in the schema; a declared open map keeps free keys.
 * A known key set to null stays valid when the default is null.
 */
function checkFeatureSettings(name, schema, value, path, segments = []) {
  if (!isPlainObject(value)) return;
  const openMaps = FEATURE_OPEN_MAPS[name] ?? [];
  for (const [key, actual] of Object.entries(value)) {
    if (!Object.hasOwn(schema, key)) rejectUnknownSetting(name, [...segments, key], path);
    const expected = schema[key];
    if (!isPlainObject(expected) || !isPlainObject(actual)) continue;
    const detail = [...segments, key].join(".");
    if (openMaps.includes(detail)) continue;
    checkFeatureSettings(name, expected, actual, path, [...segments, key]);
  }
}

/** Merge one file value over its default. Return the complete settings object. */
function resolveFeature(name, defaults, value, path) {
  if (value === undefined) return cloneValue(defaults);
  if (typeof value === "boolean") return { ...cloneValue(defaults), enabled: value };
  if (!isPlainObject(value)) {
    fail(`Feature "${name}" must be true, false, or an object. ${migrationHint(path)}`);
  }
  checkFeatureSettings(name, defaults, value, path);
  const resolved = mergeDeep(defaults, value);
  if (typeof resolved.enabled !== "boolean") {
    fail(`Feature "${name}".enabled must be true or false. ${migrationHint(path)}`);
  }
  return resolved;
}

function resolveFeatures(features, path) {
  if (features === undefined) features = {};
  if (!isPlainObject(features)) fail(`"features" must be an object. ${migrationHint(path)}`);

  for (const name of Object.keys(features)) {
    if (!Object.hasOwn(FEATURE_CATALOG, name)) unknownFeature(name, path);
  }

  const resolved = {};
  for (const [name, entry] of Object.entries(FEATURE_CATALOG)) {
    setOwn(resolved, name, resolveFeature(name, entry.defaults, features[name], path));
  }
  return resolved;
}

function resolveRuntime(runtime, path) {
  if (runtime === undefined) return cloneValue(DEFAULT_RUNTIME);
  if (!isPlainObject(runtime)) fail(`"runtime" must be an object. ${migrationHint(path)}`);
  for (const key of Object.keys(runtime)) {
    if (key !== "thinkingLoopGuard") fail(`Unknown runtime key "${key}". ${migrationHint(path)}`);
  }
  if (runtime.thinkingLoopGuard !== undefined && typeof runtime.thinkingLoopGuard !== "boolean") {
    fail(`"runtime.thinkingLoopGuard" must be true or false. ${migrationHint(path)}`);
  }
  return { thinkingLoopGuard: runtime.thinkingLoopGuard ?? DEFAULT_RUNTIME.thinkingLoopGuard };
}

/** The shared state database, used when the file names no path. */
function defaultStateDbPath() {
  return join(homedir(), ".omp", "omp-shims-state.sqlite");
}

function resolveStateDbPath(value, path) {
  if (value === undefined || value === null) return defaultStateDbPath();
  if (typeof value !== "string" || value.trim() === "") {
    fail(`"stateDbPath" must be a non-empty string or null. ${migrationHint(path)}`);
  }
  return resolve(value);
}

function resolvePluginBridge(pluginBridge, path) {
  if (pluginBridge === undefined) return { tokens: {} };
  if (!isPlainObject(pluginBridge)) fail(`"pluginBridge" must be an object. ${migrationHint(path)}`);
  for (const key of Object.keys(pluginBridge)) {
    if (key !== "tokens") fail(`Unknown pluginBridge key "${key}". ${migrationHint(path)}`);
  }
  const tokens = pluginBridge.tokens;
  if (tokens !== undefined && !isPlainObject(tokens)) {
    fail(`"pluginBridge.tokens" must be an object. ${migrationHint(path)}`);
  }
  return { tokens: tokens === undefined ? {} : cloneValue(tokens) };
}

/**
 * Read and parse the config file.
 * A missing file is an empty config; a corrupt file is an error, never a reset.
 */
export function readRawConfig(path = CONFIG_PATH) {
  if (!existsSync(path)) return {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigValidationError(`Cannot read ${path}: ${error.message}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigValidationError(`Invalid JSON in ${path}: ${error.message}. ${migrationHint(path)}`, {
      cause: error,
    });
  }
}

/**
 * Validate a raw config object and resolve it against the defaults.
 * @param {unknown} raw
 * @param {{ path?: string }} [options]
 * @returns {{ version: number, stateDbPath: string, runtime: { thinkingLoopGuard: boolean }, features: Record<string, any>, pluginBridge: { tokens: Record<string, any> } }}
 */
export function validateConfig(raw = {}, { path = CONFIG_PATH } = {}) {
  if (!isPlainObject(raw)) fail(`The config root must be a JSON object. ${migrationHint(path)}`);

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) fail(`Unknown top-level key "${key}". ${migrationHint(path)}`);
  }
  if (raw.version !== undefined && raw.version !== CONFIG_VERSION) {
    fail(`Unsupported config version ${JSON.stringify(raw.version)}; v2 expects version 2. ${migrationHint(path)}`);
  }

  return {
    version: CONFIG_VERSION,
    stateDbPath: resolveStateDbPath(raw.stateDbPath, path),
    runtime: resolveRuntime(raw.runtime, path),
    features: resolveFeatures(raw.features, path),
    pluginBridge: resolvePluginBridge(raw.pluginBridge, path),
  };
}

/**
 * Load the effective configuration.
 *
 * Precedence per feature: defaults, then the file, then OMP_SHIMS_<FEATURE>.
 * `sources` says which layer decided the enabled state of each feature.
 * @param {string} [path]
 * @returns {{ version: number, stateDbPath: string, runtime: { thinkingLoopGuard: boolean }, features: Record<string, any>, pluginBridge: { tokens: Record<string, any> }, sources: Record<string, "default" | "file" | "env">, configPath: string }}
 */
export function loadConfig(path = CONFIG_PATH) {
  const raw = readRawConfig(path);
  const config = validateConfig(raw, { path });
  const fileFeatures = isPlainObject(raw.features) ? raw.features : {};
  return { ...config, sources: applyEnvOverrides(config, fileFeatures), configPath: path };
}

/**
 * Merge a patch into the config file with an atomic 0600 write.
 *
 * A top-level patch key may be "version", "runtime", "stateDbPath", "features"
 * or "pluginBridge". Any other key is a shortcut for features[key].
 * Nested plain objects merge deep; arrays and scalars replace the old value.
 *
 * @param {Record<string, any>} patch
 * @param {string} [path]
 * @returns {Record<string, any>} the persisted raw config
 */
export function writeConfig(patch, path = CONFIG_PATH) {
  if (!isPlainObject(patch)) fail("The config patch must be an object.");

  const base = readRawConfig(path);
  if (!isPlainObject(base)) fail(`The config root must be a JSON object. ${migrationHint(path)}`);

  const next = cloneValue(base);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "version") {
      setOwn(next, key, value);
      continue;
    }
    if (key === "stateDbPath") {
      setOwn(next, key, value);
      continue;
    }
    if (key === "runtime" || key === "pluginBridge" || key === "features") {
      if (!isPlainObject(value)) fail(`The "${key}" patch must be an object.`);
      setOwn(next, key, mergeDeep(next[key], value));
      continue;
    }
    // This is the /omp-shims shortcut: a bare feature name.
    const features = isPlainObject(next.features) ? next.features : {};
    setOwn(features, key, mergeDeep(features[key], value));
    setOwn(next, "features", features);
  }
  if (next.version === undefined) setOwn(next, "version", CONFIG_VERSION);

  // Validate before the write. A bad patch must not damage the file.
  validateConfig(next, { path });

  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {}
    throw error;
  }
  return next;
}

/** One line per feature: state, name, source, summary. */
export function describeConfig(config = loadConfig()) {
  const features = config?.features ?? {};
  const sources = config?.sources ?? {};
  return Object.entries(features).map(([name, entry]) => {
    const summary = FEATURE_CATALOG[name]?.summary ?? "";
    const source = `source=${sources[name] ?? "default"}`;
    return `${entry.enabled ? "on " : "off"}  ${name.padEnd(20)} ${source.padEnd(14)} ${summary}`.trimEnd();
  });
}
