import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  ConfigValidationError,
  DEFAULTS,
  describeConfig,
  FEATURE_CATALOG,
  FEATURE_ENV_VARS,
  isKnownV2EnvVar,
  listLegacyShimEnvVars,
  loadConfig,
  normalizeStatusBasePath,
  readRawConfig,
  writeConfig,
} from "../lib/config.mjs";
import antigravityPolicy from "../presets/antigravity.json";
import clinePolicy from "../presets/cline.json";
import copilotPolicy from "../presets/copilot.json";
import rankingPolicy from "../presets/ranking.json";
import routePolicy from "../presets/routes.json";

const FEATURE_NAMES = [
  "gateway-compat",
  "sse-heartbeat",
  "reasoning-order",
  "tool-id-hash",
  "antigravity",
  "copilot-auto",
  "lazy-router",
  "cline-pin-upstream",
  "ipv6-first",
  "plugin-bridge",
  "models-bridge",
  "traffic-log",
  "kiro-credential-sync",
];

const FEATURE_ENVS = Object.values(FEATURE_ENV_VARS);
const directories = [];

function tempDir() {
  const directory = mkdtempSync(join(tmpdir(), "omp-shims-config-v2-"));
  directories.push(directory);
  return directory;
}

function configError(run, pattern) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    expect(error.message).toMatch(pattern);
    return error;
  }
  throw new Error(`expected ConfigValidationError matching ${pattern}`);
}

