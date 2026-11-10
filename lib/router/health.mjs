// Per-(unit, model) health with three states: ALIVE, DEAD and BUSY.
//
// Health is keyed by unit AND model. A provider may meter quota per model, so
// one exhausted model must not bench the account's other models.
//
// DEAD is a cooldown. It ends at `until`, or when a probe or a successful
// request marks the key alive. BUSY is not a cooldown: it says the unit is up
// but saturated, so `isCooling` is false and no deadline benches it.
//
// A probe holds a fencing token. A write from an older probe cannot land after
// a newer claim rotates the token. A normal write never rotates the token and
// never clears the lease; only `claimProbeLease` in the store does that.

import { PROBE_STATE } from "../contracts.mjs";

const KEY_SEPARATOR = " ";
const BUSY_HINT_MS = 30_000;

/** The registry key for one unit serving one model. */
export function healthKey(unitKey, model) {
  return `${unitKey}${KEY_SEPARATOR}${model}`;
}

function normalizedState(value) {
  if (value === PROBE_STATE.DEAD || value === PROBE_STATE.BUSY) return value;
  return PROBE_STATE.ALIVE;
}

export class HealthRegistry {
  /**
   * @param {{store: import("./state-store.mjs").StateStore,
   *   probeIntervalMs?: number, now?: () => number,
   *   onEvent?: (event: string, detail: object) => void}} options
   */
  constructor({ store, probeIntervalMs = 30 * 60_000, now = Date.now, onEvent = () => {} } = {}) {
    this.store = store ?? null;
    this.probeIntervalMs = Math.max(1, probeIntervalMs);
    this.now = now;
    this.onEvent = onEvent;
    /** key -> last known health row, used when storage is unavailable */
    this.known = new Map();
    /** key -> fence of the newest probe claim issued by this worker */
    this.fences = new Map();
    /** key -> local probe lease, used when no store exists */
    this.leases = new Map();
  }

  /** The store key for one unit and model. */
  keyOf(unitKey, model) {
    return healthKey(unitKey, model);
  }

  /** ALIVE, DEAD or BUSY for one unit and model. */
  stateOf(unitKey, model) {
    return this.readRow(unitKey, model).state;
  }

  /**
   * The shared row for one unit and model. `state` is the raw store state,
   * `health` is what the page may show (an expired dead/busy row is alive).
   * The local mirror is a cache: when the store is present it is never the
   * authority, and a false `markDead` leaves no local cooldown behind.
   */
  readRow(unitKey, model) {
    const key = this.keyOf(unitKey, model);
    const stored = this.store?.readHealth?.(key);
    if (stored) return this.#visibleRow(unitKey, model, key, stored);
    if (!this.store || this.store.available === false) {
      const mirror = this.known.get(key);
      if (mirror) return this.#visibleRow(unitKey, model, key, mirror);
    } else {
      this.known.delete(key);
    }
    return {
      unitKey,
      model,
      key,
      state: PROBE_STATE.ALIVE,
      health: PROBE_STATE.ALIVE,
      until: 0,
      reason: null,
      updatedAt: 0,
      probeLeaseUntil: 0,
    };
  }

