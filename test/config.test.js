import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_PATH, DEFAULTS, describeConfig, FEATURES, loadConfig, writeConfig } from "../lib/config.js";

function setFile(value) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, typeof value === "string" ? value : JSON.stringify(value));
}

afterEach(() => {
  rmSync(CONFIG_PATH, { force: true });
  for (const { env } of Object.values(FEATURES)) delete process.env[env];
});

describe("feature metadata", () => {
  test("every feature has defaults and every default has metadata", () => {
    expect(Object.keys(DEFAULTS).sort()).toEqual(Object.keys(FEATURES).sort());
  });

  test("every feature has a summary and a unique OMP_SHIMS_ env toggle", () => {
    const envs = Object.values(FEATURES).map((meta) => meta.env);
    for (const meta of Object.values(FEATURES)) {
      expect(meta.summary.length).toBeGreaterThan(0);
      expect(meta.env).toMatch(/^OMP_SHIMS_[A-Z0-9_]+$/);
    }
    expect(new Set(envs).size).toBe(envs.length);
  });

  test("defaults carry no credentials or personal accounts", () => {
    expect(DEFAULTS["cline-pin-upstream"].apiKey).toBeUndefined();
    expect(DEFAULTS["antigravity-account-routing"].ultraAccounts).toEqual([]);
    expect(DEFAULTS["antigravity-account-routing"].proAccounts).toEqual([]);
    expect(JSON.stringify(DEFAULTS)).not.toMatch(/sk_[0-9a-f]{16,}|@gmail\.com/);
  });
});

describe("loadConfig", () => {
  test("uses built-in defaults without a config file", () => {
    const { features, configPath } = loadConfig();
    expect(configPath).toBe(CONFIG_PATH);
    const off = Object.entries(features)
      .filter(([, entry]) => !entry.enabled)
      .map(([name]) => name)
      .sort();
    expect(off).toEqual(["antigravity-routing", "lazy-router", "native-loop-guard", "sse-heartbeat", "traffic-log"]);
    expect(features["antigravity-continuation"].maxContinuations).toBe(3);
  });

  test("the file overrides defaults, as a boolean or as an object", () => {
    setFile({ features: { "ipv6-first": false, "traffic-log": { enabled: true, dir: "/tmp/x" } } });
    const { features } = loadConfig();
    expect(features["ipv6-first"].enabled).toBe(false);
    expect(features["traffic-log"]).toMatchObject({ enabled: true, dir: "/tmp/x", maxAgeMs: 3_600_000 });
  });

  test("environment toggles win over the file", () => {
    setFile({ features: { "ipv6-first": false, "tool-id-hash": true } });
    process.env.OMP_SHIMS_IPV6_FIRST = "on";
    process.env.OMP_SHIMS_TOOL_ID_HASH = "off";
    const { features } = loadConfig();
    expect(features["ipv6-first"].enabled).toBe(true);
    expect(features["tool-id-hash"].enabled).toBe(false);
  });

  test("unrecognised environment values are ignored", () => {
    process.env.OMP_SHIMS_IPV6_FIRST = "maybe";
    expect(loadConfig().features["ipv6-first"].enabled).toBe(true);
  });

  test("an unreadable config file is ignored", () => {
    setFile("{not json");
    expect(loadConfig().features["ipv6-first"].enabled).toBe(true);
  });
});

describe("writeConfig", () => {
  test("creates the file and merges patches into existing settings", () => {
    writeConfig({ "antigravity-continuation": { maxContinuations: 5 } });
    writeConfig({ "antigravity-continuation": { enabled: false }, "ipv6-first": false });
    const file = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    expect(file.features).toEqual({
      "antigravity-continuation": { maxContinuations: 5, enabled: false },
      "ipv6-first": false,
    });
  });

  test("keeps sections other than features", () => {
    setFile({ pluginBridge: { tokens: { kiro: { env: "X" } } } });
    writeConfig({ "ipv6-first": { enabled: false } });
    expect(JSON.parse(readFileSync(CONFIG_PATH, "utf8")).pluginBridge).toEqual({ tokens: { kiro: { env: "X" } } });
  });
});

test("describeConfig prints one line per feature with its state", () => {
  const lines = describeConfig();
  expect(lines).toHaveLength(Object.keys(FEATURES).length);
  expect(lines.find((line) => line.includes("native-loop-guard"))).toStartWith("off");
  expect(lines.find((line) => line.includes("ipv6-first"))).toStartWith("on ");
});
