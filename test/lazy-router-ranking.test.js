import { describe, expect, test } from "bun:test";
import { affinityStickiness, populationLatencyMs, rankCandidates, routingRating } from "../lib/lazy-router/ranking.js";

const unit = (key) => ({ key, label: key });
const candidate = (model, intelligence, key = model) => ({ model, intelligence, unit: unit(key) });

describe("Glicko-like Thompson routing", () => {
  test("the latency reference is empirical, not an absolute fast/slow threshold", () => {
    expect(populationLatencyMs({ a: { totalMs: 3000 }, b: { totalMs: 9000 }, c: { totalMs: 12000 } })).toBe(9000);
    const unknown = candidate("p/unknown", "medium");
    const r = routingRating(unknown, undefined, 0, {}, 9000);
    expect(r.latencyRating).toBe(0);
    expect(r.latencyMs).toBeNull();
  });

  test("intelligence priors order low below medium below excellent", () => {
    const low = routingRating(candidate("p/low", "low"), undefined, 0, {}, undefined);
    const medium = routingRating(candidate("p/medium", "medium"), undefined, 0, {}, undefined);
    const excellent = routingRating(candidate("p/excellent", "excellent"), undefined, 0, {}, undefined);
    expect(low.prior).toBe(-0.35);
    expect(medium.prior).toBe(0);
    expect(excellent.prior).toBe(0.6);
    expect(low.rating).toBeLessThan(medium.rating);
    expect(medium.rating).toBeLessThan(excellent.rating);
  });

  test("fresh population latency ignores historical-only models; history is fallback only when all data is old", () => {
    expect(populationLatencyMs({
      fresh: { totalMs: 9_000, samples: 2 },
      oldFast: { totalMs: 1_000, historical: true },
      oldSlow: { totalMs: 2_000, historical: true },
    })).toBe(9_000);
    expect(populationLatencyMs({
      oldFast: { totalMs: 1_000, historical: true },
      oldSlow: { totalMs: 3_000, historical: true },
    })).toBe(2_000);
  });

  test("observed latency is rated by ratio to the current population", () => {
    const c = candidate("p/a", "medium");
    const fast = routingRating(c, { totalMs: 3000, samples: 10 }, 0, { latencyWeight: 1 }, 9000);
    const slow = routingRating(c, { totalMs: 12000, samples: 10 }, 0, { latencyWeight: 1 }, 9000);
    expect(fast.rating).toBeGreaterThan(0);
    expect(slow.rating).toBeLessThan(0);
  });

  test("unseen models keep wide RD and can win a Thompson draw when there is no affinity", () => {
    const known = candidate("p/known", "medium");
    const unknown = candidate("p/unknown", "medium");
    const draws = [0.5, 0.25, 0.01, 1.0];
    let i = 0;
    const ranked = rankCandidates([known, unknown], {
      perf: { "p/known": { totalMs: 3000, samples: 50 }, other: { totalMs: 9000, samples: 20 } },
      settings: { temperature: 1, excellentPrior: 0, mediumPrior: 0, affinityWeight: 0 },
      random: () => draws[i++],
    });
    expect(ranked[0].candidate.model).toBe("p/unknown");
    expect(ranked.find((x) => x.candidate.model === "p/unknown").routing.rd)
      .toBeGreaterThan(ranked.find((x) => x.candidate.model === "p/known").routing.rd);
  });

  test("historical latency is only a quarter-strength prior and keeps cold-start uncertainty wide", () => {
    const c = candidate("p/a", "medium");
    const fresh = routingRating(c, { totalMs: 3_000, samples: 1 }, 0, { latencyWeight: 1, historicalLatencyWeight: 0.25 }, 9_000);
    const history = routingRating(
      c,
      { totalMs: 3_000, samples: 0, historical: true, historicalStrength: 1 },
      0,
      { latencyWeight: 1, historicalLatencyWeight: 0.25 },
      9_000,
    );
    expect(history.latencyRating).toBeCloseTo(fresh.latencyRating * 0.25, 8);
    expect(history.historical).toBe(true);
    expect(history.rd).toBeGreaterThan(fresh.rd);
  });

  test("stale historical strength fades the already-weak latency prior", () => {
    const c = candidate("p/a", "medium");
    const full = routingRating(c, { totalMs: 18_000, samples: 0, historical: true, historicalStrength: 1 }, 0, {}, 9_000);
    const faded = routingRating(c, { totalMs: 18_000, samples: 0, historical: true, historicalStrength: 0.25 }, 0, {}, 9_000);
    expect(Math.abs(faded.latencyRating)).toBeCloseTo(Math.abs(full.latencyRating) * 0.25, 8);
  });

  test("duplicate accounts share one posterior draw per model", () => {
    const a1 = candidate("p/a", "medium", "a1");
    const a2 = candidate("p/a", "medium", "a2");
    const b = candidate("p/b", "medium", "b");
    let calls = 0;
    const ranked = rankCandidates([a1, a2, b], {
      settings: { temperature: 1 },
      random: () => (calls += 1, 0.5),
    });
    expect(calls).toBe(4);
    const a = ranked.filter((row) => row.candidate.model === "p/a");
    expect(a[0].routing.posteriorDraw).toBe(a[1].routing.posteriorDraw);
  });

  test("a normal continuation maps cachedShare around one-half back to full coverage", () => {
    const a = affinityStickiness(0.5, 8192);
    expect(a.coverage).toBe(1);
    expect(a.stickiness).toBeGreaterThan(0);
  });

  test("absolute prefix length makes stickiness strongly nonlinear", () => {
    const short = affinityStickiness(0.5, 8192).stickiness;
    const long = affinityStickiness(0.5, 32768).stickiness;
    expect(long).toBeGreaterThan(short * 4);
  });

  test("a tiny warm prefix barely changes exploration temperature", () => {
    const warm = candidate("p/warm", "medium", "u1");
    const cold = candidate("p/cold", "medium", "u2");
    const ranked = rankCandidates([warm, cold], {
      cachedShare: (c) => c.unit.key === "u1" ? 0.5 : 0,
      cachedBytes: (c) => c.unit.key === "u1" ? 1024 : 0,
      settings: { temperature: 0.5 },
      random: () => 0.5,
    });
    expect(ranked[0].routing.effectiveTemperature).toBeGreaterThan(0.49);
  });

  test("a long warm conversation almost turns Thompson exploration off", () => {
    const warm = candidate("p/warm", "medium", "u1");
    const cold = candidate("p/cold", "medium", "u2");
    const ranked = rankCandidates([warm, cold], {
      perf: { "p/warm": { totalMs: 5000, samples: 20 }, "p/cold": { totalMs: 3000, samples: 20 } },
      cachedShare: (c) => c.unit.key === "u1" ? 0.5 : 0,
      cachedBytes: (c) => c.unit.key === "u1" ? 65536 : 0,
      settings: { temperature: 0.5, excellentPrior: 0, mediumPrior: 0 },
      random: () => 0.5,
    });
    const warmRow = ranked.find((x) => x.candidate.unit.key === "u1");
    expect(warmRow.routing.affinityStickiness).toBeGreaterThan(4);
    expect(warmRow.routing.effectiveTemperature).toBeLessThan(0.01);
    expect(ranked[0].candidate.unit.key).toBe("u1");
  });

  test("an unavailable warm unit does not suppress exploration among fallbacks", () => {
    const warm = candidate("p/warm", "medium", "u1");
    const cold = candidate("p/cold", "medium", "u2");
    const ranked = rankCandidates([warm, cold], {
      cachedShare: (c) => c.unit.key === "u1" ? 0.5 : 0,
      cachedBytes: (c) => c.unit.key === "u1" ? 65536 : 0,
      affinityAvailable: (c) => c.unit.key !== "u1",
      settings: { temperature: 0.5 },
      random: () => 0.5,
    });
    expect(ranked[0].routing.effectiveTemperature).toBeCloseTo(0.5, 8);
  });

  test("affinity is still soft: a modest prefix cannot hide an overwhelming latency gap", () => {
    const warm = candidate("p/warm", "medium", "u1");
    const fast = candidate("p/fast", "medium", "u2");
    const ranked = rankCandidates([warm, fast], {
      perf: { "p/warm": { totalMs: 9000, samples: 20 }, "p/fast": { totalMs: 1000, samples: 20 } },
      cachedShare: (c) => c.unit.key === "u1" ? 0.5 : 0,
      cachedBytes: (c) => c.unit.key === "u1" ? 8192 : 0,
      settings: { temperature: 0, excellentPrior: 0, mediumPrior: 0, latencyWeight: 1, affinityWeight: 0.5 },
    });
    expect(ranked[0].candidate.model).toBe("p/fast");
  });
});
