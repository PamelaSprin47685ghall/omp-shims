// One ranking score for the `rating` graph node.
//
// A candidate's score has four parts: an intelligence prior, a relative cost
// penalty, a measured-latency penalty, and a prefix-affinity bonus. A Thompson
// draw adds exploration. The score is pure: the same candidate, evidence and
// random stream always produce the same number.
//
// Every weight is policy, not state. The defaults live in presets/ranking.json;
// callers pass the measured latency, the affinity share, and any override.
// This module never reads a store.

import rankingPolicy from "../../presets/ranking.json" with { type: "json" };

export const ROUTING_DEFAULTS = Object.freeze({ ...rankingPolicy.routing });

/** The median of the finite values, or undefined for an empty list. */
export function median(values) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return undefined;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

/** A deterministic 32-bit PRNG (mulberry32). */
export function seededRandom(seed = 1) {
  let state = Number.isFinite(seed) ? seed >>> 0 : 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One standard normal draw from a uniform random source. */
export function normal(random = Math.random) {
  const u1 = Math.max(1e-12, random());
  const u2 = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Strength of a warm-prefix reason to stay on one unit.
 *
 * The router records half of the previous transcript, so a normal continuation
 * has a cached share near 0.5. Doubling the share maps it to coverage 1. The
 * prefix byte count then grows the penalty: abandoning 32 KiB of cache costs
 * far more than abandoning 1 KiB.
 *
 * @param {number} share cached share of the request, 0..1
 * @param {number} bytes matched prefix bytes
 * @returns {{share: number, bytes: number, coverage: number, stickiness: number}}
 */
export function affinityStickiness(share, bytes, settings = {}) {
  const cfg = { ...ROUTING_DEFAULTS, ...settings };
  const coverageShare = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  const size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (coverageShare === 0 || size === 0) {
    return { share: coverageShare, bytes: size, coverage: 0, stickiness: 0 };
  }
  const coverage = Math.min(1, 2 * coverageShare);
  const lengthTerm = Math.log1p(size / Math.max(1, cfg.affinityLengthScaleBytes));
  const stickiness = coverage ** cfg.affinityCoveragePower * lengthTerm ** cfg.affinityLengthPower;
  return { share: coverageShare, bytes: size, coverage, stickiness };
}

/** Read a latency sample from a number or a summary object. */
function sampleOf(perf) {
  if (Number.isFinite(perf)) return { totalMs: perf, samples: 1 };
  if (perf && typeof perf === "object") return perf;
  return undefined;
}

/**
 * Score one candidate.
 *
 * @param {{intelligence?: number, cost?: number, model?: string}} candidate
 * @param {{perf?: number|object, affinity?: number|{share?: number, bytes?: number},
 *   referenceMs?: number|null, referenceCost?: number, lockStickiness?: number,
 *   temperature?: number, random?: () => number, settings?: object}} [options]
 * @returns {{score: number, selectionScore: number, rating: number, prior: number,
 *   costRating: number, latencyRating: number, rd: number, draw: number,
 *   effectiveTemperature: number, affinityStickiness: number, latencyMs: number|null,
 *   samples: number, intelligence: number, cost: number}}
 */
export function scoreCandidate(candidate, options = {}) {
  const cfg = { ...ROUTING_DEFAULTS, ...(options.settings ?? {}) };
  const sample = sampleOf(options.perf);
  const intelligence = Number.isFinite(candidate?.intelligence) ? candidate.intelligence : cfg.intelligenceCenter;
  const cost = Number.isFinite(candidate?.cost) && candidate.cost > 0 ? candidate.cost : 1;
  const referenceCost = Number.isFinite(options.referenceCost) && options.referenceCost > 0 ? options.referenceCost : 1;

  const prior = cfg.intelligenceSlope * (intelligence - cfg.intelligenceCenter);
  const costRating = -cfg.costWeight * Math.log(cost / referenceCost);
  const latencyMs = Number.isFinite(sample?.totalMs) && sample.totalMs > 0 ? sample.totalMs : null;
  const referenceMs = Number.isFinite(options.referenceMs) && options.referenceMs > 0 ? options.referenceMs : null;
  const historical = sample?.historical === true;
  const strength = historical
    ? Math.max(0, Math.min(1, Number.isFinite(sample?.historicalStrength) ? sample.historicalStrength : 1))
    : 1;
  const latencyRating =
    latencyMs !== null && referenceMs !== null
      ? -cfg.latencyWeight *
        (historical ? cfg.historicalLatencyWeight * strength : 1) *
        Math.log(latencyMs / referenceMs)
      : 0;

  const samples = Number.isFinite(sample?.samples) ? Math.max(0, sample.samples) : 0;
  const rd = Math.max(cfg.rdFloor, cfg.rdInitial / Math.sqrt(1 + samples / cfg.rdSampleScale));

  const affinityInput = options.affinity;
  const affinity =
    affinityInput && typeof affinityInput === "object"
      ? affinityStickiness(affinityInput.share, affinityInput.bytes, cfg).stickiness
      : Number.isFinite(affinityInput)
        ? Math.max(0, affinityInput)
        : 0;

  const rating = prior + latencyRating + costRating + cfg.affinityWeight * affinity;
  const temperature = Number.isFinite(options.temperature) ? Math.max(0, options.temperature) : cfg.temperature;
  const lock = Number.isFinite(options.lockStickiness) ? Math.max(0, options.lockStickiness) : 0;
  const effectiveTemperature = temperature * Math.exp(-cfg.affinityTemperatureWeight * lock);
  const draw = effectiveTemperature > 0 ? normal(options.random ?? Math.random) : 0;

  return {
    score: rating,
    selectionScore: rating + effectiveTemperature * rd * draw,
    rating,
    prior,
    costRating,
    latencyRating,
    rd,
    draw,
    effectiveTemperature,
    affinityStickiness: affinity,
    latencyMs,
    samples,
    intelligence,
    cost,
  };
}

/**
 * Score and sort candidates from best to worst. Ties keep declaration order.
 * A caller that needs deterministic exploration must pass a fresh
 * `random: seededRandom(seed)`.
 */
export function rankCandidates(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const latencies = list
    .map((candidate) => sampleOf(options.perfOf?.(candidate) ?? options.perf?.[candidate.model]))
    .map((sample) => sample?.totalMs);
  const referenceMs = options.referenceMs ?? median(latencies);
  const referenceCost =
    options.referenceCost ?? median(list.map((candidate) => candidate?.cost).filter((cost) => Number.isFinite(cost)));
  const lockStickiness =
    options.lockStickiness ??
    Math.max(
      0,
      ...list.map((candidate) => {
        const value = options.affinityOf?.(candidate) ?? options.affinity?.[candidate.unitKey] ?? 0;
        return typeof value === "number"
          ? value
          : affinityStickiness(value?.share, value?.bytes, options.settings).stickiness;
      }),
    );
  return list
    .map((candidate, index) => ({
      candidate,
      index,
      routing: scoreCandidate(candidate, {
        ...options,
        perf: options.perfOf?.(candidate) ?? options.perf?.[candidate.model],
        affinity: options.affinityOf?.(candidate) ?? options.affinity?.[candidate.unitKey],
        referenceMs,
        referenceCost,
        lockStickiness,
      }),
    }))
    .sort((a, b) => b.routing.selectionScore - a.routing.selectionScore || a.index - b.index);
}
