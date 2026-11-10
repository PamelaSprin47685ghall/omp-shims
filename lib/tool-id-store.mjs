// Global tool-call id shortening, backed by the shared state database.
//
// Some providers reject two tool calls whose ids share a long prefix, and some
// clients mint ids longer than OpenAI's 64-character limit. Every distinct
// original id gets one short id here. The mapping is a table in the shared
// omp-shims-state.sqlite, so every gateway worker and every later process sees
// the same short id for the same original. Nothing is truncated: the short is
// derived from a SHA-256 digest of the whole original.
//
// SQLite is the authority. A bounded in-process LRU only saves the round trip
// for ids already seen: an original -> short hit avoids the upsert for a
// minute, and a short -> original hit avoids the SELECT. A hit never changes
// the mapping. Rows expire after the TTL and the table is capped, so the file
// cannot grow without bound.
//
// Minted ids use the `t_` prefix. A fresh short never reuses a value that was
// already seen as an original, so a response value that is ambiguous between a
// client id and a minted short is left alone instead of being guessed.
//
// Fail-open contract: shortFor() throws on a cold miss, so an inbound rewrite
// can abandon a partial body and send the request untouched; originalFor()
// returns undefined, so a failed lookup leaves a response value alone. A broken
// store never fails a model request.

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { report } from "./contracts.mjs";

/** Prefix of every minted short id. */
export const SHORT_PREFIX = "t_";

/** Hash characters kept at each attempt. 10 gives a 12-character id; 14 gives 16. */
export const SHORT_LENGTHS = Object.freeze([10, 12, 14]);

/** How long a mapping survives after its last use. */
export const TOOL_ID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Most rows the table may hold, oldest first. */
export const TOOL_ID_MAX_ROWS = 200_000;

/** Entries kept in each in-process cache. */
export const TOOL_ID_CACHE_ENTRIES = 10_000;

/** Do not write last_seen more often than this. */
const TOUCH_INTERVAL_MS = 60 * 1000;

/** Run a prune after this many writes. */
const PRUNE_EVERY_WRITES = 256;

/** Background prune interval. The timer never keeps a process alive. */
const MAINTENANCE_MS = 10 * 60 * 1000;

/** The shared state schema version this module can bootstrap. Keep it equal to STATE_VERSION. */
const STATE_SCHEMA_VERSION = 2;

/** The only table this store owns. */
export const TOOL_ID_SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original TEXT NOT NULL UNIQUE,
  short TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tool_ids_last_seen ON tool_ids (last_seen);
