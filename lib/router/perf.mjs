// Rolling per-model serving performance.
//
// Three numbers describe how pleasant a model is to use: time to first token,
// generation speed and total duration. All three belong to the model, not to
// the route that picked it. The router records them in one-minute buckets over
// a rolling window, so a slow hour does not follow a model forever.
//
// Aggregation uses sums, not averages of averages: window speed is total tokens
// over total generation time. A streamed answer must carry a token count and
// take real time to generate; total duration counts every answer.

import { rebuildResponse, streamingHeaders } from "../sse.mjs";

export const PERF_WINDOW_MINUTES = 30;
const MIN_GENERATION_MS = 250;
const JSON_TAIL_CHARS = 4_096;

const OUTPUT_PATTERNS = [
  /"completion_tokens"\s*:\s*(\d+)/g,
  /"output_tokens"\s*:\s*(\d+)/g,
  /"completionTokens"\s*:\s*(\d+)/g,
  /"outputTokens"\s*:\s*(\d+)/g,
  /"candidatesTokenCount"\s*:\s*(\d+)/g,
  /"candidates_token_count"\s*:\s*(\d+)/g,
];

const BUCKET_KEYS = Object.freeze([
  "ttftMs",
  "ttftCount",
  "outputTokens",
  "tokenCount",
  "speedTokens",
  "generationMs",
  "speedCount",
  "totalMs",
  "totalCount",
  "totalLog",
  "totalLogSq",
  "imputedCount",
]);

function emptyBucket(minute) {
  return {
    minute,
    ttftMs: 0,
    ttftCount: 0,
    outputTokens: 0,
    tokenCount: 0,
    speedTokens: 0,
    generationMs: 0,
    speedCount: 0,
    totalMs: 0,
    totalCount: 0,
    totalLog: 0,
    totalLogSq: 0,
    imputedCount: 0,
  };
}

/** Highest token count in one text fragment. */
function outputTokensIn(text) {
  let best;
  for (const pattern of OUTPUT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && (best === undefined || value > best)) best = value;
    }
  }
  return best;
}

function isOutputChunk(text, streaming) {
  if (!text || text.trim() === "") return false;
  if (!streaming) return true;
  if (text.includes('"content"') || text.includes('"text"') || text.includes('"delta"')) return true;
  const frames = text.split("\n");
  return frames.some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("data:") && !trimmed.slice(5).trim().startsWith("[DONE]");
  });
}

