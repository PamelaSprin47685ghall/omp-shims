import { afterEach, describe, expect, test } from "bun:test";
import { PrefixAffinity } from "../lib/router/affinity.mjs";
import { StateStore } from "../lib/router/state-store.mjs";

const stores = [];

function memory(options = {}) {
  const store = StateStore.memory(options);
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("PrefixAffinity ordering", () => {
  test("the longest recorded prefix orders its unit first", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, ttlMs: 60_000, minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [{ length: 1_024, digest: "a" }]);
    affinity.remember("u2", [{ length: 8_192, digest: "b" }]);
    affinity.remember("u3", [{ length: 4_096, digest: "c" }]);
    expect(
      affinity.order(["u1", "u2", "u3"], {
        digests: [
          { length: 1_024, digest: "a" },
          { length: 4_096, digest: "c" },
          { length: 8_192, digest: "b" },
        ],
      }),
    ).toEqual(["u2", "u1", "u3"]);
  });

  test("every input key is kept and an unknown digest does not reorder", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [{ length: 1_024, digest: "a" }]);
    expect(affinity.order(["u1", "u2", "u3"], { digests: [{ length: 1_024, digest: "a" }] })).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    expect(affinity.order(["u1", "u2"], { digests: [{ length: 2_048, digest: "unknown" }] })).toEqual(["u1", "u2"]);
  });

  test("a match for a unit outside the candidate list is ignored", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1, now: () => now });
    affinity.remember("u3", [{ length: 8_192, digest: "c" }]);
    expect(affinity.order(["u1", "u2"], { digests: [{ length: 8_192, digest: "c" }] })).toEqual(["u1", "u2"]);
  });

  test("string digests and tuple digests are accepted", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [[2_048, "a"]]);
    expect(affinity.order(["u1", "u2"], { digests: ["a"] })).toEqual(["u1", "u2"]);
  });
});

describe("PrefixAffinity bounds", () => {
  test("prefixes below the minimum are not recorded", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1_024, now: () => now });
    affinity.remember("u1", [{ length: 4, digest: "a" }]);
    affinity.remember("u1", [{ digest: "b" }]);
    expect(affinity.size).toBe(0);
  });

  test("TTL expiry stops matching and pruning removes the row", () => {
    let now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, ttlMs: 100, minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [{ length: 1_024, digest: "a" }]);
    expect(affinity.order(["u1", "u2"], { digests: [{ length: 1_024, digest: "a" }] })).toEqual(["u1", "u2"]);
    now += 101;
    expect(affinity.order(["u1", "u2"], { digests: [{ length: 1_024, digest: "a" }] })).toEqual(["u1", "u2"]);
    store.pruneAffinity(now, affinity.maxEntries);
    expect(affinity.size).toBe(0);
  });

  test("the shared table keeps at most maxEntries rows", () => {
    const now = 1_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, maxEntries: 4, minPrefixBytes: 1, now: () => now });
    for (let index = 0; index < 10; index += 1) affinity.remember("u1", [{ length: 4, digest: `d${index}` }]);
    store.pruneAffinity(now, affinity.maxEntries);
    expect(affinity.size).toBe(4);
  });

  test("the local fallback enforces the same cap and TTL", () => {
    let now = 1_000;
    const affinity = new PrefixAffinity({ ttlMs: 100, maxEntries: 3, minPrefixBytes: 1, now: () => now });
    for (let index = 0; index < 10; index += 1) affinity.remember("u1", [{ length: 4, digest: `d${index}` }]);
    expect(affinity.size).toBe(3);
    expect(affinity.order(["u1"], { digests: [{ length: 4, digest: "d9" }] })).toEqual(["u1"]);
    now += 101;
    expect(affinity.size).toBe(0);
    expect(affinity.order(["u1", "u2"], { digests: [{ length: 4, digest: "d9" }] })).toEqual(["u1", "u2"]);
  });
});

describe("affinity counters", () => {
  test("the lookup decision records ten hits over twenty lookups", () => {
    const now = 600_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [{ length: 1_024, digest: "a" }]);
    for (let index = 0; index < 10; index += 1) {
      affinity.lookup(["u2", "u1"], { digests: [{ length: 1_024, digest: "a" }] });
    }
    for (let index = 0; index < 10; index += 1) {
      affinity.lookup(["u2", "u3"], { digests: [{ length: 1_024, digest: "unknown" }] });
    }
    const data = store.readStatusData({
      now,
      period: "peak",
      affinitySinceMinute: Math.floor(now / 60_000) - 4,
    });
    expect(data.affinityStats.hits).toBe(10);
    expect(data.affinityStats.lookups).toBe(20);
  });

  test("a lookup without a digest or with one candidate is not a query", () => {
    const now = 600_000;
    const store = memory({ now: () => now });
    const affinity = new PrefixAffinity({ store, minPrefixBytes: 1, now: () => now });
    affinity.lookup(["u1", "u2"]);
    affinity.lookup(["u1"], { digests: [{ length: 1_024, digest: "a" }] });
    const data = store.readStatusData({
      now,
      period: "peak",
      affinitySinceMinute: Math.floor(now / 60_000) - 4,
    });
    expect(data.affinityStats.lookups).toBe(0);
    expect(data.affinityStats.hits).toBe(0);
  });

  test("the local fallback counts only inside its five-minute window", () => {
    let now = 600_000;
    const affinity = new PrefixAffinity({ minPrefixBytes: 1, now: () => now });
    affinity.remember("u1", [{ length: 1_024, digest: "a" }]);
    affinity.lookup(["u2", "u1"], { digests: [{ length: 1_024, digest: "a" }] });
    expect(affinity.statsSince(Math.floor(now / 60_000) - 4).hits).toBe(1);
    now += 6 * 60_000;
    expect(affinity.statsSince(Math.floor(now / 60_000) - 4)).toEqual({
      hits: 0,
      lookups: 0,
      sinceMinute: Math.floor(now / 60_000) - 4,
      untilMinute: Math.floor(now / 60_000),
    });
  });
});
