// Test-only upstream fault injection.
//
// Lets an operator rehearse failover on a test gateway without touching real
// credentials: an injected fault fails the attempt at the point where the real
// upstream call would leave the process, so the gateway never sees a provider
// error and never reports a block to the broker. Never configure it in
// production.
//
//   "testFaults": { "cx-18": { "status": 429, "requests": 1, "probes": 1 } }
//
// fails the first request attempt and the first probe sent to unit cx-18.

/** Which kind of call a fault budget applies to. */
export const FAULT_KIND = Object.freeze({ REQUEST: "requests", PROBE: "probes" });

const DEFAULT_FAULT_STATUS = 429;

export class FaultInjector {
  /** @param {Record<string, {status?: number, requests?: number, probes?: number}>} [spec] */
  constructor(spec = {}) {
    this.budgets = new Map(
      Object.entries(spec).map(([label, fault]) => [
        label,
        {
          status: fault.status ?? DEFAULT_FAULT_STATUS,
          [FAULT_KIND.REQUEST]: fault.requests ?? 0,
          [FAULT_KIND.PROBE]: fault.probes ?? 0,
        },
      ]),
    );
  }

  get active() {
    return this.budgets.size > 0;
  }

  /**
   * Consume one fault for `label`, if any remain.
   * @returns {{status: number, message: string}|undefined}
   */
  take(label, kind) {
    const budget = this.budgets.get(label);
    if (!budget || budget[kind] <= 0) return undefined;
    budget[kind] -= 1;
    return { status: budget.status, message: `lazy-router test fault (${kind}) for ${label}` };
  }
}
