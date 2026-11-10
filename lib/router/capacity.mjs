// In-flight accounting for units whose provider limits concurrent requests.
//
// A slot is one open or reserved upstream request. The store enforces the limit
// across every worker. A reservation that the store refuses is not granted, so
// the caller must not send the request. A release is idempotent.
//
// A limit of 0 means unlimited. An unlimited unit is never counted or gated.
//
// Status does not call `inFlight()` per candidate: it reads the shared rows in
// the store's one read transaction (`readStatusData().capacityRows`). When the
// store is absent those rows are unavailable, and the page shows `—`; a local
// count is never published as a global capacity value.

export class InFlightTracker {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore,
   *   limitOf: (unitKey: string) => number}} options
   */
  constructor({ store = null, limitOf } = {}) {
    this.store = store;
    this.limitOf = typeof limitOf === "function" ? limitOf : () => 0;
    /** local counts, used only when no store exists */
    this.local = new Map();
  }

  /** The limit of one unit; 0 means unlimited. */
  limitOfKey(unitKey) {
    const limit = Number(this.limitOf(unitKey));
    return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  }

  /**
   * Requests the unit has open or reserved, across workers when a store
   * exists. This is a routing gate; status reads shared rows instead.
   */
  inFlight(unitKey) {
    if (this.store) return this.store.heldOf(unitKey);
    return this.local.get(unitKey) ?? 0;
  }

  /**
   * This worker's local count only. Status may label it “本 worker”; it is
   * never published as a global value.
   */
  localHeld(unitKey) {
    return this.local.get(unitKey) ?? 0;
  }

  /** True when one more request fits under the unit's limit. */
  hasRoom(unitKey) {
    const limit = this.limitOfKey(unitKey);
    return limit === 0 || this.inFlight(unitKey) < limit;
  }

  /**
   * Reserve one slot. Always call `release` when the request ends, even when
   * the upstream call never started. A refused slot has a no-op release.
   * @returns {{granted: boolean, release: () => void, unitKey: string, limit: number, held: number}}
   */
  slot(unitKey) {
    const limit = this.limitOfKey(unitKey);
    if (limit === 0) return { granted: true, release: () => {}, unitKey, limit, held: 0 };
    let granted;
    let held;
    if (this.store) {
      const result = this.store.reserveSlot(unitKey, limit);
      granted = result.granted;
      held = result.held;
    } else {
      const current = this.local.get(unitKey) ?? 0;
      granted = current < limit;
      held = granted ? current + 1 : current;
      if (granted) this.local.set(unitKey, held);
    }
    if (!granted) return { granted: false, release: () => {}, unitKey, limit, held };
    let released = false;
    return {
      granted: true,
      unitKey,
      limit,
      held,
      release: () => {
        if (released) return;
        released = true;
        if (this.store) this.store.releaseSlot(unitKey);
        else {
          const count = this.local.get(unitKey) ?? 0;
          if (count > 1) this.local.set(unitKey, count - 1);
          else this.local.delete(unitKey);
        }
      },
    };
  }
}
