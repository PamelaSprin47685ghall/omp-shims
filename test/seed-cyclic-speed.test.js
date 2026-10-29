import { describe, test, expect } from "bun:test";
import { collectLegacy, applyLegacy } from "../scripts/seed-cyclic-speed.js";
import { CyclicSpeed } from "../lib/lazy-router/cyclic-speed.js";

const hour = 3_600_000;
const minute = 60_000;
const at = Date.UTC(2026, 9, 29, 4, 0);
const minuteAt = Math.floor((at - hour) / minute);
const bucket = (count, ms, imputed = 0, minute = minuteAt) => ({
  minute,
  totalCount: count,
  imputedCount: imputed,
  totalLog: count * Math.log(ms),
});
const snap = (savedAt, buckets, history = {}) => ({
  version: 1,
  savedAt,
  periods: { offPeak: { "a/model": buckets } },
  history,
});
describe("legacy statistics seeding", () => {
  test("snapshots deduplicate identical minute and half-life weights yesterday's evidence", () => {
    const older = { source: "oct25", snapshot: snap(at - 4 * 86400000, [bucket(10, 1000)]) };
    const latest = { source: "oct27", snapshot: snap(at - hour, [bucket(20, 2000)]) };
    const { buckets } = collectLegacy([older, latest], { now: at, cutoff: at + minute });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].original).toBe(20);
    expect(buckets[0].effective).toBeCloseTo(20 * 2 ** (-(hour - 30_000) / 86400000), 3);
  });
  test("old imputed requests reduce confidence, not become exact completed samples", () => {
    const legacy = [{ source: "oct27", snapshot: snap(at, [bucket(10, 4000, 4)]) }];
    const evidence = collectLegacy(legacy, { now: at, cutoff: at + minute });
    const speed = new CyclicSpeed({ now: () => at });
    const result = applyLegacy(speed, evidence, at);
    expect(result.get("a/model").imputedDiscounted).toBe(4);
    expect(speed.models.get("a/model").completed).toBeCloseTo(6 * 2 ** (-(hour - 30_000) / 86400000), 4);
    expect(speed.models.get("a/model").censored).toBe(0);
  });
  test("a live speed record survives migration", () => {
    const speed = new CyclicSpeed({ now: () => at });
    speed.observe("a/model", 1800);
    const initial = speed.models.get("a/model").weight;
    const evidence = collectLegacy([{ source: "oct25", snapshot: snap(at - hour, [bucket(10, 1500)]) }], { now: at, cutoff: at + minute });
    applyLegacy(speed, evidence, at);
    expect(speed.models.get("a/model").weight).toBeGreaterThan(initial);
    expect(speed.models.get("a/model").completed).toBeGreaterThan(1);
  });
  test("aggregated historical means create uniform low-weight evidence and no fictitious hour peak", () => {
    const legacy = [{
      source: "recent", current: true,
      snapshot: snap(at, [], {
        peak: { "b/model": { meanLog: Math.log(24000), weight: 8, updatedAt: at } },
        offPeak: { "b/model": { meanLog: Math.log(12000), weight: 8, updatedAt: at } },
      }),
    }];
    const evidence = collectLegacy(legacy, { now: at, cutoff: at });
    const speed = new CyclicSpeed({ now: () => at });
    applyLegacy(speed, evidence, at);
    // The cyclic Gram diagonal is constant: the legacy mean adds no hourly shape.
    // Predicting 12 hours into the future also applies 12 hours of evidence decay.
    const diagonal = speed.models.get("b/model").gram.map((row, index) => row[index]);
    expect(Math.max(...diagonal) - Math.min(...diagonal)).toBeLessThan(1e-8);
    expect(speed.models.get("b/model").completed).toBe(0);
    expect(speed.models.get("b/model").weight).toBeCloseTo(8, 6);
  });
  test("cutoff prevents reimporting live measurements already in cyclic statistics", () => {
    const snapshot = snap(at, [
      bucket(10, 1000, 0, minuteAt),
      bucket(10, 1200, 0, Math.floor(at / minute)),
    ]);
    const evidence = collectLegacy([{ source: "current", current: true, snapshot }], { now: at + minute, cutoff: at });
    expect(evidence.buckets).toHaveLength(1);
    expect(evidence.buckets[0].at).toBeLessThan(at);
  });
});
