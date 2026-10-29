import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ComposedPolicy, isDeepSeekPeak, isOllamaPeak } from "../lib/lazy-router/composed-policy.js";
import { CyclicSpeed, periodicBasis } from "../lib/lazy-router/cyclic-speed.js";
import { InFlightTracker } from "../lib/lazy-router/capacity.js";

const when = (s) => new Date(s);
const accounts = [
  { provider: "openai-codex", tier: "plus", key: "plus1", label: "plus1" },
  { provider: "openai-codex", tier: "plus", key: "plus2", label: "plus2" },
  { provider: "openai-codex", tier: "pro", key: "pro1", label: "pro1" },
  { provider: "mistral-vibe", key: "m1", label: "m1" },
  { provider: "mistral-vibe", key: "m2", label: "m2" },
  { provider: "kiro", key: "k1", label: "kiro" },
  { provider: "google-antigravity", tier: "ultra", key: "u1", label: "ultra" },
  { provider: "google-antigravity", tier: "pro", key: "g1", label: "pro" },
  { provider: "charm-hyper", key: "charm", label: "charm" },
  { provider: "opencode-go", key: "open", label: "open" },
  { provider: "ollama-cloud", key: "ollama", label: "ollama" },
  { provider: "cline-pass", key: "cline", label: "cline" },
  { provider: "ctyun", key: "ctyun", label: "ctyun" },
  { provider: "openai-api", key: "api1", label: "openai-api" },
];
const units = { select(provider, tiers) { return accounts.filter((a) => a.provider === provider && (!tiers || tiers.includes(a.tier))); } };
const policy = new ComposedPolicy();

function ranked(route, at, options = {}) {
  const candidates = policy.candidates(route, "peak", units, at).candidates;
  return policy.rankCandidates(route, candidates, {
    at,
    random: () => 0.5,
    speed: { predict(model) { return { totalMs: model.includes("argon") ? 1000 : 10000, rd: 0.1, weight: 100 }; } },
    ...options,
  }).map((r) => r.candidate);
}

