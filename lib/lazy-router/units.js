// Units: the (provider, account) pairs a route entry expands into.
//
// An entry names a provider (through its model) and optionally the account
// tiers it wants. It expands at request time, against the accounts enabled in
// agent.db right now, so a newly logged-in account joins its tier without a
// code or config change. Ordering is deterministic:
//
//   - an entry with tiers takes them in the order listed, and within one tier
//     the accounts oldest first (ascending credential id = creation order);
//   - an entry without tiers takes every account of the provider, oldest first;
//   - an account whose tier is unknown is matched only by entries without tiers.
//
// A provider with two or more accounts gets one unit per account, each pinned
// to its credential. A provider with one account, or none in agent.db (keys
// from models.yml, environment or plugin token sources), is a single unit
// served by the gateway's own credential choice, which can only be that one.
//
// Labels name a unit without naming the account: "openai-codex:plus#1",
// "cline-pass#2", or just "kiro" for a single-unit provider. The number counts
// accounts of the same provider and tier, oldest first.

/** A provider needs this many accounts before its units are pinned. */
const MIN_ACCOUNTS_TO_PIN = 2;

/**
 * @typedef {{label: string, provider: string, tier?: string, key: string, credentialId?: number}} Unit
 * `key` identifies the unit internally (health, probes) and is never shown.
 */

export class UnitDirectory {
  /** @param {{tiers: import("./tiers.js").TierDirectory}} options */
  constructor({ tiers }) {
    this.tiers = tiers;
    this.builtFor = -1;
    /** @type {Map<string, Unit[]>} provider → units, oldest account first */
    this.byProvider = new Map();
  }

  /** Changes whenever the units change; callers key caches on it. */
  get version() {
    return this.tiers.version;
  }

  /** Wait (bounded) until the first tier pass is done. */
  async ready(timeoutMs) {
    if (!this.tiers.ready) return;
    let timer;
    await Promise.race([
      this.tiers.ready,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Units for a route entry, in priority order.
   * @param {string} provider
   * @param {string[]|undefined} tiers wanted tiers in order; undefined = every account
   * @returns {Unit[]}
   */
  select(provider, tiers) {
    const units = this.#units(provider);
    if (!tiers) return units;
    return tiers.flatMap((tier) => units.filter((unit) => unit.tier === tier));
  }

  /** Every unit known right now, grouped by provider (status view). */
  all() {
    this.#rebuildIfStale();
    return [...this.byProvider.values()].flat();
  }

  #units(provider) {
    this.#rebuildIfStale();
    return this.byProvider.get(provider) ?? [{ label: provider, provider, key: provider }];
  }

  #rebuildIfStale() {
    if (this.builtFor === this.tiers.version) return;
    this.byProvider = buildUnits(this.tiers.accounts());
    this.builtFor = this.tiers.version;
  }
}

/**
 * Turn the account list into labelled units.
 * @param {{id: number, provider: string, tier?: string}[]} accounts oldest first
 * @returns {Map<string, Unit[]>}
 */
export function buildUnits(accounts) {
  const grouped = new Map();
  for (const account of [...accounts].sort((a, b) => a.id - b.id)) {
    if (!grouped.has(account.provider)) grouped.set(account.provider, []);
    grouped.get(account.provider).push(account);
  }

  const units = new Map();
  for (const [provider, list] of grouped) {
    if (list.length < MIN_ACCOUNTS_TO_PIN) {
      const [only] = list;
      units.set(provider, [{ label: provider, provider, key: provider, ...(only.tier ? { tier: only.tier } : {}) }]);
      continue;
    }
    const ordinals = new Map();
    units.set(
      provider,
      list.map((account) => {
        const tierKey = account.tier ?? "";
        const n = (ordinals.get(tierKey) ?? 0) + 1;
        ordinals.set(tierKey, n);
        return {
          label: `${provider}${account.tier ? `:${account.tier}` : ""}#${n}`,
          provider,
          ...(account.tier ? { tier: account.tier } : {}),
          key: `${provider}/${account.id}`,
          credentialId: account.id,
        };
      }),
    );
  }
  return units;
}
