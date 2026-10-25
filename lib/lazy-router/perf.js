// Rolling per-model serving performance: first-token latency and generation speed.
//
// Three numbers decide whether a model is pleasant to work with, and all are
// properties of the model, not of the route that picked it: how long the first
// token takes, how fast the rest arrives, and how long the whole answer takes. The router measures both on every
// streamed answer (see router.js) and keeps them here in one-minute buckets over
// a rolling window, so a slow hour does not follow a model forever and a model
// that was just fixed recovers within the window.
//
// Aggregation is by sums, not by averages of averages: the window's speed is
// total tokens over total generation time, so one long answer weighs what it
// should. Latency and speed need a streamed answer that carried a token count
// in the provider's usage frame and actually took time to generate; the total
// duration counts every measured answer, streamed or delivered whole.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SseScanner } from "./sse.js";

/** Tail retained for a non-SSE JSON response so its final usage object can be read without buffering the body. */
const JSON_TAIL_CHARS = 256 * 1024;

/** Length of the rolling window, in minutes. */
export const PERF_WINDOW_MINUTES = 30;

/** Persistent-state schema and the deliberately slow, weak historical memory. */
export const PERF_STATE_VERSION = 1;
export const PERF_HISTORY_HALF_LIFE_MS = 24 * 60 * 60 * 1000;
export const PERF_HISTORY_WEIGHT_CAP = 8;
const PERF_HISTORY_MIN_WEIGHT = 0.05;

/** Diffuse log-time prior used only when the whole rolling window is empty. */
const CENSORED_PRIOR_LOG_SD = 1.25;
const CENSORED_PRIOR_WEIGHT = 2;

/** Shortest generation time that makes a speed meaningful (a whole answer in one chunk has none). */
const MIN_GENERATION_MS = 250;

/** "usage" — the byte sequence every provider's usage frame carries. */
const USAGE_BYTES = [0x75, 0x73, 0x61, 0x67, 0x65];

/** Output-token and hidden-reasoning counters used by the supported provider dialects. */
const OUTPUT_TOKEN_KEYS = new Set([
  "completion_tokens", "output_tokens", "completionTokens", "outputTokens",
  "candidatesTokenCount", "candidates_token_count",
]);
const REASONING_TOKEN_KEYS = new Set([
  "reasoning_tokens", "reasoningTokens", "thoughtsTokenCount", "thoughts_token_count",
]);
const TOKEN_PATTERNS = [
  /"completion_tokens"\s*:\s*(\d+)/g, /"output_tokens"\s*:\s*(\d+)/g,
  /"completionTokens"\s*:\s*(\d+)/g, /"outputTokens"\s*:\s*(\d+)/g,
  /"candidatesTokenCount"\s*:\s*(\d+)/g, /"candidates_token_count"\s*:\s*(\d+)/g,
];
const REASONING_PATTERNS = [
  /"reasoning_tokens"\s*:\s*(\d+)/g, /"reasoningTokens"\s*:\s*(\d+)/g,
  /"thoughtsTokenCount"\s*:\s*(\d+)/g, /"thoughts_token_count"\s*:\s*(\d+)/g,
];

/**
 * True when `chunk` may contain a usage frame. A byte scan, so a stream that
 * carries no usage costs no decoding.
 * @param {Uint8Array} chunk
 */
