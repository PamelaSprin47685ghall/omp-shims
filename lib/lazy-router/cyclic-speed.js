// Online 24-hour periodic cubic B-spline of log request completion time.
// Persist only exponentially decayed Gaussian regression sufficient statistics.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const N = 24;
const PRIOR_LOG_MS = Math.log(8000);
const PRIOR_SD = 1.25;
const MIN_MS = 1;
const MAX_MS = 3_600_000;
const HALF_LIFE_MS = DAY_MS;
const STATE_VERSION = 1;
const MIN_WEIGHT = 1e-5;

/** Four nonzero cubic periodic basis functions, in fractional UTC-hour units. */
export function periodicBasis(at) {
  const ms = at instanceof Date ? at.getTime() : Number(at);
  const hour = ((ms % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS;
  const index = Math.floor(hour);
  const u = hour - index;
  const weights = [
    (1 - u) ** 3 / 6,
    (3 * u ** 3 - 6 * u ** 2 + 4) / 6,
    (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6,
    u ** 3 / 6,
  ];
  return weights.map((value, offset) => [((index + offset - 1) % N + N) % N, value]);
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
  // Abramowitz-Stegun approximation; error below 1e-7.
  const a = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * a);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return (1 + Math.sign(x) * erf) / 2;
}

function normalPdf(x) { return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI); }

function solve(a, b) {
  const matrix = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < N; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < N; j += 1) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    if (Math.abs(matrix[i][i]) < 1e-10) return Array(N).fill(PRIOR_LOG_MS);
    const d = matrix[i][i];
    for (let k = i; k <= N; k += 1) matrix[i][k] /= d;
    for (let j = 0; j < N; j += 1) {
      if (i === j) continue;
      const f = matrix[j][i];
      for (let k = i; k <= N; k += 1) matrix[j][k] -= f * matrix[i][k];
    }
  }
  return matrix.map((row) => row[N]);
}

/** Ridge and curvature priors regularize knots that have not yet been observed. */
function coefficients(stats, ageFactor = 1) {
  const matrix = stats.gram.map((row) => row.map((value) => value * ageFactor));
  const rhs = stats.rhs.map((value) => value * ageFactor);
  const ridge = 0.15;
  const smooth = 0.8;
  for (let i = 0; i < N; i += 1) {
    matrix[i][i] += ridge;
    rhs[i] += ridge * PRIOR_LOG_MS;
    const ids = [(i + N - 1) % N, i, (i + 1) % N];
    const v = [1, -2, 1];
    for (let a = 0; a < 3; a += 1)
      for (let b = 0; b < 3; b += 1) matrix[ids[a]][ids[b]] += smooth * v[a] * v[b];
  }
  return solve(matrix, rhs);
}

function evaluate(coeff, at) {
  return periodicBasis(at).reduce((sum, [index, basis]) => sum + coeff[index] * basis, 0);
}

export class CyclicSpeed {
  constructor({ statePath = null, now = Date.now, halfLifeMs = HALF_LIFE_MS, saveDelayMs = 10000 } = {}) {
    this.statePath = statePath;
    this.now = now;
    this.halfLifeMs = halfLifeMs;
    this.saveDelayMs = saveDelayMs;
    this.models = new Map();
    this.cache = new Map();
    this.timer = null;
    this.load();
  }

  decay(stats, at) {
    const elapsed = Math.max(0, at - stats.updatedAt);
    if (!stats.updatedAt || !elapsed) { stats.updatedAt = at; return; }
    const factor = Math.pow(0.5, elapsed / this.halfLifeMs);
    for (const row of stats.gram) for (let i = 0; i < N; i += 1) row[i] *= factor;
    for (let i = 0; i < N; i += 1) stats.rhs[i] *= factor;
    stats.weight *= factor;
    stats.completed *= factor;
    stats.censored *= factor;
    stats.updatedAt = at;
  }

  state(model) {
    let stats = this.models.get(model);
    if (!stats) { stats = zero(); this.models.set(model, stats); }
    return stats;
  }

