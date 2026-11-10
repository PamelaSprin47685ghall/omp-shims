// Account directory: enabled credentials plus the live tier of each account.
//
// agent.db rows do not carry a plan tier. Two providers publish it elsewhere:
//   - openai-codex: the ChatGPT plan is a JWT claim of the OAuth token;
//   - google-antigravity: loadCodeAssist reports the paid/current tier.
// A resolver caches a known tier for `tierRefreshMs` and keeps the last known
// value when a lookup fails. The account list itself is rechecked every
// `recheckMs`, so a new login joins its tier without a restart.
//
// The directory never returns a secret. The router uses the row id to pin one
// attempt; the label never includes the id, e-mail, or key.

import { withCredentialPin } from "../contracts.mjs";

/** Re-read a known tier this often. */
export const TIER_REFRESH_MS = 21_600_000;
/** Look for new, removed, or unresolved accounts this often. */
export const TIER_RECHECK_MS = 60_000;
/** Give up on one tier lookup after this long. */
export const TIER_LOOKUP_TIMEOUT_MS = 15_000;

/** The OpenAI OAuth claim that carries the ChatGPT plan. */
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
/** Cloud Code Assist endpoint that reports the Google AI subscription. */
export const CODE_ASSIST_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist";
/** Without this client user agent, loadCodeAssist omits the account's tiers. */
const CODE_ASSIST_USER_AGENT = "antigravity";

/** "g1-ultra-tier" -> "ultra", "Plus" -> "plus". */
export function normalizeTier(raw) {
  if (typeof raw !== "string") return undefined;
  const tier = raw
    .trim()
    .toLowerCase()
    .replace(/^g\d+-/, "")
    .replace(/-tier$/, "");
  return tier === "" ? undefined : tier;
}

/** The payload of a JWT, without verifying it. */
export function decodeJwtPayload(token) {
  const part = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!part) return undefined;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Stable identity of one account inside one provider. */
export function accountKey(provider, account) {
  return `${provider}/${account}`;
}

/**
 * Resolve one account's tier.
 * @param {{provider: string, id: number, tier?: string, expiresAt?: number}} row
 * @param {{credentials: object, fetch: typeof fetch, now: () => number}} context
 */
export async function resolveAccountTier(row, { credentials, fetch, refresh = false, now = Date.now }) {
  if (row.provider === "openai-codex") {
    const credential = await credentials.resolve("openai-codex", { id: row.id });
    if (!credential?.secret) return undefined;
    return normalizeTier(decodeJwtPayload(credential.secret)?.[OPENAI_AUTH_CLAIM]?.chatgpt_plan_type);
  }
  if (row.provider === "google-antigravity") {
    let credential = await credentials.resolve("google-antigravity", { id: row.id });
    if (!credential?.secret) return undefined;
    if (
      refresh &&
      Number.isFinite(credential.expiresAt) &&
      credential.expiresAt > 0 &&
      now() >= credential.expiresAt - 120_000
    ) {
      const fresh = await credentials.refresh(row.id, { timeoutMs: TIER_LOOKUP_TIMEOUT_MS });
      if (fresh?.secret) {
        credential = { ...credential, secret: fresh.secret, expiresAt: fresh.expiresAt ?? credential.expiresAt };
      }
    }
    const response = await withCredentialPin(
      { provider: "google-antigravity", credentialId: row.id, secret: credential.secret },
      () =>
        fetch(`${CODE_ASSIST_ENDPOINT}${LOAD_CODE_ASSIST_PATH}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.secret}`,
            "content-type": "application/json",
            "user-agent": CODE_ASSIST_USER_AGENT,
          },
          body: JSON.stringify({
            metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
          }),
          signal: AbortSignal.timeout(TIER_LOOKUP_TIMEOUT_MS),
        }),
    );
    if (!response.ok) throw new Error(`loadCodeAssist answered ${response.status}`);
    const answer = await response.json();
    return normalizeTier(answer?.paidTier?.id ?? answer?.currentTier?.id);
  }
  return normalizeTier(row.tier);
}

