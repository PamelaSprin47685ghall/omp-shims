// Policy purity: production routing and channel policy lives in presets/*.json.
//
// The scan below fails when a concrete model reference, an Antigravity model
// pattern, the Lazy Router's route prefix, an off-peak schedule name, a Cline
// transport value, a Copilot API version, or a provider adapter key leaks back
// into code. The override tests then prove that the bundled values are only
// defaults: each user-facing preset can be replaced through v2 config.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { DEFAULTS, loadConfig } from "../lib/config.mjs";
import { OFFICIAL_RATE_DATE, officialApiEquivalent } from "../lib/router/official-rate-value.mjs";
import { ComposedPolicy, loadPlanData, OFF_PEAK_SCHEDULES } from "../lib/router/plan.mjs";
import { withUpstreamEffort } from "../lib/router/upstream-effort.mjs";
import adaptersPolicy from "../presets/adapters.json";
import antigravityPolicy from "../presets/antigravity.json";
import clinePolicy from "../presets/cline.json";
import copilotPolicy from "../presets/copilot.json";
import offPeakPolicy from "../presets/offpeak.json";
import rankingPolicy from "../presets/ranking.json";
import ratesPolicy from "../presets/rates.json";
import routePolicy from "../presets/routes.json";
import { migrateV1Config } from "../scripts/migrate-v2.mjs";

const ROOT = join(import.meta.dir, "..");
const SCANNED_DIRECTORIES = ["lib", "features", "scripts"];
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Every .mjs file below one directory. */
function moduleFiles(directory) {
  const files = [];
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = join(ROOT, directory, entry.name);
    if (entry.isDirectory()) files.push(...moduleFiles(relative(ROOT, path)));
    else if (entry.name.endsWith(".mjs")) files.push(path);
  }
  return files;
}

/** Collect every provider-qualified model reference in a route graph. */
function collectRouteModels(node, models) {
  if (Array.isArray(node)) {
    for (const item of node) collectRouteModels(item, models);
    return;
  }
  if (node === null || typeof node !== "object") return;
  if (typeof node.model === "string") models.add(node.model);
  if (Array.isArray(node.excludeModels)) {
    for (const model of node.excludeModels) if (typeof model === "string") models.add(model);
  }
  for (const value of Object.values(node)) collectRouteModels(value, models);
}

/** A config file with one feature patch, loaded through the public loader. */
function loadWithFeatures(features) {
  const directory = mkdtempSync(join(tmpdir(), "omp-shims-policy-"));
  directories.push(directory);
  const path = join(directory, "shims.json");
  writeFileSync(path, JSON.stringify({ features }), { mode: 0o600 });
  return loadConfig(path);
}