  /** Normalize one stored row; an expired cooldown reads alive. */
  #visibleRow(unitKey, model, key, row) {
    const raw = normalizedState(row.state);
    const until = Number(row.until) || 0;
    const now = this.now();
    const visible = raw === PROBE_STATE.ALIVE || until === 0 || until > now ? raw : PROBE_STATE.ALIVE;
    const reason = visible === PROBE_STATE.ALIVE ? null : (row.reason ?? null);
    const value = {
      unitKey,
      model,
      key,
      state: visible,
      health: visible === PROBE_STATE.DEAD ? "cooling" : visible,
      until: visible === PROBE_STATE.ALIVE ? 0 : until,
      reason,
      updatedAt: Number(row.updatedAt) || 0,
      probeLeaseUntil: Number(row.probeLeaseUntil) || 0,
    };
    this.known.set(key, {
      state: visible,
      until: value.until,
      reason: reason ?? undefined,
      fencingToken: Number(row.fencingToken) || 0,
      probeLeaseUntil: value.probeLeaseUntil,
      updatedAt: value.updatedAt,
    });
    return value;
  }

  /**
   * The local mirror only. Status uses this when the shared store is not
   * global (memory or unavailable); it never issues a store query.
   */
  localRow(unitKey, model) {
    const key = this.keyOf(unitKey, model);
    const row = this.known.get(key);
    return row ? this.#visibleRow(unitKey, model, key, row) : null;
  }

  /** True only for an active DEAD cooldown. BUSY never cools down. */
  isCooling(unitKey, model) {
    return this.stateOf(unitKey, model) === PROBE_STATE.DEAD;
  }

  /**
   * Bench a key. `until` defaults to one probe interval from now. `state` may
   * be PROBE_STATE.BUSY to record saturation without a cooldown.
   * @returns {boolean} true when the write applied
   */
  markDead(unitKey, model, { reason, until, state = PROBE_STATE.DEAD, fence } = {}) {
    const key = this.keyOf(unitKey, model);
    const now = this.now();
    const busy = state === PROBE_STATE.BUSY;
    // Saturation never clears or shortens a real cooldown.
    if (busy && this.isCooling(unitKey, model)) return false;
    const target = Number.isFinite(until)
      ? until
      : now + (busy ? Math.min(BUSY_HINT_MS, this.probeIntervalMs) : this.probeIntervalMs);
    const writeFence = fence ?? this.fences.get(key);
    const applied = this.#write(
      key,
      { state: busy ? PROBE_STATE.BUSY : PROBE_STATE.DEAD, until: target, reason: reason ?? (busy ? "busy" : "dead") },
      writeFence,
    );
    if (applied) {
      const visible = busy ? PROBE_STATE.BUSY : PROBE_STATE.DEAD;
      this.known.set(key, {
        state: visible,
        until: target,
        reason,
        fencingToken: writeFence ?? this.known.get(key)?.fencingToken ?? 0,
        probeLeaseUntil: this.known.get(key)?.probeLeaseUntil ?? 0,
        updatedAt: now,
      });
      this.onEvent(busy ? "busy" : "cooldown-enter", { key, unitKey, model, reason, until: target });
    } else {
      this.onEvent("probe-stale", { key, unitKey, model });
    }
    return applied;
  }

  /** Return a key to service. */
  markAlive(unitKey, model, { fence } = {}) {
    const key = this.keyOf(unitKey, model);
    const previous = this.stateOf(unitKey, model);
    const writeFence = fence ?? this.fences.get(key);
    let applied;
    if (this.store) applied = this.store.markAlive(key, writeFence === undefined ? {} : { fence: writeFence });
    else applied = true;
    if (applied) {
      const known = this.known.get(key);
      this.known.set(key, {
        state: PROBE_STATE.ALIVE,
        until: 0,
        reason: undefined,
        fencingToken: known?.fencingToken ?? writeFence ?? 0,
        probeLeaseUntil: known?.probeLeaseUntil ?? 0,
        updatedAt: this.now(),
      });
      if (previous !== PROBE_STATE.ALIVE) this.onEvent("cooldown-exit", { key, unitKey, model });
    } else {
      this.onEvent("probe-stale", { key, unitKey, model });
    }
    return applied;
  }

  /**
   * Take the right to probe one key. The returned fence must accompany the
   * probe result, so a stale probe cannot overwrite a newer one.
   * @returns {{claimed: boolean, fence: number}}
   */
  claimProbe(unitKey, model, leaseMs) {
    const key = this.keyOf(unitKey, model);
    const now = this.now();
    const lease = Math.max(1, Number.isFinite(leaseMs) ? leaseMs : this.probeIntervalMs);
    let result;
    if (this.store) result = this.store.claimProbeLease(key, lease);
    else {
      const current = this.leases.get(key);
      if (current && current.until > now) result = { claimed: false, fence: current.fence ?? 0 };
      else {
        const fence = (current?.fence ?? 0) + 1;
        this.leases.set(key, { until: now + lease, fence });
        result = { claimed: true, fence };
      }
    }
    if (result.claimed) this.fences.set(key, result.fence);
    return result;
  }

  /** Forget local fences and mirrors (shutdown). */
  dispose() {
    this.fences.clear();
    this.leases.clear();
    this.known.clear();
  }

  #write(key, patch, fence) {
    if (this.store) return this.store.writeHealth(key, patch, fence === undefined ? {} : { fence });
    const known = this.known.get(key);
    if (fence !== undefined && known && known.fencingToken !== fence) return false;
    const current = known ?? { until: 0, reasonRank: 0 };
    if (patch.state !== PROBE_STATE.ALIVE && current.until > patch.until) {
      return true;
    }
    this.known.set(key, {
      state: patch.state,
      until: patch.until,
      reason: patch.reason,
      fencingToken: known?.fencingToken ?? 0,
      probeLeaseUntil: known?.probeLeaseUntil ?? 0,
      updatedAt: this.now(),
    });
    return true;
  }
}
