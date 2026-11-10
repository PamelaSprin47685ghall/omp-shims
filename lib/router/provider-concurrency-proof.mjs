// Verified concurrent completions per provider/model.
//
// A proof is an actual overlapping cohort. It counts only when every member
// finishes without a transport or protocol failure. A request proves
// concurrency only while tokens flow: a request still waiting for its first
// token holds no generation slot.
//
// The router uses this as an optional status metric. It never decides a route.

const MAX_LIFETIME_MS = 30 * 60_000;
const MAX_PENDING_WITNESSES = 128;

export class ProviderConcurrencyProof {
  /** @param {{now?: () => number}} [options] */
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.groups = new Map();
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
      const previous = this.verified.get(model) ?? 0;
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
        if (witness.failed || level <= (this.verified.get(model) ?? 0)) continue;
        this.verified.set(model, level);
      }

      for (const level of group.witnesses.keys()) {
        if (level <= (this.verified.get(model) ?? 0)) group.witnesses.delete(level);
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
  }

  /** Upstream attempts open right now. */
  inFlight() {
    let open = 0;
    for (const group of this.groups.values()) open += group.active.size;
    return open;
  }

  /** The verified maximum for one model, or 0. */
  max(model) {
    return this.verified.get(model) ?? 0;
  }

  /** Plain status data. */
  snapshot() {
    return Object.fromEntries(
      [...this.verified].map(([model, max]) => [
        model,
        { provider: model.split("/", 1)[0], verifiedMaxConcurrency: max },
      ]),
    );
  }
}