function writeFileAt(path, value) {
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

afterEach(() => {
  for (const name of FEATURE_ENVS) delete process.env[name];
  delete process.env.OMP_SHIMS_VERBOSE;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("catalog and defaults", () => {
  test("the catalog holds exactly the 13 v2 autonomous features, in install order", () => {
    expect(Object.keys(FEATURE_CATALOG)).toEqual(FEATURE_NAMES);
    expect(Object.keys(DEFAULTS)).toEqual(FEATURE_NAMES);
    expect(Object.keys(FEATURE_ENV_VARS)).toEqual(FEATURE_NAMES);
  });

  test("the reviewed defaults are present", () => {
    expect(DEFAULTS["sse-heartbeat"]).toEqual({ enabled: true, intervalMs: 15_000 });
    expect(DEFAULTS["reasoning-order"]).toEqual({ enabled: true, maxBufferBytes: 16 * 1024 * 1024 });
    expect(DEFAULTS["tool-id-hash"]).toEqual({ enabled: true });
    expect(DEFAULTS.antigravity.forceSystemInstruction).toBe(false);
    expect(FEATURE_CATALOG["lazy-router"].summary).toBe(
      "Serve the configured virtual-model routes with online ranking and probe-driven failover.",
    );
    expect(DEFAULTS["lazy-router"].routing).toMatchObject({
      intelligenceCenter: 50,
      costWeight: 0.2,
      latencyWeight: 1.0,
      temperature: 0.6,
    });
    expect(DEFAULTS.antigravity.tieredPattern).toBe(antigravityPolicy.tieredPattern);
    expect(DEFAULTS.antigravity.ultraModelPattern).toBe(antigravityPolicy.ultraModelPattern);
    expect(DEFAULTS["copilot-auto"].autoBootstrapModel).toBe(copilotPolicy.autoBootstrapModel);
    expect(DEFAULTS["copilot-auto"].apiVersion).toBe(copilotPolicy.apiVersion);
    expect(DEFAULTS["lazy-router"].clientOnlyPrefix).toBe(routePolicy.clientOnlyPrefix);
    expect(DEFAULTS["lazy-router"].providerHeaderTimeoutMs).toEqual(routePolicy.providerHeaderTimeouts);
    expect(DEFAULTS["lazy-router"].routing).toEqual(rankingPolicy.routing);
    expect(DEFAULTS["cline-pin-upstream"]).toMatchObject({
      host: clinePolicy.host,
      baseURL: clinePolicy.baseURL,
      upstream: clinePolicy.upstream,
      modelChannels: clinePolicy.modelChannels,
    });
    expect(DEFAULTS["lazy-router"].stateDbPath).toBeUndefined();
  });

  test("every feature has one OMP_SHIMS_ toggle and a phase", () => {
    for (const name of FEATURE_NAMES) {
      expect(FEATURE_ENV_VARS[name]).toBe(`OMP_SHIMS_${name.toUpperCase().replaceAll("-", "_")}`);
      expect(["edge", "outbound", "process", "background"]).toContain(FEATURE_CATALOG[name].phase);
      expect(FEATURE_CATALOG[name].summary.length).toBeGreaterThan(0);
    }
    expect(new Set(FEATURE_ENVS).size).toBe(13);
  });

  test("the env allow-list and the legacy scan match the contract", () => {
    for (const name of FEATURE_ENVS) expect(isKnownV2EnvVar(name)).toBe(true);
    for (const name of ["OMP_SHIMS_CONFIG", "OMP_SHIMS_VERBOSE", "OMP_SHIMS_REUSE_PORT"]) {
      expect(isKnownV2EnvVar(name)).toBe(true);
    }
    expect(isKnownV2EnvVar("OMP_SHIMS_CLINE_PIN")).toBe(false);
    expect(isKnownV2EnvVar("OMP_SHIMS_PROFILE")).toBe(false);
    expect(isKnownV2EnvVar("OTHER")).toBe(false);
    expect(
      listLegacyShimEnvVars({
        OMP_SHIMS_CONFIG: "x",
        OMP_SHIMS_VERBOSE: "1",
        OMP_SHIMS_PROFILE: "p",
        OMP_SHIMS_REUSE_PORT: "1",
        OMP_SHIMS_LAZY_ROUTER: "on",
        OMP_SHIMS_ANTIGRAVITY_CAPTURE_OUT: "/tmp/out.jsonl",
        OMP_SHIMS_CLINE_PIN: "api.cline.bot",
        PATH: "/bin",
      }),
    ).toEqual(["OMP_SHIMS_ANTIGRAVITY_CAPTURE_OUT", "OMP_SHIMS_CLINE_PIN", "OMP_SHIMS_PROFILE"]);
  });
});

describe("strict schema", () => {
  test("a missing file is an empty config", () => {
    const path = join(tempDir(), "absent.json");
    expect(readRawConfig(path)).toEqual({});
    expect(loadConfig(path).features["ipv6-first"].enabled).toBe(true);
  });

  test("a non-object root is rejected", () => {
    const path = join(tempDir(), "root.json");
    for (const raw of ["null", "[]", '"text"']) {
      writeFileAt(path, raw);
      configError(() => loadConfig(path), /root must be a JSON object/);
    }
  });

  test("unknown top-level keys are rejected", () => {
    const path = join(tempDir(), "top.json");
    writeFileAt(path, { version: 2, unknown: true });
    configError(() => loadConfig(path), /Unknown top-level key "unknown"/);
  });

  test("a version other than 2 is rejected", () => {
    const path = join(tempDir(), "version.json");
    writeFileAt(path, { version: 1 });
    configError(() => loadConfig(path), /Unsupported config version 1/);
  });

  test("v1 legacy feature keys are rejected with the migration hint", () => {
    const path = join(tempDir(), "legacy.json");
    for (const name of ["antigravity-continuation", "antigravity-capture", "vendor-shims", "native-loop-guard"]) {
      writeFileAt(path, { features: { [name]: true } });
      const error = configError(() => loadConfig(path), /v1 legacy key/);
      expect(error.message).toContain("migrate-v2.mjs");
    }
  });

  test("unknown feature names are rejected", () => {
    const path = join(tempDir(), "feature.json");
    writeFileAt(path, { features: { "does-not-exist": true } });
    configError(() => loadConfig(path), /Unknown feature "does-not-exist"/);
  });

  test("legacy routing priors are accepted as inert provenance", () => {
    const path = join(tempDir(), "routing.json");
    for (const key of ["excellentPrior", "mediumPrior"]) {
      writeFileAt(path, { features: { "lazy-router": { routing: { [key]: 0.5 } } } });
      const config = loadConfig(path);
      expect(config.features["lazy-router"].routing[key]).toBe(0.5);
      expect(config.features["lazy-router"].routing.intelligenceCenter).toBe(50);
    }
  });

  test("unknown feature sub-keys are rejected with the full path", () => {
    const path = join(tempDir(), "subkey.json");
    const cases = [
      [{ features: { "sse-heartbeat": { intervlMs: 1 } } }, /features\["sse-heartbeat"\]\.intervlMs/],
      [{ features: { "lazy-router": { routing: { bogus: 1 } } } }, /features\["lazy-router"\]\.routing\.bogus/],
      [{ features: { antigravity: { maxContinuation: 5 } } }, /features\["antigravity"\]\.maxContinuation/],
      [{ features: { "tool-id-hash": { sallt: "x" } } }, /features\["tool-id-hash"\]\.sallt/],
      [{ features: { "lazy-router": { stateDbPath: "/tmp/state.sqlite" } } }, /features\["lazy-router"\]\.stateDbPath/],
    ];
    for (const [raw, pattern] of cases) {
      writeFileAt(path, raw);
      configError(() => loadConfig(path), pattern);
    }
  });

  test("open maps and null defaults stay valid", () => {
    const path = join(tempDir(), "open.json");
    writeFileAt(path, {
      version: 2,
      features: {
        antigravity: { captureOut: null, continuationOut: null },
        "traffic-log": { dir: null },
        "lazy-router": {
          providerHeaderTimeoutMs: { codex: 1234, other: 99 },
          upstreamHosts: { example: "https://example.test" },
          maxInFlight: { openai: 5 },
          testFaults: { anything: { nested: true } },
          routing: { costWeight: 0.5 },
        },
        "cline-pin-upstream": { modelChannels: { "custom/model": { only: ["deepseek"] } } },
      },
    });
    const config = loadConfig(path);
    expect(config.features.antigravity.captureOut).toBeNull();
    expect(config.features["traffic-log"].dir).toBeNull();
    expect(config.features["lazy-router"].providerHeaderTimeoutMs).toEqual({
      commandcode: 1_800_000,
      codex: 1234,
      other: 99,
    });
    expect(config.features["lazy-router"].upstreamHosts).toEqual({ example: "https://example.test" });
    expect(config.features["lazy-router"].maxInFlight).toEqual({ openai: 5 });
    expect(config.features["lazy-router"].testFaults).toEqual({ anything: { nested: true } });
    expect(config.features["lazy-router"].routing.costWeight).toBe(0.5);
    expect(config.features["cline-pin-upstream"].modelChannels).toMatchObject({
      "custom/model": { only: ["deepseek"] },
      "deepseek-v4.1-flash": ["deepseek"],
    });
  });

  test("bad feature values are rejected", () => {
    const path = join(tempDir(), "bad-value.json");
    const cases = [
      [{ features: { "ipv6-first": 5 } }, /must be true, false, or an object/],
      [{ features: { "ipv6-first": { enabled: "yes" } } }, /enabled must be true or false/],
      [{ runtime: { unknown: true } }, /Unknown runtime key "unknown"/],
      [{ runtime: { thinkingLoopGuard: "yes" } }, /thinkingLoopGuard.*true or false/],
      [{ pluginBridge: { other: {} } }, /Unknown pluginBridge key "other"/],
      [{ pluginBridge: { tokens: 5 } }, /pluginBridge\.tokens.*object/],
    ];
    for (const [raw, pattern] of cases) {
      writeFileAt(path, raw);
      configError(() => loadConfig(path), pattern);
    }
  });

  test("corrupt JSON is rejected and never overwritten", () => {
    const path = join(tempDir(), "corrupt.json");
    writeFileAt(path, "{not json");
    configError(() => loadConfig(path), /Invalid JSON in .*migrate-v2\.mjs/s);
    expect(readFileSync(path, "utf8")).toBe("{not json");
    configError(() => writeConfig({ "ipv6-first": true }, path), /Invalid JSON/);
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });
});

describe("env precedence, sources and describeConfig", () => {
  test("defaults report source=default", () => {
    const path = join(tempDir(), "default.json");
    const config = loadConfig(path);
    expect(config.sources).toEqual(Object.fromEntries(FEATURE_NAMES.map((name) => [name, "default"])));
    const lines = describeConfig(config);
    expect(lines).toHaveLength(13);
    for (const line of lines) {
      expect(line).toMatch(/^(on |off) {2}/);
      expect(line).toMatch(/source=(default|file|env)/);
    }
  });

  test("the file reports source=file", () => {
    const path = join(tempDir(), "file.json");
    writeFileAt(path, { version: 2, features: { "ipv6-first": false } });
    const config = loadConfig(path);
    expect(config.features["ipv6-first"].enabled).toBe(false);
    expect(config.sources["ipv6-first"]).toBe("file");
    expect(config.sources["sse-heartbeat"]).toBe("default");
  });

  test("a valid feature env var wins over the file and is labelled env", () => {
    const path = join(tempDir(), "env.json");
    writeFileAt(path, { version: 2, features: { "ipv6-first": false, "lazy-router": false } });
    process.env.OMP_SHIMS_IPV6_FIRST = "On";
    process.env.OMP_SHIMS_LAZY_ROUTER = "YES";
    const config = loadConfig(path);
    expect(config.features["ipv6-first"].enabled).toBe(true);
    expect(config.sources["ipv6-first"]).toBe("env");
    expect(config.features["lazy-router"].enabled).toBe(true);
    expect(config.sources["lazy-router"]).toBe("env");

    const lines = describeConfig(config);
    expect(lines.find((line) => line.includes("ipv6-first"))).toMatch(/source=env/);
    expect(lines.find((line) => line.includes("lazy-router"))).toMatch(/source=env/);
    expect(lines.find((line) => line.includes("gateway-compat"))).toMatch(/source=default/);
  });

  test("all accepted spellings resolve", () => {
    const path = join(tempDir(), "spellings.json");
    const cases = [
      ["OMP_SHIMS_IPV6_FIRST", "true", true],
      ["OMP_SHIMS_IPV6_FIRST", "1", true],
      ["OMP_SHIMS_IPV6_FIRST", "on", true],
      ["OMP_SHIMS_IPV6_FIRST", "yes", true],
      ["OMP_SHIMS_IPV6_FIRST", "false", false],
      ["OMP_SHIMS_IPV6_FIRST", "0", false],
      ["OMP_SHIMS_IPV6_FIRST", "off", false],
      ["OMP_SHIMS_IPV6_FIRST", "no", false],
    ];
    for (const [name, value, expected] of cases) {
      process.env[name] = value;
      const config = loadConfig(path);
      expect(config.features["ipv6-first"].enabled).toBe(expected);
      expect(config.sources["ipv6-first"]).toBe("env");
      delete process.env[name];
    }
  });

  test("an invalid env value is ignored and keeps the file source", () => {
    const path = join(tempDir(), "invalid-env.json");
    writeFileAt(path, { version: 2, features: { "ipv6-first": false } });
    process.env.OMP_SHIMS_IPV6_FIRST = "maybe";
    const config = loadConfig(path);
    expect(config.features["ipv6-first"].enabled).toBe(false);
    expect(config.sources["ipv6-first"]).toBe("file");
    expect(describeConfig(config).find((line) => line.includes("ipv6-first"))).toMatch(/source=file/);
  });
});

describe("state database path", () => {
  test("defaults to one absolute path on every load", () => {
    const path = join(tempDir(), "state-default.json");
    const config = loadConfig(path);
    expect(config.stateDbPath).toBe(resolve(join(homedir(), ".omp", "omp-shims-state.sqlite")));
    expect(isAbsolute(config.stateDbPath)).toBe(true);
  });

  test("a top-level value wins; relative paths resolve; null uses the default", () => {
    const path = join(tempDir(), "state-custom.json");
    const custom = join(tempDir(), "custom-state.sqlite");
    writeFileAt(path, { version: 2, stateDbPath: custom });
    expect(loadConfig(path).stateDbPath).toBe(custom);

    writeFileAt(path, { version: 2, stateDbPath: "relative/state.sqlite" });
    expect(loadConfig(path).stateDbPath).toBe(resolve("relative/state.sqlite"));

    writeFileAt(path, { version: 2, stateDbPath: null });
    expect(loadConfig(path).stateDbPath).toBe(resolve(join(homedir(), ".omp", "omp-shims-state.sqlite")));
  });

  test("wrong values are rejected", () => {
    const path = join(tempDir(), "state-bad.json");
    for (const value of [5, true, [], ""]) {
      writeFileAt(path, { version: 2, stateDbPath: value });
      configError(() => loadConfig(path), /stateDbPath.*non-empty string or null/);
    }
  });

  test("writeConfig persists the top-level path", () => {
    const directory = tempDir();
    const path = join(directory, "nested", "shims.json");
    const custom = join(directory, "custom-state.sqlite");
    writeConfig({ stateDbPath: custom }, path);
    expect(JSON.parse(readFileSync(path, "utf8")).stateDbPath).toBe(custom);
    expect(loadConfig(path).stateDbPath).toBe(custom);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("status page mount", () => {
  test("defaults are root mount and no external asset directory", () => {
    const config = loadConfig(join(tempDir(), "status-default.json"));
    expect(config.features["lazy-router"].statusBasePath).toBe("");
    expect(config.features["lazy-router"].statusAssetDir).toBe(null);
  });

  test("a base path must be a clean absolute prefix and trailing slashes go", () => {
    expect(normalizeStatusBasePath("")).toBe("");
    expect(normalizeStatusBasePath(undefined)).toBe("");
    expect(normalizeStatusBasePath("/ops")).toBe("/ops");
    expect(normalizeStatusBasePath("/ops/")).toBe("/ops");
    expect(normalizeStatusBasePath("/a/b/")).toBe("/a/b");
    for (const value of ["ops", "..", "/..", "/ops//x", "//ops", "/op s", "/ops?x", "/ops#x", 5, true]) {
      expect(() => normalizeStatusBasePath(value)).toThrow(ConfigValidationError);
    }
  });

  test("the file accepts both keys and normalizes them", () => {
    const path = join(tempDir(), "status-file.json");
    writeFileAt(path, {
      version: 2,
      features: { "lazy-router": { statusBasePath: "/ops/", statusAssetDir: "relative" } },
    });
    configError(() => loadConfig(path), /statusAssetDir.*absolute/);

    writeFileAt(path, {
      version: 2,
      features: { "lazy-router": { statusBasePath: "/ops/", statusAssetDir: "/srv/status-assets" } },
    });
    const config = loadConfig(path);
    expect(config.features["lazy-router"].statusBasePath).toBe("/ops");
    expect(config.features["lazy-router"].statusAssetDir).toBe("/srv/status-assets");
  });

  test("null and omitted asset directories are valid; an empty string is not", () => {
    const path = join(tempDir(), "status-asset-null.json");
    writeFileAt(path, { version: 2, features: { "lazy-router": { statusAssetDir: null } } });
    expect(loadConfig(path).features["lazy-router"].statusAssetDir).toBe(null);

    writeFileAt(path, { version: 2, features: { "lazy-router": { statusAssetDir: "" } } });
    configError(() => loadConfig(path), /statusAssetDir.*absolute/);
  });

  test("the top-level lazy-router patch shortcut accepts the keys", () => {
    const path = join(tempDir(), "status-patch.json");
    writeConfig({ "lazy-router": { statusBasePath: "/ops", statusAssetDir: "/srv/status-assets" } }, path);
    const config = loadConfig(path);
    expect(config.features["lazy-router"].statusBasePath).toBe("/ops");
    expect(config.features["lazy-router"].statusAssetDir).toBe("/srv/status-assets");
  });
});

describe("deep merge", () => {
  test("nested objects merge over their defaults instead of replacing them", () => {
    const path = join(tempDir(), "merge.json");
    writeFileAt(path, {
      version: 2,
      features: {
        "lazy-router": {
          enabled: true,
          providerHeaderTimeoutMs: { codex: 1234 },
          maxInFlight: { openai: 5 },
          routing: { costWeight: 0.9, temperature: 0.2 },
        },
        "ipv6-first": false,
      },
    });
    const config = loadConfig(path);
    const lazy = config.features["lazy-router"];
    expect(lazy.providerHeaderTimeoutMs).toEqual({ commandcode: 1_800_000, codex: 1234 });
    expect(lazy.maxInFlight).toEqual({ openai: 5 });
    expect(lazy.routing.costWeight).toBe(0.9);
    expect(lazy.routing.temperature).toBe(0.2);
    expect(lazy.routing.intelligenceCenter).toBe(50);
    expect(config.features["ipv6-first"]).toEqual({ enabled: false, ttlMs: 60_000 });
  });
});

describe("writeConfig", () => {
  test("writes a 0600 file in a 0700 directory with an atomic rename", () => {
    const path = join(tempDir(), "nested", "shims.json");
    const persisted = writeConfig({ "ipv6-first": { enabled: false }, runtime: { thinkingLoopGuard: true } }, path);

    expect(persisted.version).toBe(2);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(readdirSync(dirname(path))).toEqual(["shims.json"]);

    const file = JSON.parse(readFileSync(path, "utf8"));
    expect(file.version).toBe(2);
    expect(file.runtime).toEqual({ thinkingLoopGuard: true });
    expect(file.features["ipv6-first"].enabled).toBe(false);
    expect(file.features["lazy-router"]).toBeUndefined();
  });

  test("patches merge into the existing file and validate before writing", () => {
    const path = join(tempDir(), "patches", "shims.json");
    writeConfig({ "lazy-router": { routing: { costWeight: 0.7 } } }, path);
    writeConfig({ "lazy-router": { routing: { temperature: 0.1 } } }, path);
    writeConfig({ "sse-heartbeat": { enabled: false } }, path);

    const config = loadConfig(path);
    expect(config.features["lazy-router"].routing.costWeight).toBe(0.7);
    expect(config.features["lazy-router"].routing.temperature).toBe(0.1);
    expect(config.features["lazy-router"].routing.intelligenceCenter).toBe(50);
    expect(config.features["sse-heartbeat"].enabled).toBe(false);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const before = readFileSync(path, "utf8");
    configError(() => writeConfig({ "sse-heartbeat": { intervlMs: 1 } }, path), /Unknown setting/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("a non-object patch is rejected", () => {
    const path = join(tempDir(), "patch.json");
    configError(() => writeConfig(5, path), /patch must be an object/);
  });
});

describe("presets", () => {
  const readPreset = (name) => JSON.parse(readFileSync(new URL(`../presets/${name}`, import.meta.url), "utf8"));

  test("routes.json carries the four lazy routes, limits and peak windows", () => {
    const routes = readPreset("routes.json");
    expect(Object.keys(routes.routes).sort()).toEqual(["lazy/default", "lazy/pro", "lazy/task", "lazy/weak"]);
    expect(routes.contextWindow).toBe(500_000);
    expect(routes.maxOutputTokens).toBe(64_000);
    expect(routes.maxInFlight).toMatchObject({ "ollama-cloud": 3, "charm-hyper": 2 });
    expect(routes.peakWindows).toEqual([
      { from: "09:00", to: "12:00" },
      { from: "14:00", to: "18:00" },
    ]);
    expect(routes.routes["lazy/pro"].graph.type).toBe("rating");
    expect(routes.routes["lazy/task"].graph.children.length).toBeGreaterThan(3);
  });

  test("holidays-cn.json keeps the documented time zone and year blocks", () => {
    const holidays = readPreset("holidays-cn.json");
    expect(holidays.timeZone).toBe("Asia/Shanghai");
    expect(Object.keys(holidays.years).sort()).toEqual(["2026", "2027"]);
    expect(holidays.years["2026"].status).toBe("official");
    expect(holidays.years["2026"].holidays).toHaveLength(7);
    expect(holidays.years["2026"].makeupWorkdays).toHaveLength(6);
  });

  test("cline.json carries the transport defaults and the default channel map", () => {
    const cline = readPreset("cline.json");
    expect(cline.host).toBe("api.cline.bot");
    expect(cline.baseURL).toBe("https://api.cline.bot/api/v1");
    expect(cline.upstream).toBe("openai-compatible-private");
    expect(cline.modelChannels).toEqual({
      "deepseek-v4.1-flash": ["deepseek"],
      "cline-pass/deepseek-v4.1-flash": ["deepseek"],
      "glm-5.3-flash": { only: ["wafer", "inference-net", "digitalocean"] },
      "cline-pass/glm-5.3-flash": { only: ["wafer", "inference-net", "digitalocean"] },
    });
  });
});
