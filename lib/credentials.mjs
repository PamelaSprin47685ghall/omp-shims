// The only credential reader and writer adapter.
//
// The gateway and the broker share one credential store: agent.db. This module
// opens it read-only for lookups, refreshes one token through the broker, and
// copies a kiro-cli token into it. Runtime modules never open auth_credentials
// except through this adapter. The CLI account importer in
// lib/account-import.mjs is the only other writer: it adds accounts and repairs
// identities, and it runs only from `add-account` and `repair-identities`.
//
// Every network call goes to the broker URL only. The URL must use https, or
// http on the exact host 127.0.0.1 or localhost. Redirects are refused, because
// a redirect could forward the broker token to another host.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { activePin, NO_AUTH_SENTINEL } from "./contracts.mjs";
import { bypassFetch } from "./outbound.mjs";

const require_ = createRequire(import.meta.url);

/** Parsed credential cache lifetime. */
const CACHE_TTL_MS = 60_000;
/** Default broker refresh timeout. */
const REFRESH_TIMEOUT_MS = 10_000;
/** Fallback broker URL used by the OMP broker. */
const DEFAULT_BROKER_URL = "http://127.0.0.1:8765";
/** Fallback token lifetime when a source gives no usable expiry. */
const FALLBACK_TTL_MS = 3_600_000;
/** A plain SQLite identifier that the module may place in a query. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Expand a leading `~` to the home directory.
 *
 * The function accepts only "~" and "~/...". Other spellings stay unchanged.
 * A non-string value returns undefined.
 */
function expandHome(file) {
  if (typeof file !== "string" || file === "") return undefined;
  if (file === "~") return homedir();
  if (file.startsWith("~/")) return join(homedir(), file.slice(2));
  return file;
}

/** Load bun:sqlite lazily, so a missing runtime returns undefined instead of throwing. */
function bunSqlite() {
  try {
    return require_("bun:sqlite");
  } catch {
    return undefined;
  }
}

/**
 * Open a SQLite file in read-only mode.
 *
 * The handle sets a 2000 ms busy timeout. The function never throws. It returns
 * undefined when the file is missing, the runtime has no bun:sqlite, or the
 * file cannot be opened.
 */
function openReadonlyDb(dbPath) {
  const file = expandHome(dbPath);
  if (!file || !existsSync(file)) return undefined;
  const sqlite = bunSqlite();
  if (!sqlite?.Database) return undefined;
  let db;
  try {
    db = new sqlite.Database(file, { readonly: true });
    db.exec("PRAGMA busy_timeout = 2000");
    return db;
  } catch {
    try {
      db?.close();
    } catch {}
    return undefined;
  }
}

/**
 * Open the agent credential database as a read-only handle.
 *
 * The handle uses mode "ro" semantics (`readonly: true`) and a 2000 ms busy
 * timeout. The function never throws; it returns undefined on any failure.
 */
export function openAgentDb(dbPath) {
  return openReadonlyDb(dbPath);
}

/** Return a string, a stringified finite number, or undefined. */
function identityValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Return a string or undefined. */
function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}

/** Return a finite millisecond value, or 0. */
function expiryValue(value) {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : 0;
}

/**
 * Return a usable secret, or undefined.
 *
 * A secret must be a non-empty string. It must not equal the no-auth sentinel.
 */
function usableSecret(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === NO_AUTH_SENTINEL) return undefined;
  return value;
}

/** Return the first usable secret in the list. */
function firstToken(...values) {
  for (const value of values) {
    const secret = usableSecret(value);
    if (secret !== undefined) return secret;
  }
  return undefined;
}

/** Compare two optional email values without case. */
function sameEmail(left, right) {
  return (
    typeof left === "string" && typeof right === "string" && left.trim().toLowerCase() === right.trim().toLowerCase()
  );
}

/** Compare two optional tier values without case. */
function sameTier(left, right) {
  return (
    typeof left === "string" && typeof right === "string" && left.trim().toLowerCase() === right.trim().toLowerCase()
  );
}

