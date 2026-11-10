import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { AdmissionControl } from "../lib/router/admission.mjs";
import { InFlightTracker } from "../lib/router/capacity.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { tempDir } from "./helpers.mjs";

const stores = [];
const directories = [];

function memory(options = {}) {
  const store = StateStore.memory(options);
  stores.push(store);
  return store;
}

function filePair(options = {}) {
  const directory = tempDir("omp-router-capacity-v2-");
  directories.push(directory);
  const path = join(directory, "state.sqlite");
  const a = new StateStore({ path, worker: "a", ...options });
  const b = new StateStore({ path, worker: "b", ...options });
  stores.push(a, b);
  return [a, b];
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("InFlightTracker", () => {
  test("one global limit across workers", () => {
    const [a, b] = filePair();
    const limitOf = (unitKey) => (unitKey === "unit" ? 2 : 0);
    const first = new InFlightTracker({ store: a, limitOf });
    const second = new InFlightTracker({ store: b, limitOf });

    const one = first.slot("unit");
    const two = second.slot("unit");
    const three = first.slot("unit");
    expect([one.granted, two.granted, three.granted]).toEqual([true, true, false]);
    expect(first.inFlight("unit")).toBe(2);
    expect(first.hasRoom("unit")).toBe(false);
    expect(three.release).toBeFunction();

    one.release();
    one.release(); // idempotent
    expect(second.inFlight("unit")).toBe(1);
    expect(first.hasRoom("unit")).toBe(true);
    expect(second.slot("unit").granted).toBe(true);
  });

  test("an unlimited unit is never gated or counted", () => {
    const store = memory();
    const tracker = new InFlightTracker({ store, limitOf: () => 0 });
    const slot = tracker.slot("free");
    expect(slot.granted).toBe(true);
    expect(tracker.inFlight("free")).toBe(0);
    expect(tracker.hasRoom("free")).toBe(true);
    slot.release();
    expect(tracker.inFlight("free")).toBe(0);
  });

  test("a refused slot has a no-op release", () => {
    const store = memory();
    const tracker = new InFlightTracker({ store, limitOf: () => 1 });
    const first = tracker.slot("unit");
    expect(first.granted).toBe(true);
    const refused = tracker.slot("unit");
    expect(refused.granted).toBe(false);
    refused.release();
    refused.release();
    expect(tracker.inFlight("unit")).toBe(1);
    first.release();
    expect(tracker.inFlight("unit")).toBe(0);
  });
});

describe("shared capacity rows", () => {
  test("status rows carry the worker, age and held count without a per-unit read", () => {
    const now = 1_000_000;
    const [a, b] = filePair({ now: () => now });
    const trackerA = new InFlightTracker({ store: a, limitOf: (key) => (key === "unit" ? 4 : 0) });
    const trackerB = new InFlightTracker({ store: b, limitOf: (key) => (key === "unit" ? 4 : 0) });
    trackerA.slot("unit");
    trackerB.slot("unit");
    const data = a.readStatusData({
      now,
      period: "peak",
      workerSince: now - 300_000,
      healthSince: now - 7 * 86_400_000,
    });
    expect(data.available).toBe(true);
    expect(data.capacityRows.length).toBe(2);
    for (const row of data.capacityRows) {
      expect(row).toMatchObject({ unit: "unit", held: 1 });
      expect(typeof row.worker).toBe("string");
      expect(typeof row.updatedAt).toBe("number");
    }
  });

  test("an old lease is returned for stale classification, not silently counted", () => {
    const now = 1_000_000;
    const [store] = filePair({ now: () => now });
    const tracker = new InFlightTracker({ store, limitOf: () => 4 });
    const slot = tracker.slot("unit");
    const later = now + 20_000;
    expect(store.heldOf("unit")).toBe(1);
    const data = store.readStatusData({
      now: later,
      period: "peak",
      workerSince: later - 300_000,
      healthSince: later - 7 * 86_400_000,
    });
    expect(data.capacityRows.length).toBe(1);
    expect(data.capacityRows[0].updatedAt).toBe(now);
    slot.release();
  });

  test("memory capacity is never published as a shared value", () => {
    const store = memory();
    const tracker = new InFlightTracker({ store, limitOf: () => 2 });
    const slot = tracker.slot("unit");
    expect(tracker.inFlight("unit")).toBe(1);
    const data = store.readStatusData({ now: 1_000, period: "peak" });
    expect(data.available).toBe(false);
    expect(data.capacityRows).toEqual([]);
    slot.release();
  });
});

describe("AdmissionControl", () => {
  test("the second-best share is the threshold for two slots", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const admission = new AdmissionControl({ store, windowMs: 10_000, now: () => now });
    for (const share of [0, 0.1, 0.5, 0.9]) admission.record("unit", share);
    expect(admission.windowCount("unit")).toBe(4);
    expect(admission.threshold("unit", 2)).toBe(0.5);
    expect(admission.admits("unit", 0.9, 2, 4)).toBe(true);
    expect(admission.admits("unit", 0.1, 2, 4)).toBe(false);
    expect(admission.admits("unit", 0.5, 2, 4)).toBe(true); // ties pass
  });

  test("fewer samples than slots admits everyone", () => {
    let now = 1_000;
    const store = memory({ now: () => now });
    const admission = new AdmissionControl({ store, windowMs: 10_000, now: () => now });
    admission.record("unit", 0);
    expect(admission.threshold("unit", 4)).toBeUndefined();
    expect(admission.admits("unit", 0, 4, 1)).toBe(true);
    expect(admission.admits("unit", 0, 0, 1)).toBe(true);
    now += 1;
  });

  test("samples from two controls share one window", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const first = new AdmissionControl({ store, windowMs: 10_000, now: () => now });
    const second = new AdmissionControl({ store, windowMs: 10_000, now: () => now });
    first.record("unit", 0.9);
    second.record("unit", 0.1);
    expect(first.windowCount("unit")).toBe(2);
    expect(second.threshold("unit", 1)).toBe(0.9);
    expect(second.admits("unit", 0.1, 1, 2)).toBe(false);
    expect(second.admits("unit", 0.9, 1, 2)).toBe(true);
  });

  test("the window expires without a timer", () => {
    let now = 1_000;
    const store = memory({ now: () => now });
    const admission = new AdmissionControl({ store, windowMs: 1_000, now: () => now });
    admission.record("unit", 0.9);
    expect(admission.windowCount("unit")).toBe(1);
    now += 1_001;
    expect(admission.windowCount("unit")).toBe(0);
    expect(admission.threshold("unit", 1)).toBeUndefined();
    expect(admission.admits("unit", 0, 1, 0)).toBe(true);
  });
});
