// Verified concurrent completions per provider/model, shared across credentials.
// A proof is an actual overlapping cohort. It counts only when every member
// finishes without a transport or protocol failure.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const STATE_VERSION = 1;
const MAX_LIFETIME_MS = 30 * 60_000;
const MAX_PENDING_WITNESSES = 128;

export class ProviderConcurrencyProof {
  constructor({ statePath = null, onProof = () => {}, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, shared = null, refreshMs = 2_000 } = {}) {
    this.statePath = statePath;
    this.onProof = onProof;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.groups = new Map();
    this.verified = new Map();
    this.nextId = 1;
    // Shared mode: a proof is a lower bound, so merging workers by max keeps
    // the meaning ("this many overlapped") while covering all of them.
    this.shared = shared?.enabled ? shared : null;
    this.refreshTimer = null;
    if (this.shared) {
      this.#refreshShared();
      this.refreshTimer = setInterval(() => this.#refreshShared(), refreshMs);
      this.refreshTimer.unref?.();
    } else {
      this.#load();
    }
  }

  /** Re-read proofs recorded by other workers now. */
  refresh() {
    if (this.shared) this.#refreshShared();
  }

  #refreshShared() {
    for (const row of this.shared.proofRows()) {
      if (!row.model.includes("/")) continue;
      if ((this.verified.get(row.model) ?? 0) < row.verified) this.verified.set(row.model, row.verified);
    }
  }

  #load() {
    if (!this.statePath || !existsSync(this.statePath)) return;
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (state.version !== STATE_VERSION) return;
      for (const [model, value] of Object.entries(state.verified ?? {})) {
        if (!model.includes("/") || !Number.isSafeInteger(value) || value < 0) continue;
        this.verified.set(model, value);
      }
    } catch {
      // A corrupt optional metrics file must not interfere with routing.
    }
  }

  #persist() {
    if (!this.statePath) return;
    try {
      mkdirSync(dirname(this.statePath), { recursive: true });
      const temp = this.statePath + ".tmp-" + process.pid;
      writeFileSync(temp, JSON.stringify({
        version: STATE_VERSION,
        verified: Object.fromEntries(this.verified),
      }), { mode: 0o600 });
      renameSync(temp, this.statePath);
    } catch {
      // Metrics are best-effort, routing is not.
    }
  }

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
    if (this.shared) return this.#beginShared(model);
    const group = this.#group(model);
    const ticket = { id: this.nextId++, model, finished: false, firstAt: undefined };
    group.active.add(ticket);

    const timer = this.setTimer(() => finish(false), MAX_LIFETIME_MS);
    timer?.unref?.();

    // Concurrency is proven while tokens are flowing: a request still waiting
    // for its first token holds no generation slot.
    const firstToken = (at = this.now()) => {
      if (ticket.finished || ticket.firstAt !== undefined) return;
      ticket.firstAt = at;
      group.generating.add(ticket);
      const level = group.generating.size;
      const previous = this.verified.get(model) ?? 0;
      if (level <= previous || group.witnesses.has(level)) return;
      // Bound memory even if concurrency grows into the thousands. Dropping
      // evidence can only underestimate the proven maximum, never inflate it.
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
      this.clearTimer(timer);
      group.active.delete(ticket);
      group.generating.delete(ticket);

      for (const [level, witness] of group.witnesses) {
        // A failure anywhere while a proof is pending invalidates it.
        if (!success) witness.failed = true;
        witness.pending.delete(ticket);
        if (witness.pending.size > 0) continue;
        group.witnesses.delete(level);
        if (witness.failed || level <= (this.verified.get(model) ?? 0)) continue;
        this.verified.set(model, level);
        this.shared?.proofMax(model, level, this.now() + MAX_LIFETIME_MS);
        const slash = model.indexOf("/");
        try {
          this.onProof({
            provider: model.slice(0, slash),
            model,
            verifiedMaxConcurrency: level,
            observedAt: new Date(witness.observedAt).toISOString(),
            verifiedAt: new Date(this.now()).toISOString(),
            evidence: "overlapping upstream requests all completed successfully",
          });
        } catch {
          // Never let metrics callbacks fail a completed provider request.
        }
        if (!this.shared) this.#persist();
      }

      // Remove superseded lower-level pending proofs without discarding the
      // evidence for newer, higher levels still waiting to complete.
      for (const level of group.witnesses.keys()) {
        if (level <= (this.verified.get(model) ?? 0)) group.witnesses.delete(level);
      }
      if (!group.active.size && !group.witnesses.size) this.groups.delete(model);
    };
    return { finish, firstToken };
  }

  /**
   * Shared mode: an attempt is an interval in one table, and the proof is the
   * largest number of *successful* intervals that were active at once across
   * every worker. Per-worker cohorts cannot see that number: four workers with
   * three overlapping attempts each prove twelve, not three.
   */
  #beginShared(model) {
    const id = `${this.shared.worker}:${this.nextId++}`;
    const startedAt = this.now();
    this.shared.attemptBegin(id, model, this.shared.worker, startedAt);
    const ticket = { id, model, startedAt, firstAt: undefined, finished: false };
    return {
      firstToken: (at = this.now()) => {
        if (ticket.finished || ticket.firstAt !== undefined) return;
        ticket.firstAt = at;
        this.shared.attemptFirstToken(id, at);
      },
      finish: (success) => {
        if (ticket.finished) return;
        ticket.finished = true;
        const at = this.now();
        this.shared.attemptFinish(id, at, success);
        // No token ever flowed: nothing was generated, so nothing to prove.
        if (!success || ticket.firstAt === undefined) return;
        // Concurrency at this attempt's first token, counting only attempts
        // that completed successfully; the max over all is the true peak.
        const overlap = this.shared.attemptCoverage(model, id, ticket.firstAt) + 1;
        const previous = this.verified.get(model) ?? 0;
        if (overlap <= previous) return;
        this.verified.set(model, overlap);
        this.shared.proofMax(model, overlap, at + MAX_LIFETIME_MS);
        const slash = model.indexOf("/");
        try {
          this.onProof({
            provider: model.slice(0, slash),
            model,
            verifiedMaxConcurrency: overlap,
            observedAt: new Date(ticket.firstAt).toISOString(),
            verifiedAt: new Date(at).toISOString(),
            evidence: "overlapping upstream requests all completed successfully",
          });
        } catch {
          // Metrics callbacks never fail a provider request.
        }
      },
    };
  }

  /** Upstream attempts open right now, across every live worker. */
  inFlight() {
    if (this.shared) return this.shared.openAttempts();
    let open = 0;
    for (const group of this.groups.values()) open += group.active.size;
    return open;
  }

  max(model) { return this.verified.get(model) ?? 0; }
  snapshot() {
    return Object.fromEntries([...this.verified].map(([model, max]) =>
      [model, { provider: model.split("/", 1)[0], verifiedMaxConcurrency: max }]));
  }
}