export class AccountDirectory {
  /**
   * @param {{credentials: object, providers?: Iterable<string>,
   *   recheckMs?: number, tierRefreshMs?: number, now?: () => number,
   *   fetch?: typeof fetch, report?: (message: string, detail?: object) => void}} options
   */
  constructor({
    credentials,
    providers = [],
    recheckMs = TIER_RECHECK_MS,
    tierRefreshMs = TIER_REFRESH_MS,
    now = Date.now,
    fetch = (...args) => globalThis.fetch(...args),
    report = () => {},
  }) {
    this.credentials = credentials;
    this.providers = new Set(providers);
    this.recheckMs = Math.max(1_000, recheckMs);
    this.tierRefreshMs = Math.max(1_000, tierRefreshMs);
    this.now = now;
    this.fetch = fetch;
    this.report = report;
    /** provider -> account rows with the resolved tier */
    this.byProvider = new Map();
    /** `${provider}/${id}` -> {tier, checkedAt} */
    this.resolved = new Map();
    this.unknownReported = new Set();
    this.version = 0;
    this.running = undefined;
    this.ready = undefined;
    this.timer = null;
  }

  /** Add providers discovered later, such as extension providers. */
  addProviders(names) {
    let changed = false;
    for (const name of names ?? []) {
      if (typeof name !== "string" || name === "" || this.providers.has(name)) continue;
      this.providers.add(name);
      changed = true;
    }
    if (changed) this.version += 1;
  }

  /** Resolve the account list and every tier, then keep them current. */
  start() {
    this.ready = this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.recheckMs);
    this.timer.unref?.();
    return this.ready;
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every known provider. Concurrent callers share it. */
  refresh() {
    this.running ??= this.#refresh().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async #refresh() {
    if (typeof this.credentials.listProviders === "function") {
      try {
        this.addProviders(await this.credentials.listProviders());
      } catch (error) {
        this.report("lazy-router: provider list failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const next = new Map();
    let changed = false;
    for (const provider of [...this.providers].sort()) {
      let rows;
      try {
        rows = await this.credentials.listAccounts(provider);
      } catch (error) {
        this.report("lazy-router: account list failed", {
          provider,
          error: error instanceof Error ? error.message : String(error),
        });
        rows = this.byProvider.get(provider) ?? [];
      }
      const enabled = (Array.isArray(rows) ? rows : [])
        .filter((row) => row && !row.disabled && Number.isInteger(row.id))
        .sort((left, right) => left.id - right.id)
        .map((row) => ({ ...row, provider: row.provider ?? provider }));
      const withTiers = await Promise.all(
        enabled.map(async (row) => ({ ...row, tier: await this.#tierFor(provider, row) })),
      );
      next.set(provider, withTiers);
      if (!sameRows(this.byProvider.get(provider), withTiers)) changed = true;
    }
    this.byProvider = next;
    if (changed || this.version === 0) this.version += 1;
  }

  /** Cached tier of one account, resolved live when stale. */
  async #tierFor(provider, row) {
    const key = accountKey(provider, row.id);
    const known = this.resolved.get(key);
    const at = this.now();
    if (known?.tier !== undefined && at - known.checkedAt < this.tierRefreshMs) return known.tier;

    let tier;
    let failure;
    try {
      tier = await resolveAccountTier(row, {
        credentials: this.credentials,
        fetch: this.fetch,
        refresh: provider === "google-antigravity",
        now: this.now,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    // Keep a known tier through a transient lookup failure.
    if (tier === undefined && known?.tier !== undefined) tier = known.tier;
    this.resolved.set(key, { tier, checkedAt: at });
    if (tier === undefined && !this.unknownReported.has(key)) {
      this.unknownReported.add(key);
      this.report("lazy-router: account tier unknown", {
        provider,
        reason: failure ?? "no tier in the account metadata",
        effect: "matches only route entries without a tier",
      });
    }
    if (tier !== undefined) this.unknownReported.delete(key);
    return tier;
  }

  /** Accounts of one provider, oldest first, with the resolved tier. */
  accounts(provider) {
    return this.byProvider.get(provider) ?? [];
  }

  /** Every account, grouped provider by provider. */
  all() {
    return [...this.byProvider.values()].flat();
  }

  /** The row for one account id, or undefined. */
  accountOf(provider, account) {
    return this.byProvider.get(provider)?.find((row) => row.id === account);
  }

  /** The tier of one account id, or undefined. */
  tierOf(provider, account) {
    return this.accountOf(provider, account)?.tier ?? this.resolved.get(accountKey(provider, account))?.tier;
  }
}

/** True when two account lists carry the same rows and tiers. */
function sameRows(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id || a.provider !== b.provider || a.email !== b.email || a.tier !== b.tier) return false;
  }
  return true;
}
