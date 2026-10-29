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
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.statePath = statePath;
    this.onProof = onProof;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.groups = new Map();
    this.verified = new Map();
    this.nextId = 1;
    this.#load();
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
      group = { active: new Set(), witnesses: new Map() };
      this.groups.set(model, group);
    }
    return group;
  }

  /** Start one actual upstream attempt. Credentials do not enter the key. */
  begin(model) {
    if (typeof model !== "string" || !model.includes("/")) return { finish() {} };
    const group = this.#group(model);
    const ticket = { id: this.nextId++, finished: false };
    group.active.add(ticket);

    const concurrent = group.active.size;
    const previous = this.verified.get(model) ?? 0;
    if (concurrent > previous && !group.witnesses.has(concurrent)) {
      // Bound memory even if concurrency grows into the thousands. Dropping
      // evidence can only underestimate the proven maximum, never inflate it.
      if (group.witnesses.size >= MAX_PENDING_WITNESSES) {
        group.witnesses.delete(group.witnesses.keys().next().value);
      }
      group.witnesses.set(concurrent, {
        concurrency: concurrent,
        pending: new Set(group.active),
        failed: false,
        observedAt: this.now(),
      });
    }

    const timer = this.setTimer(() => finish(false), MAX_LIFETIME_MS);
    timer?.unref?.();

    const finish = (success) => {
      if (ticket.finished) return;
      ticket.finished = true;
      this.clearTimer(timer);
      group.active.delete(ticket);

      for (const [level, witness] of group.witnesses) {
        // A failure anywhere while a proof is pending invalidates it.
        if (!success) witness.failed = true;
        witness.pending.delete(ticket);
        if (witness.pending.size > 0) continue;
        group.witnesses.delete(level);
        if (witness.failed || level <= (this.verified.get(model) ?? 0)) continue;
        this.verified.set(model, level);
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
        this.#persist();
      }

      // Remove superseded lower-level pending proofs without discarding the
      // evidence for newer, higher levels still waiting to complete.
      for (const level of group.witnesses.keys()) {
        if (level <= (this.verified.get(model) ?? 0)) group.witnesses.delete(level);
      }
      if (!group.active.size && !group.witnesses.size) this.groups.delete(model);
    };
    return { finish };
  }

  max(model) { return this.verified.get(model) ?? 0; }
  snapshot() {
    return Object.fromEntries([...this.verified].map(([model, max]) =>
      [model, { provider: model.split("/", 1)[0], verifiedMaxConcurrency: max }]));
  }
}
