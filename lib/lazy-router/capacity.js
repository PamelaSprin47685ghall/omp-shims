// In-flight accounting for units whose provider limits concurrent requests.
//
// A unit's load is the number of its upstream requests that are logically
// open: counted at the outbound fetch layer from the moment the provider call
// leaves until its response body has been fully read or closed, the call has
// failed, or it was aborted (a pooled keep-alive socket staying open does not
// count). Between routing and that first provider call the router holds a
// reservation, so two requests routed at the same instant cannot both take the
// last slot.
//
// A unit's limit comes from the route tables (`maxInFlight`, by "provider" or
// "provider:tier"); 0, the default, means unlimited, and an unlimited unit is
// never gated or shown. Every release is idempotent, so the many ways a
// request can end (stream done, error, client abort, abandoned attempt,
// failover) can each release without double counting.

/**
 * @typedef {import("./units.js").Unit} Unit
 */

export class InFlightTracker {
  /** @param {{limitOf: (unit: Unit) => number}} options */
  constructor({ limitOf }) {
    this.limitOf = limitOf;
    /** unit key → open upstream requests plus reservations */
    this.counts = new Map();
  }

  /** True when the unit has a limit at all. */
  isLimited(unit) {
    return this.limitOf(unit) > 0;
  }

  /** Requests the unit has open (or reserved) right now. */
  inFlight(unit) {
    return this.counts.get(unit.key) ?? 0;
  }

  /** True when one more request fits under the unit's limit. */
  hasRoom(unit) {
    const limit = this.limitOf(unit);
    return limit === 0 || this.inFlight(unit) < limit;
  }

  /**
   * A slot for one candidate's attempts, holding a reservation when `reserve`
   * is set (routed requests) and none for traffic that is counted but never
   * gated (liveness probes).
   * @param {Unit} unit
   * @param {{reserve?: boolean}} [options]
   */
  slot(unit, { reserve = true } = {}) {
    return this.isLimited(unit) ? new Slot(this, unit.key, reserve) : UNTRACKED_SLOT;
  }

  /** Change a unit's count; returns an idempotent undo. */
  acquire(key) {
    this.#add(key, 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#add(key, -1);
    };
  }

  #add(key, delta) {
    const count = (this.counts.get(key) ?? 0) + delta;
    if (count > 0) this.counts.set(key, count);
    else this.counts.delete(key);
  }
}

/**
 * The capacity one routed candidate uses: a reservation that the first
 * provider call takes over, plus one count per further call (the gateway's own
 * retries, the router's retry of the same unit).
 */
export class Slot {
  constructor(tracker, key, reserve) {
    this.tracker = tracker;
    this.key = key;
    this.reservation = reserve ? tracker.acquire(key) : undefined;
    /** @type {Set<() => void>} releases of calls still open */
    this.open = new Set();
  }

  /**
   * Account for one provider call; returns its idempotent release.
   * @returns {() => void}
   */
  beginRequest() {
    const undo = this.reservation ?? this.tracker.acquire(this.key);
    this.reservation = undefined;
    const release = () => {
      if (!this.open.delete(release)) return;
      undo();
    };
    this.open.add(release);
    return release;
  }

  /** Give back a reservation no provider call took (attempt failed early or was served without one). */
  releaseReservation() {
    this.reservation?.();
    this.reservation = undefined;
  }

  /** End everything: the reservation and any call still open (abandoned attempts, client aborts). */
  releaseAll() {
    this.releaseReservation();
    for (const release of [...this.open]) release();
  }

  /**
   * Hand the slot to the served response. The provider calls keep their counts
   * until their own bodies end; the client's response ending (or the client
   * aborting) is the backstop that ends whatever is still open, so a call the
   * gateway never drains cannot leak a slot.
   * @param {Response} response the response going to the client
   * @param {AbortSignal} [signal] the client's signal
   */
  settleWith(response, signal) {
    this.releaseReservation();
    return releaseWhenSettled(response, () => this.releaseAll(), signal);
  }
}

const NO_RELEASE = () => {};

/** The slot of a unit without a limit: nothing is counted. */
export const UNTRACKED_SLOT = Object.freeze({
  beginRequest: () => NO_RELEASE,
  releaseReservation() {},
  releaseAll() {},
  settleWith: (response) => response,
});

/**
 * The same response, with `release` called exactly once when its body has been
 * read to the end, failed, or been cancelled; at once when there is no body.
 * @param {Response} response
 * @param {() => void} release
 * @param {AbortSignal} [signal] the call's signal: an abort releases too
 */
export function releaseWhenSettled(response, release, signal) {
  if (release === NO_RELEASE) return response;
  if (signal) {
    if (signal.aborted) release();
    else signal.addEventListener("abort", release, { once: true });
  }
  if (!response.body) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  if (response.url) {
    try {
      Object.defineProperty(wrapped, "url", { value: response.url, configurable: true, enumerable: true });
    } catch {}
  }
  return wrapped;
}