describe("recursive keyed-model algebra", () => {
  test("only four Lazy routes exist after batch-blind retirement", () => {
    expect(policy.routeNames).toEqual([
      "lazy/pro", "lazy/weak", "lazy/default", "lazy/task",
    ]);
    expect(policy.routeFor("lazy/batch-blind")).toBeUndefined();
    for (const name of ["weak/task", "rush/default", "rush/task", "rush/vision", "lazy/vision", "weak/default", "lazy/flash"]) expect(policy.routeFor(name)).toBeUndefined();
  });

  test("Codex Plus remains ahead of Codex Pro inside its fallback branch", () => {
    const at = when("2026-10-29T12:00:00Z");
    const codex = (options) => ranked("lazy/default", at, options)
      .filter((c) => c.model === "openai-codex/gpt-6.1-terra");
    expect(codex().map((c) => c.unit.tier)).toEqual(["plus", "plus", "pro"]);
    expect(codex({ available: (c) => c.unit.key !== "plus1" }).map((c) => c.unit.key)).toEqual(["plus2", "pro1"]);
    expect(codex({ available: (c) => c.unit.tier !== "plus" }).map((c) => c.unit.key)).toEqual(["pro1"]);
  });

  test("Plus, then Pro, then official OpenAI API Flex Terra medium strictly", () => {
    const at = when("2026-10-29T12:00:00Z");
    const topology = policy.routeTopology()["lazy/default"].graph;
    expect(topology.type).toBe("fallback");
    expect(topology.children.map((c) => [c.model, c.tier, c.effort])).toEqual([
      ["openai-codex/gpt-6.1-terra", "plus", "medium"],
      ["openai-codex/gpt-6.1-terra", "pro", "medium"],
      ["openai-api/gpt-6.1-terra", null, "medium"],
    ]);
    const choice = (options = {}) => ranked("lazy/default", at, options);
    const ordered = choice().map((c) => [c.model, c.unit.tier ?? null]);
    expect(ordered.slice(0, 2)).toEqual([
      ["openai-codex/gpt-6.1-terra", "plus"],
      ["openai-codex/gpt-6.1-terra", "plus"],
    ]);
    expect(ordered.slice(2)).toEqual([
      ["openai-codex/gpt-6.1-terra", "pro"],
      ["openai-api/gpt-6.1-terra", null],
    ]);
    const fastestFlex = choice({
      speed: { predict(model) {
        return { totalMs: model === "openai-api/gpt-6.1-terra" ? 1 : 100000,
          rd: 0.1, weight: 100 };
      } },
    });
    expect(fastestFlex.at(-1).model).toBe("openai-api/gpt-6.1-terra");
    expect(fastestFlex[0].unit.tier).toBe("plus");
    const noPlus = choice({ available: (c) => c.unit.tier !== "plus" });
    expect(noPlus[0].unit.tier).toBe("pro");
    expect(noPlus.at(-1).model).toBe("openai-api/gpt-6.1-terra");
    const onlyFlex = choice({
      available: (c) => c.model === "openai-api/gpt-6.1-terra",
    });
    expect(onlyFlex.map((c) => c.model)).toEqual(["openai-api/gpt-6.1-terra"]);
  });

  test("Mistral GLM Flash has 20 concurrent slots for each Key, not 20 shared across Keys", () => {
    const model = "mistral-vibe/zai-glm-5-3-flash";
    const key1 = { provider: "mistral-vibe", key: "mistral-vibe/31", label: "mistral-vibe#1" };
    const key2 = { provider: "mistral-vibe", key: "mistral-vibe/42", label: "mistral-vibe#2" };
    const first = policy.capacityUnit({ unit: key1, model });
    const second = policy.capacityUnit({ unit: key2, model });
    const small = policy.capacityUnit({ unit: key1, model: "mistral-vibe/mistral-small-latest" });
    const tracker = new InFlightTracker({ limitOf: (unit) => policy.maxInFlight(unit) });
    expect(policy.maxInFlight(first)).toBe(20);
    expect(policy.maxInFlight(second)).toBe(20);
    expect(policy.maxInFlight(small)).toBe(0);
    expect(small).toBe(key1);
    expect(first.key).not.toBe(second.key);
    const held = Array.from({ length: 20 }, () => tracker.slot(first));
    expect(tracker.inFlight(first)).toBe(20);
    expect(tracker.hasRoom(first)).toBe(false);
    expect(tracker.hasRoom(second)).toBe(true);
    const otherKey = tracker.slot(second);
    expect(tracker.inFlight(second)).toBe(1);
    expect(tracker.inFlight(first)).toBe(20);
    expect(tracker.hasRoom(small)).toBe(true);
    const probe = tracker.slot(second, { reserve: true });
    probe.beginRequest();
    expect(tracker.inFlight(second)).toBe(2);
    probe.releaseAll();
    held[0].releaseAll();
    expect(tracker.inFlight(first)).toBe(19);
    expect(tracker.hasRoom(first)).toBe(true);
    held.forEach((slot) => slot.releaseAll());
    otherKey.releaseAll();
    expect(tracker.inFlight(first)).toBe(0);
    expect(tracker.inFlight(second)).toBe(0);
  });

  test("multiple Mistral keys receive one shared speed prediction", () => {
    const at = when("2026-10-29T12:00:00Z");
    const model = "mistral-vibe/zai-glm-5-3-flash";
    const calls = [];
    const speed = { predict(name) { calls.push(name); return { totalMs: 2300, rd: 0.2, weight: 90 }; } };
    const result = ranked("lazy/task", at, { speed });
    expect(result.filter((c) => c.model === model)).toHaveLength(2);
    expect(ranked("lazy/task", at, { speed }).filter((c) => c.model === model)).toHaveLength(2);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toContain(model);
    expect(new Set(calls)).not.toContain("google-antigravity/gemini-3.8-flash");
  });

  test("key distribution is random and can preserve affinity via effective temperature", () => {
    const at = when("2026-10-29T12:00:00Z");
    const warm = ranked("lazy/task", at, {
      random: () => 0.8,
      cachedShare: (c) => c.unit.key === "m1" ? 0.5 : 0,
      cachedBytes: (c) => c.unit.key === "m1" ? 65536 : 0,
      settings: { temperature: 0.6 },
    });
    expect(warm[0].unit.key).toBe("m1");
  });

  test("Argon uses one rated slot: Ultra first, Pro only after Ultra is unavailable", () => {
    const at = when("2026-10-29T12:00:00Z");
    const row = (available) => ranked("lazy/pro", at, {
      settings: { temperature: 0 }, available,
    }).filter((candidate) => candidate.model === "google-antigravity/gemini-4-argon");
    expect(row(() => true).map((candidate) => candidate.unit.tier)).toEqual(["ultra", "pro"]);
    expect(row((candidate) => candidate.unit.tier !== "ultra").map((candidate) => candidate.unit.tier)).toEqual(["pro"]);
    const raw = policy.candidates("lazy/pro", "peak", units, at).candidates;
    expect(raw.filter((c) => c.model === "google-antigravity/gemini-4-argon")).toHaveLength(2);
  });

  test("Lazy Task excludes uncached Mistral DeepSeek and keeps all five other DeepSeek models", () => {
    const glm = "mistral-vibe/zai-glm-5-3-flash";
    const deepseek = [
      "charm-hyper/deepseek-v4.1-flash-1017",
      "opencode-go/deepseek-v4.1-flash",
      "ollama-cloud/deepseek-v4.1-flash:1017",
      "cline-pass/deepseek-v4.1-flash-1017",
      "ctyun/deepseek-v4.1-flash",
    ];
    const at = when("2026-10-31T14:00:00Z");
    const candidates = policy.candidates("lazy/task", "peak", units, at).candidates;
    expect(candidates.some((c) => c.model === "mistral-vibe/deepseek-v4-1-flash-1017")).toBe(false);
    expect(candidates.filter((c) => c.model === glm)).toHaveLength(2);
    expect(new Set(candidates.map((c) => c.model))).toEqual(new Set([glm, ...deepseek]));
    const topology = policy.routeTopology()["lazy/task"].graph;
    expect(topology.type).toBe("rating");
    expect(topology.children.map((c) => c.model)).toEqual([glm, ...deepseek]);
    // Neither model is forced ahead. The same scoring mechanism may pick either.
    const fast = (fastModel) => ranked("lazy/task", at, {
      random: () => 0.5,
      speed: { predict(model) {
        return { totalMs: model === fastModel ? 10 : 100000, rd: 0.1, weight: 100 };
      } },
    });
    expect(fast(glm)[0].model).toBe(glm);
    expect(fast(deepseek[0])[0].model).toBe(deepseek[0]);
    expect(fast(deepseek.at(-1))[0].model).toBe(deepseek.at(-1));
    const activePeak = policy.candidates("lazy/task", "peak", units,
      when("2026-10-29T02:00:00Z")).candidates;
    expect(activePeak.some((c) => c.model === deepseek[1])).toBe(false);
    expect(activePeak.some((c) => c.model === "ctyun/deepseek-v4.1-flash")).toBe(true);
    const ollamaPeak = policy.candidates("lazy/task", "peak", units,
      when("2026-10-29T14:00:00Z")).candidates;
    expect(ollamaPeak.some((c) => c.model === deepseek[2])).toBe(false);
    expect(ollamaPeak.some((c) => c.model === "ctyun/deepseek-v4.1-flash")).toBe(true);
  });

  test("model rating compares only predicted completion time, never configured intelligence or cost", () => {
    const at = when("2026-10-29T12:00:00Z");
    const result = ranked("lazy/pro", at, { settings: { temperature: 0 } });
    expect(result[0].model).toBe("google-antigravity/gemini-4-argon");
  });

  test("Cline Pass DeepSeek follows official DeepSeek windows, never Ollama windows", () => {
    const cline = "cline-pass/deepseek-v4.1-flash-1017";
    const ollama = "ollama-cloud/deepseek-v4.1-flash:1017";
    const opencode = "opencode-go/deepseek-v4.1-flash";
    const configured = policy.routeTopology()["lazy/task"].graph.children;
    expect(configured.find((c) => c.model === cline)?.offPeakOnly).toBe("deepseek");
    expect(configured.find((c) => c.model === ollama)?.offPeakOnly).toBe("ollama");
    const eligible = (at) => new Set(
      policy.candidates("lazy/task", "peak", units, when(at)).candidates.map((c) => c.model));
    const dsPeak = eligible("2026-10-29T02:00:00Z"); // DeepSeek peak, Ollama off-peak
    expect(dsPeak.has(cline)).toBe(false);
    expect(dsPeak.has(opencode)).toBe(false);
    expect(dsPeak.has(ollama)).toBe(true);
    const ollamaPeak = eligible("2026-10-29T14:00:00Z"); // Ollama peak, DeepSeek off-peak
    expect(ollamaPeak.has(cline)).toBe(true);
    expect(ollamaPeak.has(opencode)).toBe(true);
    expect(ollamaPeak.has(ollama)).toBe(false);
    const holiday = new ComposedPolicy(undefined, {
      calendar: { days: new Map([["2026-10-29", { kind: "holiday" }]]) },
    });
    const holidaySet = new Set(holiday.candidates("lazy/task", "peak", units,
      when("2026-10-29T02:00:00Z")).candidates.map((c) => c.model));
    expect(holidaySet.has(cline)).toBe(true);
    expect(holidaySet.has(opencode)).toBe(true);
  });

  test("DeepSeek and Ollama peak windows differ and are end-exclusive", () => {
    expect(isDeepSeekPeak(when("2026-10-29T01:00:00Z"))).toBe(true);
    expect(isDeepSeekPeak(when("2026-10-29T04:00:00Z"))).toBe(false);
    expect(isDeepSeekPeak(when("2026-10-29T06:00:00Z"))).toBe(true);
    expect(isDeepSeekPeak(when("2026-10-31T06:00:00Z"))).toBe(false);
    const calendar = { days: new Map([["2026-10-29", { kind: "holiday" }]]) };
    expect(isDeepSeekPeak(when("2026-10-29T06:00:00Z"), calendar)).toBe(false);
    expect(isOllamaPeak(when("2026-10-29T12:00:00Z"))).toBe(true);
    expect(isOllamaPeak(when("2026-10-29T18:00:00Z"))).toBe(false);
    expect(isOllamaPeak(when("2026-10-31T12:00:00Z"))).toBe(false);
  });

  test("GLM warm conversation always stays on its cached account across RNG values", () => {
    const at = when("2026-10-29T12:00:00Z");
    for (const randomValue of [0, 0.2, 0.5, 0.8, 0.999]) {
      const warm = ranked("lazy/task", at, {
        random: () => randomValue,
        cachedShare: (c) => c.unit.key === "m2" ? 0.5 : 0,
        cachedBytes: (c) => c.unit.key === "m2" ? 30000 : 0,
      });
      const glmKeys = warm.filter((c) => c.model === "mistral-vibe/zai-glm-5-3-flash");
      expect(glmKeys.map((c) => c.unit.key)).toEqual(["m2", "m1"]);
    }
    // When the warm account fails, the other account remains available.
    expect(ranked("lazy/task", at, {
      available: (c) => c.unit.key !== "m2",
      cachedBytes: (c) => c.unit.key === "m2" ? 30000 : 0,
    }).filter((c) => c.model === "mistral-vibe/zai-glm-5-3-flash")
      .map((c) => c.unit.key)).toEqual(["m1"]);
  });

  test("topology exposes nested rating, fallback and model leaves", () => {
    const topology = policy.routeTopology();
    expect(Object.keys(topology)).toEqual(policy.routeNames);
    expect(topology["lazy/pro"].graph.type).toBe("rating");
    expect(topology["lazy/pro"].graph.children[2].type).toBe("fallback");
    expect(topology["lazy/default"].graph.type).toBe("fallback");
    expect(topology["lazy/default"].graph.children).toHaveLength(3);
    expect(topology["lazy/task"].graph.type).toBe("rating");
    expect(JSON.stringify(topology)).not.toContain("credentialId");
  });

  test("unknown aliases and circular trees are rejected", () => {
    expect(() => new ComposedPolicy({ routes: { a: { alias: "b" }, b: { alias: "a" } } })).toThrow();
    expect(() => new ComposedPolicy({ routes: { a: { graph: { type: "random", children: [] } } } })).toThrow();
  });
});