export function mayCarryUsage(chunk) {
  if (!(chunk instanceof Uint8Array) || chunk.length < USAGE_BYTES.length) return false;
  const limit = chunk.length - USAGE_BYTES.length;
  for (let i = 0; i <= limit; i += 1) {
    if (chunk[i] !== USAGE_BYTES[0]) continue;
    let matched = true;
    for (let j = 1; j < USAGE_BYTES.length; j += 1) {
      if (chunk[i + j] !== USAGE_BYTES[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** Highest finite non-negative value, preserving undefined when neither side exists. */
function maxDefined(left, right) {
  if (!Number.isFinite(right) || right < 0) return left;
  return left === undefined ? right : Math.max(left, right);
}

/** Merge cumulative usage observations from successive frames. */
function mergeUsage(left = {}, right = {}) {
  return {
    outputTokens: maxDefined(left.outputTokens, right.outputTokens),
    reasoningTokens: maxDefined(left.reasoningTokens, right.reasoningTokens),
  };
}

/** Read known token counters from a parsed provider event/response. */
export function tokenUsageIn(value) {
  const usage = {};
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    for (const [key, child] of Object.entries(node)) {
      if (OUTPUT_TOKEN_KEYS.has(key) && Number.isFinite(Number(child))) {
        usage.outputTokens = maxDefined(usage.outputTokens, Number(child));
      } else if (REASONING_TOKEN_KEYS.has(key) && Number.isFinite(Number(child))) {
        usage.reasoningTokens = maxDefined(usage.reasoningTokens, Number(child));
      }
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return usage;
}

/** Read usage from JSON text; regex is only a fallback for truncated/raw provider text. */
export function tokenUsageInText(text) {
  if (typeof text !== "string" || text.length === 0) return {};
  try { return tokenUsageIn(JSON.parse(text)); } catch {}
  let outputTokens;
  let reasoningTokens;
  for (const pattern of TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) outputTokens = maxDefined(outputTokens, Number(match[1]));
  }
  for (const pattern of REASONING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) reasoningTokens = maxDefined(reasoningTokens, Number(match[1]));
  }
  return { outputTokens, reasoningTokens };
}

/** The output-token total in text, retained as the public helper used by tests. */
export function outputTokensIn(text) { return tokenUsageInText(text).outputTokens; }

/** One minute's sums for one model. */
function emptyBucket(minute) {
  return {
    minute,
    ttftMs: 0, ttftCount: 0,
    outputTokens: 0, tokenCount: 0,
    speedTokens: 0, generationMs: 0, speedCount: 0,
    totalMs: 0, totalCount: 0, totalLog: 0, totalLogSq: 0, imputedCount: 0,
  };
}

/**
 * Per-model rolling window of first-token latency and generation speed.
 * Periods are independent regimes: peak evidence never updates off-peak and vice versa.
 */
export class ModelPerf {
  /**
   * @param {{minutes?: number, now?: () => number, statePath?: string|null,
   *   historyHalfLifeMs?: number, historyWeightCap?: number}} [options]
   */
  constructor({
    minutes = PERF_WINDOW_MINUTES,
    now = Date.now,
    statePath = null,
    historyHalfLifeMs = PERF_HISTORY_HALF_LIFE_MS,
    historyWeightCap = PERF_HISTORY_WEIGHT_CAP,
  } = {}) {
    this.minutes = minutes;
    this.now = now;
    this.statePath = statePath;
    this.historyHalfLifeMs = Math.max(1, historyHalfLifeMs);
    this.historyWeightCap = Math.max(1, historyWeightCap);
    /** @type {Map<string, Map<string, ReturnType<typeof emptyBucket>[]>>} period → model → minute buckets */
    this.periods = new Map();
    /** @type {Map<string, Map<string, {meanLog: number, weight: number, updatedAt: number}>>} */
    this.history = new Map();
    this.#load();
  }

  #models(period, create = false) {
    let models = this.periods.get(period);
    if (!models && create) {
      models = new Map();
      this.periods.set(period, models);
    }
    return models;
  }

  #historyModels(period, create = false) {
    let models = this.history.get(period);
    if (!models && create) {
      models = new Map();
      this.history.set(period, models);
    }
    return models;
  }

  #decayedHistory(entry, at = this.now()) {
    if (!entry || !Number.isFinite(entry.meanLog) || !Number.isFinite(entry.weight) || entry.weight <= 0) return undefined;
    const age = Math.max(0, at - (Number.isFinite(entry.updatedAt) ? entry.updatedAt : at));
    const weight = entry.weight * Math.exp(-Math.LN2 * age / this.historyHalfLifeMs);
    if (weight < PERF_HISTORY_MIN_WEIGHT) return undefined;
    return { meanLog: entry.meanLog, weight, updatedAt: at };
  }

  #recordHistory(model, totalMs, period) {
    if (!Number.isFinite(totalMs) || totalMs < 0) return;
    const at = this.now();
    const models = this.#historyModels(period, true);
    const previous = this.#decayedHistory(models.get(model), at);
    const oldWeight = Math.min(previous?.weight ?? 0, Math.max(0, this.historyWeightCap - 1));
    const combinedWeight = oldWeight + 1;
    const meanLog = ((previous?.meanLog ?? 0) * oldWeight + Math.log(Math.max(1, totalMs))) / combinedWeight;
    models.set(model, {
      meanLog,
      weight: Math.min(this.historyWeightCap, combinedWeight),
      updatedAt: at,
    });
  }

  #load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (state?.version !== PERF_STATE_VERSION) return;
      const now = this.now();
      const minute = Math.floor(now / 60_000);
      for (const [period, models] of Object.entries(state.periods ?? {})) {
        if (!models || typeof models !== "object") continue;
        for (const [model, savedBuckets] of Object.entries(models)) {
          if (!Array.isArray(savedBuckets)) continue;
          const buckets = this.#buckets(model, period);
          for (const saved of savedBuckets) {
            const savedMinute = Number(saved?.minute);
            if (!Number.isInteger(savedMinute) || savedMinute > minute || minute - savedMinute >= this.minutes) continue;
            const bucket = buckets[((savedMinute % this.minutes) + this.minutes) % this.minutes];
            Object.assign(bucket, emptyBucket(savedMinute));
            for (const key of ["ttftMs", "ttftCount", "outputTokens", "tokenCount", "speedTokens", "generationMs", "speedCount", "totalMs", "totalCount", "totalLog", "totalLogSq", "imputedCount"]) {
              const value = Number(saved?.[key]);
              if (Number.isFinite(value) && value >= 0) bucket[key] = value;
            }
          }
        }
      }
      for (const [period, models] of Object.entries(state.history ?? {})) {
        if (!models || typeof models !== "object") continue;
        const target = this.#historyModels(period, true);
        for (const [model, saved] of Object.entries(models)) {
          const entry = this.#decayedHistory({
            meanLog: Number(saved?.meanLog),
            weight: Number(saved?.weight),
            updatedAt: Number(saved?.updatedAt),
          }, now);
          if (entry) target.set(model, entry);
        }
        if (target.size === 0) this.history.delete(period);
      }
      this.#prune(minute);
    } catch {}
  }

  #persist() {
    if (!this.statePath) return;
    try {
      const minute = Math.floor(this.now() / 60_000);
      const periods = {};
      for (const [period, models] of this.periods) {
        const savedModels = {};
        for (const [model, buckets] of models) {
          const saved = buckets.filter((bucket) => bucket.minute <= minute && minute - bucket.minute < this.minutes && (bucket.totalCount > 0 || bucket.ttftCount > 0));
          if (saved.length > 0) savedModels[model] = saved;
        }
        if (Object.keys(savedModels).length > 0) periods[period] = savedModels;
      }
      const history = {};
      for (const [period, models] of this.history) {
        const savedModels = {};
        for (const [model, raw] of models) {
          const entry = this.#decayedHistory(raw);
          if (!entry) continue;
          savedModels[model] = entry;
        }
        if (Object.keys(savedModels).length > 0) history[period] = savedModels;
      }
      mkdirSync(dirname(this.statePath), { recursive: true });
      const temp = this.statePath + ".tmp-" + process.pid;
      writeFileSync(temp, JSON.stringify({ version: PERF_STATE_VERSION, savedAt: this.now(), minutes: this.minutes, periods, history }));
      chmodSync(temp, 0o600);
      renameSync(temp, this.statePath);
    } catch {}
  }

  #buckets(model, period) {
    const models = this.#models(period, true);
    let buckets = models.get(model);
    if (!buckets) {
      buckets = Array.from({ length: this.minutes }, (_, index) => emptyBucket(-1 - index));
      models.set(model, buckets);
    }
    return buckets;
  }

  #bucket(model, minute, period) {
    const buckets = this.#buckets(model, period);
    const bucket = buckets[((minute % this.minutes) + this.minutes) % this.minutes];
    if (bucket.minute !== minute) {
      bucket.minute = minute;
      bucket.ttftMs = 0;
      bucket.ttftCount = 0;
      bucket.outputTokens = 0;
      bucket.tokenCount = 0;
      bucket.speedTokens = 0;
      bucket.generationMs = 0;
      bucket.speedCount = 0;
      bucket.totalMs = 0;
      bucket.totalCount = 0;
      bucket.totalLog = 0;
      bucket.totalLogSq = 0;
      bucket.imputedCount = 0;
    }
    return bucket;
  }

  /**
   * Record one streamed answer.
   *
   * @param {string} model provider-qualified model id
   * @param {{ttftMs?: number, outputTokens?: number, generationMs?: number, totalMs?: number}} sample
   *   ttftMs: request start to the first token, absent for an answer that was
   *   not streamed; generationMs: first token to last, which a single-chunk
   *   answer leaves at zero; totalMs: request start to the end of the answer.
   */
  record(model, { ttftMs, outputTokens, speedTokens = outputTokens, generationMs, totalMs, imputed = false }, period = "default") {
    if (!model) return;
    const minute = Math.floor(this.now() / 60_000);
    const bucket = this.#bucket(model, minute, period);
    if (Number.isFinite(ttftMs) && ttftMs >= 0) {
      bucket.ttftMs += ttftMs;
      bucket.ttftCount += 1;
    }
    // Token totals are useful even for a one-chunk answer whose generation speed is not measurable.
    if (Number.isFinite(outputTokens) && outputTokens >= 0) {
      bucket.outputTokens += outputTokens;
      bucket.tokenCount += 1;
    }
    if (Number.isFinite(speedTokens) && speedTokens > 0 && Number.isFinite(generationMs) && generationMs >= MIN_GENERATION_MS) {
      bucket.speedTokens += speedTokens;
      bucket.generationMs += generationMs;
      bucket.speedCount += 1;
    }
    if (Number.isFinite(totalMs) && totalMs >= 0) {
      bucket.totalMs += totalMs;
      bucket.totalCount += 1;
      const log = Math.log(Math.max(1, totalMs));
      bucket.totalLog += log;
      bucket.totalLogSq += log * log;
      if (imputed) bucket.imputedCount += 1;
      else this.#recordHistory(model, totalMs, period);
    }
    if (bucket.ttftCount === 0 && bucket.totalCount === 0) this.#forget(model, period);
    this.#prune(minute);
    if (bucket.ttftCount > 0 || bucket.totalCount > 0) this.#persist();
  }

  /** Expected completion time for a right-censored request: E[T | T > elapsed].
   * The prior is empirical: other models in the same rolling window first, then
   * this model's own history. With no completed request anywhere, elapsed time
   * itself is the center of a deliberately broad prior; there is no fixed "normal" latency.
   */
  estimateCompletion(model, elapsedMs, period = "default") {
    const minute = Math.floor(this.now() / 60_000);
    const live = (buckets) => buckets.filter((bucket) => minute - bucket.minute < this.minutes && bucket.minute <= minute);
    const models = this.#models(period) ?? new Map();
    const own = live(models.get(model) ?? []);
    let n = 0;
    let sum = 0;
    let sumSq = 0;
    for (const bucket of own) {
      n += bucket.totalCount;
      sum += bucket.totalLog;
      sumSq += bucket.totalLogSq;
    }

    let populationN = 0;
    let populationSum = 0;
    let populationSumSq = 0;
    for (const [other, buckets] of models) {
      if (other === model) continue;
      for (const bucket of live(buckets)) {
        populationN += bucket.totalCount;
        populationSum += bucket.totalLog;
        populationSumSq += bucket.totalLogSq;
      }
    }

    const elapsed = Math.max(1, elapsedMs);
    const fallbackMu = Math.log(elapsed);
    const ownMu = n > 0 ? sum / n : fallbackMu;
    const priorMu = populationN > 0 ? populationSum / populationN : ownMu;
    let priorVariance = CENSORED_PRIOR_LOG_SD ** 2;
    if (populationN > 1) priorVariance = Math.max(0.25, populationSumSq / populationN - priorMu * priorMu);
    else if (n > 1) priorVariance = Math.max(0.25, sumSq / n - ownMu * ownMu);

    const weight = CENSORED_PRIOR_WEIGHT + n;
    const mu = (CENSORED_PRIOR_WEIGHT * priorMu + sum) / weight;
    const priorSecond = priorMu * priorMu + priorVariance;
    const second = (CENSORED_PRIOR_WEIGHT * priorSecond + sumSq) / weight;
    const sigma2 = Math.min(4, Math.max(0.09, second - mu * mu));
    const sigma = Math.sqrt(sigma2);
    const z0 = (Math.log(elapsed) - mu) / sigma;
    const z1 = (Math.log(elapsed) - mu - sigma2) / sigma;
    const tail0 = Math.max(1e-9, 1 - normalCdf(z0));
    const tail1 = Math.max(1e-9, 1 - normalCdf(z1));
    const estimate = Math.exp(mu + sigma2 / 2) * (tail1 / tail0);
    return Math.max(elapsed, Math.min(estimate, elapsed + 10 * Math.exp(mu + sigma2 / 2)));
  }

  /** Drop a model whose only sample had nothing to record. */
  #forget(model, period) {
    const models = this.#models(period);
    if (!models) return;
    models.delete(model);
    if (models.size === 0) this.periods.delete(period);
  }

  /** Drop models/periods whose every bucket has fallen out of the exact rolling window. */
  #prune(minute) {
    for (const [period, models] of this.periods) {
      for (const [model, buckets] of models) {
        if (buckets.every((bucket) => minute - bucket.minute >= this.minutes)) models.delete(model);
      }
      if (models.size === 0) this.periods.delete(period);
    }
  }

  /**
   * The window's view, per model. Absent models have no samples; a model with
   * samples but no token counts reports latency only.
   * @returns {Record<string, {ttftMs: number|null, tokensPerSecond: number|null, totalMs: number|null,
   *   samples: number, tokens: number}>}
   */
  view(period = "default") {
    const minute = Math.floor(this.now() / 60_000);
    const out = {};
    const models = this.#models(period) ?? new Map();
    for (const [model, buckets] of models) {
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
        if (minute - bucket.minute >= this.minutes || bucket.minute > minute) continue;
        ttftMs += bucket.ttftMs;
        ttftCount += bucket.ttftCount;
        outputTokens += bucket.outputTokens;
        tokenCount += bucket.tokenCount;
        speedTokens += bucket.speedTokens;
        generationMs += bucket.generationMs;
        speedCount += bucket.speedCount;
        totalMs += bucket.totalMs;
        samples += bucket.totalCount;
        imputedSamples += bucket.imputedCount;
      }
      if (samples === 0 && ttftCount === 0) continue;
      const sampleCount = Math.max(samples, ttftCount);
      out[model] = {
        ttftMs: ttftCount > 0 ? Math.round(ttftMs / ttftCount) : null,
        tokensPerSecond: generationMs > 0 ? (speedTokens / generationMs) * 1000 : null,
        totalMs: samples > 0 ? Math.round(totalMs / samples) : null,
        samples: sampleCount,
        ttftSamples: ttftCount,
        tokenSamples: tokenCount,
        speedSamples: speedCount,
        imputedSamples,
        tokens: tokenCount > 0 ? outputTokens : null,
      };
    }
    return out;
  }

  /** Decayed historical latency only; never shown as current-window evidence. */
  historyView(period = "default") {
    const out = {};
    const models = this.#historyModels(period) ?? new Map();
    for (const [model, raw] of models) {
      const entry = this.#decayedHistory(raw);
      if (!entry) continue;
      out[model] = {
        totalMs: Math.round(Math.exp(entry.meanLog)),
        weight: entry.weight,
        strength: Math.min(1, entry.weight),
      };
    }
    return out;
  }

  /**
   * Routing evidence: current 30-minute data wins completely. Only models with
   * no current total-latency sample receive the decayed historical weak prior.
   */
  routingView(period = "default") {
    const live = this.view(period);
    const out = { ...live };
    for (const [model, historical] of Object.entries(this.historyView(period))) {
      if (Number.isFinite(live[model]?.totalMs) && live[model].totalMs > 0) continue;
      out[model] = {
        ...(live[model] ?? { samples: 0 }),
        totalMs: historical.totalMs,
        historical: true,
        historicalStrength: historical.strength,
      };
    }
    return out;
  }
}

