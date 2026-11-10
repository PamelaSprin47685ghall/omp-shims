// Token epoch and request accounting contract.
//
// One epoch per reset, request-start capture, one write per request, usage
// exactly once, and coverage that distinguishes "zero" from "unobserved".

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelPerf } from "../lib/router/perf.mjs";
import { LazyRouter } from "../lib/router/router.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import {
  largeJsonBody,
  sseBody,
  USAGE_EMPTY,
  USAGE_JSON,
  USAGE_OUTPUT_ONLY,
  USAGE_SSE_DUPLICATE,
  USAGE_SSE_FRAMES,
} from "./fixtures/token-usage.mjs";

const stores = [];
const directories = [];
let now = Date.UTC(2026, 10, 10, 12, 0, 0);

function directory() {
  const path = mkdtempSync(join(tmpdir(), "omp-token-epoch-v3-"));
  directories.push(path);
  return path;
}

function fileStore(options = {}) {
  const store = new StateStore({
    path: join(directory(), "state.sqlite"),
    now: () => now,
    worker: "fixture-worker:111",
    ...options,
  });
  stores.push(store);
  return store;
}

function usageStore() {
  return fileStore();
}

function epochId(store) {
  return store.db.query("SELECT value FROM metadata WHERE name = 'token_epoch'").get().value;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
  now = Date.UTC(2026, 10, 10, 12, 0, 0);
});

describe("epoch capture", () => {
  test("a fresh store has exactly one epoch and captureTokenEpoch reads it", () => {
    const store = usageStore();
    const id = store.captureTokenEpoch();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(id).not.toBe("legacy");
    expect(id).toBe(epochId(store));
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_epochs").get().n).toBe(1);
  });

  test("capture is read-only", () => {
    const store = usageStore();
    const before = store.db.query("SELECT COUNT(*) AS n FROM metadata").get().n;
    store.captureTokenEpoch();
    store.captureTokenEpoch();
    expect(store.db.query("SELECT COUNT(*) AS n FROM metadata").get().n).toBe(before);
  });

  test("two workers on one file see the same current epoch", () => {
    const first = usageStore();
    const second = new StateStore({ path: first.path, now: () => now, worker: "fixture-worker:222" });
    stores.push(second);
    expect(second.captureTokenEpoch()).toBe(first.captureTokenEpoch());
  });

  test("a closed store reports no epoch", () => {
    const store = usageStore();
    store.close();
    expect(store.captureTokenEpoch()).toBe(null);
  });
});

describe("usage write", () => {
  test("one request writes the epoch row and the legacy mirror in one step", () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    const wrote = store.addTokenTotals(epoch, "fixture-provider", "fixture-model-a", {
      uncachedInput: 100,
      cachedInput: 20,
      output: 10,
    });
    expect(wrote).toBe(true);

    const row = store.db
      .query("SELECT * FROM token_totals WHERE epoch = ? AND provider = ? AND model = ?")
      .get(epoch, "fixture-provider", "fixture-model-a");
    expect(row).toMatchObject({
      epoch,
      provider: "fixture-provider",
      model: "fixture-model-a",
      uncached_input: 100,
      cached_input: 20,
      output: 10,
      complete: 1,
      seen_uncached: 1,
      seen_cached: 1,
      seen_output: 1,
    });

    const legacy = store.db
      .query("SELECT * FROM totals WHERE provider = ? AND model = ?")
      .get("fixture-provider", "fixture-model-a");
    expect(legacy).toMatchObject({ uncached_input: 100, cached_input: 20, output: 10, complete: 1 });
  });

  test("a missing metric does not increment its seen counter", () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    expect(store.addTokenTotals(epoch, "fixture-provider", "fixture-model-a", USAGE_OUTPUT_ONLY.usage)).toBe(true);
    const totals = store.readStatusData({ now, period: "peak" }).tokenTotals;
    const row = totals.rows.find((item) => item.model === "fixture-model-a");
    expect(row.complete).toBe(1);
    expect(row.seenCached).toBe(0);
    expect(row.seenUncached).toBe(0);
    expect(row.seenOutput).toBe(1);
  });

  test("an empty usage object is not a completed request", () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    expect(store.addTokenTotals(epoch, "fixture-provider", "fixture-model-a", USAGE_EMPTY.usage)).toBe(false);
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_totals").get().n).toBe(0);
  });

  test("a request that starts before a reset writes only to its captured epoch", () => {
    const store = usageStore();
    const startEpoch = store.captureTokenEpoch();
    now += 5_000;
    const reset = store.resetTokenTotals({ resetId: "reset-fixture-1" });
    expect(reset.idempotent).toBe(false);
    const current = store.captureTokenEpoch();
    expect(current).not.toBe(startEpoch);

    expect(store.addTokenTotals(startEpoch, "fixture-provider", "fixture-model-a", { output: 7 })).toBe(true);
    const data = store.readStatusData({ now, period: "peak" });
    expect(data.epoch.id).toBe(current);
    expect(data.tokenTotals.rows).toEqual([]);
    const old = store.db
      .query("SELECT output FROM token_totals WHERE epoch = ? AND provider = ? AND model = ?")
      .get(startEpoch, "fixture-provider", "fixture-model-a");
    expect(old.output).toBe(7);
  });
});

