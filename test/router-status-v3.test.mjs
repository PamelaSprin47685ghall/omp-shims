// Router read-model contract: one store read, one snapshot, shared health,
// capacity, proof and affinity, and a 503 JSON path without zero-filled data.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HealthRegistry } from "../lib/router/health.mjs";
import { LazyRouter } from "../lib/router/router.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { BUILD_VERSION, NOW } from "./fixtures/status-v3.mjs";

const stores = [];
const directories = [];
const MODEL = "fixture-provider/fixture-model-a";
const UNIT = "fixture-provider/acct-a";
const HEALTH_KEY = `${UNIT} ${MODEL}`;

function fileStore(now = () => NOW) {
  const directory = mkdtempSync(join(tmpdir(), "omp-router-status-v3-"));
  directories.push(directory);
  const store = new StateStore({
    path: join(directory, "state.sqlite"),
    now,
    worker: "fixture-a:101",
  });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function policy() {
  return {
    routeNames: ["lazy/pro"],
    modelIdOf: (id) => id,
    displayNameOf: () => "专业路由",
    contextWindowOf: () => 1_000_000,
    maxOutputTokensOf: () => 128_000,
    maxInFlight: (key) => (key === UNIT ? 4 : 0),
    periodAt: () => "peak",
    candidatesFor: () => [
      {
        unitKey: UNIT,
        unit: { label: "fixture-provider:plus#1" },
        model: MODEL,
        effort: "high",
        intelligence: 50,
        cost: 1,
      },
    ],
  };
}

function catalog() {
  return {
    ready: true,
    find: () => ({ contextWindow: 1_000_000, input: ["text"], output: ["text"] }),
  };
}

function makeRouter(store, overrides = {}) {
  const health = overrides.health ?? new HealthRegistry({ store, now: () => NOW });
  return new LazyRouter({
    policy: policy(),
    catalog: catalog(),
    health,
    dispatcher: { dispatch: async () => new Response("no") },
    faults: { active: false },
    store,
    now: () => new Date(NOW),
    buildVersion: BUILD_VERSION,
    idFactory: () => "snap_0123456789abcdef",
    accountDirectory: {
      version: 1,
      all: () => [{ provider: "fixture-provider", id: "acct-a", tier: null }],
    },
    planData: {
      routes: { "lazy/pro": { graph: { type: "model", model: MODEL } } },
    },
    emit: () => {},
    settings: {
      probePrompt: "Reply OK",
      probeMaxTokens: 8,
      probeTimeoutMs: 1_000,
      headerTimeoutMs: 1_000,
      providerHeaderTimeoutMs: {},
      upstreamHosts: {},
      routing: { temperature: 0 },
    },
    ...overrides,
  });
}

function seed(store) {
  const minute = Math.floor(NOW / 60_000);
  const epoch = store.captureTokenEpoch();
  store.addTokenTotals(epoch, "fixture-provider", "fixture-model-a", {
    uncachedInput: 1_500,
    cachedInput: 300,
    output: 200,
  });
  store.addPerf({
    model: MODEL,
    period: "peak",
    minute,
    totalMs: 1_640,
    totalCount: 1,
    completeMs: 1_640,
    completeN: 1,
    ttftMs: 100,
    ttftCount: 1,
  });
  store.setProof(MODEL, 5, NOW + 60_000);
  store.recordAffinityStat(minute, 1, 2);
  store.reserveSlot(UNIT, 4);
  store.reserveSlot(UNIT, 4);
  store.writeHealth(HEALTH_KEY, { state: "dead", until: NOW + 60_000, reason: "429 限流" });
  store.writeWorkerLoad({
    worker: "fixture-a:101",
    host: "fixture-a",
    pid: 101,
    build_version: BUILD_VERSION,
    view_schema: 3,
    in_flight: 3,
    catalog_ready: 1,
    epoch,
    updated_at: NOW - 1_000,
  });
  store.writeWorkerLoad({
    worker: "fixture-b:202",
    host: "fixture-b",
    pid: 202,
    build_version: BUILD_VERSION,
    view_schema: 3,
    in_flight: 2,
    catalog_ready: 1,
    epoch,
    updated_at: NOW - 2_000,
  });
  store.writeWorkerLoad({
    worker: "fixture-c:303",
    host: "fixture-c",
    pid: 303,
    build_version: BUILD_VERSION,
    view_schema: 3,
    in_flight: 9,
    catalog_ready: 0,
    epoch,
    updated_at: NOW - 30_000,
  });
}

describe("statusView", () => {
  test("returns one StatusSnapshotV3 from one readStatusData call", () => {
    const store = fileStore();
    seed(store);
    let reads = 0;
    const original = store.readStatusData.bind(store);
    store.readStatusData = (...args) => {
      reads += 1;
      return original(...args);
    };
    let tokenReads = 0;
    const originalToken = store.readTokenTotals.bind(store);
    store.readTokenTotals = (...args) => {
      tokenReads += 1;
      return originalToken(...args);
    };
    let speedReads = 0;
    const originalSpeed = store.readSpeedRows.bind(store);
    store.readSpeedRows = (...args) => {
      speedReads += 1;
      return originalSpeed(...args);
    };
    const router = makeRouter(store);
    const view = router.statusView();
    expect(reads).toBe(1);
    expect(tokenReads).toBe(0);
    expect(speedReads).toBe(0);
    expect(view.schemaVersion).toBe(3);
    expect(view.snapshotId).toBe("snap_0123456789abcdef");
    expect(view.buildVersion).toBe(BUILD_VERSION);
    expect(view.routes.length).toBe(1);
    expect(view.metrics.M01).toBeTruthy();
    expect(view.metrics.M27).toBeTruthy();
  });

  test("M03/M04 read live worker rows and exclude a stale worker", () => {
    const store = fileStore();
    seed(store);
    const view = makeRouter(store).statusView();
    expect(view.workers.length).toBe(3);
    expect(view.metrics.M03.value).toBe("5");
    expect(view.metrics.M03.detail).toContain("2 workers");
    expect(view.workers.find((worker) => worker.worker === "fixture-c:303").stale).toBe(true);
  });

  test("M20/M22/M23 read the shared health row, not a local cooling map", () => {
    const store = fileStore();
    seed(store);
    const health = new HealthRegistry({ store, now: () => NOW });
    const view = makeRouter(store, { health }).statusView();
    const unit = view.routes[0].channels[0].units[0];
    expect(unit.health).toBe("cooling");
    expect(unit.reason).toContain("429");
    expect(unit.metrics.M20.value).toContain("冷却");
    expect(unit.metrics.M22.value).not.toBe("—");
    expect(view.health.rows.length).toBeGreaterThan(0);
  });

  test("M21 reads shared capacity rows and reports unlimited as 不限", () => {
    const store = fileStore();
    seed(store);
    const view = makeRouter(store).statusView();
    const unit = view.routes[0].channels[0].units[0];
    expect(unit.capacity).toMatchObject({ held: 2, max: 4, scope: "unit" });
    expect(unit.metrics.M21.value).toContain("2");
    expect(unit.metrics.M21.value).toContain("4");
    expect(view.capacity.available).toBe(true);
    expect(view.capacity.rows.some((row) => row.unitRef === unit.unitRef)).toBe(true);
  });

  test("M17 reads the shared proof row and M07 reads affinity counters", () => {
    const store = fileStore();
    seed(store);
    const view = makeRouter(store).statusView();
    const channel = view.routes[0].channels[0];
    expect(channel.perf.M17.available).toBe(true);
    expect(channel.perf.M17.value).toBe("5");
    expect(view.metrics.M07.value).toBe("50.0%");
    expect(view.metrics.M07.detail).toContain("命中 1 / 查询 2");
  });

  test("token totals use the current epoch and the full scope label", () => {
    const store = fileStore();
    seed(store);
    const view = makeRouter(store).statusView();
    expect(view.tokenTotals.available).toBe(true);
    expect(view.tokenTotals.scope).toEqual({
      includesNonSse: true,
      includesDirect: true,
      label: "含直连/非流式",
    });
    expect(view.metrics.M08.value).toBe("1.5 K");
  });

  test("perf and speed rows come from the same read, never a per-candidate query", () => {
    const store = fileStore();
    seed(store);
    let perfReads = 0;
    const original = store.perfWindow.bind(store);
    store.perfWindow = (...args) => {
      perfReads += 1;
      return original(...args);
    };
    const router = makeRouter(store);
    router.statusView();
    expect(perfReads).toBe(0);
  });
});

describe("JSON endpoint", () => {
  test("a successful status is JSON with the snapshot envelope", async () => {
    const store = fileStore();
    seed(store);
    const response = makeRouter(store).status();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.schemaVersion).toBe(3);
    expect(body.snapshotId).toMatch(/^snap_[0-9a-f]{16}$/);
  });

  test("a read error is 503 with the stable error body, never a zero-filled snapshot", async () => {
    const store = fileStore();
    seed(store);
    store.readStatusData = () => ({
      available: false,
      mode: "sqlite",
      reason: "共享存储读取失败",
      epoch: null,
      tokenTotals: null,
      perfRows: [],
      speedRows: [],
      workerRows: [],
      capacityRows: [],
      healthRows: [],
      proofRows: [],
      affinityStats: null,
    });
    const response = makeRouter(store).status();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      error: "store_unavailable",
      snapshotId: "snap_0123456789abcdef",
      generatedAt: new Date(NOW).toISOString(),
      buildVersion: BUILD_VERSION,
    });
  });

  test("memory mode renders an unavailable snapshot instead of 503", async () => {
    const store = StateStore.memory({ now: () => NOW });
    stores.push(store);
    const view = makeRouter(store).statusView();
    expect(view.store.mode).toBe("memory");
    expect(view.store.available).toBe(false);
    expect(view.metrics.M26.available).toBe(false);
    expect(view.tokenTotals.available).toBe(false);
    const response = makeRouter(store).status();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.store.mode).toBe("memory");
  });
});