/** Standard normal CDF; sufficient for routing-time censored completion estimates. */
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * a);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return 0.5 * (1 + sign * erf);
}

/**
 * Wrap a provider answer so latency, token usage and generation speed are measured
 * without buffering or re-encoding the response. SSE usage is read structurally
 * from complete events; non-SSE JSON keeps only a bounded tail for its usage object.
 *
 * @param {{model: string, startedAt: number, perf: ModelPerf, classify?: (event: object) => string,
 *   isOutput?: (event: object) => boolean, signal?: AbortSignal, now?: () => number}} options
 * @returns {(response: Response) => Response} identity only for a bodyless answer.
 */
export function measureStream({ model, startedAt, perf, period = "default", classify, isOutput, signal, now = Date.now }) {
  return (response) => {
    const body = response.body;
    if (!body) return response;
    const streaming = (response.headers.get("content-type") ?? "").includes("text/event-stream");

    let firstAt;
    let lastAt;
    let usage = {};
    let plainTail = "";
    let recorded = false;
    const decoder = new TextDecoder();
    const scanner = streaming ? new SseScanner() : undefined;

    const usageOfEvent = (event) =>
      typeof event?.data === "string" ? tokenUsageInText(event.data) : tokenUsageIn(event?.data);

    const eventIsOutput = (event) => {
      if (typeof isOutput === "function") return Boolean(isOutput(event));
      const eventUsage = usageOfEvent(event);
      if (typeof classify !== "function") return eventUsage.outputTokens === undefined;
      // The liveness classifier deliberately treats a usage-only final frame as progress.
      // It is not a first/last generated token for latency metrics.
      return classify(event) === "progress" && eventUsage.outputTokens === undefined;
    };

    const observeEvents = (events, at) => {
      let output = false;
      for (const event of events) {
        usage = mergeUsage(usage, usageOfEvent(event));
        if (eventIsOutput(event)) output = true;
      }
      if (output) {
        if (firstAt === undefined) firstAt = at;
        lastAt = at;
      }
    };

    const appendPlain = (text) => {
      if (!text) return;
      plainTail = (plainTail + text).slice(-JSON_TAIL_CHARS);
    };

    const record = (totalMs, imputed = false) => {
      if (recorded) return;
      recorded = true;
      const completedMs =
        imputed && typeof perf.estimateCompletion === "function" ? perf.estimateCompletion(model, totalMs, period) : totalMs;
      const outputTokens = usage.outputTokens;
      // Provider completion/output totals include hidden reasoning on APIs that bill/report it.
      // Count those tokens in throughput exactly as reported; reasoningTokens stays diagnostic only.
      const speedTokens = outputTokens;
      perf.record(model, {
        totalMs: completedMs,
        ...(imputed ? { imputed: true } : {}),
        ...(Number.isFinite(outputTokens) ? { outputTokens, speedTokens } : {}),
        ...(firstAt === undefined ? {} : { ttftMs: firstAt - startedAt, generationMs: (lastAt ?? firstAt) - firstAt }),
      }, period);
    };

    const onAbort = () => record(Math.max(0, now() - startedAt), true);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const measured = body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const at = now();
          const text = decoder.decode(chunk, { stream: true });
          if (streaming) observeEvents(scanner.push(text), at);
          else appendPlain(text);
          controller.enqueue(chunk);
        },
        flush() {
          signal?.removeEventListener("abort", onAbort);
          const at = now();
          const finalText = decoder.decode();
          if (streaming) {
            if (finalText) observeEvents(scanner.push(finalText), at);
            // SSE permits EOF immediately after the last data block. Finalize any pending block.
            observeEvents(scanner.push("\n\n"), at);
          } else {
            appendPlain(finalText);
            usage = mergeUsage(usage, tokenUsageInText(plainTail));
          }
          record(at - startedAt, false);
        },
      }),
    );

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(measured, { status: response.status, statusText: response.statusText, headers });
  };
}