describe("reset transaction", () => {
  test("reset creates a new epoch, clears legacy totals, and keeps old rows", () => {
    const store = usageStore();
    const before = store.captureTokenEpoch();
    expect(store.addTokenTotals(before, "fixture-provider", "fixture-model-a", { uncachedInput: 9, output: 3 })).toBe(
      true,
    );
    now += 10_000;
    const result = store.resetTokenTotals({ resetId: "reset-a" });
    expect(result.idempotent).toBe(false);
    expect(result.epoch.id).toMatch(/^epoch_\d+_[A-Za-z0-9]+$/);
    expect(result.epoch.id).not.toBe(before);
    expect(result.epoch.since).toBe(new Date(now).toISOString());

    expect(store.captureTokenEpoch()).toBe(result.epoch.id);
    expect(store.readTokenTotals().totals).toEqual({ uncachedInput: 0, cachedInput: 0, output: 0 });
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_totals WHERE epoch = ?").get(before).n).toBe(1);
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_epochs").get().n).toBe(2);
    expect(store.db.query("SELECT value FROM metadata WHERE name = 'since'").get().value).toBe(result.epoch.since);
  });

  test("replaying the same resetId is idempotent and returns the same epoch", () => {
    const store = usageStore();
    now += 3_000;
    const first = store.resetTokenTotals({ resetId: "reset-replay" });
    const second = store.resetTokenTotals({ resetId: "reset-replay" });
    expect(second.idempotent).toBe(true);
    expect(second.epoch).toEqual(first.epoch);
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_epochs").get().n).toBe(2);
  });

  test("a second reset within two seconds is a conflict, then allowed", () => {
    const store = usageStore();
    now += 10_000;
    const first = store.resetTokenTotals({ resetId: "reset-conflict-a" });
    now += 1_000;
    const second = store.resetTokenTotals({ resetId: "reset-conflict-b" });
    expect(second.conflict).toBe(true);
    expect(second.epoch).toEqual(first.epoch);
    expect(store.captureTokenEpoch()).toBe(first.epoch.id);

    now += 1_500;
    const third = store.resetTokenTotals({ resetId: "reset-conflict-c" });
    expect(third.idempotent).toBe(false);
    expect(third.epoch.id).not.toBe(first.epoch.id);
    expect(third.epoch.id).toMatch(/^epoch_/);
  });

  test("an unavailable store never pretends the reset succeeded", () => {
    const store = usageStore();
    store.close();
    expect(store.resetTokenTotals({ resetId: "reset-closed" })).toBe(null);
    const memory = StateStore.memory({ now: () => now });
    stores.push(memory);
    expect(memory.resetTokenTotals({ resetId: "reset-memory" })).toBe(null);
  });
});