describe("Rating uses temperature-softmax of log total completion time", () => {
  const at = when("2026-10-29T12:00:00Z");
  const two = new ComposedPolicy({ routes: {
    pair: { graph: { type: "rating", children: [
      { type: "model", model: "kiro/claude-opus-5-5" },
      { type: "model", model: "ctyun/deepseek-v4.1-flash" },
    ] } },
  } });
  const candidates = two.candidates("pair", "peak", units, at).candidates;
  const seededRandom = (seed) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  };
  const sample = (fastMs, slowMs, temp, rd = 0, draws = 5000) => {
    const random = seededRandom(3297);
    const counts = [0, 0];
    const speed = { predict(model) {
      return { totalMs: model.startsWith("kiro/") ? fastMs : slowMs, rd, weight: 100 };
    } };
    for (let i = 0; i < draws; i++) {
      const result = two.rankCandidates("pair", candidates, {
        at, random, speed, settings: { temperature: temp },
      });
      counts[result[0].candidate.model.startsWith("kiro/") ? 0 : 1]++;
    }
    return counts[0] / draws;
  };

  test("nearly equal speeds receive nearly equal traffic, not near-deterministic preference", () => {
    const fastShare = sample(10000, 10300, 0.6);
    // Theoretical softmax share = 1 / (1 + (10000/10300) ** (1/0.6)).
    const theoretical = 1 / (1 + Math.pow(10000 / 10300, 1 / 0.6));
    expect(fastShare).toBeGreaterThan(0.48);
    expect(fastShare).toBeLessThan(0.56);
    expect(Math.abs(fastShare - theoretical)).toBeLessThan(0.035);
  });

  test("large speed gaps favor fast models without starving slow ones unnecessarily", () => {
    const fastShare = sample(1000, 20000, 0.6);
    expect(fastShare).toBeGreaterThan(0.98);
    expect(fastShare).toBeLessThan(1);
  });

  test("higher temperature flattens the split and zero temperature is fastest-first", () => {
    const cold = sample(1000, 2000, 0.1);
    const hot = sample(1000, 2000, 4);
    expect(cold).toBeGreaterThan(0.99);
    expect(hot).toBeGreaterThan(0.49);
    expect(hot).toBeLessThan(0.60);
    expect(sample(10000, 10300, 0, 1.25, 100)).toBe(1);
  });

  test("RD still supplies exploration, even for a high-evidence speed rating", () => {
    const precise = sample(10000, 15000, 0.4, 0, 4000);
    const uncertain = sample(10000, 15000, 0.4, 3, 4000);
    // A symmetric posterior draw flattens preference when the model is uncertain.
    expect(uncertain).toBeLessThan(precise);
    expect(uncertain).toBeGreaterThan(0.5);
  });

  test("one unavailable model is removed before drawing and fallback order is unchanged", () => {
    const onlySlow = two.rankCandidates("pair", candidates, {
      at, random: seededRandom(10),
      available: (c) => c.unit.provider === "ctyun",
      settings: { temperature: 2 },
    });
    expect(onlySlow.map(x => x.candidate.unit.provider)).toEqual(["ctyun"]);
    const fallback = policy.candidates("lazy/default", "peak", units, at).candidates;
    const winner = policy.rankCandidates("lazy/default", fallback, {
      at, random: seededRandom(10), settings: { temperature: 100 },
    });
    expect(winner.map(x => x.candidate.unit.tier ?? "flex")).toEqual([
      "plus", "plus", "pro", "flex",
    ]);
  });
});