/** True when a row is not disabled. */
function isEnabled(row) {
  return row.disabled_cause === null || row.disabled_cause === undefined;
}

/** True when `credential` matches every filter that the caller supplied. */
function matchesFilter(credential, filter) {
  if (!credential) return false;
  if (filter.id !== undefined) {
    if (credential.id === undefined || String(credential.id) !== String(filter.id)) return false;
  }
  if (filter.accountId !== undefined) {
    if (credential.accountId === undefined) return false;
    if (String(credential.accountId) !== String(filter.accountId)) return false;
  }
  if (filter.email !== undefined && !sameEmail(credential.email, filter.email)) return false;
  if (filter.tier !== undefined && !sameTier(credential.tier, filter.tier)) return false;
  return true;
}

/** Build a credential from one auth_credentials row. Return undefined when unusable. */
function credentialFromRow(row) {
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;

  const secret = firstToken(data.access, data.key, data.apiKey, data.token);
  if (!secret) return undefined;

  return {
    id: row.id,
    provider: row.provider,
    accountId: identityValue(data.accountId ?? data.account_id),
    email: stringValue(data.email),
    secret,
    expiresAt: expiryValue(data.expires ?? data.expiresAt),
    refreshToken: stringValue(data.refresh ?? data.refresh_token),
    tier: stringValue(data.tier),
  };
}

/** Build a credential from a request-scoped pin. Return undefined when unusable. */
function credentialFromPin(pin, provider) {
  const secret = firstToken(pin.secret);
  if (!secret) return undefined;
  return {
    id: pin.credentialId ?? pin.id,
    provider: pin.provider ?? provider,
    accountId: identityValue(pin.accountId),
    email: stringValue(pin.email),
    secret,
    expiresAt: expiryValue(pin.expiresAt ?? pin.expires),
    refreshToken: stringValue(pin.refreshToken),
    tier: stringValue(pin.tier),
  };
}

/**
 * Normalize the broker base URL.
 *
 * Only https URLs and http URLs on 127.0.0.1 or localhost are valid. The
 * function rejects embedded credentials, query strings, and hashes. A bad value
 * returns undefined.
 */
function normalizeBrokerUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol === "http:") {
    const host = url.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") return undefined;
  } else if (url.protocol !== "https:") {
    return undefined;
  }
  url.search = "";
  url.hash = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Validate one credential id. Return a positive safe integer or undefined. */
