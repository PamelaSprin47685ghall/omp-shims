// Pinned-account credentials and how each provider presents them.
//
// Reads auth_credentials from agent.db (read-only) and refreshes OAuth tokens
// that are about to expire through the auth-broker, the same way
// antigravity-account-routing does. The broker stays the only writer.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

/** Re-read agent.db at most this often; broker refreshes land there. */
const RELOAD_INTERVAL_MS = 30_000;
/** Refresh a token this long before it expires. */
const REFRESH_MARGIN_MS = 120_000;
/** Assumed lifetime when the broker omits an expiry. */
const FALLBACK_TOKEN_TTL_MS = 3_600_000;

/**
 * Outbound auth headers per provider. The default covers bearer APIs; a
 * provider whose token is bound to an account id says so here.
 * @type {Record<string, (credential: Credential) => Record<string, string>>}
 */
export const AUTH_HEADERS = {
  default: (credential) => ({ authorization: `Bearer ${credential.secret}` }),
  // The Codex backend checks the token against the ChatGPT account header.
  "openai-codex": (credential) => ({
    authorization: `Bearer ${credential.secret}`,
    ...(credential.accountId ? { "chatgpt-account-id": credential.accountId } : {}),
  }),
};

/** Headers that present `credential` to its provider. */
export function authHeadersFor(credential) {
  return (AUTH_HEADERS[credential.provider] ?? AUTH_HEADERS.default)(credential);
}

/**
 * @typedef {{id: number, provider: string, secret: string, expires: number, accountId?: string, oauth: boolean}} Credential
 */

/** Parse one auth_credentials row; undefined when it holds no usable secret. */
export function parseCredentialRow(row) {
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return undefined;
  }
  const secret = data.access ?? data.key;
  if (typeof secret !== "string" || secret === "") return undefined;
  return {
    id: row.id,
    provider: row.provider,
    secret,
    expires: Number(data.expires) || 0,
    oauth: typeof data.access === "string",
    ...(data.accountId ? { accountId: data.accountId } : {}),
  };
}

export class CredentialStore {
  /**
   * @param {{dbPath: string, brokerUrl: string, brokerTokenPath: string, now?: () => number,
   *   readRows?: () => {id: number, provider: string, data: string}[]}} options
   */
  constructor({ dbPath, brokerUrl, brokerTokenPath, now = Date.now, readRows }) {
    this.brokerUrl = brokerUrl.replace(/\/+$/, "");
    this.brokerTokenPath = brokerTokenPath;
    this.now = now;
    this.readRows = readRows ?? (() => readCredentialRows(dbPath));
    /** @type {Map<number, Credential>} */
    this.byId = new Map();
    this.loadedAt = 0;
  }

  /** The provider an id belongs to (for attributing broker calls). */
  providerOf(id) {
    this.#reloadIfStale();
    return this.byId.get(id)?.provider;
  }

  /**
   * Every enabled credential, oldest first (ascending id = creation order).
   * Rows added or removed in agent.db show up within one reload interval.
   * @returns {Credential[]}
   */
  list() {
    this.#reloadIfStale();
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  /** A fresh credential for `id`, refreshed through the broker when close to expiry. */
  async resolve(id) {
    this.#reloadIfStale();
    const credential = this.byId.get(id);
    if (!credential) return undefined;
    if (credential.oauth && credential.expires - REFRESH_MARGIN_MS <= this.now()) await this.#refresh(credential);
    return credential;
  }

  /** True for a URL on the auth-broker. */
  isBrokerUrl(url) {
    return url.startsWith(`${this.brokerUrl}/`);
  }

  #reloadIfStale() {
    if (this.now() - this.loadedAt < RELOAD_INTERVAL_MS && this.loadedAt > 0) return;
    let rows;
    try {
      rows = this.readRows();
    } catch {
      return;
    }
    const next = new Map();
    for (const row of rows) {
      const loaded = parseCredentialRow(row);
      if (!loaded) continue;
      // Keep a broker-refreshed token we already hold if agent.db lags behind it.
      const held = this.byId.get(loaded.id);
      next.set(loaded.id, held && held.expires > loaded.expires ? held : loaded);
    }
    this.byId = next;
    this.loadedAt = this.now();
  }

  async #refresh(credential) {
    const token = readTrimmed(this.brokerTokenPath);
    if (!token) return;
    try {
      const response = await fetch(`${this.brokerUrl}/v1/credential/${credential.id}/refresh`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const fresh = (await response.json())?.entry?.credential;
      if (fresh?.access) {
        credential.secret = fresh.access;
        credential.expires = Number(fresh.expires) || this.now() + FALLBACK_TOKEN_TTL_MS;
      }
    } catch {}
  }
}

/** Read every enabled credential row from agent.db, read-only. */
function readCredentialRows(dbPath) {
  const { Database } = require_("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query("SELECT id, provider, data FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY id").all();
  } finally {
    db.close();
  }
}

/** A file's trimmed contents, or "" when it cannot be read. */
export function readTrimmed(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}