describe("readStatusData", () => {
  test("returns the exact raw-row bundle from one read", () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    store.addTokenTotals(epoch, "fixture-provider", "fixture-model-a", { uncachedInput: 5, cachedInput: 2, output: 1 });
    const data = store.readStatusData({
      now,
      period: "peak",
      perfSinceMinute: Math.floor(now / 60_000) - 29,
      perfUntilMinute: Math.floor(now / 60_000),
      affinitySinceMinute: Math.floor(now / 60_000) - 4,
      workerSince: now - 300_000,
      healthSince: now - 7 * 86_400_000,
    });
    expect(data.available).toBe(true);
    expect(data.mode).toBe("sqlite");
    expect(data.reason).toBe(null);
    expect(data.epoch).toEqual({ id: epoch, since: expect.any(String) });
    expect(data.tokenTotals.epoch).toEqual(data.epoch);
    expect(Array.isArray(data.tokenTotals.rows)).toBe(true);
    expect(Array.isArray(data.perfRows)).toBe(true);
    expect(Array.isArray(data.speedRows)).toBe(true);
    expect(Array.isArray(data.workerRows)).toBe(true);
    expect(Array.isArray(data.capacityRows)).toBe(true);
    expect(Array.isArray(data.healthRows)).toBe(true);
    expect(Array.isArray(data.proofRows)).toBe(true);
    expect(data.affinityStats).toEqual({
      hits: expect.any(Number),
      lookups: expect.any(Number),
      sinceMinute: Math.floor(now / 60_000) - 4,
      untilMinute: Math.floor(now / 60_000),
    });
  });

  test("the perf window is inclusive and bounded at 30 buckets", () => {
    const store = usageStore();
    const minute = Math.floor(now / 60_000);
    for (let distance = 0; distance < 32; distance += 1) {
      store.addPerf({
        model: "fixture-provider/fixture-model-a",
        period: "peak",
        minute: minute - distance,
        totalMs: 1_000,
        totalCount: 1,
        completeMs: 1_000,
        completeN: 1,
      });
    }
    const data = store.readStatusData({
      now,
      period: "peak",
      perfSinceMinute: minute - 29,
      perfUntilMinute: minute,
      affinitySinceMinute: minute - 4,
      workerSince: now - 300_000,
      healthSince: now - 7 * 86_400_000,
    });
    expect(data.perfRows.length).toBe(30);
    const minutes = data.perfRows.map((row) => row.minute).sort((a, b) => a - b);
    expect(minutes[0]).toBe(minute - 29);
    expect(minutes.at(-1)).toBe(minute);
    expect(data.perfRows.some((row) => row.completeN === undefined)).toBe(false);
  });

  test("a memory store is unavailable and never zero-filled", () => {
    const store = StateStore.memory({ now: () => now });
    stores.push(store);
    const data = store.readStatusData({ now, period: "peak" });
    expect(data.available).toBe(false);
    expect(data.mode).toBe("memory");
    expect(typeof data.reason).toBe("string");
    expect(data.tokenTotals).toBe(null);
    expect(data.epoch).toBe(null);
    expect(data.perfRows).toEqual([]);
  });

  test("runs inside one transaction", () => {
    const store = usageStore();
    let transactions = 0;
    const original = store.db.transaction.bind(store.db);
    store.db.transaction = (...args) => {
      transactions += 1;
      return original(...args);
    };
    store.readStatusData({ now, period: "peak" });
    expect(transactions).toBe(1);
  });

  test("a large model set does not issue a query per model", () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    for (let index = 0; index < 40; index += 1) {
      store.addTokenTotals(epoch, "fixture-provider", `fixture-model-${index}`, { output: index });
    }
    let queries = 0;
    const original = store.db.query.bind(store.db);
    store.db.query = (...args) => {
      queries += 1;
      return original(...args);
    };
    const data = store.readStatusData({ now, period: "peak" });
    expect(data.tokenTotals.rows.length).toBe(40);
    expect(queries).toBeLessThan(5);
  });
});