export class ModelPerf {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore, now?: () => number,
   *   minutes?: number}} [options]
   */
  constructor({ store = null, now = Date.now, minutes = PERF_WINDOW_MINUTES } = {}) {
    this.store = store;
    this.now = now;
    this.minutes = Math.max(1, minutes);
    /** period -> model -> buckets, used only when no store exists */
    this.periods = new Map();
  }

  /**
   * Record one answer.
   *
   * @param {{model?: string, period?: string, candidate?: {model?: string}}|string} attempt
   * @param {{ttftMs?: number, outputTokens?: number, generationMs?: number,
   *   totalMs?: number, speedTokens?: number, imputed?: boolean}} sample
   */
  observe(attempt, sample = {}) {
    const model = typeof attempt === "string" ? attempt : (attempt?.model ?? attempt?.candidate?.model);
    if (!model) return;
    const period = (typeof attempt === "object" && attempt?.period) || sample.period || "default";
    const minute = Math.floor(this.now() / 60_000);
    const delta = this.#delta(sample, minute);
    if (this.store) {
      this.store.addPerf({ ...delta, model, period, minute });
      return;
    }
    const bucket = this.#bucket(model, period, minute);
    for (const key of BUCKET_KEYS) bucket[key] += delta[key];
    this.#pruneLocal(minute);
  }

  /**
   * The window's view of one model, or undefined when it has no samples.
   * @returns {{ttftMs: number|null, tokensPerSecond: number|null, totalMs: number|null,
   *   samples: number, ttftSamples: number, tokenSamples: number, speedSamples: number,
   *   imputedSamples: number, tokens: number|null}|undefined}
   */
  summary(model, period = "default") {
    const minute = Math.floor(this.now() / 60_000);
    if (this.store) {
      const buckets = this.store.perfWindow(period, minute - this.minutes).filter((row) => row.model === model);
      return this.#aggregate(buckets);
    }
    const models = this.periods.get(period);
    const buckets = models?.get(model);
    if (!buckets) return undefined;
    return this.#aggregate(
      [...buckets.values()].filter((bucket) => minute - bucket.minute < this.minutes && bucket.minute <= minute),
    );
  }

  /**
   * Measure one response or byte stream without buffering the body. Returns a
   * Response when given one, otherwise a ReadableStream.
   *
   * `ctx`: {model, period?, startedAt?, signal?, isOutput?(text)}.
   * Optional `onObservation(sample)` sees each completed observation.
   */
  wrapStream(stream, ctx = {}) {
    const response = typeof Response !== "undefined" && stream instanceof Response ? stream : null;
    const body = response ? response.body : stream;
    if (!body || typeof body.getReader !== "function") return stream;
    const model = ctx.model;
    if (!model) return stream;

    const clock = typeof ctx.now === "function" ? ctx.now : this.now;
    const startedAt = Number.isFinite(ctx.startedAt) ? ctx.startedAt : clock();
    const streaming = response
      ? (response.headers.get("content-type") ?? "").includes("text/event-stream")
      : Boolean(ctx.streaming ?? true);
    const decoder = new TextDecoder();
    const reader = body.getReader();
    const isOutput = typeof ctx.isOutput === "function" ? ctx.isOutput : (text) => isOutputChunk(text, streaming);
    let tail = "";
    let tokens;
    let firstAt;
    let lastAt;
    let observed = false;
    const onAbort = () => finish(true);

    const absorb = (text, at) => {
      if (!text) return;
      tail = (tail + text).slice(-JSON_TAIL_CHARS);
      const count = outputTokensIn(tail);
      if (count !== undefined) tokens = count;
      if (isOutput(text)) {
        if (firstAt === undefined) firstAt = at;
        lastAt = at;
      }
    };

    const finish = (imputed) => {
      if (observed) return;
      observed = true;
      ctx.signal?.removeEventListener?.("abort", onAbort);
      const at = clock();
      const totalMs = Math.max(0, at - startedAt);
      const sample = {
        totalMs,
        ...(imputed ? { imputed: true } : {}),
        ...(Number.isFinite(tokens) ? { outputTokens: tokens, speedTokens: tokens } : {}),
        ...(firstAt === undefined ? {} : { ttftMs: Math.max(0, firstAt - startedAt) }),
        ...(firstAt === undefined || lastAt === undefined ? {} : { generationMs: Math.max(0, lastAt - firstAt) }),
      };
      try {
        this.observe(
          { model, period: ctx.period ?? "default" },
          {
            ...sample,
            ...(sample.generationMs !== undefined && sample.generationMs >= MIN_GENERATION_MS
              ? {}
              : { speedTokens: undefined }),
          },
        );
        ctx.onObservation?.(sample);
      } catch {
        // Measurement must never fail the response.
      }
    };

    if (ctx.signal) {
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener("abort", onAbort, { once: true });
    }

    const measured = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            const rest = decoder.decode();
            absorb(rest, clock());
            finish(false);
            controller.close();
            return;
          }
          if (value && value.byteLength > 0) {
            const text = decoder.decode(value, { stream: true });
            absorb(text, clock());
          }
          controller.enqueue(value);
        } catch (error) {
          finish(true);
          controller.error(error);
        }
      },
      cancel(reason) {
        finish(true);
        return reader.cancel(reason);
      },
    });

    if (!response) return measured;
    return rebuildResponse(response, measured, {
      headers: streaming ? streamingHeaders(response.headers) : response.headers,
    });
  }

  #delta(sample, minute) {
    const delta = emptyBucket(minute);
    if (Number.isFinite(sample.ttftMs) && sample.ttftMs >= 0) {
      delta.ttftMs = sample.ttftMs;
      delta.ttftCount = 1;
    }
    if (Number.isFinite(sample.outputTokens) && sample.outputTokens >= 0) {
      delta.outputTokens = sample.outputTokens;
      delta.tokenCount = 1;
    }
    const speedTokens = Number.isFinite(sample.speedTokens) ? sample.speedTokens : sample.outputTokens;
    if (
      Number.isFinite(speedTokens) &&
      speedTokens > 0 &&
      Number.isFinite(sample.generationMs) &&
      sample.generationMs >= MIN_GENERATION_MS
    ) {
      delta.speedTokens = speedTokens;
      delta.generationMs = sample.generationMs;
      delta.speedCount = 1;
    }
    if (Number.isFinite(sample.totalMs) && sample.totalMs >= 0) {
      delta.totalMs = sample.totalMs;
      delta.totalCount = 1;
      const log = Math.log(Math.max(1, sample.totalMs));
      delta.totalLog = log;
      delta.totalLogSq = log * log;
      if (sample.imputed) delta.imputedCount = 1;
    }
    return delta;
  }

  #aggregate(buckets) {
    if (!buckets || buckets.length === 0) return undefined;
    let ttftMs = 0;
    let ttftCount = 0;
    let outputTokens = 0;
    let tokenCount = 0;
    let speedTokens = 0;
    let generationMs = 0;
    let speedCount = 0;
    let totalMs = 0;
    let samples = 0;
    let imputedSamples = 0;
    for (const bucket of buckets) {
      ttftMs += Number(bucket.ttftMs) || 0;
      ttftCount += Number(bucket.ttftCount) || 0;
      outputTokens += Number(bucket.outputTokens) || 0;
      tokenCount += Number(bucket.tokenCount) || 0;
      speedTokens += Number(bucket.speedTokens) || 0;
      generationMs += Number(bucket.generationMs) || 0;
      speedCount += Number(bucket.speedCount) || 0;
      totalMs += Number(bucket.totalMs) || 0;
      samples += Number(bucket.totalCount) || 0;
      imputedSamples += Number(bucket.imputedCount) || 0;
    }
    if (samples === 0 && ttftCount === 0) return undefined;
    return {
      ttftMs: ttftCount > 0 ? Math.round(ttftMs / ttftCount) : null,
      tokensPerSecond: generationMs > 0 ? (speedTokens / generationMs) * 1_000 : null,
      totalMs: samples > 0 ? Math.round(totalMs / samples) : null,
      samples: Math.max(samples, ttftCount),
      ttftSamples: ttftCount,
      tokenSamples: tokenCount,
      speedSamples: speedCount,
      imputedSamples,
      tokens: tokenCount > 0 ? outputTokens : null,
    };
  }

  #bucket(model, period, minute) {
    let models = this.periods.get(period);
    if (!models) {
      models = new Map();
      this.periods.set(period, models);
    }
    let buckets = models.get(model);
    if (!buckets) {
      buckets = new Map();
      models.set(model, buckets);
    }
    let bucket = buckets.get(minute);
    if (!bucket) {
      bucket = emptyBucket(minute);
      buckets.set(minute, bucket);
    }
    return bucket;
  }

  #pruneLocal(minute) {
    for (const [period, models] of this.periods) {
      for (const [model, buckets] of models) {
        for (const [key, bucket] of buckets) if (minute - bucket.minute >= this.minutes) buckets.delete(key);
        if (buckets.size === 0) models.delete(model);
      }
      if (models.size === 0) this.periods.delete(period);
    }
  }
}
