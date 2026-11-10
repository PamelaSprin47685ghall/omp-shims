// Shared synthetic input for the v3 snapshot and router tests.
//
// The shapes follow the C0 input contract exactly; the expected output is the
// S3 §3.1–§3.3 envelope. No real provider, account, credential, or URL.

import { createHash } from "node:crypto";

export const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
export const NOW_MINUTE = Math.floor(NOW / 60_000);
export const SNAPSHOT_ID = "snap_0123456789abcdef";
export const BUILD_VERSION = "sha256-0123456789ab";
export const EPOCH_ID = "epoch_1762776000000_fixture";
export const EPOCH_SINCE = "2026-11-10T00:00:00.000Z";

/** S3 §3.3: unitRef = "u_" + sha256(provider + "\0" + accountId).slice(0, 16). */
export function expectedUnitRef(provider, accountId) {
  return `u_${createHash("sha256").update(`${provider}\0${accountId}`).digest("hex").slice(0, 16)}`;
}

export const SAFE_HTTPS_URL = "https://example.com/official-pricing";

/** One valid, fully available snapshot input. */
export function snapshotInput(overrides = {}) {
  const routes = [
    {
      id: "lazy/pro",
      title: "专业路由",
      state: "alive",
      strategy: "按总耗时评分 · 带温度探索",
      graph: {
        type: "op",
        label: "并行候选",
        children: [
          { type: "model", model: "fixture-provider/fixture-model-a", label: "fixture-model-a", children: [] },
        ],
      },
      channels: [
        {
          model: "fixture-provider/fixture-model-a",
          effort: "high",
          posterior: { totalMs: 1_820, rd: 0.42, weight: 3.7, censored: 2, completed: 3 },
          units: [
            {
              unitKey: "fixture-provider/acct-a",
              displayName: "fixture-provider:plus#1",
              provider: "fixture-provider",
              model: "fixture-provider/fixture-model-a",
              health: "alive",
              capacity: { held: 2, max: 4, scope: "unit", stale: false, updatedAt: NOW - 1_000 },
            },
            {
              unitKey: "fixture-provider/acct-b",
              displayName: "fixture-provider:plus#2",
              provider: "fixture-provider",
              model: "fixture-provider/fixture-model-a",
              health: "cooling",
              reason: "429 限流",
              nextProbeAt: NOW + 180_000,
              coolingSince: NOW - 180_000,
              capacity: { held: 0, max: 4, scope: "unit", stale: false, updatedAt: NOW - 1_000 },
            },
          ],
        },
        {
          model: "fixture-provider/fixture-model-b",
          effort: "—",
          posterior: { totalMs: 900, rd: 0.2, weight: 1.1, censored: 0, completed: 2 },
          units: [
            {
              unitKey: "fixture-provider/acct-c",
              displayName: "fixture-provider:plus#3",
              provider: "fixture-provider",
              model: "fixture-provider/fixture-model-b",
              health: "busy",
              capacity: { held: 1, max: 0, scope: "unit_model", stale: false, updatedAt: NOW - 1_000 },
            },
          ],
        },
      ],
    },
    {
      id: "lazy/flash",
      title: "快速路由",
      state: "loading",
      strategy: "按总耗时评分 · 带温度探索",
      graph: null,
      channels: [],
    },
  ];

  const workerRows = [
    {
      worker: "fixture-a:101",
      host: "fixture-a",
      pid: 101,
      buildVersion: BUILD_VERSION,
      viewSchema: 3,
      inFlight: 4,
      catalogReady: true,
      epoch: EPOCH_ID,
      updatedAt: NOW - 1_000,
    },
    {
      worker: "fixture-b:202",
      host: "fixture-b",
      pid: 202,
      buildVersion: BUILD_VERSION,
      viewSchema: 3,
      inFlight: 3,
      catalogReady: true,
      epoch: EPOCH_ID,
      updatedAt: NOW - 900,
    },
    {
      worker: "fixture-c:303",
      host: "fixture-c",
      pid: 303,
      buildVersion: BUILD_VERSION,
      viewSchema: 3,
      inFlight: 2,
      catalogReady: false,
      epoch: EPOCH_ID,
      updatedAt: NOW - 3_000,
    },
    {
      worker: "fixture-d:404",
      host: "fixture-d",
      pid: 404,
      buildVersion: "sha256-bbbbbbbbbbbb",
      viewSchema: 3,
      inFlight: 9,
      catalogReady: true,
      epoch: "epoch_old",
      updatedAt: NOW - 30_000,
    },
  ];

  const capacityRows = [
    {
      unit: "fixture-provider/acct-a",
      worker: "fixture-a:101",
      held: 2,
      max: 4,
      scope: "unit",
      updatedAt: NOW - 1_000,
    },
    {
      unit: "fixture-provider/acct-c",
      worker: "fixture-c:303",
      held: 1,
      max: 0,
      scope: "unit_model",
      updatedAt: NOW - 1_000,
    },
    {
      unit: "fixture-provider/acct-b",
      worker: "fixture-b:202",
      held: 0,
      max: 4,
      scope: "unit",
      updatedAt: NOW - 30_000,
    },
  ];

  const healthRows = [
    { key: "fixture-provider/acct-a", state: "alive", until: 0, reason: null, updatedAt: NOW - 1_000 },
    {
      key: "fixture-provider/acct-b",
      state: "dead",
      until: NOW + 180_000,
      reason: "429 限流",
      probeLeaseUntil: NOW + 30_000,
      updatedAt: NOW - 180_000,
    },
    { key: "fixture-provider/acct-c", state: "busy", until: NOW + 60_000, reason: "繁忙", updatedAt: NOW - 2_000 },
    {
      key: "fixture-provider/acct-d",
      state: "dead",
      until: NOW - 60_000,
      reason: "过期冷却",
      updatedAt: NOW - 120_000,
    },
  ];

  const proofRows = [
    { model: "fixture-provider/fixture-model-a", verified: 6, until: NOW + 1_800_000 },
    { model: "fixture-provider/fixture-model-b", verified: 4, until: NOW + 900_000 },
  ];

  const tokenTotals = {
    epoch: { id: EPOCH_ID, since: EPOCH_SINCE },
    rows: [
      {
        provider: "fixture-provider",
        model: "fixture-model-a",
        uncachedInput: 1_000_000,
        cachedInput: 300_000,
        output: 80_000,
        complete: 6,
        seenUncached: 6,
        seenCached: 5,
        seenOutput: 6,
        updatedAt: NOW,
      },
      {
        provider: "fixture-provider",
        model: "fixture-model-b",
        uncachedInput: 234_567,
        cachedInput: 40_000,
        output: 18_700,
        complete: 4,
        seenUncached: 2,
        seenCached: 2,
        seenOutput: 4,
        updatedAt: NOW,
      },
    ],
    models: [
      {
        provider: "fixture-provider",
        model: "fixture-model-a",
        uncachedInput: 1_000_000,
        cachedInput: 300_000,
        output: 80_000,
        complete: 6,
      },
      {
        provider: "fixture-provider",
        model: "fixture-model-b",
        uncachedInput: 234_567,
        cachedInput: 40_000,
        output: 18_700,
        complete: 4,
      },
    ],
  };

  const perfRows = [
    {
      model: "fixture-provider/fixture-model-a",
      period: "peak",
      minute: NOW_MINUTE,
      ttftMs: 100,
      ttftCount: 1,
      outputTokens: 100,
      tokenCount: 1,
      speedTokens: 100,
      generationMs: 500,
      speedCount: 1,
      totalMs: 1_640,
      totalCount: 1,
      totalLog: Math.log(1_640),
      totalLogSq: Math.log(1_640) ** 2,
      imputedCount: 0,
      completeMs: 1_640,
      completeN: 1,
      completeLog: Math.log(1_640),
      completeLogSq: Math.log(1_640) ** 2,
      imputedMs: 0,
      legacyMixed: 0,
      updatedAt: NOW,
    },
  ];

  const input = {
    now: NOW,
    idFactory: () => SNAPSHOT_ID,
    answeredBy: "fixture-a:101",
    buildVersion: BUILD_VERSION,
    epoch: { id: EPOCH_ID, since: EPOCH_SINCE },
    store: { mode: "sqlite", available: true, reason: null },
    period: {
      id: "peak",
      label: "高峰时段",
      nextSwitch: { at: "2026-11-10T14:10:00.000Z", period: "offPeak", label: "闲时 · 2 小时 10 分后" },
    },
    catalog: { ready: true, workerReady: true, aggregateReady: true },
    routes,
    perfRows,
    nowMinute: NOW_MINUTE,
    workerRows,
    capacityRows,
    healthRows,
    proofRows,
    affinityStats: { hits: 10, lookups: 16, sinceMinute: NOW_MINUTE - 4, untilMinute: NOW_MINUTE },
    tokenTotals,
  };
  return merge(input, overrides);
}