function credentialId(value) {
  const id = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** True when a token string is present and is not the literal word "undefined". */
function validKiroToken(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "undefined";
}

/** Read the kiro-cli social token row. Return undefined when it is absent or unreadable. */
function readKiroToken(dbPath) {
  const db = openReadonlyDb(dbPath);
  if (!db) return undefined;
  try {
    const row = db.query("SELECT value FROM auth_kv WHERE key = 'kirocli:social:token'").get();
    if (!row || typeof row.value !== "string") return undefined;
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/** Read the expiry of a kiro token. Fall back to one hour from now. */
function kiroExpiry(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + FALLBACK_TTL_MS;
}

/** Resolve a token value and apply the `$ENV` rule. */
function tokenValue(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const placeholder = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (!placeholder) return trimmed;
  const fromEnv = process.env[placeholder[1]];
  if (typeof fromEnv !== "string") return trimmed;
  const envValue = fromEnv.trim();
  return envValue === "" ? undefined : envValue;
}

/** Resolve `{ json: { file, path } }`. */
function resolveJsonSpec(json) {
  if (!json || typeof json !== "object") return undefined;
  const file = expandHome(json.file);
  if (!file || typeof json.path !== "string" || json.path === "") return undefined;
  let value;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  for (const key of json.path.split(".")) {
    if (key === "" || value === null || value === undefined) return undefined;
    value = value[key];
  }
  return tokenValue(value);
}

/** Resolve `{ sqlite: { file, table?, column?, query? } }`. */
function resolveSqliteSpec(sqlite) {
  if (!sqlite || typeof sqlite !== "object") return undefined;
  const file = expandHome(sqlite.file);
  if (!file) return undefined;

  let column;
  if (sqlite.column !== undefined) {
    if (typeof sqlite.column !== "string" || !SQL_IDENTIFIER.test(sqlite.column)) return undefined;
    column = sqlite.column;
  }
  let query = typeof sqlite.query === "string" && sqlite.query.trim() !== "" ? sqlite.query : undefined;

  if (!query) {
    const table = sqlite.table;
    if (typeof table !== "string" || !SQL_IDENTIFIER.test(table)) return undefined;
    query = `SELECT * FROM "${table}"`;
  }

  const db = openReadonlyDb(file);
  if (!db) return undefined;
  try {
    const row = db.query(query).get();
    if (!row) return undefined;
    const value = column === undefined ? Object.values(row)[0] : row[column];
    return tokenValue(value);
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/**
 * Read and refresh credentials for the gateway.
 *
 * One instance owns its caches and its read-only database handle. It never
 * writes agent.db, except in syncKiroCredential, which is an explicit copy.
 */
export class CredentialRepository {
  #cache = new Map();
  #inflight = new Map();
  #agentDb;
  #brokerToken;
  #kiroMtimes = new Map();

  /**
   * @param {{agentDbPath?: string, brokerUrl?: string, brokerTokenPath?: string, kiroDbPath?: string,
   *   fetch?: typeof fetch}} options
   */
  constructor({ agentDbPath, brokerUrl, brokerTokenPath, kiroDbPath, fetch: customFetch } = {}) {
    this.agentDbPath = expandHome(agentDbPath) ?? join(homedir(), ".omp", "agent", "agent.db");
    this.brokerUrl = normalizeBrokerUrl(brokerUrl ?? DEFAULT_BROKER_URL);
    this.brokerTokenPath = expandHome(brokerTokenPath) ?? join(homedir(), ".omp", "auth-broker.token");
    this.kiroDbPath = expandHome(kiroDbPath) ?? join(homedir(), ".local", "share", "kiro-cli", "data.sqlite3");
    // A custom fetch is for tests and alternate runtimes. The default bypasses
    // the outbound provider chain, so a broker refresh cannot re-enter a shim.
    this.fetch = typeof customFetch === "function" ? customFetch : undefined;
  }

  /**
   * Return the first usable credential for `provider` that matches the filter.
   *
   * An active request pin constrains the result. A pin that carries a secret
   * answers directly and reads no database. A pin that carries only an
   * identity narrows the database lookup to that identity; an identity that
   * conflicts with a supplied filter resolves nothing. A parsed row stays
   * cached for 60 seconds. Disabled rows are skipped. A secret must be
   * non-empty and must not equal NO_AUTH_SENTINEL. Any read failure returns
   * undefined.
   *
   * @param {string} provider
   * @param {{id?: number | string, accountId?: string | number, email?: string, tier?: string}} [filter]
   */
  async resolve(provider, filter = {}) {
    if (typeof provider !== "string" || provider === "") return undefined;
    const wanted = filter && typeof filter === "object" ? filter : {};

    let pin;
    try {
      pin = activePin(provider);
    } catch {
      pin = undefined;
    }
    let effective = wanted;
    if (pin) {
      // A secret on the pin is authoritative, including an explicit empty or
      // sentinel secret that must reject the pin.
      if (pin.secret !== undefined) {
        const pinned = credentialFromPin(pin, provider);
        return matchesFilter(pinned, wanted) ? pinned : undefined;
      }

      // An identity-only pin (GatewayDispatcher's attempt pin, for example)
      // never supplies a secret. It narrows the database lookup to its own
      // identity and refuses any conflicting filter instead of falling back
      // to another account.
      const pinId = pin.credentialId ?? pin.id;
      const pinAccountId = pin.accountId;
      const pinEmail = pin.email;
      if (wanted.id !== undefined && pinId !== undefined && credentialId(wanted.id) !== credentialId(pinId)) {
        return undefined;
      }
      if (
        wanted.accountId !== undefined &&
        pinAccountId !== undefined &&
        String(wanted.accountId) !== String(pinAccountId)
      ) {
        return undefined;
      }
      if (wanted.email !== undefined && pinEmail !== undefined && !sameEmail(wanted.email, pinEmail)) {
        return undefined;
      }
      effective = {
        ...wanted,
        ...(pinId === undefined ? {} : { id: pinId }),
        ...(pinAccountId === undefined ? {} : { accountId: pinAccountId }),
        ...(pinEmail === undefined ? {} : { email: pinEmail }),
      };
    }

    const rows = this.#rows(provider);
    for (const row of rows) {
      if (!isEnabled(row)) continue;
      const credential = this.#credentialForRow(row);
      if (matchesFilter(credential, effective)) return credential;
    }
    return undefined;
  }

  /**
   * Ask the broker for a fresh secret.
   *
   * Calls for one id share one in-flight request. The request has a 10 second
   * default timeout and refuses redirects. The method never writes agent.db; it
   * only calls the broker. Any failure returns undefined.
   *
   * @param {number | string} id
   * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
   * @returns {Promise<{secret: string, expiresAt: number} | undefined>}
   */
  async refresh(id, { signal, timeoutMs = REFRESH_TIMEOUT_MS } = {}) {
    const key = credentialId(id);
    if (key === undefined) return undefined;

    const existing = this.#inflight.get(key);
    if (existing) return existing;

    const task = this.#refreshOnce(key, signal, timeoutMs).finally(() => {
      if (this.#inflight.get(key) === task) this.#inflight.delete(key);
    });
    this.#inflight.set(key, task);
    return task;
  }

  /**
   * Drop cached credentials.
   *
   * With no id, drop every cached credential. With an id, drop that entry only.
   * The method never touches agent.db and never cancels an in-flight refresh.
   *
   * @param {number | string} [id]
   */
  invalidate(id) {
    if (id === undefined) {
      this.#cache.clear();
      return;
    }
    const key = credentialId(id);
    if (key !== undefined) this.#cache.delete(key);
  }

  /**
   * List safe account fields for one provider in one query.
   *
   * Each item has no secret field. A row with disabled_cause set reports
   * `disabled: true`. A read failure returns an empty array.
   *
   * @param {string} provider
   * @returns {Promise<Array<{id: number, email: string | undefined, tier: string | undefined, disabled: boolean, expiresAt: number}>>}
   */
  async listAccounts(provider) {
    if (typeof provider !== "string" || provider === "") return [];
    const rows = this.#rows(
      provider,
      "SELECT id, data, disabled_cause FROM auth_credentials WHERE provider = ? ORDER BY id",
    );
    const accounts = [];
    for (const row of rows) {
      let data = {};
      try {
        const parsed = JSON.parse(row.data);
        if (parsed && typeof parsed === "object") data = parsed;
      } catch {}
      accounts.push({
        id: row.id,
        email: stringValue(data.email),
        tier: stringValue(data.tier),
        disabled: !isEnabled(row),
        expiresAt: expiryValue(data.expires ?? data.expiresAt),
      });
    }
    return accounts;
  }

  /**
   * List every provider that has at least one credential row.
   *
   * The result is sorted and distinct. It includes providers whose rows are
   * all disabled. A read failure returns an empty array.
   *
   * @returns {Promise<string[]>}
   */
  async listProviders() {
    const db = this.#openAgentDb();
    if (!db) return [];
    try {
      const rows = db.query("SELECT DISTINCT provider FROM auth_credentials ORDER BY provider").all();
      return rows.map((row) => stringValue(row.provider)).filter((provider) => provider !== undefined);
    } catch {
      try {
        db.close();
      } catch {}
      this.#agentDb = undefined;
      return [];
    }
  }

  /**
   * Resolve one configured token source.
   *
   * The method supports `{ value }`, `{ env }`, `{ json: { file, path } }`, and
   * `{ sqlite: { file, column?, query?, table? } }`. It returns a trimmed,
   * non-empty string only. The sqlite branch reads the named column, or the
   * first column when no name is given. It never guesses another value.
   *
   * A resolved value that starts with "$" stays literal, unless it matches
   * `$NAME` and that environment variable exists.
   *
   * @param {object | string} spec
   * @returns {string | undefined}
   */
  resolveTokenSpec(spec) {
    try {
      if (typeof spec === "string") return tokenValue(spec);
      if (!spec || typeof spec !== "object") return undefined;
      if (spec.value !== undefined) return tokenValue(spec.value);
      if (spec.env !== undefined) {
        if (typeof spec.env !== "string" || spec.env === "") return undefined;
        return tokenValue(process.env[spec.env]);
      }
      if (spec.json !== undefined) return resolveJsonSpec(spec.json);
      if (spec.sqlite !== undefined) return resolveSqliteSpec(spec.sqlite);
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Copy a valid kiro-cli token into the agent credential store.
   *
   * The method validates access_token and refresh_token before any write. Both
   * must be non-empty strings and must not equal "undefined". The write is one
   * transaction and bumps auth_change_revision. An unchanged source file is
   * skipped by mtime. Any failure returns { changed: false, reason }.
   *
   * @param {string} [sourcePath]
   * @param {{agentDbPath?: string}} [options]
   * @returns {{changed: boolean, reason?: string}}
   */
  syncKiroCredential(sourcePath, { agentDbPath } = {}) {
    const source = expandHome(sourcePath === undefined ? this.kiroDbPath : sourcePath);
    const target = expandHome(agentDbPath ?? this.agentDbPath);
    if (!source) return { changed: false, reason: "source path is missing" };
    if (!target) return { changed: false, reason: "agent database path is missing" };
    const cacheKey = `${source}\u0000${target}`;
    if (!existsSync(target)) {
      this.#kiroMtimes.delete(cacheKey);
      return { changed: false, reason: "agent database is missing" };
    }

    let stat;
    try {
      stat = statSync(source);
    } catch {
      this.#kiroMtimes.delete(cacheKey);
      return { changed: false, reason: "source file is missing" };
    }
    if (this.#kiroMtimes.get(cacheKey) === stat.mtimeMs) {
      return { changed: false, reason: "source file is unchanged" };
    }

    const token = readKiroToken(source);
    if (!token) return { changed: false, reason: "kiro token is missing" };

    const accessToken = token.access_token;
    const refreshToken = token.refresh_token;
    if (!validKiroToken(accessToken)) return { changed: false, reason: "kiro access token is invalid" };
    if (!validKiroToken(refreshToken)) return { changed: false, reason: "kiro refresh token is invalid" };

    const sqlite = bunSqlite();
    if (!sqlite?.Database) return { changed: false, reason: "bun:sqlite is unavailable" };

    let db;
    try {
      db = new sqlite.Database(target, { readwrite: true, create: false });
      db.exec("PRAGMA busy_timeout = 2000");
    } catch {
      try {
        db?.close();
      } catch {}
      return { changed: false, reason: "agent database cannot be opened" };
    }

    try {
      const row = db.query("SELECT id, data FROM auth_credentials WHERE provider = 'kiro' ORDER BY id LIMIT 1").get();
      if (!row) return { changed: false, reason: "kiro credential is absent" };

      let current;
      try {
        current = JSON.parse(row.data);
      } catch {
        return { changed: false, reason: "stored credential is not valid JSON" };
      }
      if (!current || typeof current !== "object") {
        return { changed: false, reason: "stored credential is not an object" };
      }

      const next = {
        ...current,
        access: accessToken,
        refresh: `${refreshToken}|desktop`,
        expires: kiroExpiry(token.expires_at),
        region:
          typeof token.region === "string" && token.region !== "" ? token.region : (current.region ?? "us-east-1"),
        profileArn:
          typeof token.profile_arn === "string" && token.profile_arn !== "" ? token.profile_arn : current.profileArn,
      };

      const unchanged =
        current.access === next.access &&
        current.refresh === next.refresh &&
        current.expires === next.expires &&
        current.region === next.region &&
        current.profileArn === next.profileArn;
      if (unchanged) {
        this.#kiroMtimes.set(cacheKey, stat.mtimeMs);
        return { changed: false, reason: "credential is already current" };
      }

      const update = db.transaction(() => {
        db.query(
          "UPDATE auth_credentials SET data = ?, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?",
        ).run(JSON.stringify(next), row.id);
        db.query("UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1").run();
      });
      update();
      this.#kiroMtimes.set(cacheKey, stat.mtimeMs);
      return { changed: true };
    } catch {
      return { changed: false, reason: "agent database write failed" };
    } finally {
      try {
        db.close();
      } catch {}
    }
  }

  /** Release the cached database handle and clear cached values. */
  close() {
    try {
      this.#agentDb?.close();
    } catch {}
    this.#agentDb = undefined;
    this.#cache.clear();
    this.#inflight.clear();
    this.#brokerToken = undefined;
    this.#kiroMtimes.clear();
  }

  /** Return the shared read-only handle, or undefined. */
  #openAgentDb() {
    if (!this.#agentDb) this.#agentDb = openReadonlyDb(this.agentDbPath);
    return this.#agentDb;
  }

  /** Read rows with one query. Return an empty array on any failure. */
  #rows(
    provider,
    query = "SELECT id, provider, data, disabled_cause FROM auth_credentials WHERE provider = ? ORDER BY id",
  ) {
    const db = this.#openAgentDb();
    if (!db) return [];
    try {
      return db.query(query).all(provider);
    } catch {
      try {
        db.close();
      } catch {}
      this.#agentDb = undefined;
      return [];
    }
  }

  /** Return a cached credential for one row, or parse and cache it. */
  #credentialForRow(row) {
    const now = Date.now();
    const cached = this.#cache.get(row.id);
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
    const value = credentialFromRow(row);
    if (!value) return undefined;
    this.#cache.set(row.id, { at: now, value });
    return value;
  }

  /** Read the broker token, cached by file mtime. */
  #brokerTokenValue() {
    const path = expandHome(this.brokerTokenPath);
    if (!path) return "";
    let mtimeMs;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      this.#brokerToken = undefined;
      return "";
    }
    if (this.#brokerToken?.mtimeMs === mtimeMs) return this.#brokerToken.value;
    let value = "";
    try {
      value = readFileSync(path, "utf8").trim();
    } catch {}
    this.#brokerToken = { mtimeMs, value };
    return value;
  }

  /** Perform one broker refresh. Never throws. */
  async #refreshOnce(id, signal, timeoutMs) {
    if (!this.brokerUrl) return undefined;
    const token = this.#brokerTokenValue();
    if (!token) return undefined;

    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : REFRESH_TIMEOUT_MS;
    let requestSignal;
    try {
      requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    } catch {
      return undefined;
    }

    let response;
    try {
      response = await (this.fetch ?? bypassFetch)(`${this.brokerUrl}/v1/credential/${id}/refresh`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: requestSignal,
        redirect: "error",
      });
    } catch {
      return undefined;
    }

    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {}
      return undefined;
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return undefined;
    }

    const entry = body?.entry?.credential ?? body?.credential ?? body;
    const secret = firstToken(entry?.secret, entry?.access, entry?.key);
    if (!secret) return undefined;
    const expiresAt = expiryValue(entry?.expires ?? entry?.expiresAt);

    const cached = this.#cache.get(id);
    if (cached) {
      cached.value.secret = secret;
      cached.value.expiresAt = expiresAt;
      cached.at = Date.now();
    }
    return { secret, expiresAt };
  }
}