describe("periodic cubic B-spline sufficient statistics", () => {
  test("basis partition of unity, continuity at midnight, and hourly knot count", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const basis = periodicBasis(hour * 3_600_000);
      expect(basis).toHaveLength(4);
      expect(basis.reduce((sum, [, v]) => sum + v, 0)).toBeCloseTo(1, 9);
    }
    expect(periodicBasis(0)).toEqual(periodicBasis(86_400_000));
  });

  test("one-day half-life makes yesterday's 100 samples count about 50 today", () => {
    let now = Date.UTC(2026, 9, 29, 6);
    const speed = new CyclicSpeed({ now: () => now });
    for (let i = 0; i < 100; i += 1) speed.observe("a/model", 1000);
    expect(speed.predict("a/model").weight).toBeCloseTo(100, 6);
    now += 86_400_000;
    expect(speed.predict("a/model").weight).toBeCloseTo(50, 6);
    now += 86_400_000;
    expect(speed.predict("a/model").weight).toBeCloseTo(25, 6);
  });

  test("hourly RD remains uncertain away from the observed UTC hour", () => {
    let now = Date.UTC(2026, 9, 29, 6);
    const speed = new CyclicSpeed({ now: () => now });
    for (let i = 0; i < 200; i++) speed.observe("a/model", 950);
    const seenHour = speed.predict("a/model", now);
    const unseenHour = speed.predict("a/model", now + 8 * 3_600_000);
    expect(seenHour.localWeight).toBeGreaterThan(0);
    expect(unseenHour.localWeight).toBeCloseTo(0, 6);
    expect(unseenHour.rd).toBeGreaterThan(seenHour.rd);
  });

  test("old speed observations lose influence on the fitted mean as they age", () => {
    let now = Date.UTC(2026, 9, 29, 6);
    const speed = new CyclicSpeed({ now: () => now });
    for (let i = 0; i < 200; i++) speed.observe("a/model", 900);
    const fresh = speed.predict("a/model").totalMs;
    now += 4 * 86_400_000;
    const stale = speed.predict("a/model").totalMs;
    expect(fresh).toBeLessThan(8000);
    expect(stale).toBeGreaterThan(fresh);
    expect(speed.predict("a/model").weight).toBeCloseTo(12.5, 6);
  });

  test("censored slow requests raise expected time without being counted as successes", () => {
    let now = Date.UTC(2026, 9, 29, 6);
    const speed = new CyclicSpeed({ now: () => now });
    for (let i = 0; i < 80; i++) speed.observe("a/model", 1200);
    const before = speed.predict("a/model", now).totalMs;
    speed.observe("a/model", 30000, { censored: true });
    expect(speed.predict("a/model", now).totalMs).toBeGreaterThan(before);
    const stats = speed.models.get("a/model");
    expect(stats.censored).toBeGreaterThan(0);
    expect(stats.completed).toBe(80);
  });

  test("state persists only bounded regression sums and can be reloaded", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-cyclic-"));
    try {
      let now = Date.UTC(2026, 9, 29, 6);
      const path = join(dir, "speed.json");
      const first = new CyclicSpeed({ now: () => now, statePath: path });
      first.observe("a/model", 1400);
      first.observe("a/model", 12000, { censored: true });
      first.flush();
      const second = new CyclicSpeed({ now: () => now, statePath: path });
      expect(second.predict("a/model", now).weight).toBeCloseTo(first.predict("a/model", now).weight, 6);
      expect(second.models.get("a/model").gram).toHaveLength(24);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test("nested fallback, random, and rating compose without special route handlers", () => {
  const nested = new ComposedPolicy({ routes: {
    "nested/test": { graph: { type: "fallback", children: [
      { type: "random", children: [
        { type: "rating", children: [
          { type: "model", model: "kiro/claude-opus-5-5" },
          { type: "model", model: "google-antigravity/gemini-4-argon", tier: "ultra" },
        ] },
        { type: "model", model: "mistral-vibe/mistral-small-latest" },
      ] },
      { type: "model", model: "ctyun/glm-5.3-oc" },
    ] } },
  } });
  const time = when("2026-10-29T12:00:00Z");
  const pool = nested.candidates("nested/test", "peak", units, time).candidates;
  const result = nested.rankCandidates("nested/test", pool, {
    at: time, random: () => 0.4,
    speed: { predict() { return { totalMs: 1200, rd: 0.5, weight: 5 }; } },
  }).map(({candidate}) => candidate.model);
  expect(result).toHaveLength(5);
  expect(result.at(-1)).toBe("ctyun/glm-5.3-oc");
});
