// Admission for limited units: keep their few slots for the requests that
// benefit from the unit's prompt cache.
//
// Every request the router evaluates for a limited unit contributes one sample
// x = (longest prefix of the request recorded for that unit) / (request size),
// from 0 (nothing cached there) to just under 1. Over a rolling window
// (five minutes) the unit has seen N requests and can hold maxInFlight at a
// time, so it can afford rate = maxInFlight / N of them. A request is admitted
// only if its x is among the best `rate` share of the window: x at or above
// the (1 − rate) quantile, i.e. not below the maxInFlight-th largest sample.
// Ties at the threshold are admitted. With rate ≥ 1 (few requests) or an empty
// window everyone is admitted. This sits on top of the hard in-flight check.

export const ADMISSION_WINDOW_MS = 300_000;
/** Samples kept per unit; the oldest go first beyond this. */
export const ADMISSION_MAX_SAMPLES = 4_096;

/** One unit's rolling window of cache-benefit samples. */
export class AdmissionWindow {
  /** @param {{windowMs?: number, maxSamples?: number, now?: () => number}} [options] */
  constructor({ windowMs = ADMISSION_WINDOW_MS, maxSamples = ADMISSION_MAX_SAMPLES, now = Date.now } = {}) {
    Object.assign(this, { windowMs, maxSamples, now });
    /** @type {{at: number, x: number}[]} oldest first */
    this.samples = [];
  }

  /** Requests evaluated within the window. */
  get count() {
    this.#prune();
    return this.samples.length;
  }

  /** Add a sample. */
  observe(x) {
    this.samples.push({ at: this.now(), x });
    if (this.samples.length > this.maxSamples) this.samples.splice(0, this.samples.length - this.maxSamples);
  }

  /**
   * The lowest x admitted for a unit with `capacity` slots, or undefined when
   * everyone is admitted (rate ≥ 1 or no samples).
   * @param {number} capacity
   */
  threshold(capacity) {
    this.#prune();
    const n = this.samples.length;
    if (n === 0 || capacity >= n) return undefined;
    const sorted = this.samples.map((sample) => sample.x).sort((a, b) => b - a);
    return sorted[capacity - 1];
  }

  /** True when x is in the better-match `capacity / N` share of the window. */
  admits(x, capacity) {
    const threshold = this.threshold(capacity);
    return threshold === undefined || x >= threshold;
  }

  #prune() {
    const horizon = this.now() - this.windowMs;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].at <= horizon) drop += 1;
    if (drop) this.samples.splice(0, drop);
  }
}

/** Admission windows for every limited unit, keyed by unit key. */
export class AdmissionControl {
  /** @param {{windowMs?: number, maxSamples?: number, now?: () => number}} [options] */
  constructor(options = {}) {
    this.options = options;
    /** @type {Map<string, AdmissionWindow>} */
    this.windows = new Map();
  }

  /**
   * Record this request's sample for the unit and decide whether it may use it.
   * @param {string} unitKey
   * @param {number} x cache-benefit share of the request for this unit
   * @param {number} capacity the unit's maxInFlight (> 0)
   */
  evaluate(unitKey, x, capacity) {
    let window = this.windows.get(unitKey);
    if (!window) {
      window = new AdmissionWindow(this.options);
      this.windows.set(unitKey, window);
    }
    window.observe(x);
    return {
      admitted: window.admits(x, capacity),
      threshold: window.threshold(capacity) ?? null,
      window: window.count,
    };
  }

  /** Requests evaluated for a unit in the current window. */
  windowCount(unitKey) {
    return this.windows.get(unitKey)?.count ?? 0;
  }
}