describe("worker heartbeat and affinity counters", () => {
  test("worker_load upserts and deletes one row per worker", () => {
    const store = usageStore();
    const row = {
      worker: "fixture-worker:111",
      host: "fixture-worker",
      pid: 111,
      build_version: "sha256-0123456789ab",
      view_schema: 3,
      in_flight: 2,
      catalog_ready: 1,
      epoch: store.captureTokenEpoch(),
      updated_at: now,
    };
    store.writeWorkerLoad(row);
    store.writeWorkerLoad({ ...row, in_flight: 5, updated_at: now + 1_000 });
    let data = store.readStatusData({ now: now + 2_000, period: "peak" });
    expect(data.workerRows.length).toBe(1);
    expect(data.workerRows[0].inFlight).toBe(5);
    expect(data.workerRows[0].viewSchema).toBe(3);
    store.deleteWorkerLoad(row.worker);
    data = store.readStatusData({ now: now + 2_000, period: "peak" });
    expect(data.workerRows).toEqual([]);
  });

  test("affinity counters aggregate in five-minute buckets and prune after ten", () => {
    const store = usageStore();
    const minute = Math.floor(now / 60_000);
    store.recordAffinityStat(minute, 1, 1);
    store.recordAffinityStat(minute, 0, 1);
    store.recordAffinityStat(minute - 1, 1, 1);
    const data = store.readStatusData({
      now,
      period: "peak",
      affinitySinceMinute: minute - 4,
      untilMinute: minute,
    });
    expect(data.affinityStats.hits).toBe(2);
    expect(data.affinityStats.lookups).toBe(3);

    now += 11 * 60_000;
    store.prune(now);
    expect(store.db.query("SELECT COUNT(*) AS n FROM affinity_stat").get().n).toBe(0);
  });

  test("worker rows are reaped after five minutes", () => {
    const store = usageStore();
    store.writeWorkerLoad({
      worker: "fixture-worker:111",
      host: "fixture-worker",
      pid: 111,
      build_version: "sha256-0123456789ab",
      view_schema: 3,
      in_flight: 1,
      catalog_ready: 1,
      epoch: store.captureTokenEpoch(),
      updated_at: now,
    });
    now += 6 * 60_000;
    store.prune(now);
    expect(store.db.query("SELECT COUNT(*) AS n FROM worker_load").get().n).toBe(0);
  });
});

describe("proof rows", () => {
  test("verified concurrency is monotonic across workers", () => {
    const first = usageStore();
    const second = new StateStore({ path: first.path, now: () => now, worker: "fixture-worker:222" });
    stores.push(second);
    first.setProof("fixture-provider/fixture-model-a", 6, now + 60_000);
    second.setProof("fixture-provider/fixture-model-a", 4, now + 30_000);
    expect(first.getProof("fixture-provider/fixture-model-a")).toEqual({
      verified: 6,
      until: now + 60_000,
    });
    second.setProof("fixture-provider/fixture-model-a", 9, now + 90_000);
    expect(first.getProof("fixture-provider/fixture-model-a")).toEqual({
      verified: 9,
      until: now + 90_000,
    });
  });

  test("an expired proof is not returned", () => {
    const store = usageStore();
    store.setProof("fixture-provider/fixture-model-a", 3, now + 1_000);
    now += 2_000;
    expect(store.getProof("fixture-provider/fixture-model-a")).toBe(undefined);
    const data = store.readStatusData({ now, period: "peak" });
    expect(data.proofRows).toEqual([]);
  });
});

