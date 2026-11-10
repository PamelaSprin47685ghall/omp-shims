// Test-only upstream fault injection.
//
// An operator can rehearse failover on a test gateway without touching real
// credentials. An injected fault fails the attempt where the real upstream call
// would leave the process, so the gateway never sees a provider error and never
// reports a block to the broker. Never configure it in production.
//
//   "testFaults": { "openai-codex:plus#1": { "status": 429, "requests": 1, "probes": 1 } }
//
// The keys are unit labels. A fault budget counts request attempts and probes
// separately.

/** Which kind of call a fault budget applies to. */
export const FAULT_KIND = Object.freeze({ REQUEST: "requests", PROBE: "probes" });

const DEFAULT_FAULT_STATUS = 429;

/** A finite, non-negative budget. */
function budget(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export class FaultInjector {
  /** @param {Record<string, {status?: number, requests?: number, probes?: number}>} [spec] */
  constructor(spec = {}) {
    this.budgets = new Map(
      Object.entries(spec ?? {}).map(([label, fault]) => [
        label,
        {
          status: Number.isInteger(fault?.status) ? fault.status : DEFAULT_FAULT_STATUS,
          [FAULT_KIND.REQUEST]: budget(fault?.requests),
          [FAULT_KIND.PROBE]: budget(fault?.probes),
        },
      ]),
    );
  }

  /** True when at least one fault budget is configured. */
  get active() {
    return this.budgets.size > 0;
  }

  /**
   * Consume one fault for `label`, when any remain.
   * @returns {{status: number, message: string}|undefined}
   */
  take(label, kind) {
    const entry = this.budgets.get(label);
    if (!entry || entry[kind] <= 0) return undefined;
    entry[kind] -= 1;
    return {
      status: entry.status,
      message: `lazy-router test fault (${kind}) for ${label}`,
    };
  }
}
