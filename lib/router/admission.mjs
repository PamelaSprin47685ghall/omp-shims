// Admission for limited units: keep their few slots for requests that reuse
// the unit's prompt cache.
//
// Each request contributes one sample x, the longest matching prefix divided
// by the request size. A unit with `limit` slots and `n` requests in the
// rolling window can admit the best `limit / n` share. A request is admitted
// when its x is at or above the `limit`-th largest sample. Ties pass.
//
// The store holds one shared window across workers. Without a store, one
// bounded in-process window keeps the same rule. A storage failure admits
// (fails open) instead of blocking traffic.

export const ADMISSION_WINDOW_MS = 300_000;
export const ADMISSION_MAX_SAMPLES = 4_096;

export class AdmissionControl {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore,
   *   windowMs?: number, now?: () => number, maxSamples?: number}} [options]
   */
  constructor({
    store = null,
    windowMs = ADMISSION_WINDOW_MS,
    now = Date.now,
    maxSamples = ADMISSION_MAX_SAMPLES,
  } = {}) {
    this.store = store;
    this.windowMs = Math.max(1, windowMs);
    this.now = now;
    this.maxSamples = Math.max(1, maxSamples);
    /** unit -> samples, used only when no store exists */
    this.windows = new Map();
  }

  /** Record one cache-benefit sample, 0..1. */
  record(unitKey, share) {
    const value = Number(share);
    if (!Number.isFinite(value)) return;
    const at = this.now();
    if (this.store) {
      this.store.recordAdmission(unitKey, value, at);
      return;
    }
    const samples = this.#local(unitKey, at);
    samples.push({ at, share: Math.min(1, Math.max(0, value)) });
    if (samples.length > this.maxSamples) samples.splice(0, samples.length - this.maxSamples);
  }

  /**
   * True when the request may use the unit.
   * @param {string} unitKey
   * @param {number} share cache-benefit share of this request, 0..1
   * @param {number} limit the unit's maxInFlight; 0 or undefined means unlimited
   * @param {number} [windowCount] samples in the window, when the caller knows it
   */
  admits(unitKey, share, limit, windowCount) {
    const capacity = Number(limit);
    if (!Number.isFinite(capacity) || capacity <= 0) return true;
    const value = Number.isFinite(share) ? share : 0;
    const count = Number.isFinite(windowCount) ? windowCount : this.windowCount(unitKey);
    if (count <= capacity) return true;
    const threshold = this.threshold(unitKey, capacity);
    return threshold === undefined || value >= threshold;
  }

  /** The `capacity`-th largest sample in the window, or undefined. */
  threshold(unitKey, capacity) {
    const rank = Math.floor(capacity);
    if (!Number.isFinite(rank) || rank <= 0) return undefined;
    if (this.store) return this.store.admissionThreshold(unitKey, this.now() - this.windowMs, rank);
    const samples = this.#local(unitKey, this.now());
    if (samples.length <= rank) return undefined;
    const sorted = samples.map((sample) => sample.share).sort((a, b) => b - a);
    return sorted[rank - 1];
  }

  /** Samples inside the current window. */
  windowCount(unitKey) {
    if (this.store) return this.store.admissionCount(unitKey, this.now() - this.windowMs);
    return this.#local(unitKey, this.now()).length;
  }

  #local(unitKey, at) {
    let samples = this.windows.get(unitKey);
    if (!samples) {
      samples = [];
      this.windows.set(unitKey, samples);
    }
    const horizon = at - this.windowMs;
    let drop = 0;
    while (drop < samples.length && samples[drop].at <= horizon) drop += 1;
    if (drop > 0) samples.splice(0, drop);
    return samples;
  }
}