describe("usage tap", () => {
  async function loadUsageTap() {
    for (const path of ["../lib/router/perf.mjs", "../lib/router/router.mjs"]) {
      try {
        const module = await import(path);
        if (typeof module.createUsageTap === "function") return module.createUsageTap;
      } catch {
        // Try the next documented home.
      }
    }
    throw new Error("createUsageTap is not exported from perf.mjs or router.mjs");
  }

  test("SSE merges the final usage and calls onUsage exactly once", async () => {
    const createUsageTap = await loadUsageTap();
    const calls = [];
    const response = new Response(sseBody(USAGE_SSE_FRAMES), {
      headers: { "content-type": "text/event-stream" },
    });
    const tapped = createUsageTap(response, {
      mode: "sse",
      requestId: "req-sse-1",
      onUsage: (usage) => calls.push(usage),
    });
    const text = await new Response(tapped.body).text();
    expect(text).toContain("[DONE]");
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ uncachedInput: 120, cachedInput: 40, output: 40 });
  });

  test("duplicate SSE frames cannot add a second record", async () => {
    const createUsageTap = await loadUsageTap();
    const calls = [];
    const response = new Response(sseBody(USAGE_SSE_DUPLICATE), {
      headers: { "content-type": "text/event-stream" },
    });
    const tapped = createUsageTap(response, {
      mode: "sse",
      requestId: "req-sse-2",
      onUsage: (usage) => calls.push(usage),
    });
    await new Response(tapped.body).text();
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0].output).toBe(40);
  });

  test("JSON keeps the body byte-identical and parses only the tail", async () => {
    const createUsageTap = await loadUsageTap();
    const calls = [];
    const body = largeJsonBody();
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    const tapped = createUsageTap(response, {
      mode: "json",
      requestId: "req-json-1",
      onUsage: (usage) => calls.push(usage),
    });
    const text = await new Response(tapped.body).text();
    expect(text).toBe(body);
    await Promise.resolve();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ uncachedInput: 5, output: 6 });
  });

  test("an errored stream never counts as completed", async () => {
    const createUsageTap = await loadUsageTap();
    const calls = [];
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(USAGE_JSON)}\n\n`));
        controller.error(new Error("fixture abort"));
      },
    });
    const tapped = createUsageTap(new Response(body, { headers: { "content-type": "text/event-stream" } }), {
      mode: "sse",
      requestId: "req-abort",
      onUsage: (usage) => calls.push(usage),
    });
    await expect(new Response(tapped.body).text()).rejects.toThrow();
    await Promise.resolve();
    expect(calls.length).toBe(0);
  });
});

describe("direct and non-SSE requests", () => {
  function directRouter(store) {
    return new LazyRouter({
      policy: {
        routeNames: [],
        modelIdOf: (id) => id,
        displayNameOf: (id) => id,
        candidatesFor: () => [],
        maxInFlight: () => 0,
        periodAt: () => "peak",
      },
      catalog: { ready: true, find: () => undefined },
      health: { stateOf: () => "alive" },
      dispatcher: {},
      faults: { active: false },
      perf: new ModelPerf({ store, now: () => now }),
      store,
      now: () => new Date(now),
      settings: {
        routing: {},
        probePrompt: "Reply OK",
        probeMaxTokens: 8,
        probeTimeoutMs: 1_000,
        headerTimeoutMs: 1_000,
        providerHeaderTimeoutMs: {},
        upstreamHosts: {},
      },
    });
  }

  test("a direct JSON response keeps its bytes and writes one usage row", async () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    const body = JSON.stringify(USAGE_JSON);
    const response = new Response(body, { headers: { "content-type": "application/json" } });
    const router = directRouter(store);
    const measured = router.measureDirect("fixture-provider/fixture-model-a", response, now, undefined, epoch);
    expect(await measured.text()).toBe(body);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const row = store.db
      .query("SELECT * FROM token_totals")
      .all()
      .find(
        (entry) =>
          entry.epoch === epoch &&
          entry.provider === "fixture-provider" &&
          entry.model === "fixture-provider/fixture-model-a",
      );
    expect(row).toMatchObject({
      complete: 1,
      seen_uncached: 1,
      seen_cached: 1,
      seen_output: 1,
    });
  });

  test("a direct response without usage writes no row", async () => {
    const store = usageStore();
    const epoch = store.captureTokenEpoch();
    const router = directRouter(store);
    const measured = router.measureDirect(
      "fixture-provider/fixture-model-a",
      new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
      now,
      undefined,
      epoch,
    );
    await measured.text();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.db.query("SELECT COUNT(*) AS n FROM token_totals").get().n).toBe(0);
  });
});