  predict(model, at = this.now()) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    const stats = this.state(model);
    // Do not mutate stored evidence on every query; only account for its decay.
    const ageFactor = Math.pow(0.5, Math.max(0, ms - stats.updatedAt) / this.halfLifeMs);
    const weight = stats.weight * ageFactor;
    const slot = Math.floor(ms / 300_000);
    let fit = this.cache.get(model);
    if (!fit || fit.slot !== slot) {
      fit = { slot, coeff: coefficients(stats, ageFactor) };
      this.cache.set(model, fit);
    }
    const mean = evaluate(fit.coeff, ms);
    // Confidence is local on the UTC circle: evidence from 06:00 does not
    // make the model appear certain at 18:00.
    const basis = periodicBasis(ms);
    const localWeight = Math.max(0, ageFactor * basis.reduce((sum, [i, vi]) =>
      sum + basis.reduce((inner, [j, vj]) => inner + vi * stats.gram[i][j] * vj, 0), 0));
    return {
      totalMs: Math.min(MAX_MS, Math.max(MIN_MS, Math.exp(mean))),
      // Local Rating Deviation grows again as that hour's evidence ages.
      rd: Math.max(0.08, PRIOR_SD / Math.sqrt(1 + localWeight / 12)),
      weight,
      localWeight,
      logMean: mean,
    };
  }

  /** Record a completed request or its right-censored lower bound.
   * Censoring updates the posterior via the truncated Gaussian conditional
   * expectation and its Fisher information; it is not treated as a success.
   */
  observe(model, elapsedMs, { at = this.now(), censored = false } = {}) {
    if (!model || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    const now = this.now();
    const timestamp = at instanceof Date ? at.getTime() : Number(at);
    const stats = this.state(model);
    this.decay(stats, now);
    const elapsedLog = Math.log(Math.max(MIN_MS, Math.min(MAX_MS, elapsedMs)));
    let y = elapsedLog;
    let information = 1;
    if (censored) {
      const prior = this.predict(model, timestamp);
      const z = (elapsedLog - prior.logMean) / PRIOR_SD;
      const tail = Math.max(1e-10, 1 - normalCdf(z));
      const hazard = normalPdf(z) / tail;
      // A stable asymptote avoids division by zero in the extreme tail.
      const safeHazard = z > 6 ? z + 1 / Math.max(1, z) : Math.min(12, hazard);
      y = Math.max(elapsedLog, prior.logMean + PRIOR_SD * safeHazard);
      information = Math.max(0.05, Math.min(1, safeHazard * (safeHazard - z)));
    }
    for (const [i, vi] of periodicBasis(timestamp)) {
      stats.rhs[i] += information * vi * y;
      for (const [j, vj] of periodicBasis(timestamp)) stats.gram[i][j] += information * vi * vj;
    }
    stats.weight += information;
    if (censored) stats.censored += 1;
    else stats.completed += 1;
    this.cache.delete(model);
    this.queueSave();
  }

  queueSave() {
    if (!this.statePath || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.saveDelayMs);
    this.timer.unref?.();
  }

  flush() {
    if (!this.statePath) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const state = { version: STATE_VERSION, models: Object.fromEntries(this.models), savedAt: this.now() };
      const temp = this.statePath + ".tmp-" + process.pid;
      writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
      chmodSync(temp, 0o600);
      renameSync(temp, this.statePath);
    } catch {}
  }

  load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (state?.version !== STATE_VERSION) return;
      for (const [model, stats] of Object.entries(state.models ?? {})) {
        if (!Array.isArray(stats.gram) || stats.gram.length !== N || stats.gram.some((row) => !Array.isArray(row) || row.length !== N || row.some((v) => !Number.isFinite(v) || v < -1e12 || v > 1e12))) continue;
        if (!Array.isArray(stats.rhs) || stats.rhs.length !== N || stats.rhs.some((v) => !Number.isFinite(v))) continue;
        if (!Number.isFinite(stats.weight) || stats.weight < 0 || !Number.isFinite(stats.updatedAt) || stats.updatedAt > this.now() + 60_000) continue;
        this.models.set(model, stats);
      }
    } catch {}
  }

  view(at = this.now()) {
    return Object.fromEntries([...this.models].filter(([, row]) => row.weight > MIN_WEIGHT).map(([model, row]) =>
      [model, { ...this.predict(model, at), completed: row.completed, censored: row.censored }]));
  }
}
