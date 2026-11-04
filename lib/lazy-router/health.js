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
//
// Several gateway workers share one store (health-store.js): state changes are
// written through, each worker mirrors the rows it has not seen yet, and a
// probe is only sent by the worker that wins the row's lease. Reads stay
// in-process, so the routing path never touches SQLite.

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
   *   describe?: (key: string, subject: any) => string,
   *   setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (timer: any) => void,
   *   store?: {loadAll: () => any[], changedSince: (ms: number) => any[], write: (record: object) => void,
   *     claimProbe: (key: string, untilMs: number, nowMs: number) => boolean, pruneStale?: (nowMs: number) => void},
   *   resolve?: (key: string) => any,
   *   refreshMs?: number, probeLeaseMs?: number}} options
   */
  constructor({
    probeIntervalMs,
    prober,
    onEvent = () => {},
    now = Date.now,
    describe = (key) => key,
    setTimer,
    clearTimer,
    store = null,
    resolve = null,
    refreshMs = 1_000,
    probeLeaseMs = 180_000,
  }) {
    // Keys may be internal; `describe` is what events and snapshots show instead.
    this.describe = describe;
    this.probeIntervalMs = probeIntervalMs;
    this.prober = prober;
    this.onEvent = onEvent;
    this.now = now;
    this.setTimer = setTimer ?? defaultSetTimer;
    this.clearTimer = clearTimer ?? clearTimeout;
    this.store = store?.enabled ? store : null;
    this.resolve = resolve;
    this.refreshMs = refreshMs;
    this.probeLeaseMs = probeLeaseMs;
    this.lastRefreshAt = 0;
    this.refreshTimer = null;
    /** @type {Map<string, {state: string, since: number, reason?: string, subject?: any, nextProbeAt?: number, probes: number, timer?: any}>} */
    this.entries = new Map();

    if (this.store) {
      this.#hydrate();
      this.refreshTimer = setInterval(() => this.#refresh(), refreshMs);
      this.refreshTimer.unref?.();
    }
  }

  /** Install the function that checks one key; called by the router once it can dispatch. */
  setProber(prober) {
    this.prober = prober;
  }

  /** Install the key → candidate resolver used for entries learned from another worker. */
  setResolver(resolve) {
    this.resolve = resolve;
  }

  /** Re-read rows written by other workers (the same pass the timer runs). */
  refresh() {
    if (this.store) this.#refresh();
  }

  /** The raw entry for a key, if it has ever been benched. */
  entry(key) {
    return this.entries.get(key);
  }

  isAlive(key) {
    return this.entries.get(key)?.state !== HEALTH.COOLING;
  }

  /**
   * Bench a key and start probing it every interval. Idempotent while already cooling.
   * @param {string} key
   * @param {string} reason
   * @param {any} subject handed back to the prober (the router passes the candidate)
   * @param {{probeIntervalMs?: number, probeBackoff?: number, maxProbeIntervalMs?: number}} options
   */
  markDead(key, reason, subject, options = {}) {
    const current = this.entries.get(key);
    if (current?.state === HEALTH.COOLING) return;
    const probeIntervalMs = options.probeIntervalMs ?? this.probeIntervalMs;
    const maxProbeIntervalMs = options.maxProbeIntervalMs ?? probeIntervalMs;
    const probeBackoff = options.probeBackoff ?? 1;
    const entry = {
      state: HEALTH.COOLING,
      since: this.now(),
      reason,
      subject,
      probes: 0,
      probeIntervalMs,
      maxProbeIntervalMs,
      probeBackoff,
    };
    this.entries.set(key, entry);
    this.onEvent("cooldown-enter", { key: this.describe(key, subject), reason, probeInMs: probeIntervalMs });
    this.#schedule(key, entry, probeIntervalMs);
    this.#write(key, entry);
  }

  /** Return a key to service and stop its probe loop. */
  markAlive(key, cause = "probe") {
    const current = this.entries.get(key);
    if (current?.state !== HEALTH.COOLING) return;
    if (current.timer !== undefined) this.clearTimer(current.timer);
    this.entries.set(key, { state: HEALTH.ALIVE, since: this.now(), probes: 0 });
    this.onEvent("cooldown-exit", {
      key: this.describe(key, current.subject),
      cause,
      cooledMs: this.now() - current.since,
    });
    this.store?.write({ key, state: HEALTH.ALIVE, since: this.now(), updatedAt: this.now() });
  }

  /** Stop every timer (tests and shutdown). */
  dispose() {
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    for (const entry of this.entries.values()) if (entry.timer !== undefined) this.clearTimer(entry.timer);
  }

  /** Plain-data view for the status endpoint. */
  snapshot() {
    const view = {};
    for (const [key, entry] of this.entries) {
      view[this.describe(key, entry.subject)] = {
        state: entry.state,
        since: new Date(entry.since).toISOString(),
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.nextProbeAt ? { nextProbeAt: new Date(entry.nextProbeAt).toISOString(), probes: entry.probes } : {}),
      };
    }
    return view;
  }

  /** Write one entry to the shared store; scheduling details included. */
  #write(key, entry) {
    if (!this.store) return;
    this.store.write({
      key,
      state: entry.state,
      since: entry.since,
      reason: entry.reason ?? null,
      nextProbeAt: entry.nextProbeAt ?? null,
      probes: entry.probes ?? 0,
      probeIntervalMs: entry.probeIntervalMs ?? null,
      maxProbeIntervalMs: entry.maxProbeIntervalMs ?? null,
      probeBackoff: entry.probeBackoff ?? null,
      updatedAt: this.now(),
    });
  }

  #hydrate() {
    this.lastRefreshAt = this.now();
    for (const row of this.store.loadAll()) this.#applyRow(row, { silent: true });
  }

  #refresh() {
    const now = this.now();
    // Overlap the window: two writes in the same millisecond must not be lost.
    const since = Math.max(0, this.lastRefreshAt - 2_000);
    this.lastRefreshAt = now;
    for (const row of this.store.changedSince(since)) this.#applyRow(row);
    this.store.pruneStale?.(now);
  }

  /** Apply a row written by any worker, without echoing it back. */
  #applyRow(row, { silent = false } = {}) {
    if (!row?.key) return;
    if (row.state === HEALTH.COOLING) {
      const current = this.entries.get(row.key);
      if (current?.state === HEALTH.COOLING) {
        current.reason = row.reason ?? current.reason;
        current.since = row.since ?? current.since;
        current.probes = Math.max(current.probes ?? 0, row.probes ?? 0);
        current.nextProbeAt = row.nextProbeAt ?? current.nextProbeAt;
        return;
      }
      const entry = {
        state: HEALTH.COOLING,
        since: row.since ?? this.now(),
        reason: row.reason ?? undefined,
        subject: this.resolve?.(row.key),
        probes: row.probes ?? 0,
        probeIntervalMs: row.probeIntervalMs ?? this.probeIntervalMs,
        maxProbeIntervalMs: row.maxProbeIntervalMs ?? this.probeIntervalMs,
        probeBackoff: row.probeBackoff ?? 1,
      };
      this.entries.set(row.key, entry);
      const delay = Math.max(0, (row.nextProbeAt ?? this.now()) - this.now());
      this.#schedule(row.key, entry, delay);
      if (!silent) {
        this.onEvent("cooldown-shared", {
          key: this.describe(row.key, entry.subject),
          reason: entry.reason ?? null,
          probeInMs: delay,
        });
      }
      return;
    }
    if (row.state !== HEALTH.ALIVE) return;
    const current = this.entries.get(row.key);
    if (current?.state !== HEALTH.COOLING) return;
    if (current.timer !== undefined) this.clearTimer(current.timer);
    this.entries.set(row.key, { state: HEALTH.ALIVE, since: row.since ?? this.now(), probes: 0 });
    if (!silent) {
      this.onEvent("cooldown-exit", {
        key: this.describe(row.key, current.subject),
        cause: "shared",
        cooledMs: this.now() - (current.since ?? this.now()),
      });
    }
  }

  #schedule(key, entry, delayMs = entry.probeIntervalMs ?? this.probeIntervalMs) {
    entry.nextProbeAt = this.now() + delayMs;
    entry.timer = this.setTimer(() => this.#probe(key, entry), delayMs);
  }

  async #probe(key, entry) {
    if (this.entries.get(key) !== entry) return; // superseded
    // An entry learned from another worker has no candidate yet; resolve it so
    // any worker can run the probe.
    if (!entry.subject) entry.subject = this.resolve?.(key);
    if (!entry.subject) {
      this.#schedule(key, entry, entry.probeIntervalMs ?? this.probeIntervalMs);
      return;
    }
    // One probe per interval for the whole gateway, not one per worker.
    if (this.store) {
      const until = this.now() + this.probeLeaseMs;
      if (!this.store.claimProbe(key, until, this.now())) {
        this.#schedule(key, entry, this.probeLeaseMs);
        return;
      }
    }
    entry.probes += 1;
    let alive = false;
    try {
      alive = this.prober ? await this.prober(entry.subject, key) : false;
    } catch {
      alive = false;
    }
    if (this.entries.get(key) !== entry) return;
    if (alive) {
      this.onEvent("background-probe", { key: this.describe(key, entry.subject), alive: true, attempt: entry.probes });
      this.markAlive(key, "background-probe");
    } else {
      const initial = entry.probeIntervalMs ?? this.probeIntervalMs;
      const factor = Number.isFinite(entry.probeBackoff) && entry.probeBackoff > 1 ? entry.probeBackoff : 1;
      const cap = entry.maxProbeIntervalMs ?? initial;
      const delay = Math.min(cap, initial * factor ** entry.probes);
      this.#schedule(key, entry, delay);
      this.#write(key, entry);
    }
  }
}

/** setTimeout that never keeps the process alive on its own. */
function defaultSetTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
}
