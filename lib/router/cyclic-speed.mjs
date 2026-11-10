// Online 24-hour periodic cubic B-spline of log request completion time.
//
// The model is a Gaussian regression on four nonzero periodic cubic basis
// functions. Only exponentially decayed sufficient statistics are kept: one
// 24x24 Gram matrix and one 24-vector per model and worker. A prediction needs
// no request history, and a censored request updates the posterior through a
// truncated-Gaussian conditional expectation.
//
// One worker owns one row per model. A reader decays every row to one instant,
// sums them, and fits the spline. The store is the only shared state; there is
// no JSON file.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const N = 24;
const PRIOR_LOG_MS = Math.log(8_000);
const PRIOR_SD = 1.25;
const MIN_MS = 1;
const MAX_MS = 3_600_000;
const HALF_LIFE_MS = DAY_MS;
const MIN_WEIGHT = 1e-5;

/** Four nonzero cubic periodic basis functions, in fractional UTC-hour units. */
export function periodicBasis(at) {
  const ms = at instanceof Date ? at.getTime() : Number(at);
  const hour = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
  const index = Math.floor(hour);
  const u = hour - index;
  const weights = [
    (1 - u) ** 3 / 6,
    (3 * u ** 3 - 6 * u ** 2 + 4) / 6,
    (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6,
    u ** 3 / 6,
  ];
  return weights.map((value, offset) => [(((index + offset - 1) % N) + N) % N, value]);
}

function zero() {
  return {
    gram: Array.from({ length: N }, () => Array(N).fill(0)),
    rhs: Array(N).fill(0),
    weight: 0,
    completed: 0,
    censored: 0,
    updatedAt: 0,
  };
}

function normalCdf(x) {
  const a = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * a);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return (1 + Math.sign(x) * erf) / 2;
}

function normalPdf(x) {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
}

function solve(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let i = 0; i < N; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < N; j += 1) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-10) return Array(N).fill(PRIOR_LOG_MS);
    const divisor = rows[i][i];
    for (let k = i; k <= N; k += 1) rows[i][k] /= divisor;
    for (let j = 0; j < N; j += 1) {
      if (i === j) continue;
      const factor = rows[j][i];
      for (let k = i; k <= N; k += 1) rows[j][k] -= factor * rows[i][k];
    }
  }
  return rows.map((row) => row[N]);
}

/** Ridge and curvature priors regularize knots that have not been observed. */
function coefficients(stats, ageFactor = 1) {
  const matrix = stats.gram.map((row) => row.map((value) => value * ageFactor));
  const rhs = stats.rhs.map((value) => value * ageFactor);
  const ridge = 0.15;
  const smooth = 0.8;
  for (let i = 0; i < N; i += 1) {
    matrix[i][i] += ridge;
    rhs[i] += ridge * PRIOR_LOG_MS;
    const ids = [(i + N - 1) % N, i, (i + 1) % N];
    const weights = [1, -2, 1];
    for (let a = 0; a < 3; a += 1) {
      for (let b = 0; b < 3; b += 1) matrix[ids[a]][ids[b]] += smooth * weights[a] * weights[b];
    }
  }
  return solve(matrix, rhs);
}

function evaluate(coeff, at) {
  return periodicBasis(at).reduce((sum, [index, basis]) => sum + coeff[index] * basis, 0);
}

function validStats(value) {
  return (
    Array.isArray(value?.gram) &&
    value.gram.length === N &&
    value.gram.every((row) => Array.isArray(row) && row.length === N && row.every(Number.isFinite)) &&
    Array.isArray(value.rhs) &&
    value.rhs.length === N &&
    value.rhs.every(Number.isFinite) &&
    Number.isFinite(value.weight) &&
    Number.isFinite(value.updatedAt)
  );
}

