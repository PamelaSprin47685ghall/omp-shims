import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ComposedPolicy, isDeepSeekPeak, isOllamaPeak } from "../lib/lazy-router/composed-policy.js";
import { CyclicSpeed, periodicBasis } from "../lib/lazy-router/cyclic-speed.js";

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
  test("only six Lazy routes and two exact Rush aliases exist", () => {
    expect(policy.routeNames).toEqual([
      "lazy/pro", "lazy/flash", "lazy/batch-blind", "lazy/weak",
      "lazy/default", "lazy/task", "rush/default", "rush/task",
    ]);
    for (const name of ["weak/task", "rush/vision", "lazy/vision", "weak/default"]) expect(policy.routeFor(name)).toBeUndefined();
  });

  test("all Plus keys precede all Pro keys, even when Pro has better predicted speed", () => {
    const at = when("2026-10-29T12:00:00Z");
    const expected = ["plus", "plus", "pro"];
    expect(ranked("lazy/default", at).map((c) => c.unit.tier)).toEqual(expected);
    expect(ranked("rush/default", at).map((c) => c.unit.tier)).toEqual(expected);
    expect(ranked("lazy/default", at, { available: (c) => c.unit.key !== "plus1" }).map((c) => c.unit.key)).toEqual(["plus2", "pro1"]);
    expect(ranked("lazy/default", at, { available: (c) => c.unit.tier !== "plus" }).map((c) => c.unit.key)).toEqual(["pro1"]);
  });

  test("Rush/task is an alias; multiple Mistral keys receive one shared speed prediction", () => {
    const at = when("2026-10-29T12:00:00Z");
    const model = "mistral-vibe/deepseek-v4-1-flash-1017";
    const calls = [];
    const speed = { predict(name) { calls.push(name); return { totalMs: 2300, rd: 0.2, weight: 90 }; } };
    const result = ranked("rush/task", at, { speed });
    expect(result.map((c) => c.model)).toEqual([model, model]);
    expect(ranked("lazy/task", at, { speed }).map((c) => c.model)).toEqual([model, model]);
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls)).toEqual(new Set([model]));
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

  test("model rating compares only predicted completion time, never configured intelligence or cost", () => {
    const at = when("2026-10-29T12:00:00Z");
    const result = ranked("lazy/pro", at, { settings: { temperature: 0 } });
    expect(result[0].model).toBe("google-antigravity/gemini-4-argon");
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

  test("disabled peak-priced candidates are excluded before ranking", () => {
    const id = (t) => policy.candidates("lazy/flash", "peak", units, when(t)).candidates.map((c) => c.model);
    const dsPeak = id("2026-10-29T02:00:00Z");
    expect(dsPeak.some((s) => s.startsWith("opencode-go/"))).toBe(false);
    expect(dsPeak.some((s) => s.startsWith("ollama-cloud/"))).toBe(true);
    const ollamaPeak = id("2026-10-29T14:00:00Z");
    expect(ollamaPeak.some((s) => s.startsWith("ollama-cloud/"))).toBe(false);
    expect(ollamaPeak.some((s) => s.startsWith("cline-pass/"))).toBe(false);
    expect(ollamaPeak.some((s) => s.startsWith("opencode-go/"))).toBe(true);
    expect(id("2026-10-31T14:00:00Z")).toHaveLength(5);
  });

  test("unknown aliases and circular trees are rejected", () => {
    expect(() => new ComposedPolicy({ routes: { a: { alias: "b" }, b: { alias: "a" } } })).toThrow();
    expect(() => new ComposedPolicy({ routes: { a: { graph: { type: "random", children: [] } } } })).toThrow();
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