`;

/** True for an error another attempt may cure. */
function retryable(error) {
  const text = String(error?.message ?? error);
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(text);
}

/** True when the insert lost a race for the short value. */
function shortCollision(error) {
  return /UNIQUE constraint failed:\s*tool_ids\.short|SQLITE_CONSTRAINT_UNIQUE/i.test(String(error?.message ?? error));
}

/** The deterministic short id for one original at one digest length. */
export function shortId(original, length = SHORT_LENGTHS[0]) {
  const digest = createHash("sha256").update(original, "utf8").digest("base64url");
  return `${SHORT_PREFIX}${digest.slice(0, length)}`;
}

/** A Map that evicts the least recently used entry above its limit. */
class LruCache {
  #map = new Map();
  #limit;

  constructor(limit) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  get size() {
    return this.#map.size;
  }

  get(key) {
    const value = this.#map.get(key);
    if (value === undefined) return undefined;
    this.#map.delete(key);
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#limit) this.#map.delete(this.#map.keys().next().value);
  }

  clear() {
    this.#map.clear();
  }
}

export class ToolIdStore {
  #path;
  #now;
  #ttlMs;
  #maxRows;
  #db = null;
  #statements = null;
  #timer = null;
  #writes = 0;
  #closed = false;
  #reported = new Set();
  #byOriginal = new LruCache(TOOL_ID_CACHE_ENTRIES);
  #byShort = new LruCache(TOOL_ID_CACHE_ENTRIES);

  /**
   * @param {{ path?: string|null, now?: () => number, ttlMs?: number, maxRows?: number,
   *   cacheEntries?: number }} [options]
   * A null path uses an in-memory database. The timer is always unref'd.
   */
  constructor({
    path = null,
    now = Date.now,
    ttlMs = TOOL_ID_TTL_MS,
    maxRows = TOOL_ID_MAX_ROWS,
    cacheEntries = TOOL_ID_CACHE_ENTRIES,
  } = {}) {
    this.#path = typeof path === "string" && path !== "" ? path : ":memory:";
    this.#now = now;
    this.#ttlMs = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : TOOL_ID_TTL_MS;
    this.#maxRows = Number.isFinite(maxRows) ? Math.max(0, Math.floor(maxRows)) : TOOL_ID_MAX_ROWS;
    if (Number.isFinite(cacheEntries) && cacheEntries > 0) {
      this.#byOriginal = new LruCache(cacheEntries);
      this.#byShort = new LruCache(cacheEntries);
    }
    this.#open();
  }

  /** True when SQLite answered every operation. */
  get available() {
    return this.#db !== null;
  }

  /** True after close(). A caller may then open a fresh instance. */
  get closed() {
    return this.#closed;
  }

  /** The database path, or ":memory:". */
  get path() {
    return this.#path;
  }

  /** The open connection, for diagnostics and tests. */
  get db() {
    return this.#db;
  }

  /** Cached originals, for diagnostics and tests. */
  get cacheEntries() {
    return this.#byOriginal.size;
  }

  /** Rows currently stored. Useful for status and tests. */
  count() {
    if (!this.#db) return 0;
    try {
      return Number(this.#statements.count.get()?.n ?? 0);
    } catch (error) {
      this.#fail("count", error);
      return 0;
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  #open() {
    const target = this.#path;
    try {
      if (target !== ":memory:") mkdirSync(dirname(target), { recursive: true });
      const db = new Database(target, { create: true });
      db.exec("PRAGMA busy_timeout=2000");
      try {
        db.exec("PRAGMA journal_mode=WAL");
      } catch {
        // A file system without WAL support still serves the mapping.
      }
      db.exec(TOOL_ID_SCHEMA);
      this.#adoptSchemaVersion(db);
      this.#statements = this.#prepare(db);
      this.#db = db;
      this.prune(this.#now());
      this.#startMaintenance();
    } catch (error) {
      this.#db = null;
      this.#statements = null;
      this.#fail("open", error);
    }
  }

  /**
   * A fresh shared file must carry the v2 state version, because the router
   * store refuses a version 0 file that already has tables. Bootstrap only a
   * file this store alone created; a legacy file keeps version 0 and the
   * migration stays the only way to upgrade it.
   */
  #adoptSchemaVersion(db) {
    const version = Number(db.query("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== 0) return;
    const foreign = db
      .query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('tool_ids', 'tool_ids_meta')`,
      )
      .all();
    if (foreign.length === 0) db.exec(`PRAGMA user_version = ${STATE_SCHEMA_VERSION}`);
  }

  #prepare(db) {
    return {
      // The insert returns the stored short: normally the deterministic one,
      // and on a rare short collision the extended digest a previous write won.
      insert: db.prepare(
        `INSERT INTO tool_ids (original, short, created_at, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(original) DO UPDATE SET last_seen = excluded.last_seen
         RETURNING short`,
      ),
      findShort: db.prepare(
        `SELECT original FROM tool_ids AS mapped
         WHERE mapped.short = ?1
           AND NOT EXISTS (SELECT 1 FROM tool_ids AS source WHERE source.original = ?1)`,
      ),
      prune: db.prepare("DELETE FROM tool_ids WHERE last_seen < ?"),
      cap: db.prepare(
        `DELETE FROM tool_ids WHERE id IN (
           SELECT id FROM tool_ids ORDER BY last_seen ASC
           LIMIT (SELECT MAX(0, COUNT(*) - ?) FROM tool_ids))`,
      ),
      count: db.prepare("SELECT COUNT(*) AS n FROM tool_ids"),
    };
  }

  #startMaintenance() {
    if (this.#timer !== null || !this.#db) return;
    this.#timer = setInterval(() => this.prune(), MAINTENANCE_MS);
    this.#timer.unref?.();
  }

  /** Stop the maintenance timer and close the database. Idempotent. */
  close() {
    this.#closed = true;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    try {
      this.#db?.close();
    } catch {
      // A close failure must not surface to a request.
    }
    this.#db = null;
    this.#statements = null;
    this.#byOriginal.clear();
    this.#byShort.clear();
  }

  // ---- mapping -----------------------------------------------------------

  /**
   * Return the stable short id for `original`, or the original itself for an
   * empty value.
   *
   * A cached id returns immediately. A cached id older than a minute writes
   * last_seen again, but a failed refresh keeps the cached answer. A cold miss
   * throws when the store is unavailable; the caller abandons its rewrite.
   */
  shortFor(original) {
    if (typeof original !== "string" || original === "") return original;

    const now = this.#now();
    const cached = this.#byOriginal.get(original);
    if (cached !== undefined) {
      if (now - cached.refreshedAt >= TOUCH_INTERVAL_MS) this.#touch(original, cached, now);
      return cached.short;
    }
    if (!this.#db) throw new Error("the tool id store is unavailable");

    const short = this.#upsert(original, now);
    this.#byOriginal.set(original, { short, refreshedAt: now });
    this.#byShort.set(short, original);
    this.#writes += 1;
    this.#maybePrune(now);
    return short;
  }

  /**
   * Return the original id for a minted short, or undefined when the value is
   * unknown, not minted here, or the store cannot answer. Never throws: an
   * outbound stream must keep flowing.
   */
  originalFor(short) {
    if (typeof short !== "string" || !short.startsWith(SHORT_PREFIX)) return undefined;
    const cached = this.#byShort.get(short);
    if (cached !== undefined) return cached;
    if (!this.#db) return undefined;
    try {
      const original = this.#statements.findShort.get(short)?.original;
      if (original !== undefined) this.#byShort.set(short, original);
      return original;
    } catch (error) {
      this.#fail("originalFor", error);
      return undefined;
    }
  }

  #touch(original, cached, now) {
    if (!this.#db) return;
    try {
      this.#upsert(original, now);
      cached.refreshedAt = now;
    } catch (error) {
      // The mapping is already known; a failed refresh only delays the prune.
      this.#fail("touch", error);
    }
  }

  #upsert(original, now) {
    let lastError;
    for (const length of SHORT_LENGTHS) {
      const short = shortId(original, length);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return this.#statements.insert.get(original, short, now, now).short;
        } catch (error) {
          lastError = error;
          if (shortCollision(error)) break;
          if (!retryable(error)) throw error;
        }
      }
    }
    throw lastError;
  }

  // ---- maintenance -------------------------------------------------------

  /** Delete expired rows, then the oldest rows above the cap. Return removed count. */
  prune(now = this.#now()) {
    if (!this.#db) return 0;
    try {
      const expired = this.#statements.prune.run(now - this.#ttlMs).changes;
      const capped = this.#statements.cap.run(this.#maxRows).changes;
      return Number(expired ?? 0) + Number(capped ?? 0);
    } catch (error) {
      this.#fail("prune", error);
      return 0;
    }
  }

  #maybePrune(now) {
    if (this.#writes < PRUNE_EVERY_WRITES) return;
    this.#writes = 0;
    this.prune(now);
  }

  #fail(kind, error) {
    if (this.#reported.has(kind)) return;
    this.#reported.add(kind);
    report(`tool id store ${kind} failed: ${error?.message ?? error}`);
  }
}

/* ------------------------------------------------------------------ */
/* The process-wide singleton.                                         */
/* ------------------------------------------------------------------ */

let singleton = null;
let singletonPath;

/**
 * Return the one store for `path` in this process. A different path, or a
 * closed store, opens a replacement. Production has exactly one path: the
 * configured stateDbPath.
 */
export function toolIdStore(path) {
  const key = typeof path === "string" && path !== "" ? path : ":memory:";
  if (singleton && singletonPath === key && !singleton.closed) return singleton;
  singleton?.close();
  singleton = new ToolIdStore({ path: key });
  singletonPath = key;
  return singleton;
}

/** Close and forget the singleton. */
export function closeToolIdStore() {
  singleton?.close();
  singleton = null;
  singletonPath = undefined;
}
