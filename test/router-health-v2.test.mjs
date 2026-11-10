import { afterEach, describe, expect, test } from "bun:test";
import { PROBE_STATE } from "../lib/contracts.mjs";
import { HealthRegistry } from "../lib/router/health.mjs";
import { StateStore } from "../lib/router/state-store.mjs";

const stores = [];

function clock(start = 1_000) {
  const value = { now: start };
  return { value, now: () => value.now };
}

function registries(time, options = {}) {
  const store = StateStore.memory({ now: time.now });
  stores.push(store);
  return [
    new HealthRegistry({ store, probeIntervalMs: 1_000, now: time.now, ...options }),
    new HealthRegistry({ store, probeIntervalMs: 1_000, now: time.now, ...options }),
    store,
  ];
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("HealthRegistry states", () => {
  test("a new key is ALIVE and a dead key is cooling", () => {
    const time = clock();
    const [health] = registries(time);
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.ALIVE);
    health.markDead("acct", "p/model", { reason: "429", until: time.value.now + 5_000 });
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.DEAD);
    expect(health.isCooling("acct", "p/model")).toBe(true);
  });

  test("BUSY never cools down", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { state: PROBE_STATE.BUSY, reason: "saturated" });
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.BUSY);
    expect(health.isCooling("acct", "p/model")).toBe(false);
  });

  test("BUSY cannot overwrite a live cooldown", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "quota", until: time.value.now + 5_000 });
    expect(health.markDead("acct", "p/model", { state: PROBE_STATE.BUSY, reason: "busy" })).toBe(false);
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.DEAD);
    expect(health.isCooling("acct", "p/model")).toBe(true);
  });

  test("ALIVE clears a dead state and an expired cooldown reads ALIVE", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "429", until: time.value.now + 100 });
    expect(health.markAlive("acct", "p/model")).toBe(true);
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.ALIVE);
    health.markDead("acct", "p/model", { reason: "429", until: time.value.now + 100 });
    time.value.now += 101;
    expect(health.stateOf("acct", "p/model")).toBe(PROBE_STATE.ALIVE);
    expect(health.isCooling("acct", "p/model")).toBe(false);
  });

  test("the key includes the model, not only the unit", () => {
    const time = clock();
    const [health] = registries(time);
    expect(health.keyOf("acct", "p/a")).toBe("acct p/a");
    expect(health.keyOf("acct", "p/a")).not.toBe(health.keyOf("acct", "p/b"));
    health.markDead("acct", "p/a", { reason: "quota", until: time.value.now + 5_000 });
    expect(health.stateOf("acct", "p/a")).toBe(PROBE_STATE.DEAD);
    expect(health.stateOf("acct", "p/b")).toBe(PROBE_STATE.ALIVE);
  });
});