export class CyclicSpeed {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore, now?: () => number,
   *   halfLifeMs?: number, flushIntervalMs?: number, refreshMs?: number}} [options]
   */
  constructor({
    store = null,
    now = Date.now,
    halfLifeMs = HALF_LIFE_MS,
    flushIntervalMs = 5_000,
    refreshMs = 2_000,
  } = {}) {
    this.store = store;
    this.now = now;
    this.halfLifeMs = Math.max(1, halfLifeMs);
    this.flushIntervalMs = Math.max(0, flushIntervalMs);
    this.refreshMs = Math.max(0, refreshMs);
    /** This worker's own statistics. */
    this.models = new Map();
    /** Other workers' statistics, already decayed to the last refresh. */
    this.remote = new Map();
    this.cache = new Map();
    this.mergedCache = new Map();
    this.dirty = new Set();
    this.lastFlush = now();
    this.lastRefresh = 0;
    this.timer = null;
  }

  /** Read other workers and write this worker's rows now. */
  refresh() {
    this.#refreshRemote();
    this.flush();
  }

  /** Start the flush interval. One interval per instance. */
  start(intervalMs = this.flushIntervalMs) {
    if (this.timer !== null || !this.store) return;
    this.timer = setInterval(() => this.flush(), Math.max(1, intervalMs));
    this.timer.unref?.();
  }

  /** Stop the interval and write what is dirty. */
  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /** Write this worker's dirty statistics to the store. */
  flush() {
    if (!this.store) return;
    const now = this.now();
    for (const model of this.dirty) {
      const stats = this.models.get(model);
      if (!stats) continue;
      this.store.upsertSpeed(model, this.store.worker ?? "worker", stats.gram, stats.rhs, stats);
    }
    this.dirty.clear();
    this.lastFlush = now;
  }

  observe(model, sample) {
    if (!model) return;
    const elapsedMs = typeof sample === "number" ? sample : (sample?.elapsedMs ?? sample?.totalMs);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const censored = typeof sample === "object" && sample?.censored === true;
    const at = typeof sample === "object" && Number.isFinite(sample?.at) ? sample.at : this.now();
    const now = this.now();
    const stats = this.state(model);
    this.decay(stats, now);
    const elapsedLog = Math.log(Math.max(MIN_MS, Math.min(MAX_MS, elapsedMs)));
    let value = elapsedLog;
    let information = 1;
    if (censored) {
      const prior = this.predict(model, at);
      const z = (elapsedLog - prior.logMean) / PRIOR_SD;
      const tail = Math.max(1e-10, 1 - normalCdf(z));
      const hazard = normalPdf(z) / tail;
      const safeHazard = z > 6 ? z + 1 / Math.max(1, z) : Math.min(12, hazard);
      value = Math.max(elapsedLog, prior.logMean + PRIOR_SD * safeHazard);
      information = Math.max(0.05, Math.min(1, safeHazard * (safeHazard - z)));
    }
    for (const [i, vi] of periodicBasis(at)) {
      stats.rhs[i] += information * vi * value;
      for (const [j, vj] of periodicBasis(at)) stats.gram[i][j] += information * vi * vj;
    }
    stats.weight += information;
    if (censored) stats.censored += 1;
    else stats.completed += 1;
    this.cache.delete(model);
    this.mergedCache.clear();
    this.dirty.add(model);
    if (this.store) {
      if (this.dirty.size >= 16 || now - this.lastFlush >= this.flushIntervalMs) this.flush();
    }
  }

  /** Expected completion time and rating deviation at one instant. */
  predict(model, at = this.now()) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    if (this.store) this.#maybeRefresh();
    const stats = this.store ? this.#mergedCached(model, this.now()) : this.#merged(model, this.now());
    const ageFactor = 0.5 ** (Math.max(0, ms - stats.updatedAt) / this.halfLifeMs);
    const weight = stats.weight * ageFactor;
    const slot = Math.floor(ms / 300_000);
    let fit = this.cache.get(model);
    if (!fit || fit.slot !== slot) {
      fit = { slot, coeff: coefficients(stats, ageFactor) };
      this.cache.set(model, fit);
    }
    const mean = evaluate(fit.coeff, ms);
    const basis = periodicBasis(ms);
    const localWeight = Math.max(
      0,
      ageFactor *
        basis.reduce(
          (sum, [i, vi]) => sum + basis.reduce((inner, [j, vj]) => inner + vi * stats.gram[i][j] * vj, 0),
          0,
        ),
    );
    return {
      totalMs: Math.min(MAX_MS, Math.max(MIN_MS, Math.exp(mean))),
      rd: Math.max(0.08, PRIOR_SD / Math.sqrt(1 + localWeight / 12)),
      weight,
      localWeight,
      logMean: mean,
    };
  }

  /** Decay one statistics block to `at`. */
  decay(stats, at) {
    const elapsed = Math.max(0, at - stats.updatedAt);
    if (!stats.updatedAt || !elapsed) {
      stats.updatedAt = at;
      return;
    }
    const factor = 0.5 ** (elapsed / this.halfLifeMs);
    for (const row of stats.gram) for (let i = 0; i < N; i += 1) row[i] *= factor;
    for (let i = 0; i < N; i += 1) stats.rhs[i] *= factor;
    stats.weight *= factor;
    stats.completed *= factor;
    stats.censored *= factor;
    stats.updatedAt = at;
  }

  /** The local statistics block of one model, created on first use. */
  state(model) {
    let stats = this.models.get(model);
    if (!stats) {
      stats = zero();
      stats.updatedAt = this.now();
      this.models.set(model, stats);
    }
    return stats;
  }

  /** Per-model predictions for the status page. */
  view(at = this.now()) {
    const models = new Set([...this.models.keys(), ...this.remote.keys()]);
    const rows = {};
    for (const model of models) {
      const stats = this.store ? this.#mergedCached(model, at) : this.#merged(model, at);
      if (stats.weight <= MIN_WEIGHT) continue;
      rows[model] = { ...this.predict(model, at), completed: stats.completed, censored: stats.censored };
    }
    return rows;
  }

  #maybeRefresh() {
    if (this.now() - this.lastRefresh < this.refreshMs) return;
    this.#refreshRemote();
  }

  /** Rebuild other workers' posterior; each row is decayed to now, then summed. */
  #refreshRemote() {
    this.lastRefresh = this.now();
    if (!this.store) return;
    const now = this.now();
    const next = new Map();
    for (const row of this.store.readSpeedRows()) {
      if (row.worker === this.store.worker) continue;
      let gram;
      let rhs;
      try {
        gram = JSON.parse(row.gram);
        rhs = JSON.parse(row.rhs);
      } catch {
        continue;
      }
      if (!validStats({ gram, rhs, weight: row.weight, updatedAt: row.updatedAt })) continue;
      let target = next.get(row.model);
      if (!target) {
        target = zero();
        next.set(row.model, target);
      }
      const factor = 0.5 ** (Math.max(0, now - row.updatedAt) / this.halfLifeMs);
      for (let i = 0; i < N; i += 1) {
        for (let j = 0; j < N; j += 1) target.gram[i][j] += gram[i][j] * factor;
        target.rhs[i] += rhs[i] * factor;
      }
      target.weight += row.weight * factor;
      target.completed += row.completed * factor;
      target.censored += row.censored * factor;
      target.updatedAt = now;
    }
    this.remote = next;
    this.cache.clear();
    this.mergedCache.clear();
  }

  #mergedCached(model, at) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    const second = Math.floor(ms / 1000) * 1000;
    const key = `${model}@${second}`;
    let cached = this.mergedCache.get(key);
    if (!cached) {
      if (this.mergedCache.size > 512) this.mergedCache.clear();
      cached = this.#merged(model, second);
      this.mergedCache.set(key, cached);
    }
    return cached;
  }

  /** This worker plus every other worker, decayed to `at`. */
  #merged(model, at) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    const result = zero();
    for (const source of [this.remote.get(model), this.models.get(model)]) {
      if (!source) continue;
      const factor = 0.5 ** (Math.max(0, ms - source.updatedAt) / this.halfLifeMs);
      for (let i = 0; i < N; i += 1) {
        for (let j = 0; j < N; j += 1) result.gram[i][j] += source.gram[i][j] * factor;
        result.rhs[i] += source.rhs[i] * factor;
      }
      result.weight += source.weight * factor;
      result.completed += source.completed * factor;
      result.censored += source.censored * factor;
    }
    result.updatedAt = ms;
    return result;
  }
}
