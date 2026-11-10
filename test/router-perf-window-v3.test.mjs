// Perf window contract: exactly 30 inclusive buckets, complete-only mean,
// imputed samples kept separate, and one batch read per model set.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inPerfWindow, ModelPerf, PERF_WINDOW_MINUTES, perfWindowBounds } from "../lib/router/perf.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { legacyMixedRow, mixedRows, perfBucket, windowRows } from "./fixtures/perf-buckets.mjs";

const stores = [];
const directories = [];
let now = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_MINUTE = Math.floor(now / 60_000);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), "omp-perf-window-v3-"));
  directories.push(directory);
  const store = new StateStore({ path: join(directory, "state.sqlite"), now: () => now, worker: "fixture:1" });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  now = Date.UTC(2026, 10, 10, 12, 0, 0);
});

function seed(store, rows) {
  for (const row of rows) store.addPerf(row);
}

describe("window bounds", () => {
  test("30 inclusive minutes including the current one", () => {
    expect(PERF_WINDOW_MINUTES).toBe(30);
    expect(perfWindowBounds(NOW_MINUTE)).toEqual({ sinceMinute: NOW_MINUTE - 29, untilMinute: NOW_MINUTE });
    expect(inPerfWindow(NOW_MINUTE - 29, perfWindowBounds(NOW_MINUTE))).toBe(true);
    expect(inPerfWindow(NOW_MINUTE, perfWindowBounds(NOW_MINUTE))).toBe(true);
    expect(inPerfWindow(NOW_MINUTE - 30, perfWindowBounds(NOW_MINUTE))).toBe(false);
    expect(inPerfWindow(NOW_MINUTE + 1, perfWindowBounds(NOW_MINUTE))).toBe(false);
  });

  test("a store read keeps the same bound", () => {
    const store = fileStore();
    seed(store, windowRows(NOW_MINUTE));
    const rows = store.perfWindow("peak", NOW_MINUTE - 29);
    expect(rows.length).toBe(31);
    const bounds = perfWindowBounds(NOW_MINUTE);
    expect(rows.filter((row) => inPerfWindow(Number(row.minute), bounds)).length).toBe(30);
  });
});

describe("complete and imputed samples", () => {
  test("the displayed mean is complete-only", () => {
    const store = fileStore();
    seed(store, mixedRows(NOW_MINUTE));
    const perf = new ModelPerf({ store, now: () => now });
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(2);
    expect(summary.imputedSamples).toBe(3);
    expect(summary.legacyMixedSamples).toBe(0);
    expect(summary.totalMs).toBe(2_000);
    expect(summary.totalSamples).toBe(5);
    expect(summary.totalMsRaw).toBeGreaterThan(summary.totalMs);
  });

  test("a legacy mixed bucket never contributes to the complete mean", () => {
    const store = fileStore();
    seed(store, [legacyMixedRow(NOW_MINUTE)]);
    const perf = new ModelPerf({ store, now: () => now });
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(0);
    expect(summary.legacyMixedSamples).toBe(2);
    expect(summary.totalMs).toBe(null);
    expect(summary.imputedSamples).toBeGreaterThanOrEqual(0);
  });

  test("an imputed-only bucket reports no complete sample and never borrows one", () => {
    const store = fileStore();
    seed(store, [perfBucket({ minute: NOW_MINUTE, completeN: 0, completeMs: 0, imputedN: 4, imputedMs: 4_000 })]);
    const perf = new ModelPerf({ store, now: () => now });
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(0);
    expect(summary.imputedSamples).toBe(4);
    expect(summary.totalMs).toBe(null);
  });

  test("imputed samples do not enter the speed ratio", () => {
    const store = fileStore();
    seed(store, [
      perfBucket({
        minute: NOW_MINUTE,
        completeN: 0,
        completeMs: 0,
        imputedN: 2,
        imputedMs: 4_000,
        speedTokens: 1_000,
        generationMs: 2_000,
        speedN: 2,
      }),
    ]);
    const perf = new ModelPerf({ store, now: () => now });
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(0);
    expect(summary.totalMs).toBe(null);
  });
});

describe("batch read", () => {
  test("one store read serves every requested model", () => {
    const store = fileStore();
    const models = Array.from({ length: 20 }, (_, index) => `provider/model-${index}`);
    for (const model of models) seed(store, windowRows(NOW_MINUTE, model));
    let reads = 0;
    const original = store.perfWindow.bind(store);
    store.perfWindow = (...args) => {
      reads += 1;
      return original(...args);
    };
    const perf = new ModelPerf({ store, now: () => now });
    const summaries = perf.summaries(models, "peak");
    expect(reads).toBe(1);
    expect(Object.keys(summaries).sort()).toEqual([...models].sort());
    expect(summaries[models[0]].completeSamples).toBe(30);
  });

  test("the single-model summary uses the same batch path", () => {
    const store = fileStore();
    seed(store, windowRows(NOW_MINUTE));
    const perf = new ModelPerf({ store, now: () => now });
    expect(perf.summary("provider/model", "peak")).toEqual(
      perf.summaries(["provider/model"], "peak")["provider/model"],
    );
  });

  test("rows outside the window never leak into the summary", () => {
    const store = fileStore();
    seed(store, windowRows(NOW_MINUTE));
    const perf = new ModelPerf({ store, now: () => now });
    const summary = perf.summary("provider/model", "peak");
    // 30 samples of 1000..1029 ms; the 9999 ms and 8888 ms rows are outside.
    expect(summary.completeSamples).toBe(30);
    expect(summary.totalMs).toBe(1_015);
  });
});

describe("stream observation", () => {
  function sseResponse(body) {
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }

  test("a clean stream counts as a complete sample", async () => {
    const perf = new ModelPerf({ now: () => now });
    const response = sseResponse('data: {"delta":{"content":"hi"},"completion_tokens":4}\n\ndata: [DONE]\n\n');
    const tapped = perf.wrapStream(response, { model: "provider/model", period: "peak", startedAt: now });
    await new Response(tapped.body).text();
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(1);
    expect(summary.imputedSamples).toBe(0);
  });

  test("a cancelled stream is censored, not complete", async () => {
    const perf = new ModelPerf({ now: () => now + 2_000 });
    const response = sseResponse('data: {"delta":{"content":"hi"},"completion_tokens":4}\n\n');
    const tapped = perf.wrapStream(response, { model: "provider/model", period: "peak", startedAt: now });
    const reader = tapped.body.getReader();
    await reader.read();
    await reader.cancel("client gone");
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(0);
    expect(summary.imputedSamples).toBe(1);
  });

  test("an aborted signal is censored and records no speed", async () => {
    const controller = new AbortController();
    const perf = new ModelPerf({ now: () => now + 1_000 });
    const response = sseResponse('data: {"delta":{"content":"hi"},"completion_tokens":50}\n\n');
    const tapped = perf.wrapStream(response, {
      model: "provider/model",
      period: "peak",
      startedAt: now,
      signal: controller.signal,
    });
    const reader = tapped.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel("aborted");
    const summary = perf.summary("provider/model", "peak");
    expect(summary.completeSamples).toBe(0);
    expect(summary.imputedSamples).toBe(1);
    expect(summary.tokensPerSecond).toBe(null);
  });
});
