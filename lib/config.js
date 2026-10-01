// Feature configuration: one source of truth for every shim toggle.
//
// Resolution order (last wins):
//   1. built-in defaults (DEFAULTS below)
//   2. ~/.omp/shims.json      {"features": {"<name>": false}, ...}
//   3. environment variables  OMP_SHIMS_<FEATURE>=off|on
//
// A feature is enabled unless it is explicitly turned off, so adding a new
// feature keeps the previous behaviour without touching the config file.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const CONFIG_PATH = process.env.OMP_SHIMS_CONFIG ?? join(homedir(), ".omp", "shims.json");

/** Feature metadata, in the order they must be applied to the runtime. */
export const FEATURES = {
  "ipv6-first": {
    summary: "Resolve IPv6 first for outbound requests, falling back to IPv4 per address.",
    env: "OMP_SHIMS_IPV6_FIRST",
  },
  "antigravity-system-instruction": {
    summary: "Send the Antigravity system prompt as a leading user turn (upstream 429s on systemInstruction).",
    env: "OMP_SHIMS_ANTIGRAVITY_SYSTEM_INSTRUCTION",
  },
  "antigravity-routing": {
    summary: "Route Gemini 3.6/3.7/3.8 Flash to the upstream -tiered variants with a thinking level.",
    env: "OMP_SHIMS_ANTIGRAVITY_ROUTING",
  },
  "antigravity-continuation": {
    summary: "Recover Antigravity turns that end thought-only, malformed or truncated.",
    env: "OMP_SHIMS_ANTIGRAVITY_CONTINUATION",
  },
  "antigravity-capture": {
    summary: "Record Antigravity stream diagnostics to a JSONL file.",
    env: "OMP_SHIMS_ANTIGRAVITY_CAPTURE",
  },
  "plugin-bridge": {
    summary: "Expose installed OMP plugins to the auth-gateway model registry and supply their credentials.",
    env: "OMP_SHIMS_PLUGIN_BRIDGE",
  },
  "vendor-shims": {
    summary: "Install the vendored @earendil-works packages pi provider plugins expect the host to provide.",
    env: "OMP_SHIMS_VENDOR_SHIMS",
  },
  "tool-id-hash": {
    summary: "Prefix every tool-call id with a hash8 so upstream stops rejecting calls whose ids share a 9-character prefix.",
    env: "OMP_SHIMS_TOOL_ID_HASH",
  },
  "native-loop-guard": {
    summary: "OMP's built-in thinking-loop guard. Off by default: it aborts and retries the identical body, and nothing here compensates loops.",
    env: "OMP_SHIMS_NATIVE_LOOP_GUARD",
  },
  "traffic-log": {
    summary: "Log every inbound gateway request to a rolling hourly JSONL file.",
    env: "OMP_SHIMS_TRAFFIC_LOG",
  },
};

export const DEFAULTS = {
  "ipv6-first": { enabled: true, ttlMs: 60_000 },
  "antigravity-system-instruction": { enabled: true },
  "antigravity-routing": { enabled: true, effort: "high" },
  "antigravity-continuation": { enabled: true, maxContinuations: 3, locationRetries: 3 },
  "antigravity-capture": { enabled: true, out: null, sampleEvery: 0 },
  "plugin-bridge": { enabled: true, pluginsDir: null, plugins: null },
  "vendor-shims": { enabled: true, pluginsDir: null, packages: null },
  "tool-id-hash": {
    summary: "Prefix every tool-call id with a hash8 so upstream stops rejecting calls whose ids share a 9-character prefix.",
    env: "OMP_SHIMS_TOOL_ID_HASH",
  },
  "tool-id-hash": { enabled: true },
  "native-loop-guard": { enabled: false },
  "traffic-log": { enabled: false, dir: null, maxAgeMs: 3_600_000, sweepMs: 300_000 },
};

/** Parse a toggle-ish value. Accepts booleans and the usual env spellings. */
function toBool(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim().toLowerCase();
  if (["0", "off", "false", "no", "disable", "disabled", "none"].includes(text)) return false;
  if (["1", "on", "true", "yes", "enable", "enabled"].includes(text)) return true;
  return undefined;
}

function readConfigFile() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (error) {
    console.warn(`[omp-shims] Ignoring unreadable ${CONFIG_PATH}: ${error.message}`);
    return {};
  }
}

export { readConfigFile };

/**
 * Resolve the effective configuration.
 * @returns {{features: Record<string, any>, configPath: string}}
 */
export function loadConfig() {
  const file = readConfigFile();
  const fileFeatures = file.features ?? {};
  const resolved = {};

  for (const [name, defaults] of Object.entries(DEFAULTS)) {
    const entry = { ...defaults };

    const fromFile = fileFeatures[name];
    if (fromFile && typeof fromFile === "object") Object.assign(entry, fromFile);
    else if (typeof fromFile === "boolean") entry.enabled = fromFile;

    const meta = FEATURES[name];
    if (meta?.env) {
      const fromEnv = toBool(process.env[meta.env]);
      if (fromEnv !== undefined) entry.enabled = fromEnv;
    }

    entry.enabled = entry.enabled !== false;
    resolved[name] = entry;
  }

  return { features: resolved, configPath: CONFIG_PATH };
}

/** Human-readable one-line-per-feature status. */
export function describeConfig(config = loadConfig()) {
  return Object.entries(config.features).map(
    ([name, entry]) => `${entry.enabled ? "on " : "off"}  ${name.padEnd(34)} ${FEATURES[name]?.summary ?? ""}`.trimEnd(),
  );
}

/**
 * Merge `patch` into the config file, creating it when absent.
 * Keys are feature names; a value may be a boolean or an object of settings.
 */
export function writeConfig(patch) {
  let file = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    } catch {
      file = {};
    }
  }
  const features = { ...(file.features ?? {}) };
  for (const [name, value] of Object.entries(patch)) {
    features[name] =
      typeof value === "object" && value !== null ? { ...(features[name] ?? {}), ...value } : value;
  }
  file.features = features;

  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");
  return file;
}