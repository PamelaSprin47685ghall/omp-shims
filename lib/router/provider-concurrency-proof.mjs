// Verified concurrent completions per provider/model.
//
// A proof is an actual overlapping cohort. It counts only when every member
// finishes without a transport or protocol failure. A request proves
// concurrency only while tokens flow: a request still waiting for its first
// token holds no generation slot.
//
// The proof lives in the shared `proof` table with a monotonic MAX upsert, so
// it survives a worker restart and every worker reads the same lower bound.
// The in-process map is a cache for the hot path, never the authority. The
// router uses this as an optional status metric; it never decides a route.

export const PROOF_TTL_MS = 30 * 60_000;
const MAX_LIFETIME_MS = PROOF_TTL_MS;
const MAX_PENDING_WITNESSES = 128;

export class ProviderConcurrencyProof {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore, now?: () => number,
   *   ttlMs?: number}} [options]
   */
  constructor({ store = null, now = Date.now, ttlMs = PROOF_TTL_MS } = {}) {
    this.store = store;
    this.now = now;
    this.ttlMs = Math.max(1, Number.isFinite(ttlMs) ? ttlMs : PROOF_TTL_MS);
    this.groups = new Map();
    /** model -> {verified, until}; cache only */
    this.verified = new Map();
    this.nextId = 1;
    this.timers = new Set();
  }

  /** The group of open attempts for one model. */
  #group(model) {
    let group = this.groups.get(model);
    if (!group) {
      group = { active: new Set(), generating: new Set(), witnesses: new Map() };
      this.groups.set(model, group);
    }
    return group;
  }

  /** Start one actual upstream attempt. Credentials do not enter the key. */
  begin(model) {
    if (typeof model !== "string" || !model.includes("/")) return { finish() {}, firstToken() {} };
    const group = this.#group(model);
    const ticket = { id: this.nextId++, model, finished: false, firstAt: undefined };
    group.active.add(ticket);

    const timer = setTimeout(() => finish(false), MAX_LIFETIME_MS);
    timer.unref?.();
    this.timers.add(timer);

    const firstToken = (at = this.now()) => {
      if (ticket.finished || ticket.firstAt !== undefined) return;
      ticket.firstAt = at;
      group.generating.add(ticket);
      const level = group.generating.size;
      const previous = this.#cached(model)?.verified ?? 0;
      if (level <= previous || group.witnesses.has(level)) return;
      if (group.witnesses.size >= MAX_PENDING_WITNESSES) {
        group.witnesses.delete(group.witnesses.keys().next().value);
      }
      group.witnesses.set(level, {
        concurrency: level,
        pending: new Set(group.generating),
        failed: false,
        observedAt: at,
      });
    };

    const finish = (success) => {
      if (ticket.finished) return;
      ticket.finished = true;
      clearTimeout(timer);
      this.timers.delete(timer);
      group.active.delete(ticket);
      group.generating.delete(ticket);

      for (const [level, witness] of group.witnesses) {
        if (!success) witness.failed = true;
        witness.pending.delete(ticket);
        if (witness.pending.size > 0) continue;
        group.witnesses.delete(level);
        if (witness.failed || level <= (this.#cached(model)?.verified ?? 0)) continue;
        this.#publish(model, level, this.now());
      }

      for (const level of group.witnesses.keys()) {
        if (level <= (this.#cached(model)?.verified ?? 0)) group.witnesses.delete(level);
      }
      if (!group.active.size && !group.witnesses.size) this.groups.delete(model);
    };

    return { finish, firstToken };
  }

  /** Finish every open attempt as a failure and drop its timer. */
  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.groups.clear();
    this.verified.clear();
  }

  /** Upstream attempts open right now. */
  inFlight() {
    let open = 0;
    for (const group of this.groups.values()) open += group.active.size;
    return open;
  }

  /** The verified maximum for one model, or 0. The store wins when present. */
  max(model) {
    const cached = this.#cached(model);
    const shared = this.store?.getProof?.(model);
    if (shared && Number(shared.until) > this.now()) {
      const value = Math.max(cached?.verified ?? 0, Number(shared.verified) || 0);
      this.verified.set(model, {
        verified: value,
        until: Math.max(cached?.until ?? 0, Number(shared.until) || 0),
      });
      return value;
    }
    return cached?.verified ?? 0;
  }

  /**
   * Plain status data. With `rows` (from the status read transaction) it maps
   * those shared rows; without them it returns the live cache.
   */
  snapshot(rows = null) {
    const now = this.now();
    const source = Array.isArray(rows) ? rows : [...this.verified].map(([model, row]) => ({ model, ...row }));
    const out = {};
    for (const row of source) {
      if (typeof row?.model !== "string") continue;
      const verified = Number(row.verified) || 0;
      const until = Number(row.until) || 0;
      if (until <= now) continue;
      out[row.model] = {
        provider: row.model.split("/", 1)[0],
        verifiedMaxConcurrency: verified,
        verified,
        until: new Date(until).toISOString(),
      };
    }
    return out;
  }

  /** One local cache read that drops an expired entry. */
  #cached(model) {
    const row = this.verified.get(model);
    if (!row) return undefined;
    if (Number(row.until) <= this.now()) {
      this.verified.delete(model);
      return undefined;
    }
    return row;
  }

  /** Monotonic publish: the store enforces MAX; the cache mirrors it. */
  #publish(model, level, at) {
    const until = at + this.ttlMs;
    const cached = this.verified.get(model);
    this.verified.set(model, {
      verified: Math.max(level, cached?.verified ?? 0),
      until: Math.max(until, cached?.until ?? 0),
    });
    try {
      this.store?.setProof?.(model, level, until);
    } catch {
      // A proof write never fails a response.
    }
  }
}