describe("HealthRegistry probe leases", () => {
  test("a brand-new unseen key is probeable by exactly one registry", () => {
    const time = clock();
    const [first, second] = registries(time);
    const lease = first.claimProbe("fresh", "p/model", 100);
    expect(lease).toEqual({ claimed: true, fence: 1 });
    expect(first.stateOf("fresh", "p/model")).toBe(PROBE_STATE.ALIVE);
    expect(second.claimProbe("fresh", "p/model", 100)).toEqual({ claimed: false, fence: 1 });
    time.value.now += 100;
    const next = second.claimProbe("fresh", "p/model", 100);
    expect(next.claimed).toBe(true);
    expect(next.fence).toBe(2);
  });

  test("one claim wins across two registries, and a stale write is rejected", () => {
    const time = clock();
    const [first, second, store] = registries(time);
    first.markDead("acct", "p/model", { reason: "429", until: time.value.now + 9_000 });
    expect(second.stateOf("acct", "p/model")).toBe(PROBE_STATE.DEAD);

    const leaseA = first.claimProbe("acct", "p/model", 100);
    expect(leaseA.claimed).toBe(true);
    expect(second.claimProbe("acct", "p/model", 100).claimed).toBe(false);

    time.value.now += 100;
    const leaseB = second.claimProbe("acct", "p/model", 100);
    expect(leaseB.claimed).toBe(true);
    expect(leaseB.fence).toBeGreaterThan(leaseA.fence);

    expect(second.markAlive("acct", "p/model", { fence: leaseA.fence })).toBe(false);
    expect(first.stateOf("acct", "p/model")).toBe(PROBE_STATE.DEAD);
    expect(second.markAlive("acct", "p/model", { fence: leaseB.fence })).toBe(true);
    expect(first.stateOf("acct", "p/model")).toBe(PROBE_STATE.ALIVE);
    expect(store.readHealth(first.keyOf("acct", "p/model")).state).toBe(PROBE_STATE.ALIVE);
  });

  test("a probe result written with its own fence lands", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "429", until: time.value.now + 9_000 });
    const lease = health.claimProbe("acct", "p/model", 1_000);
    expect(
      health.markDead("acct", "p/model", { reason: "quota", until: time.value.now + 20_000, fence: lease.fence }),
    ).toBe(true);
    expect(health.isCooling("acct", "p/model")).toBe(true);
  });

  test("a stronger reason may shorten a cooldown", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "timeout", until: time.value.now + 20_000 });
    health.markDead("acct", "p/model", { reason: "billing", until: time.value.now + 10_000 });
    const row = health.store.readHealth(health.keyOf("acct", "p/model"));
    expect(row.until).toBe(time.value.now + 10_000);
    expect(row.reason).toBe("billing");
  });
});

describe("shared health rows", () => {
  test("readRow returns the shared reason, until, lease and update time", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "429 quota", until: time.value.now + 9_000 });
    const row = health.readRow("acct", "p/model");
    expect(row).toMatchObject({
      key: "acct p/model",
      state: PROBE_STATE.DEAD,
      health: "cooling",
      until: time.value.now + 9_000,
      reason: "429 quota",
    });
    expect(typeof row.updatedAt).toBe("number");
    expect(typeof row.probeLeaseUntil).toBe("number");
  });

  test("two registries see one shared reason and next probe deadline", () => {
    const time = clock();
    const [first, second] = registries(time);
    first.markDead("acct", "p/model", { reason: "billing", until: time.value.now + 7_000 });
    const row = second.readRow("acct", "p/model");
    expect(row.reason).toBe("billing");
    expect(row.until).toBe(time.value.now + 7_000);
    expect(second.isCooling("acct", "p/model")).toBe(true);
  });

  test("a rejected markDead leaves no local cooling", () => {
    const time = clock();
    const [first, second, store] = registries(time);
    first.markDead("acct", "p/model", { reason: "quota", until: time.value.now + 9_000 });
    const staleFence = first.claimProbe("acct", "p/model", 100).fence;
    time.value.now += 100;
    const freshFence = second.claimProbe("acct", "p/model", 100).fence;
    expect(freshFence).toBeGreaterThan(staleFence);
    expect(second.markAlive("acct", "p/model", { fence: staleFence })).toBe(false);
    expect(second.stateOf("acct", "p/model")).toBe(PROBE_STATE.DEAD);
    expect(second.isCooling("acct", "p/model")).toBe(true);
    expect(store.readHealth("acct p/model").state).toBe(PROBE_STATE.DEAD);
  });

  test("an expired shared dead row reads alive with no reason", () => {
    const time = clock();
    const [health] = registries(time);
    health.markDead("acct", "p/model", { reason: "429", until: time.value.now + 100 });
    time.value.now += 101;
    const row = health.readRow("acct", "p/model");
    expect(row.state).toBe(PROBE_STATE.ALIVE);
    expect(row.health).toBe("alive");
    expect(row.reason).toBe(null);
    expect(row.until).toBe(0);
  });
});
