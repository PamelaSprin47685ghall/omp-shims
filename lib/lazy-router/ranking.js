// Glicko-like online routing with Thompson sampling over rating deviation.
// Intelligence supplies a two-level prior. Observed total latency shifts rating only
// relative to the current empirical population; unseen models start latency-neutral.
// Prefix affinity is deliberately nonlinear: long warm prefixes suppress exploration
// because switching makes both the cost and the latency sample unrepresentative.

export const INTELLIGENCE = Object.freeze({ MEDIUM: "medium", EXCELLENT: "excellent" });

export const ROUTING_DEFAULTS = Object.freeze({
  excellentPrior: 0.60,
  mediumPrior: 0.0,
  latencyWeight: 1.0,
  rdInitial: 1.0,
  rdFloor: 0.10,
  rdSampleScale: 12,
  affinityWeight: 0.50,
  affinityLengthScaleBytes: 8192,
  affinityCoveragePower: 2.0,
  affinityLengthPower: 2.0,
  affinityTemperatureWeight: 1.0,
  temperature: 0.60,
});

function median(values) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function populationLatencyMs(perf) {
  return median(
    Object.values(perf ?? {})
      .map((sample) => sample?.totalMs)
      .filter((ms) => Number.isFinite(ms) && ms > 0),
  );
}

/**
 * Strength of a warm-prefix reason to stay on one unit.
 *
 * Affinity records half of the previous canonical transcript, so a normal
 * continuation's cachedShare naturally sits near 0.5. 2*share therefore maps
 * an ordinary strong continuation back to coverage ~= 1. Absolute prefix size
 * then grows the penalty convexly: a 1 KiB match is cheap to abandon, while a
 * 32+ KiB warm prefix is expensive enough that exploration should almost stop.
 */
export function affinityStickiness(cachedShare, cachedBytes, settings = {}) {
  const cfg = { ...ROUTING_DEFAULTS, ...settings };
  const share = Number.isFinite(cachedShare) ? Math.max(0, Math.min(1, cachedShare)) : 0;
  const bytes = Number.isFinite(cachedBytes) ? Math.max(0, cachedBytes) : 0;
  if (share === 0 || bytes === 0) return { share, bytes, coverage: 0, stickiness: 0 };
  const coverage = Math.min(1, 2 * share);
  const scale = Math.max(1, cfg.affinityLengthScaleBytes);
  const lengthTerm = Math.log1p(bytes / scale);
  const stickiness =
    Math.pow(coverage, cfg.affinityCoveragePower) * Math.pow(lengthTerm, cfg.affinityLengthPower);
  return { share, bytes, coverage, stickiness };
}

export function routingRating(candidate, sample, cachedShare, settings = {}, referenceMs, cachedBytes = 0) {
  const cfg = { ...ROUTING_DEFAULTS, ...settings };
  const prior = candidate.intelligence === INTELLIGENCE.EXCELLENT ? cfg.excellentPrior : cfg.mediumPrior;
  const latencyMs = Number.isFinite(sample?.totalMs) && sample.totalMs > 0 ? sample.totalMs : null;
  const samples = Number.isFinite(sample?.samples) ? sample.samples : 0;
  const rd = Math.max(cfg.rdFloor, cfg.rdInitial / Math.sqrt(1 + samples / cfg.rdSampleScale));
  const latencyRating =
    latencyMs !== null && Number.isFinite(referenceMs) && referenceMs > 0
      ? -cfg.latencyWeight * Math.log(latencyMs / referenceMs)
      : 0;
  const rating = prior + latencyRating;
  const affinity = affinityStickiness(cachedShare, cachedBytes, cfg);
  const score = rating + cfg.affinityWeight * affinity.stickiness;
  return {
    score,
    rating,
    rd,
    prior,
    latencyRating,
    latencyMs,
    samples,
    affinity: affinity.share,
    affinityBytes: affinity.bytes,
    affinityCoverage: affinity.coverage,
    affinityStickiness: affinity.stickiness,
    referenceMs: referenceMs ?? null,
  };
}

function normal(random) {
  const u1 = Math.max(1e-12, random());
  const u2 = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function rankCandidates(
  candidates,
  {
    perf = {},
    cachedShare = () => 0,
    cachedBytes = () => 0,
    affinityAvailable = () => true,
    settings = {},
    random = Math.random,
  } = {},
) {
  const cfg = { ...ROUTING_DEFAULTS, ...settings };
  const referenceMs = populationLatencyMs(perf);
  const base = candidates.map((candidate, index) => ({
    candidate,
    index,
    routing: routingRating(
      candidate,
      perf[candidate.model],
      cachedShare(candidate),
      cfg,
      referenceMs,
      cachedBytes(candidate),
    ),
  }));

  // One strongly warm, currently usable unit makes this whole request a poor
  // exploration sample. Suppress Thompson variance globally rather than only
  // on the warm unit; otherwise a cold candidate could still win by lottery.
  const lockStickiness = base.reduce(
    (max, row) => affinityAvailable(row.candidate) ? Math.max(max, row.routing.affinityStickiness) : max,
    0,
  );
  const effectiveTemperature = cfg.temperature * Math.exp(-cfg.affinityTemperatureWeight * lockStickiness);

  const drawByModel = new Map();
  return base
    .map(({ candidate, index, routing }) => {
      let posteriorDraw = 0;
      if (effectiveTemperature > 0) {
        if (!drawByModel.has(candidate.model)) drawByModel.set(candidate.model, normal(random));
        posteriorDraw = drawByModel.get(candidate.model);
      }
      return {
        candidate,
        index,
        routing: {
          ...routing,
          temperature: cfg.temperature,
          effectiveTemperature,
          affinityLockStickiness: lockStickiness,
          posteriorDraw,
          selectionScore: routing.score + effectiveTemperature * routing.rd * posteriorDraw,
        },
      };
    })
    .sort((a, b) => b.routing.selectionScore - a.routing.selectionScore || a.index - b.index);
}
