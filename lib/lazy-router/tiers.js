// Account tiers, read at runtime from metadata the providers already expose.
//
// Route entries select accounts by tier ("plus", "pro", "ultra", ...) rather
// than by credential, so the repository never names an account. Each provider
// that has tiers registers a resolver here; a provider without one, or an
// account whose tier cannot be read, has no tier and is matched only by route
// entries that do not ask for one.

import { runPinned } from "../credential-pin.js";

/** Re-read a known tier this often; plans change rarely. */
export const TIER_REFRESH_MS = 21_600_000;
/** Look for new, removed or unresolved credentials this often. */
export const TIER_RECHECK_MS = 60_000;
/** Give up on one tier lookup after this long. */
export const TIER_LOOKUP_TIMEOUT_MS = 15_000;

/** The OpenAI OAuth claim that carries the ChatGPT account. */
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
/** Cloud Code Assist endpoint that reports the Google AI subscription of an account. */
export const CODE_ASSIST_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist";
/** Without an Antigravity client user agent, loadCodeAssist omits the account's tiers. */
const CODE_ASSIST_USER_AGENT = "antigravity";

/** "g1-ultra-tier" → "ultra", "Plus" → "plus"; undefined for anything empty. */
export function normalizeTier(raw) {
  if (typeof raw !== "string") return undefined;
  const tier = raw
    .trim()
    .toLowerCase()
    .replace(/^g\d+-/, "")
    .replace(/-tier$/, "");
  return tier === "" ? undefined : tier;
}

/** The payload of a JWT, without verifying it (the provider already did). */
export function decodeJwtPayload(token) {
  const part = typeof token === "string" ? token.split(".")[1] : undefined;
  if (!part) return undefined;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Per-provider tier resolvers.
 *
 * `freshToken` asks for a token refreshed through the broker first (needed when
 * the resolver calls the provider); `resolve` returns the raw tier name.
 * @type {Record<string, {freshToken: boolean, resolve: (credential: import("./credentials.js").Credential,
 *   context: {fetch: typeof fetch}) => Promise<string|undefined>}>}
 */
export const TIER_RESOLVERS = {
  // The ChatGPT plan is a claim of the OAuth access token itself.
  "openai-codex": {
    freshToken: false,
    resolve: async (credential) => decodeJwtPayload(credential.secret)?.[OPENAI_AUTH_CLAIM]?.chatgpt_plan_type,
  },
  // The Google AI subscription is the paid tier Cloud Code Assist reports for the account.
  "google-antigravity": {
    freshToken: true,
    resolve: async (credential, { fetch }) => {
      const response = await fetch(`${CODE_ASSIST_ENDPOINT}${LOAD_CODE_ASSIST_PATH}`, {
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
      });
      if (!response.ok) throw new Error(`loadCodeAssist answered ${response.status}`);
      const answer = await response.json();
      return answer?.paidTier?.id ?? answer?.currentTier?.id;
    },
  },
};

/**
 * Tier of every enabled credential, kept current in the background.
 *
 * `version` changes whenever the credential set or a tier changes, so callers
 * can cache what they derive from it.
 */
export class TierDirectory {
  /**
   * @param {{credentials: import("./credentials.js").CredentialStore,
   *   resolvers?: typeof TIER_RESOLVERS, refreshMs?: number, recheckMs?: number,
   *   fetch?: typeof fetch, emit?: (event: string, detail?: object) => void, now?: () => number}} options
   */
  constructor({
    credentials,
    resolvers = TIER_RESOLVERS,
    refreshMs = TIER_REFRESH_MS,
    recheckMs = TIER_RECHECK_MS,
    fetch = (...args) => globalThis.fetch(...args),
    emit = () => {},
    now = Date.now,
  }) {
    Object.assign(this, { credentials, resolvers, refreshMs, recheckMs, fetch, emit, now });
    /** @type {Map<number, {tier?: string, checkedAt: number}>} */
    this.tiers = new Map();
    this.unknownReported = new Set();
    this.version = 0;
    this.signature = "";
    /** @type {{id: number, provider: string, tier?: string}[]} */
    this.snapshot = [];
    this.running = undefined;
    this.ready = undefined;
  }

  /** Resolve every tier now, then keep them current. Returns the first pass. */
  start() {
    this.ready = this.refresh();
    const timer = setInterval(() => this.refresh(), this.recheckMs);
    timer.unref?.();
    this.timer = timer;
    return this.ready;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Tier of a credential id; undefined when the provider has no tiers or it is not known (yet). */
  tierOf(id) {
    return this.tiers.get(id)?.tier;
  }

  /** Enabled accounts with their tiers as of the last pass, oldest first. */
  accounts() {
    return this.snapshot;
  }

  /** One pass over the credential set; concurrent callers share it. */
  refresh() {
    this.running ??= this.#refresh().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async #refresh() {
    const credentials = this.credentials.list();
    const live = new Set(credentials.map((credential) => credential.id));
    for (const id of this.tiers.keys()) if (!live.has(id)) this.tiers.delete(id);

    await Promise.all(credentials.map((credential) => this.#check(credential)));
    this.#bumpIfChanged(credentials);
  }

  async #check(credential) {
    const resolver = this.resolvers[credential.provider];
    if (!resolver) return;
    const known = this.tiers.get(credential.id);
    if (known?.tier !== undefined && this.now() - known.checkedAt < this.refreshMs) return;

    let tier;
    let failure;
    try {
      const subject = resolver.freshToken ? await this.credentials.resolve(credential.id) : credential;
      if (subject) {
        // Pinned, so account-selecting fetch layers leave the lookup on this account.
        tier = normalizeTier(
          await runPinned({ provider: credential.provider, credentialId: credential.id }, () =>
            resolver.resolve(subject, { fetch: this.fetch }),
          ),
        );
      }
    } catch (error) {
      failure = String(error?.message ?? error);
    }
    // Keep a known tier through a transient lookup failure.
    if (tier === undefined && known?.tier !== undefined) tier = known.tier;
    this.tiers.set(credential.id, { tier, checkedAt: this.now() });
    if (tier === undefined && !this.unknownReported.has(credential.id)) {
      this.unknownReported.add(credential.id);
      this.emit("tier-unknown", {
        provider: credential.provider,
        reason: failure ?? "no tier in the account metadata",
        effect: "matches only route entries without a tier",
      });
    }
    if (tier !== undefined) this.unknownReported.delete(credential.id);
  }

  #bumpIfChanged(credentials) {
    const signature = credentials
      .map((credential) => `${credential.provider}/${credential.id}=${this.tierOf(credential.id) ?? ""}`)
      .join(",");
    if (signature === this.signature) return;
    this.signature = signature;
    this.snapshot = credentials.map((credential) => ({
      id: credential.id,
      provider: credential.provider,
      tier: this.tierOf(credential.id),
    }));
    this.version += 1;
  }
}