describe("no concrete policy in code", () => {
  test("model references, patterns, prefixes, transport values, and adapter keys live only in presets", () => {
    const models = new Set(Object.keys(ratesPolicy.rates));
    collectRouteModels(routePolicy, models);
    models.add(copilotPolicy.autoBootstrapModel);

    const fragments = [...models];
    for (const model of models) {
      const slash = model.indexOf("/");
      if (slash > 0) fragments.push(model.slice(slash + 1));
    }
    fragments.push(
      "gemini-3",
      "gemini-4",
      "claude-opus",
      "claude-sonnet",
      "gpt-5.6",
      "gpt-6",
      "deepseek-v4",
      "glm-5",
      "grok-4",
      "zai-glm",
      antigravityPolicy.tieredPattern,
      antigravityPolicy.ultraModelPattern,
    );

    const prefixLiteral = new RegExp(
      `["'\`]${routePolicy.clientOnlyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
    );
    const transportLiterals = [
      clinePolicy.host,
      clinePolicy.upstream,
      copilotPolicy.apiVersion,
      ...Object.keys(adaptersPolicy).filter((key) => !key.startsWith("$")),
    ];
    const scheduleNames = Object.keys(offPeakPolicy.schedules);
    const offenders = [];
    const files = SCANNED_DIRECTORIES.flatMap(moduleFiles);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const name = relative(ROOT, file);
      for (const fragment of fragments) {
        if (text.includes(fragment)) offenders.push(`${name}: model policy "${fragment}"`);
      }
      if (prefixLiteral.test(text)) offenders.push(`${name}: route prefix "${routePolicy.clientOnlyPrefix}"`);
      for (const literal of transportLiterals) {
        if (text.includes(literal)) offenders.push(`${name}: transport policy "${literal}"`);
      }
      if (name === "lib/router/plan.mjs") {
        for (const schedule of scheduleNames) {
          if (text.includes(`"${schedule}"`)) offenders.push(`${name}: off-peak schedule "${schedule}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("preset defaults and overrides", () => {
  test("ranking weights come from presets/ranking.json and stay tunable", () => {
    expect(DEFAULTS["lazy-router"].routing).toEqual(rankingPolicy.routing);
    const config = loadWithFeatures({ "lazy-router": { routing: { costWeight: 0.42, temperature: 0.1 } } });
    expect(config.features["lazy-router"].routing.costWeight).toBe(0.42);
    expect(config.features["lazy-router"].routing.temperature).toBe(0.1);
    expect(config.features["lazy-router"].routing.intelligenceCenter).toBe(rankingPolicy.routing.intelligenceCenter);
  });

  test("Antigravity model patterns come from the preset and stay tunable", () => {
    expect(DEFAULTS.antigravity.tieredPattern).toBe(antigravityPolicy.tieredPattern);
    expect(DEFAULTS.antigravity.ultraModelPattern).toBe(antigravityPolicy.ultraModelPattern);
    const config = loadWithFeatures({
      antigravity: { tieredPattern: "^(custom-flash)$", ultraModelPattern: "^custom-ultra$" },
    });
    expect(config.features.antigravity.tieredPattern).toBe("^(custom-flash)$");
    expect(config.features.antigravity.ultraModelPattern).toBe("^custom-ultra$");
  });

  test("the Copilot Auto bootstrap model and API version come from the preset and stay tunable", () => {
    expect(DEFAULTS["copilot-auto"].autoBootstrapModel).toBe(copilotPolicy.autoBootstrapModel);
    expect(DEFAULTS["copilot-auto"].apiVersion).toBe(copilotPolicy.apiVersion);
    const config = loadWithFeatures({
      "copilot-auto": { autoBootstrapModel: "custom/bootstrap-model", apiVersion: "2099-01-01" },
    });
    expect(config.features["copilot-auto"].autoBootstrapModel).toBe("custom/bootstrap-model");
    expect(config.features["copilot-auto"].apiVersion).toBe("2099-01-01");
  });

  test("Cline transport and channel defaults come from the preset and stay tunable", () => {
    expect(DEFAULTS["cline-pin-upstream"]).toMatchObject({
      host: clinePolicy.host,
      baseURL: clinePolicy.baseURL,
      upstream: clinePolicy.upstream,
      modelChannels: clinePolicy.modelChannels,
    });
    const config = loadWithFeatures({
      "cline-pin-upstream": {
        host: "custom.example",
        baseURL: "https://custom.example/v1",
        upstream: "custom-upstream",
        modelChannels: { "custom/model": ["custom-channel"] },
      },
    });
    expect(config.features["cline-pin-upstream"]).toMatchObject({
      host: "custom.example",
      baseURL: "https://custom.example/v1",
      upstream: "custom-upstream",
      modelChannels: { "custom/model": ["custom-channel"] },
    });
  });

  test("provider adapters come from presets/adapters.json", () => {
    expect(adaptersPolicy.commandcode).toEqual({
      upstreamEffortWriter: "params-reasoning-effort",
      requiresAttemptTrust: true,
    });
    const body = JSON.stringify({ params: { model: "m" } });
    const rewritten = withUpstreamEffort("commandcode", body, "high");
    expect(JSON.parse(rewritten).params.reasoning_effort).toBe("high");
    expect(withUpstreamEffort("unknown-provider", body, "high")).toBeUndefined();
  });

  test("the route prefix comes from presets/routes.json and stays tunable", () => {
    expect(DEFAULTS["lazy-router"].clientOnlyPrefix).toBe(routePolicy.clientOnlyPrefix);
    const config = loadWithFeatures({ "lazy-router": { clientOnlyPrefix: "custom/" } });
    expect(config.features["lazy-router"].clientOnlyPrefix).toBe("custom/");
  });

  test("routes.json peakWindows is the only source and is required", () => {
    const plan = loadPlanData();
    expect(plan.peakWindows).toEqual(routePolicy.peakWindows);
    expect(new ComposedPolicy(plan).peakWindows).toEqual(routePolicy.peakWindows);
    expect(() => new ComposedPolicy({ routes: {} })).toThrow(/peakWindows/);
    expect(() => loadPlanData(new URL("./definitely-missing-routes.json", import.meta.url))).toThrow();
  });

  test("pricing comes from presets/rates.json", () => {
    expect(OFFICIAL_RATE_DATE).toBe(ratesPolicy.asOf);
    const [model] = Object.keys(ratesPolicy.rates);
    const result = officialApiEquivalent([{ model, uncachedInput: 1_000_000, cachedInput: 0, output: 0 }]);
    expect(result.valueUsd).toBe(ratesPolicy.rates[model].input);
    expect(result.ratesAsOf).toBe(ratesPolicy.asOf);
    expect(result.note).toBe(ratesPolicy.note);
  });

  test("off-peak schedules come from presets/offpeak.json", () => {
    expect(OFF_PEAK_SCHEDULES).toEqual(Object.keys(offPeakPolicy.schedules));
  });
});

describe("v1 migration preserves routing semantics", () => {
  test("temperature and the legacy priors survive the migration", () => {
    const { config, notes } = migrateV1Config({
      features: { "lazy-router": { routing: { temperature: 0.5, excellentPrior: 0.6, mediumPrior: 0 } } },
    });
    expect(config.features["lazy-router"].routing).toMatchObject({
      temperature: 0.5,
      excellentPrior: 0.6,
      mediumPrior: 0,
    });
    const text = notes.join("\n");
    expect(text).toContain("routing.temperature: kept");
    expect(text).toContain("routing.excellentPrior: carried");
    expect(text).toContain("routing.mediumPrior: carried");
  });

  test("the v2 default temperature equals the verified v1 default", () => {
    // v1 lib/lazy-router/ranking.js at the parent of the v2 rewrite: 0.60.
    expect(DEFAULTS["lazy-router"].routing.temperature).toBe(0.6);
    expect(rankingPolicy.routing.temperature).toBe(0.6);
  });
});
