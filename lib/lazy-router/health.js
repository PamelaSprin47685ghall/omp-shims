// Per-(unit, model) health with a background recovery loop.
//
// Health is keyed by unit AND model, not unit alone: Antigravity meters quota
// per model family (gemini-4 can be exhausted while gemini-3.8-flash still
// works on the same account), and the same account can serve two routes with
// different models. Scoping to the pair never benches a working combination;
// the price is at most one extra probe per extra model of a unit.
//
// A dead entry is probed on a fixed interval until a probe succeeds, then it is
// alive again and, being earlier in the route list, wins traffic back.

/** Health states. */
export const HEALTH = Object.freeze({ ALIVE: "alive", COOLING: "cooling" });

/** The registry key for a unit serving a model. */
export function healthKey(unitLabel, model) {
  return `${unitLabel} ${model}`;
}

export class HealthRegistry {
  /**
   * @param {{probeIntervalMs: number, prober?: (subject: any, key: string) => Promise<boolean>,
   *   onEvent?: (event: string, detail: object) => void, now?: () => number,
   *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (timer: any) => void}} options
   */
  constructor({ probeIntervalMs, prober, onEvent = () => {}, now = Date.now, setTimer, clearTimer }) {
    this.probeIntervalMs = probeIntervalMs;
    this.prober = prober;
    this.onEvent = onEvent;
    this.now = now;
    this.setTimer = setTimer ?? defaultSetTimer;
    this.clearTimer = clearTimer ?? clearTimeout;
    /** @type {Map<string, {state: string, since: number, reason?: string, subject?: any, nextProbeAt?: number, probes: number, timer?: any}>} */
    this.entries = new Map();
  }

  /** Install the function that checks one key; called by the router once it can dispatch. */
  setProber(prober) {
    this.prober = prober;
  }

  isAlive(key) {
    return this.entries.get(key)?.state !== HEALTH.COOLING;
  }

  /**
   * Bench a key and start probing it every interval. Idempotent while already cooling.
   * @param {string} key
   * @param {string} reason
   * @param {any} subject handed back to the prober (the router passes the candidate)
   */
  markDead(key, reason, subject) {
    const current = this.entries.get(key);
    if (current?.state === HEALTH.COOLING) return;
    const entry = { state: HEALTH.COOLING, since: this.now(), reason, subject, probes: 0 };
    this.entries.set(key, entry);
    this.onEvent("cooldown-enter", { key, reason, probeInMs: this.probeIntervalMs });
    this.#schedule(key, entry);
  }

  /** Return a key to service and stop its probe loop. */
  markAlive(key, cause = "probe") {
    const current = this.entries.get(key);
    if (current?.state !== HEALTH.COOLING) return;
    if (current.timer !== undefined) this.clearTimer(current.timer);
    this.entries.set(key, { state: HEALTH.ALIVE, since: this.now(), probes: 0 });
    this.onEvent("cooldown-exit", { key, cause, cooledMs: this.now() - current.since });
  }

  /** Stop every timer (tests and shutdown). */
  dispose() {
    for (const entry of this.entries.values()) if (entry.timer !== undefined) this.clearTimer(entry.timer);
  }

  /** Plain-data view for the status endpoint. */
  snapshot() {
    const view = {};
    for (const [key, entry] of this.entries) {
      view[key] = {
        state: entry.state,
        since: new Date(entry.since).toISOString(),
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nextProbeAt ? { nextProbeAt: new Date(entry.nextProbeAt).toISOString(), probes: entry.probes } : {}),
      };
    }
    return view;
  }

  #schedule(key, entry) {
    entry.nextProbeAt = this.now() + this.probeIntervalMs;
    entry.timer = this.setTimer(() => this.#probe(key, entry), this.probeIntervalMs);
  }

  async #probe(key, entry) {
    if (this.entries.get(key) !== entry) return; // superseded
    entry.probes += 1;
    let alive = false;
    try {
      alive = this.prober ? await this.prober(entry.subject, key) : false;
    } catch {
      alive = false;
    }
    if (this.entries.get(key) !== entry) return;
    this.onEvent("background-probe", { key, alive, attempt: entry.probes });
    if (alive) this.markAlive(key, "background-probe");
    else this.#schedule(key, entry);
  }
}

/** setTimeout that never keeps the process alive on its own. */
function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}
