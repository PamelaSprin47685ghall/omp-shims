import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { STATE_VERSION, StateStore } from "../lib/router/state-store.mjs";
import { createV2Fixture, V2_NOW, V2_ROWS, V2_SINCE } from "./fixtures/status-v2.mjs";
import { tempDir } from "./helpers.mjs";

const stores = [];
const directories = [];

function track(store) {
  stores.push(store);
  return store;
}

function fileStore(options = {}) {
  const directory = tempDir("omp-router-state-v2-");
  directories.push(directory);
  return track(new StateStore({ path: join(directory, "state.sqlite"), ...options }));
}

function migratedFixture(options = {}) {
  const directory = tempDir("omp-router-migrate-v3-");
  directories.push(directory);
  const path = join(directory, "state-v2.sqlite");
  createV2Fixture(path);
  return track(new StateStore({ path, now: () => V2_NOW, ...options }));
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("StateStore schema", () => {
  test("a fresh file is v2, WAL, busy_timeout=2000", () => {
    const store = fileStore();
    expect(store.available).toBe(true);
    expect(store.db.query("PRAGMA user_version").get().user_version).toBe(STATE_VERSION);
    expect(store.db.query("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    expect(store.db.query("PRAGMA busy_timeout").get().timeout).toBe(2_000);
  });

  test("memory() never touches a file and still serves every table", () => {
    const store = track(StateStore.memory({ now: () => 1_000 }));
    expect(store.mode).toBe("memory");
    store.writeHealth("k", { state: "dead", until: 5_000, reason: "429" });
    store.putAffinity("d", 1_024, "u", 9_000);
    store.addTokenTotals("p", "m", { uncachedInput: 3, cachedInput: 1, output: 2 });
    expect(store.readHealth("k").until).toBe(5_000);
    expect(store.lookupAffinity(["d"])).toEqual({ unitKey: "u", length: 1_024 });
    expect(store.readTokenTotals().totals).toEqual({ uncachedInput: 3, cachedInput: 1, output: 2 });
  });
});

describe("StateStore capacity", () => {
  test("one limit across two store instances", () => {
    const directory = tempDir("omp-router-capacity-v2-");
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const a = track(new StateStore({ path, worker: "a" }));
    const b = track(new StateStore({ path, worker: "b" }));
    expect(a.reserveSlot("unit", 2)).toEqual({ granted: true, held: 1 });
    expect(b.reserveSlot("unit", 2)).toEqual({ granted: true, held: 2 });
    expect(a.reserveSlot("unit", 2)).toEqual({ granted: false, held: 2 });
    b.releaseSlot("unit");
    b.releaseSlot("unit"); // a release beyond the row is a no-op
    expect(a.heldOf("unit")).toBe(1);
    expect(a.reserveSlot("unit", 2).granted).toBe(true);
  });

  test("close() degrades to local counting and never throws", () => {
    const store = track(StateStore.memory());
    store.close();
    let first;
    expect(() => {
      first = store.reserveSlot("unit", 2);
    }).not.toThrow();
    expect(first).toEqual({ granted: true, held: 1 });
    expect(store.reserveSlot("unit", 2)).toEqual({ granted: true, held: 2 });
    expect(store.reserveSlot("unit", 2)).toEqual({ granted: false, held: 2 });
    store.releaseSlot("unit");
    expect(store.heldOf("unit")).toBe(1);
    expect(store.reserveSlot("unit", 2).granted).toBe(true);
  });

  test("unlimited units are never counted", () => {
    const store = track(StateStore.memory());
    expect(store.reserveSlot("free", 0)).toEqual({ granted: true, held: 0 });
    expect(store.heldOf("free")).toBe(0);
  });
});

describe("StateStore health fences and cooldowns", () => {
  test("a brand-new key can be claimed; a concurrent claim loses", () => {
    let now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    const first = store.claimProbeLease("fresh", 100);
    expect(first).toEqual({ claimed: true, fence: 1 });
    expect(store.readHealth("fresh")).toMatchObject({
      state: "alive",
      until: 0,
      fencingToken: 1,
      probeLeaseUntil: 1_100,
    });
    expect(store.claimProbeLease("fresh", 100)).toEqual({ claimed: false, fence: 1 });
    now = 1_100;
    expect(store.claimProbeLease("fresh", 100)).toEqual({ claimed: true, fence: 2 });
  });

  test("claiming an existing dead key preserves its cooldown", () => {
    const now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    store.writeHealth("dead", { state: "dead", until: 9_000, reason: "429" });
    expect(store.claimProbeLease("dead", 100)).toEqual({ claimed: true, fence: 1 });
    expect(store.readHealth("dead")).toMatchObject({
      state: "dead",
      until: 9_000,
      reason: "429",
      fencingToken: 1,
      probeLeaseUntil: 1_100,
    });
  });

  test("a closed store claims a fresh key from local state", () => {
    let now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    store.close();
    expect(store.claimProbeLease("fresh", 100)).toEqual({ claimed: true, fence: 1 });
    expect(store.claimProbeLease("fresh", 100)).toEqual({ claimed: false, fence: 1 });
    now += 100;
    expect(store.claimProbeLease("fresh", 100)).toEqual({ claimed: true, fence: 2 });
    expect(store.readHealth("fresh")).toMatchObject({
      state: "alive",
      fencingToken: 2,
      probeLeaseUntil: 1_200,
    });
  });

  test("a stale fencing token cannot write after a newer claim", () => {
    let now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    store.writeHealth("k", { state: "dead", until: 9_000, reason: "429" });
    const first = store.claimProbeLease("k", 100);
    expect(first.claimed).toBe(true);
    now = 1_100;
    const second = store.claimProbeLease("k", 100);
    expect(second.claimed).toBe(true);
    expect(second.fence).toBeGreaterThan(first.fence);
    expect(store.writeHealth("k", { state: "alive" }, { fence: first.fence })).toBe(false);
    expect(store.readHealth("k").state).toBe("dead");
    expect(store.writeHealth("k", { state: "alive" }, { fence: second.fence })).toBe(true);
    expect(store.readHealth("k").state).toBe("alive");
  });

  test("a normal write cannot clear a live probe lease", () => {
    const now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    store.writeHealth("k", { state: "dead", until: 9_000, reason: "429" });
    const lease = store.claimProbeLease("k", 500);
    store.writeHealth("k", { state: "dead", until: 20_000, reason: "timeout" });
    const row = store.readHealth("k");
    expect(row.fencingToken).toBe(lease.fence);
    expect(row.probeLeaseUntil).toBe(1_500);
    expect(store.claimProbeLease("k", 500).claimed).toBe(false);
  });

  test("cooldowns only move later unless a stronger reason replaces them", () => {
    const now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    store.writeHealth("k", { state: "dead", until: 10_000, reason: "timeout" });
    store.writeHealth("k", { state: "dead", until: 5_000, reason: "timeout" });
    expect(store.readHealth("k").until).toBe(10_000);
    store.writeHealth("k", { state: "dead", until: 7_000, reason: "billing" });
    expect(store.readHealth("k").until).toBe(7_000);
    expect(store.readHealth("k").reason).toBe("billing");
    store.writeHealth("k2", { state: "dead", until: 0, reason: "timeout" });
    store.writeHealth("k2", { state: "dead", until: 5_000, reason: "timeout" });
    expect(store.readHealth("k2").until).toBe(0);
  });

  test("account cooldowns are shared and monotonic", () => {
    let now = 1_000;
    const directory = tempDir("omp-router-cooldown-v2-");
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const a = track(new StateStore({ path, worker: "a", now: () => now }));
    const b = track(new StateStore({ path, worker: "b", now: () => now }));
    a.setAccountCooldown("acct", 5_000, "429");
    b.setAccountCooldown("acct", 3_000, "429");
    expect(b.listAccountCooldowns(now).get("acct").until).toBe(5_000);
    b.setAccountCooldown("acct", 2_000, "billing");
    expect(b.listAccountCooldowns(now).get("acct").until).toBe(2_000);
    now = 6_000;
    expect(a.listAccountCooldowns(now).size).toBe(0);
  });
});

describe("StateStore bounded tables", () => {
  test("admission samples leave the window and prune", () => {
    let now = 1_000;
    const store = track(StateStore.memory({ now: () => now, admissionWindowMs: 1_000 }));
    for (const share of [0.1, 0.9]) store.recordAdmission("u", share, now);
    expect(store.admissionCount("u", now - 1_000)).toBe(2);
    now += 2_000;
    expect(store.admissionCount("u", now - 1_000)).toBe(0);
    store.prune(now);
    expect(store.admissionCount("u", 0)).toBe(0);
  });

  test("affinity is capped and expired rows are removed", () => {
    let now = 1_000;
    const store = track(StateStore.memory({ now: () => now }));
    for (let index = 0; index < 10; index += 1) store.putAffinity(`d${index}`, 4, "u", now + 5_000);
    store.pruneAffinity(now, 4);
    expect(store.countAffinity()).toBe(4);
    now += 6_000;
    store.pruneAffinity(now, 4);
    expect(store.countAffinity()).toBe(0);
  });

  test("old perf buckets and reaped workers do not accumulate", () => {
    let now = 1_000_000;
    const directory = tempDir("omp-router-prune-v2-");
    directories.push(directory);
    const path = join(directory, "state.sqlite");
    const dead = track(new StateStore({ path, worker: "dead", now: () => now }));
    const live = track(new StateStore({ path, worker: "live", now: () => now }));
    dead.reserveSlot("unit", 1);
    dead.addPerf({ model: "p/m", period: "peak", minute: Math.floor(now / 60_000) - 120, totalMs: 1, totalCount: 1 });
    now += 6 * 60_000;
    live.prune(now);
    expect(live.heldOf("unit")).toBe(0);
    expect(live.perfWindow("peak", 0)).toEqual([]);
  });

  test("token totals keep a provider/model split and coverage", () => {
    const store = track(StateStore.memory());
    store.addTokenTotals("p", "m", { uncachedInput: 10, cachedInput: 2, output: 3 });
    store.addTokenTotals("p", "m", { output: 4 });
    const totals = store.readTokenTotals();
    expect(totals.totals).toEqual({ uncachedInput: 10, cachedInput: 2, output: 7 });
    expect(totals.coverage.complete).toBe(2);
    expect(totals.models).toEqual([
      { provider: "p", model: "m", uncachedInput: 10, cachedInput: 2, output: 7, complete: 2 },
    ]);
    expect(store.resetTokenTotals()).toBe(true);
    expect(store.readTokenTotals().totals).toEqual({ uncachedInput: 0, cachedInput: 0, output: 0 });
  });
});

describe("v3 expand migration", () => {
  test("a synthetic v2 file keeps user_version=2 and gains every v3 object", () => {
    const store = migratedFixture();
    expect(store.db.query("PRAGMA user_version").get().user_version).toBe(2);
    const tables = new Set(
      store.db
        .query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const name of ["worker_load", "affinity_stat", "token_epochs", "token_totals"]) {
      expect({ name, exists: tables.has(name) }).toEqual({ name, exists: true });
    }
    const columns = new Set(
      store.db
        .query("PRAGMA table_info(perf)")
        .all()
        .map((row) => row.name),
    );
    for (const name of ["complete_ms", "complete_log", "complete_log_sq", "complete_n", "imputed_ms", "legacy_mixed"]) {
      expect({ name, exists: columns.has(name) }).toEqual({ name, exists: true });
    }
    expect(store.db.query("SELECT value FROM metadata WHERE name = 'state_features'").get().value).toBe("status-v3");
  });

  test("legacy totals, since and the adopted epoch survive the migration", () => {
    const store = migratedFixture();
    expect(store.db.query("SELECT value FROM metadata WHERE name = 'since'").get().value).toBe(V2_SINCE);
    expect(store.captureTokenEpoch()).toBe("legacy");
    const epoch = store.db.query("SELECT * FROM token_epochs").all();
    expect(epoch.length).toBe(1);
    expect(epoch[0].id).toBe("legacy");
    expect(epoch[0].since).toBe(V2_SINCE);

    const rows = store.db.query("SELECT * FROM token_totals ORDER BY model").all();
    expect(rows.length).toBe(V2_ROWS.totals.length);
    for (const [index, expected] of V2_ROWS.totals.entries()) {
      expect(rows[index]).toMatchObject({
        epoch: "legacy",
        provider: expected.provider,
        model: expected.model,
        uncached_input: expected.uncached_input,
        cached_input: expected.cached_input,
        output: expected.output,
        complete: expected.complete,
        seen_uncached: expected.seen_uncached,
        seen_cached: expected.seen_cached,
        seen_output: expected.seen_output,
      });
    }
    const totals = store.readTokenTotals();
    expect(totals.since).toBe(V2_SINCE);
    expect(totals.totals).toEqual({ uncachedInput: 1_240, cachedInput: 300, output: 97 });
  });

  test("the perf backfill separates complete rows from legacy mixed rows", () => {
    const store = migratedFixture();
    const rows = store.db.query("SELECT * FROM perf ORDER BY minute").all();
    expect(rows.length).toBe(2);
    const complete = rows[0];
    expect(complete).toMatchObject({ complete_n: 3, complete_ms: 3_000, legacy_mixed: 0, imputed_n: 0 });
    expect(complete.complete_log).toBeCloseTo(Math.log(3_000) * 3, 8);
    const mixed = rows[1];
    expect(mixed.complete_n).toBe(0);
    expect(mixed.legacy_mixed).toBe(1);
    expect(mixed.imputed_n).toBe(2);
  });

  test("migration is idempotent across close and reopen", () => {
    const first = migratedFixture();
    const path = first.path;
    first.close();
    stores.splice(stores.indexOf(first), 1);

    const second = track(new StateStore({ path, now: () => V2_NOW + 60_000, worker: "fixture-worker:222" }));
    expect(second.db.query("PRAGMA user_version").get().user_version).toBe(2);
    expect(second.db.query("SELECT COUNT(*) AS n FROM token_epochs").get().n).toBe(1);
    expect(second.db.query("SELECT COUNT(*) AS n FROM token_totals").get().n).toBe(V2_ROWS.totals.length);
    expect(second.db.query("SELECT value FROM metadata WHERE name = 'state_features'").get().value).toBe("status-v3");
    expect(second.captureTokenEpoch()).toBe("legacy");
  });

  test("old v2 tables still accept the old statements after migration", () => {
    const store = migratedFixture();
    store.db
      .query("UPDATE totals SET output = output + 1 WHERE provider = ? AND model = ?")
      .run(V2_ROWS.totals[0].provider, V2_ROWS.totals[0].model);
    expect(store.readTokenTotals().totals.output).toBe(98);
    store.db.query("INSERT INTO metadata (name, value) VALUES ('old_writer', 'ok')").run();
    expect(store.db.query("SELECT value FROM metadata WHERE name = 'old_writer'").get().value).toBe("ok");
    expect(() => store.writeHealth("fixture-provider/acct-a", { state: "alive" })).not.toThrow();
  });

  test("a fresh database gets one non-legacy epoch", () => {
    const store = fileStore();
    const epoch = store.captureTokenEpoch();
    expect(epoch).not.toBe("legacy");
    expect(epoch).toMatch(/^epoch_/);
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_epochs").get().n).toBe(1);
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_totals").get().n).toBe(0);
  });

  test("readStatusData returns the adopted legacy epoch under the same transaction", () => {
    const store = migratedFixture();
    const data = store.readStatusData({ now: V2_NOW, period: "peak" });
    expect(data.available).toBe(true);
    expect(data.epoch).toEqual({ id: "legacy", since: V2_SINCE });
    expect(data.tokenTotals.rows.length).toBe(V2_ROWS.totals.length);
    expect(data.workerRows).toEqual([]);
  });
});
