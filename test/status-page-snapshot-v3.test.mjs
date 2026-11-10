// Executable contract for the StatusSnapshotV3 builder.
//
// S3 §3.1–§3.3: envelope, M01–M27 placement, formatting, identity, escaping,
// unavailable branches. These tests call only the public builder and formatter.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DASH,
  formatCount,
  formatCurrencyPair,
  formatDuration,
  formatPercent,
  formatRatio,
  formatTokens,
  formatTokensExact,
  formatUsd,
} from "../lib/router/status-page/format.mjs";
import { buildSnapshot } from "../lib/router/status-page/snapshot.mjs";
import {
  BUILD_VERSION,
  EPOCH_ID,
  expectedUnitRef,
  NOW,
  NOW_MINUTE,
  oneUnitRoute,
  SNAPSHOT_ID,
  snapshotInput,
  unavailableInput,
} from "./fixtures/status-v3.mjs";
import { HOSTILE_REASONS } from "./fixtures/xss-names.mjs";

const ENVELOPE_KEYS = [
  "schemaVersion",
  "snapshotId",
  "generatedAt",
  "answeredBy",
  "buildVersion",
  "epoch",
  "store",
  "period",
  "catalog",
  "overview",
  "metrics",
  "routes",
  "diagnostics",
  "workers",
  "capacity",
  "health",
  "proof",
  "affinity",
  "tokenTotals",
  "notices",
];

const METRIC_KEYS = [
  "id",
  "label",
  "value",
  "exact",
  "unit",
  "scope",
  "window",
  "available",
  "reason",
  "detail",
  "tone",
  "coverage",
];

const UNITS = new Set(["count", "tokens", "ms", "percent", "usd", "text"]);
const SCOPES = new Set(["global", "global_approx", "worker", "per_worker", "per_model", "per_unit", "n/a"]);
const TONES = new Set(["normal", "positive", "warning", "muted"]);

