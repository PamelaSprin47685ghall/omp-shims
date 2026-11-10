// Synthetic perf rows for the 30-bucket window and imputed separation tests.

/** One minute bucket. `complete` values stay separate from imputed values. */
export function perfBucket({
  model = "provider/model",
  period = "peak",
  minute,
  completeN = 1,
  completeMs = 1_000,
  imputedN = 0,
  imputedMs = 0,
  legacyMixed = 0,
  ttftMs = 100,
  ttftN = 1,
  speedTokens = 100,
  generationMs = 500,
  speedN = 1,
} = {}) {
  const totalCount = Math.max(0, completeN) + Math.max(0, imputedN);
  const totalMs = completeMs * Math.max(0, completeN) + imputedMs * Math.max(0, imputedN);
  return {
    model,
    period,
    minute,
    ttftMs,
    ttftCount: ttftN,
    outputTokens: speedTokens,
    tokenN: speedN,
    speedTokens,
    generationMs,
    speedN,
    totalMs,
    totalCount,
    totalLog: totalMs > 0 ? Math.log(totalMs) * totalCount : 0,
    totalLogSq: totalMs > 0 ? Math.log(totalMs) ** 2 * totalCount : 0,
    imputedMs: imputedMs * Math.max(0, imputedN),
    imputedCount: imputedN,
    completeMs: completeMs * Math.max(0, completeN),
    completeN,
    completeLog: completeMs > 0 ? Math.log(completeMs) * completeN : 0,
    completeLogSq: completeMs > 0 ? Math.log(completeMs) ** 2 * completeN : 0,
    legacyMixed,
    updatedAt: minute * 60_000,
  };
}

/**
 * Exactly 30 in-window buckets (minute-29..minute) plus one older and one
 * future bucket that every reader must exclude.
 */
export function windowRows(nowMinute, model = "provider/model") {
  const rows = [];
  for (let distance = 29; distance >= 0; distance -= 1) {
    rows.push(
      perfBucket({
        model,
        minute: nowMinute - distance,
        completeN: 1,
        completeMs: 1_000 + distance,
      }),
    );
  }
  rows.push(perfBucket({ model, minute: nowMinute - 30, completeN: 9, completeMs: 9_999 }));
  rows.push(perfBucket({ model, minute: nowMinute + 1, completeN: 9, completeMs: 8_888 }));
  return rows;
}

/** A complete-only mean of 2 s from two samples, plus three imputed samples. */
export function mixedRows(nowMinute, model = "provider/model") {
  return [perfBucket({ model, minute: nowMinute, completeN: 2, completeMs: 2_000, imputedN: 3, imputedMs: 9_000 })];
}

/** A bucket that cannot be split after migration: complete_n stays 0. */
export function legacyMixedRow(nowMinute, model = "provider/model") {
  return perfBucket({
    model,
    minute: nowMinute,
    completeN: 0,
    completeMs: 0,
    imputedN: 2,
    imputedMs: 4_000,
    legacyMixed: 1,
  });
}

/** Four workers, one stale, for M03/M04 aggregation. */
export function workerRows(now, { staleAfterMs = 5_000 } = {}) {
  return [
    {
      worker: "fixture-a:101",
      host: "fixture-a",
      pid: 101,
      build_version: "sha256-aaaaaaaaaaaa",
      view_schema: 3,
      in_flight: 3,
      catalog_ready: 1,
      epoch: "epoch_current",
      updated_at: now - 1_000,
    },
    {
      worker: "fixture-b:202",
      host: "fixture-b",
      pid: 202,
      build_version: "sha256-aaaaaaaaaaaa",
      view_schema: 3,
      in_flight: 2,
      catalog_ready: 1,
      epoch: "epoch_current",
      updated_at: now - 2_000,
    },
    {
      worker: "fixture-c:303",
      host: "fixture-c",
      pid: 303,
      build_version: "sha256-aaaaaaaaaaaa",
      view_schema: 3,
      in_flight: 1,
      catalog_ready: 0,
      epoch: "epoch_current",
      updated_at: now - 4_000,
    },
    {
      worker: "fixture-d:404",
      host: "fixture-d",
      pid: 404,
      build_version: "sha256-bbbbbbbbbbbb",
      view_schema: 3,
      in_flight: 9,
      catalog_ready: 1,
      epoch: "epoch_old",
      updated_at: now - staleAfterMs - 3_000,
    },
  ];
}