/** A store that cannot answer: every shared metric is unknown, never zero. */
export function unavailableInput(overrides = {}) {
  return merge(snapshotInput(), {
    store: { mode: "unavailable", available: false, reason: "共享状态不可用" },
    workerRows: [],
    capacityRows: [],
    healthRows: [],
    proofRows: [],
    affinityStats: null,
    tokenTotals: null,
    routes: [],
    perfRows: [],
    catalog: { ready: false, workerReady: false, aggregateReady: false },
    ...overrides,
  });
}

/** A shallow merge for the two or three nested keys the tests change. */
export function merge(base, patch) {
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] =
      value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object"
        ? { ...base[key], ...value }
        : value;
  }
  return output;
}

/** One route with a single unit, for focus tests. */
export function oneUnitRoute(unit = {}, channel = {}, route = {}) {
  return {
    id: "lazy/pro",
    title: "专业路由",
    state: "alive",
    strategy: "按总耗时评分 · 带温度探索",
    graph: null,
    channels: [
      {
        model: "fixture-provider/fixture-model-a",
        effort: "high",
        posterior: { totalMs: 1_820, rd: 0.42, weight: 3.7, censored: 2, completed: 3 },
        units: [
          {
            unitKey: "fixture-provider/acct-a",
            displayName: "fixture-provider:plus#1",
            provider: "fixture-provider",
            model: "fixture-provider/fixture-model-a",
            health: "alive",
            capacity: { held: 2, max: 4, scope: "unit", stale: false, updatedAt: NOW - 1_000 },
            ...unit,
          },
        ],
        ...channel,
      },
    ],
    ...route,
  };
}

/** A minimal LazyRouter store double for the read-count test. */
export function countingStore(bundle) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    readStatusData() {
      reads += 1;
      return bundle;
    },
    captureTokenEpoch() {
      return EPOCH_ID;
    },
    worker: "fixture-a:101",
  };
}