function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walk(item, visit, `${path}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) walk(item, visit, `${path}.${key}`);
  }
}

function assertNoUndefined(snapshot) {
  walk(snapshot, (value, path) => {
    expect(`${path}:${String(value === undefined)}`).not.toBe(`${path}:true`);
  });
}

/** Every object that looks like a Metric, with the path where it sits. */
function metricsIn(snapshot) {
  const found = [];
  walk(snapshot, (value, path) => {
    if (
      value &&
      typeof value === "object" &&
      typeof value.id === "string" &&
      /^M\d{2}$/.test(value.id) &&
      "available" in value &&
      "scope" in value &&
      "value" in value
    ) {
      found.push({ metric: value, path });
    }
  });
  return found;
}

function snapshot(overrides) {
  return buildSnapshot(snapshotInput(overrides));
}

describe("envelope", () => {
  test("has exactly the S3 keys and scalar identity", () => {
    const view = snapshot();
    expect(Object.keys(view).sort()).toEqual([...ENVELOPE_KEYS].sort());
    expect(view.schemaVersion).toBe(3);
    expect(view.snapshotId).toBe(SNAPSHOT_ID);
    expect(view.snapshotId).toMatch(/^snap_[0-9a-f]{16}$/);
    expect(view.generatedAt).toBe(new Date(NOW).toISOString());
    expect(view.answeredBy).toBe("fixture-a:101");
    expect(view.buildVersion).toBe(BUILD_VERSION);
    expect(view.epoch).toEqual({ id: EPOCH_ID, since: "2026-11-10T00:00:00.000Z" });
    expect(view.store).toEqual({ mode: "sqlite", available: true, reason: null });
    expect(view.period.id).toBe("peak");
    expect(view.period.label).toBe("高峰时段");
    expect(view.period.nextSwitch.label).toContain("闲时");
    expect(view.catalog).toEqual({ ready: true, workerReady: true, aggregateReady: true });
    expect(view.diagnostics.windowMinutes).toBe(30);
    expect(view.proof.ttlMinutes).toBe(30);
    expect(view.affinity.windowMinutes).toBe(5);
    expect(Array.isArray(view.notices)).toBe(true);
  });

  test("the id factory is called once after the input is read", () => {
    let calls = 0;
    const view = buildSnapshot(
      snapshotInput({
        idFactory: () => {
          calls += 1;
          return `snap_${String(calls).padStart(16, "0").slice(-16)}`;
        },
      }),
    );
    expect(calls).toBe(1);
    expect(view.snapshotId).toBe("snap_0000000000000001");
  });

  test("contains no undefined value at any depth", () => {
    assertNoUndefined(snapshot());
    assertNoUndefined(buildSnapshot(unavailableInput()));
  });

  test("one snapshotId appears in the envelope and M27 only as a reference", () => {
    const view = snapshot();
    const ids = [];
    walk(view, (value, path) => {
      if (typeof value === "string" && value === SNAPSHOT_ID) ids.push(path);
    });
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids.some((path) => path.includes("M27"))).toBe(true);
  });
});

describe("overview and metric inventory", () => {
  test("primary and secondary groups carry the S3 metric ids", () => {
    const view = snapshot();
    expect(view.overview.primary.map((group) => group.key)).toEqual(["period", "inFlight", "channels", "tokens"]);
    expect(view.overview.primary).toEqual([
      { key: "period", metricIds: ["M01", "M02"] },
      { key: "inFlight", metricIds: ["M03"], detailMetricIds: ["M04"] },
      { key: "channels", metricIds: ["M05"] },
      { key: "tokens", metricIds: ["M08", "M09", "M10", "M11", "M12"] },
    ]);
    expect(view.overview.secondary).toEqual([
      { key: "routeSummary", metricIds: ["M06", "M07"] },
      { key: "routeDiagnostics", metricIds: ["M13", "M14", "M15", "M16", "M17", "M18", "M19"] },
      { key: "capacity", metricIds: ["M21"] },
      { key: "health", metricIds: ["M20", "M22", "M23"] },
      { key: "catalog", metricIds: ["M24"] },
      { key: "store", metricIds: ["M26"] },
      { key: "meta", metricIds: ["M27"] },
    ]);
  });

  test("snapshot-wide metrics are exactly M01–M12 and M24–M27", () => {
    const view = snapshot();
    expect(Object.keys(view.metrics).sort()).toEqual(
      ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09", "M10", "M11", "M12", "M24", "M25", "M26", "M27"]
        .filter((id) => id !== "M04")
        .sort(),
    );
  });

  test("every metric record has the exact field and enum shape", () => {
    for (const { metric, path } of metricsIn(snapshot())) {
      expect(Object.keys(metric).sort()).toEqual([...METRIC_KEYS].sort());
      expect(metric.id).toMatch(/^M\d{2}$/);
      expect(typeof metric.label).toBe("string");
      expect(metric.label.length).toBeGreaterThan(0);
      expect(typeof metric.value).toBe("string");
      expect(metric.value.length).toBeGreaterThan(0);
      expect(typeof metric.exact).toBe("string");
      expect(UNITS.has(metric.unit)).toBe(true);
      expect(SCOPES.has(metric.scope)).toBe(true);
      expect(typeof metric.available).toBe("boolean");
      expect(metric.reason === null || typeof metric.reason === "string").toBe(true);
      expect(typeof metric.detail).toBe("string");
      expect(TONES.has(metric.tone)).toBe(true);
      expect(metric.coverage === null || typeof metric.coverage === "object").toBe(true);
      if (!metric.available) {
        expect(metric.value).toBe(DASH);
        expect(typeof metric.reason).toBe("string");
      }
      expect(path.length).toBeGreaterThan(0);
    }
  });

  test("M01–M27 appear only in their documented context", () => {
    const view = snapshot();
    const allowed = new Set([
      "M01",
      "M02",
      "M03",
      "M05",
      "M06",
      "M07",
      "M08",
      "M09",
      "M10",
      "M11",
      "M12",
      "M24",
      "M25",
      "M26",
      "M27",
    ]);
    for (const { metric, path } of metricsIn(view)) {
      if (allowed.has(metric.id)) {
        expect(path.startsWith("$.metrics.")).toBe(true);
      } else if (metric.id === "M04") {
        expect(path).toMatch(/^\$\.workers\[\d+\]\.metric$/);
      } else if (/^M1[3-9]$/.test(metric.id)) {
        expect(path).toMatch(/^\$\.routes\[\d+\]\.channels\[\d+\]\.perf\.M1[3-9]$/);
      } else if (/^M2[0-3]$/.test(metric.id)) {
        expect(path).toMatch(/^\$\.routes\[\d+\]\.channels\[\d+\]\.units\[\d+\]\.metrics\.M2[0-3]$/);
      } else {
        throw new Error(`unknown metric ${metric.id} at ${path}`);
      }
    }
  });

  test("every route, channel and unit has exactly one metric set", () => {
    const view = snapshot();
    expect(view.routes.length).toBe(2);
    for (const route of view.routes) {
      expect(Array.isArray(route.channels)).toBe(true);
      for (const channel of route.channels) {
        expect(Object.keys(channel.perf).sort()).toEqual(["M13", "M14", "M15", "M16", "M17", "M18", "M19"].sort());
        for (const unit of channel.units) {
          expect(Object.keys(unit.metrics).sort()).toEqual(["M20", "M21", "M22", "M23"].sort());
        }
      }
    }
    for (const worker of view.workers) expect(worker.metric.id).toBe("M04");
  });

  test("M25 is present, unavailable, and never computes an alternate preview", () => {
    const view = snapshot();
    expect(view.metrics.M25.available).toBe(false);
    expect(view.metrics.M25.reason).toBe("未保留该时段预览");
    expect(view.metrics.M25.value).toBe(DASH);
    expect("alternate" in view).toBe(false);
  });
});

describe("formatting", () => {
  test("tokens are exact below 1000 and use one-decimal units above", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1.0 K");
    expect(formatTokens(1_234_567)).toBe("1.2 M");
    expect(formatTokens(340_000)).toBe("340.0 K");
    expect(formatTokens(98_700)).toBe("98.7 K");
    expect(formatTokensExact(1_234_567)).toBe("1,234,567");
    expect(formatTokens(NaN)).toBe(DASH);
  });

  test("a known nonzero count never rounds down to 0.0", () => {
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999_999)).toBe("1.0 M");
    expect(formatTokens(1_050)).toBe("1.1 K");
  });

  test("percent, ratio and duration follow the documented bands", () => {
    expect(formatPercent(10, 16)).toBe("62.5%");
    expect(formatPercent(0, 0)).toBe(DASH);
    expect(formatRatio(0.625)).toBe("62.5%");
    expect(formatRatio(null)).toBe(DASH);
    expect(formatDuration(820)).toBe("820 ms");
    expect(formatDuration(1_640)).toBe("1.6 s");
    expect(formatDuration(125_000)).toBe("2 分 5 秒");
    expect(formatDuration(3_725_000)).toBe("1 小时 2 分");
    expect(formatDuration(undefined)).toBe(DASH);
  });

  test("counts and currency never invent a zero", () => {
    expect(formatCount(1_234)).toBe("1,234");
    expect(formatCount(undefined)).toBe(DASH);
    expect(formatUsd(12.3456)).toBe("USD $12.3456");
    expect(formatUsd(null)).toBe(DASH);
    expect(formatCurrencyPair(12.3456)).toContain("USD $12.3456");
    expect(formatCurrencyPair(12.3456)).toContain("CNY ¥82.25");
  });
});

describe("tokens, affinity, proof and totals", () => {
  test("M08–M11 use current-epoch totals and coverage, not frame counts", () => {
    const view = snapshot();
    expect(view.metrics.M08.value).toBe("1.2 M");
    expect(view.metrics.M08.exact).toBe("1,234,567");
    expect(view.metrics.M08.coverage).toEqual({ observed: 8, complete: 10 });
    expect(view.metrics.M09.value).toBe("340.0 K");
    expect(view.metrics.M09.coverage).toEqual({ observed: 7, complete: 10 });
    expect(view.metrics.M10.value).toBe("98.7 K");
    expect(view.metrics.M10.coverage).toEqual({ observed: 10, complete: 10 });
    expect(view.metrics.M11.value).toBe("80.0%");
    expect(view.metrics.M11.detail).toContain("含直连/非流式");
    expect(view.tokenTotals.scope).toEqual({ includesNonSse: true, includesDirect: true, label: "含直连/非流式" });
    expect(view.tokenTotals.totals).toEqual({ uncachedInput: 1_234_567, cachedInput: 340_000, output: 98_700 });
    expect(view.tokenTotals.coverage).toEqual({ complete: 10, uncachedInput: 8, cachedInput: 7, output: 10 });
    expect(view.tokenTotals.epoch).toEqual({ id: EPOCH_ID, since: "2026-11-10T00:00:00.000Z" });
  });

  test("a metric with seen=0 is unknown even when the stored sum is zero", () => {
    const view = snapshot({
      tokenTotals: {
        epoch: { id: EPOCH_ID, since: "2026-11-10T00:00:00.000Z" },
        rows: [
          {
            provider: "fixture-provider",
            model: "fixture-model-a",
            uncachedInput: 0,
            cachedInput: 0,
            output: 50,
            complete: 2,
            seenUncached: 0,
            seenCached: 0,
            seenOutput: 2,
            updatedAt: NOW,
          },
        ],
        models: [],
      },
    });
    expect(view.metrics.M08.available).toBe(false);
    expect(view.metrics.M08.value).toBe(DASH);
    expect(view.metrics.M08.reason).toBeTruthy();
    expect(view.metrics.M10.available).toBe(true);
    expect(view.metrics.M10.value).toBe("50");
    expect(JSON.stringify(view.metrics.M08)).not.toContain("0 tokens");
  });

  test("M07 has no lookups → unknown, never 0%", () => {
    const view = snapshot({ affinityStats: null });
    expect(view.metrics.M07.available).toBe(false);
    expect(view.metrics.M07.value).toBe(DASH);
    expect(view.metrics.M07.reason).toBeTruthy();
    expect(view.affinity.available).toBe(false);
  });

  test("M17 reads the shared proof row and hides an expired one", () => {
    const view = snapshot({
      proofRows: [
        { model: "fixture-provider/fixture-model-a", verified: 6, until: NOW + 60_000 },
        { model: "fixture-provider/fixture-model-b", verified: 9, until: NOW - 60_000 },
      ],
    });
    const channelA = view.routes[0].channels.find((channel) => channel.model === "fixture-provider/fixture-model-a");
    const channelB = view.routes[0].channels.find((channel) => channel.model === "fixture-provider/fixture-model-b");
    expect(channelA.perf.M17.available).toBe(true);
    expect(channelA.perf.M17.value).toBe("6");
    expect(channelB.perf.M17.available).toBe(false);
    expect(channelB.perf.M17.value).toBe(DASH);
  });

  test("M19 counts complete and imputed samples separately", () => {
    const view = snapshot();
    const channel = view.routes[0].channels[0];
    expect(channel.perf.M19.available).toBe(true);
    expect(channel.perf.M19.value).toContain("/");
    expect(channel.perf.M18.available).toBe(true);
  });
});

describe("unavailable branches", () => {
  test("global metrics are unknown when the shared store is unavailable", () => {
    const view = buildSnapshot(unavailableInput());
    for (const id of ["M03", "M05", "M07", "M08", "M09", "M10", "M11", "M12", "M24", "M26"]) {
      expect(`${id}:${view.metrics[id].available}`).toBe(`${id}:false`);
      expect(`${id}:${view.metrics[id].value}`).toBe(`${id}:${DASH}`);
    }
    expect(view.metrics.M26.reason).toBeTruthy();
    expect(view.tokenTotals.available).toBe(false);
    expect(view.tokenTotals.totals).toEqual({ uncachedInput: null, cachedInput: null, output: null });
    expect(view.tokenTotals.officialValue).toBe(null);
    expect(view.notices.some((notice) => notice.code === "store_unavailable")).toBe(true);
  });

  test("an empty catalog labels M05 as loading and M24 as not ready", () => {
    const view = snapshot({
      catalog: { ready: false, workerReady: false, aggregateReady: false },
      routes: [],
    });
    expect(view.metrics.M05.available).toBe(false);
    expect(view.metrics.M05.value).toBe("目录加载中");
    expect(view.metrics.M24.available).toBe(false);
    expect(view.notices.some((notice) => notice.code === "catalog_loading")).toBe(true);
  });

  test("memory mode is labelled as this worker, never as a global value", () => {
    const view = buildSnapshot(unavailableInput({ store: { mode: "memory", available: false, reason: null } }));
    expect(view.metrics.M26.value).toContain("memory");
    expect(view.notices.some((notice) => notice.code === "memory_store")).toBe(true);
  });

  test("no unavailable metric renders a false zero", () => {
    const view = buildSnapshot(unavailableInput());
    for (const { metric } of metricsIn(view)) {
      if (metric.available) continue;
      expect(metric.value).not.toBe("0");
      expect(metric.value).not.toBe("0%");
      expect(metric.value).not.toBe("0 ms");
      expect(metric.value).not.toBe("0 tokens");
    }
  });
});

describe("workers, capacity and health", () => {
  test("M03 sums live heartbeats only and M04 keeps every worker row", () => {
    const view = snapshot();
    expect(view.workers.length).toBe(4);
    expect(view.metrics.M03.value).toBe("9");
    expect(view.metrics.M03.scope).toBe("global_approx");
    expect(view.metrics.M03.detail).toContain("3 workers");
    expect(view.workers.map((worker) => worker.metric.value)).toEqual(["4", "3", "2", "9"]);
    expect(view.workers[3].stale).toBe(true);
    expect(view.workers[3].scope).toBe("worker");
  });

  test("capacity rows classify stale leases and unlimited rows", () => {
    const view = snapshot();
    expect(view.capacity.available).toBe(true);
    expect(view.capacity.rows.length).toBe(3);
    expect(view.capacity.staleCount).toBe(1);
    expect(view.capacity.liveCount).toBe(2);
    const unlimited = view.routes[0].channels
      .flatMap((channel) => channel.units)
      .find((unit) => unit.capacity?.max === 0);
    expect(unlimited.metrics.M21.value).toBe("不限");
    const stale = view.capacity.rows.find((row) => row.stale);
    expect(stale).toBeTruthy();
  });

  test("health is shared row state; an expired dead row is alive again", () => {
    const view = snapshot();
    expect(view.health.available).toBe(true);
    const expired = view.health.rows.find((row) => row.unitRef === expectedUnitRef("fixture-provider", "acct-d"));
    expect(expired.state).toBe("alive");
    expect(expired.health).toBe("alive");
    expect(expired.reason).toBe(null);
    expect(expired.until).toBe(null);
    const busy = view.health.rows.find((row) => row.unitRef === expectedUnitRef("fixture-provider", "acct-c"));
    expect(busy.health).toBe("busy");
  });

  test("a busy unit is labelled 繁忙, never cooling", () => {
    const view = snapshot();
    const busyUnit = view.routes[0].channels.flatMap((channel) => channel.units).find((unit) => unit.health === "busy");
    expect(busyUnit.healthLabel).toBe("繁忙");
    expect(busyUnit.metrics.M20.value).toContain("繁忙");
  });

  test("rejected markDead leaves no local cooling: health wins over a stale local mirror", () => {
    const view = snapshot({
      routes: [oneUnitRoute({ health: "cooling", reason: "local mirror" })],
      healthRows: [{ key: "fixture-provider/acct-a", state: "alive", until: 0, reason: null, updatedAt: NOW - 500 }],
    });
    const unit = view.routes[0].channels[0].units[0];
    expect(unit.health).toBe("alive");
    expect(unit.reason).toBe(null);
  });
});

describe("identity and reasons", () => {
  test("unitRef is the stable sha256 prefix of provider + NUL + accountId", () => {
    const view = snapshot();
    const units = view.routes[0].channels.flatMap((channel) => channel.units);
    const refs = units.map((unit) => unit.unitRef);
    expect(refs).toContain(expectedUnitRef("fixture-provider", "acct-a"));
    expect(refs).toContain(expectedUnitRef("fixture-provider", "acct-b"));
    for (const ref of refs) expect(ref).toMatch(/^u_[0-9a-f]{16}$/);
    expect(new Set(refs).size).toBe(refs.length);
  });

  test("labels are aliases and do not merge rows", () => {
    const view = snapshot({
      routes: [
        oneUnitRoute({ unitKey: "fixture-provider/acct-a", displayName: "duplicate" }),
        oneUnitRoute({ unitKey: "fixture-provider/acct-b", displayName: "duplicate" }),
      ],
    });
    const units = view.routes.flatMap((route) => route.channels.flatMap((channel) => channel.units));
    expect(units.length).toBe(2);
    expect(new Set(units.map((unit) => unit.unitRef)).size).toBe(2);
  });

  test("the raw account id, unit key and credential never appear in the snapshot", () => {
    const text = JSON.stringify(snapshot());
    expect(text).not.toContain("acct-a");
    expect(text).not.toContain("acct-b");
    expect(text).not.toContain("unitKey");
    expect(text).not.toContain("accountId");
  });

  test("reasons are sanitized, truncated and emptied into —", () => {
    const view = snapshot({
      routes: [oneUnitRoute({ health: "cooling", reason: HOSTILE_REASONS.join(" ") })],
      healthRows: [
        {
          key: "fixture-provider/acct-a",
          state: "dead",
          until: NOW + 60_000,
          reason: HOSTILE_REASONS.join(" "),
          updatedAt: NOW - 1_000,
        },
      ],
    });
    const unit = view.routes[0].channels[0].units[0];
    expect(unit.reason.length).toBeLessThanOrEqual(120);
    expect(unit.reason).not.toContain("operator@example.com");
    expect(unit.reason).not.toContain("sk-live-");
    expect(unit.reason).not.toMatch(/https?:\/\//);
    const hasControl = [...unit.reason].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
    });
    expect(hasControl).toBe(false);
    // A snapshot carries plain text; the page escapes it on output.
    expect(typeof unit.reason).toBe("string");

    const empty = buildSnapshot({
      ...snapshotInput(),
      routes: [oneUnitRoute({ health: "cooling", reason: "\u0000\u0007" })],
    });
    expect(empty.routes[0].channels[0].units[0].metrics.M23.value).toBe(DASH);
  });

  test("the snapshot module imports no database, DOM, or Node built-in", () => {
    const source = readFileSync(new URL("../lib/router/status-page/snapshot.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:node:|bun:|svelte|framework7|\.\/state-store)/);
    expect(source).not.toMatch(/\b(?:document|navigator|location)\./);
    expect(source).not.toMatch(/\bwindow\./);
    expect(source).not.toMatch(/\bglobalThis\.(?:document|window|navigator)\b/);
  });

  test("one build produces one consistent snapshot at a fixed clock", () => {
    const first = snapshot();
    const second = snapshot();
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.metrics.M03.value).toBe(first.metrics.M03.value);
    expect(NOW_MINUTE).toBe(Math.floor(NOW / 60_000));
  });
});
