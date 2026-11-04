import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HealthStore } from "../lib/lazy-router/health-store.js";
import { HealthRegistry } from "../lib/lazy-router/health.js";
import { tempDir } from "./helpers.js";

function openPair() {
  const path = join(tempDir("omp-health-"), "health.sqlite");
  return [new HealthStore({ path }), new HealthStore({ path })];
}

function worker(store, timers, events = [], overrides = {}) {
  return new HealthRegistry({
    probeIntervalMs: 1_000,
    onEvent: (event, detail) => events.push({ event, ...detail }),
    setTimer: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => {},
    store,
    ...overrides,
  });
}

describe("shared health store", () => {
  test("a cooldown in one worker cools the same key in another", () => {
    const [storeA, storeB] = openPair();
    const a = worker(storeA, []);
    const b = worker(storeB, []);
    expect(b.isAlive("unit-a model-x")).toBe(true);

    a.markDead("unit-a model-x", "quota", { unit: { label: "unit-a" }, model: "model-x" }, { probeIntervalMs: 5_000 });

    b.refresh();
    expect(b.isAlive("unit-a model-x")).toBe(false);
    expect(b.entry("unit-a model-x")?.reason).toBe("quota");
    expect(b.snapshot()["unit-a model-x"].state).toBe("cooling");

    storeA.close();
    storeB.close();
  });

  test("a recovery in one worker clears the cooldown in another", () => {
    const [storeA, storeB] = openPair();
    const events = [];
    const a = worker(storeA, []);
    const b = worker(storeB, [], events);
    a.markDead("u m", "quota", undefined);
    b.refresh();
    expect(b.isAlive("u m")).toBe(false);

    a.markAlive("u m");
    b.refresh();
    expect(b.isAlive("u m")).toBe(true);
    expect(events.some((event) => event.event === "cooldown-exit" && event.cause === "shared")).toBe(true);

    storeA.close();
    storeB.close();
  });

  test("only one worker holds the probe lease", () => {
    const [storeA, storeB] = openPair();
    storeA.write({ key: "u m", state: "cooling", since: 1, reason: "quota", nextProbeAt: 0, updatedAt: 1 });
    expect(storeA.claimProbe("u m", 10_000, 1_000)).toBe(true);
    expect(storeB.claimProbe("u m", 20_000, 1_000)).toBe(false);
    expect(storeB.claimProbe("u m", 20_000, 10_001)).toBe(true);
    storeA.close();
    storeB.close();
  });

  test("two workers holding the same cooling row send one probe", async () => {
    const path = join(tempDir("omp-health-"), "health.sqlite");
    const seed = new HealthStore({ path });
    seed.write({ key: "u m", state: "cooling", since: 1, reason: "quota", nextProbeAt: 0, updatedAt: 1 });
    seed.close();

    const calls = [];
    const subjectOf = (key) => ({ unit: { label: key.split(" ")[0] }, model: key.split(" ")[1] });
    const stores = [new HealthStore({ path }), new HealthStore({ path })];
    const timers = [[], []];
    const registries = stores.map((store, index) => worker(store, timers[index], [], {
      prober: async (subject) => {
        calls.push(subject);
        return true;
      },
      resolve: subjectOf,
    }));

    expect(registries[0].isAlive("u m")).toBe(false);
    expect(registries[1].isAlive("u m")).toBe(false);
    expect(timers[0].length).toBe(1);
    expect(timers[1].length).toBe(1);

    await Promise.all([timers[0][0].fn(), timers[1][0].fn()]);
    expect(calls.length).toBe(1);

    stores.forEach((store) => store.close());
  });
});
