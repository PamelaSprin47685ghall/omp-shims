// The one persistent store of the router: health, capacity, admission,
// affinity, performance, speed, proof and token totals.
//
// One SQLite file carries the state every gateway worker shares. The store
// never runs `BEGIN IMMEDIATE` on the request path. A single guarded statement
// enforces a capacity limit, and single-row upserts carry every other write.
//
// The schema has `PRAGMA user_version = 2`. A file from the old router (version
// 0 with tables) is refused; the store then uses an in-memory database and
// reports the refusal once. Capacity degrades to local counting. Every method
// catches its own errors, so a storage fault cannot fail a model request.

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { report } from "../contracts.mjs";

/** Schema version of a v2 file. */
export const STATE_VERSION = 2;
/** Metadata marker written last by the additive status-page v3 migration. */
export const STATUS_V3_FEATURE = "status-v3";
/** How long a health row stays after its last write. */
const HEALTH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** How long a capacity row may go untouched before another worker reaps it. */
const CAPACITY_STALE_MS = 5 * 60 * 1000;
/** Perf buckets kept beyond the 30-minute window, for a late reader. */
const PERF_RETENTION_MINUTES = 60;
/** Speed statistics older than this are dropped. */
const SPEED_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
/** Affinity counters are minute buckets kept for five reads plus slack. */
const AFFINITY_STAT_RETENTION_MINUTES = 10;
/** Epoch totals beyond this age are diagnostics nobody asks for. */
const TOKEN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** Canonical v2 schema. A migration must create exactly these tables. */
export const STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS health (
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  until INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  reason_rank INTEGER NOT NULL DEFAULT 0,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  probe_lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS health_updated ON health (updated_at);

CREATE TABLE IF NOT EXISTS capacity (
  unit TEXT NOT NULL,
  worker TEXT NOT NULL,
  held INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (unit, worker)
);
CREATE INDEX IF NOT EXISTS capacity_updated ON capacity (updated_at);

CREATE TABLE IF NOT EXISTS account_cooldown (
  account TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT,
  reason_rank INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit TEXT NOT NULL,
  at INTEGER NOT NULL,
  share REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS admission_unit_at ON admission (unit, at);
CREATE INDEX IF NOT EXISTS admission_at ON admission (at);

CREATE TABLE IF NOT EXISTS affinity (
  digest TEXT PRIMARY KEY,
  length INTEGER NOT NULL,
  unit_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS affinity_expires ON affinity (expires_at);

CREATE TABLE IF NOT EXISTS perf (
  model TEXT NOT NULL,
  period TEXT NOT NULL,
  minute INTEGER NOT NULL,
  ttft_ms REAL NOT NULL DEFAULT 0,
  ttft_n INTEGER NOT NULL DEFAULT 0,
  out_tokens REAL NOT NULL DEFAULT 0,
  token_n INTEGER NOT NULL DEFAULT 0,
  speed_tokens REAL NOT NULL DEFAULT 0,
  gen_ms REAL NOT NULL DEFAULT 0,
  speed_n INTEGER NOT NULL DEFAULT 0,
  total_ms REAL NOT NULL DEFAULT 0,
  total_n INTEGER NOT NULL DEFAULT 0,
  total_log REAL NOT NULL DEFAULT 0,
  total_log_sq REAL NOT NULL DEFAULT 0,
  imputed_n INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, period, minute)
);
CREATE INDEX IF NOT EXISTS perf_minute ON perf (minute);

CREATE TABLE IF NOT EXISTS perf_history (
  model TEXT NOT NULL,
  period TEXT NOT NULL,
  mean_log REAL NOT NULL,
  weight REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, period)
);

CREATE TABLE IF NOT EXISTS speed (
  model TEXT NOT NULL,
  worker TEXT NOT NULL,
  gram TEXT NOT NULL,
  rhs TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  completed REAL NOT NULL DEFAULT 0,
  censored REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, worker)
);

CREATE TABLE IF NOT EXISTS proof (
  model TEXT PRIMARY KEY,
  verified INTEGER NOT NULL,
  until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS totals (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  uncached_input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  seen_uncached INTEGER NOT NULL DEFAULT 0,
  seen_cached INTEGER NOT NULL DEFAULT 0,
  seen_output INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, model)
);

CREATE TABLE IF NOT EXISTS metadata (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const HEALTH_ROW = `key, state, until, reason, fencing_token AS fencingToken,
  probe_lease_until AS probeLeaseUntil`;

const PERF_WRITE = `INSERT INTO perf (
  model, period, minute, ttft_ms, ttft_n, out_tokens, token_n, speed_tokens,
  gen_ms, speed_n, total_ms, total_n, total_log, total_log_sq, imputed_n,
  complete_ms, complete_log, complete_log_sq, complete_n, imputed_ms,
  legacy_mixed, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(model, period, minute) DO UPDATE SET
  ttft_ms = perf.ttft_ms + excluded.ttft_ms,
  ttft_n = perf.ttft_n + excluded.ttft_n,
  out_tokens = perf.out_tokens + excluded.out_tokens,
  token_n = perf.token_n + excluded.token_n,
  speed_tokens = perf.speed_tokens + excluded.speed_tokens,
  gen_ms = perf.gen_ms + excluded.gen_ms,
  speed_n = perf.speed_n + excluded.speed_n,
  total_ms = perf.total_ms + excluded.total_ms,
  total_n = perf.total_n + excluded.total_n,
  total_log = perf.total_log + excluded.total_log,
  total_log_sq = perf.total_log_sq + excluded.total_log_sq,
  imputed_n = perf.imputed_n + excluded.imputed_n,
  complete_ms = perf.complete_ms + excluded.complete_ms,
  complete_log = perf.complete_log + excluded.complete_log,
  complete_log_sq = perf.complete_log_sq + excluded.complete_log_sq,
  complete_n = perf.complete_n + excluded.complete_n,
  imputed_ms = perf.imputed_ms + excluded.imputed_ms,
  legacy_mixed = MAX(perf.legacy_mixed, excluded.legacy_mixed),
  updated_at = excluded.updated_at`;

/** Perf columns the status page reads, including the complete-only fields. */
const PERF_V3_ROW = `model, period, minute, ttft_ms AS ttftMs, ttft_n AS ttftCount,
  out_tokens AS outputTokens, token_n AS tokenCount, speed_tokens AS speedTokens,
  gen_ms AS generationMs, speed_n AS speedCount, total_ms AS totalMs,
  total_n AS totalCount, total_log AS totalLog, total_log_sq AS totalLogSq,
  imputed_n AS imputedCount, complete_ms AS completeMs, complete_log AS completeLog,
  complete_log_sq AS completeLogSq, complete_n AS completeN, imputed_ms AS imputedMs,
  legacy_mixed AS legacyMixed`;

/**
 * Additive v3 tables. `PRAGMA user_version` stays 2 so the previous release
 * can still open the file; every statement here is idempotent.
 */
const STATUS_V3_SCHEMA = `
CREATE TABLE IF NOT EXISTS worker_load (
  worker TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  build_version TEXT NOT NULL,
  view_schema INTEGER NOT NULL,
  in_flight INTEGER NOT NULL DEFAULT 0,
  catalog_ready INTEGER NOT NULL DEFAULT 0,
  epoch TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS worker_load_updated ON worker_load (updated_at);

CREATE TABLE IF NOT EXISTS affinity_stat (
  minute INTEGER PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  lookups INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_epochs (
  id TEXT PRIMARY KEY,
  since TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_totals (
  epoch TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  uncached_input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  seen_uncached INTEGER NOT NULL DEFAULT 0,
  seen_cached INTEGER NOT NULL DEFAULT 0,
  seen_output INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (epoch, provider, model)
);
CREATE INDEX IF NOT EXISTS token_totals_epoch ON token_totals (epoch);
CREATE INDEX IF NOT EXISTS perf_period_minute ON perf (period, minute);
`;

/** Write the current epoch into metadata without touching any other state. */
function writeEpochMetadata(db, id, since) {
  const write = db.prepare("INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)");
  write.run("token_epoch", id);
  if (typeof since === "string" && since.length > 0) write.run("token_epoch_since", since);
}

/**
 * Add the status-page v3 tables and perf columns to an existing v2 file.
 * Backfills the complete-only perf columns and the legacy token epoch. Safe to
 * run on every open; it never drops or renames a v2 table.
 */
export function migrateStatusV3(db, now = Date.now()) {
  const at = Number.isFinite(now) ? now : Date.now();
  db.exec(STATUS_V3_SCHEMA);

  const columns = new Set(
    db
      .query("PRAGMA table_info(perf)")
      .all()
      .map((row) => row.name),
  );
  const add = (name, ddl) => {
    if (!columns.has(name)) db.exec(`ALTER TABLE perf ADD COLUMN ${ddl}`);
  };
  add("complete_ms", "complete_ms REAL NOT NULL DEFAULT 0");
  add("complete_log", "complete_log REAL NOT NULL DEFAULT 0");
  add("complete_log_sq", "complete_log_sq REAL NOT NULL DEFAULT 0");
  add("complete_n", "complete_n INTEGER NOT NULL DEFAULT 0");
  add("imputed_ms", "imputed_ms REAL NOT NULL DEFAULT 0");
  add("legacy_mixed", "legacy_mixed INTEGER NOT NULL DEFAULT 0");

  // Rows written before v3 mixed imputed samples into total_ms. Only a bucket
  // with no imputed sample can be adopted as complete without changing its
  // mean; the rest stay visible as legacy-mixed and are excluded from it.
  db.exec(`UPDATE perf
    SET complete_ms = total_ms,
        complete_log = total_log,
        complete_log_sq = total_log_sq,
        complete_n = MAX(0, total_n - imputed_n)
    WHERE complete_n = 0 AND total_n > 0 AND imputed_n = 0`);
  db.exec(`UPDATE perf SET legacy_mixed = 1 WHERE imputed_n > 0 AND complete_n = 0`);

  const totalRows = Number(db.query("SELECT COUNT(*) AS n FROM totals").get()?.n ?? 0);
  const since = db.query("SELECT value FROM metadata WHERE name = 'since'").get()?.value ?? null;
  if (totalRows > 0 || since) {
    const sinceIso = typeof since === "string" && since.length > 0 ? since : new Date(at).toISOString();
    db.query("INSERT OR IGNORE INTO token_epochs (id, since, created_at) VALUES ('legacy', ?, ?)").run(sinceIso, at);
    db.query(`INSERT OR IGNORE INTO token_totals
      (epoch, provider, model, uncached_input, cached_input, output, complete,
       seen_uncached, seen_cached, seen_output, updated_at)
      SELECT 'legacy', provider, model, uncached_input, cached_input, output, complete,
             seen_uncached, seen_cached, seen_output, ?
      FROM totals`).run(at);
    db.query("INSERT OR IGNORE INTO metadata (name, value) VALUES ('token_epoch', 'legacy')").run();
    db.query("INSERT OR IGNORE INTO metadata (name, value) VALUES ('token_epoch_since', ?)").run(sinceIso);
  }
}

/**
 * Return the current token epoch, creating one on a fresh database. The
 * `legacy` epoch is adopted when the v2 totals were already backfilled.
 * @returns {{id: string, since: string|null}}
 */
export function ensureTokenEpoch(db, now = Date.now()) {
  const at = Number.isFinite(now) ? now : Date.now();
  const read = (name) => db.query("SELECT value FROM metadata WHERE name = ?").get(name)?.value ?? null;
  const current = read("token_epoch");
  if (current) {
    const row = db.query("SELECT id, since FROM token_epochs WHERE id = ?").get(current);
    if (row) return { id: row.id, since: row.since ?? null };
  }
  const legacy = db.query("SELECT id, since FROM token_epochs WHERE id = 'legacy'").get();
  if (legacy) {
    writeEpochMetadata(db, legacy.id, legacy.since);
    return { id: legacy.id, since: legacy.since ?? null };
  }
  const id = `epoch_${at}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const since = new Date(at).toISOString();
  db.query("INSERT OR IGNORE INTO token_epochs (id, since, created_at) VALUES (?, ?, ?)").run(id, since, at);
  writeEpochMetadata(db, id, since);
  return { id, since };
}

/**
 * Rank a cooldown reason. A stronger reason may shorten a cooldown. A weaker
 * reason may only extend it. This keeps a credential failure from being
 * replaced by a transient timeout that would expire sooner.
 */
const REASON_RANKING = [
  [/auth|credential|token|billing|payment|ban|suspend|401|403/i, 3],
  [/quota|exhaust|rate|429|capacity|overload|congest/i, 2],
];

export function reasonRank(reason) {
  if (reason === null || reason === undefined || reason === "") return 0;
  const text = String(reason);
  for (const [pattern, rank] of REASON_RANKING) if (pattern.test(text)) return rank;
  return 1;
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function stateName(state) {
  return state === "dead" || state === "busy" ? state : "alive";
}

export class StateStore {
  /**
   * @param {{path?: string|null, now?: () => number, worker?: string,
   *   admissionWindowMs?: number, mode?: "sqlite"|"memory"}} [options]
   */
  constructor({
    path = null,
    now = Date.now,
    worker = `${hostname()}:${process.pid}`,
    admissionWindowMs = 300_000,
    mode = "sqlite",
  } = {}) {
    this.now = now;
    this.worker = worker;
    this.admissionWindowMs = Math.max(1, admissionWindowMs);
    this.mode = mode === "memory" || path === null ? "memory" : "sqlite";
    this.path = this.mode === "memory" ? null : path;
    this.db = null;
    this.statements = null;
    this.degraded = false;
    this.fileLost = false;
    this.refusals = [];
    this.#reported = new Set();
    this.#localHeld = new Map();
    this.#localHealth = new Map();
    this.#localCooldowns = new Map();
    this.#timer = null;
    this.#lastPrune = this.now();
    this.#open();
  }

  /** A store that never touches the file system. */
  static memory(options = {}) {
    return new StateStore({ ...options, path: null, mode: "memory" });
  }

  #reported;
  #localHeld;
  #localHealth;
  #localCooldowns;
  #timer;
  #lastPrune;
  #affinityQueries = new Map();

  // ---- lifecycle ---------------------------------------------------------

  get available() {
    return this.db !== null;
  }

  #open() {
    const target = this.path ?? ":memory:";
    try {
      if (this.path) mkdirSync(dirname(this.path), { recursive: true });
      const db = new Database(target, { create: true });
      db.exec("PRAGMA busy_timeout=2000");
      db.exec("PRAGMA journal_mode=WAL");
      this.#install(db);
      this.db = db;
      this.prune(this.now());
    } catch (error) {
      this.#refuse("open", `state store cannot open ${this.path ?? "memory"}: ${error?.message ?? error}`);
    }
  }

  #install(db) {
    const existing = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
    const row = db.query("PRAGMA user_version").get();
    const version = Number(row?.user_version ?? 0);
    if (version !== 0 && version !== STATE_VERSION) {
      throw new Error(`unsupported state version ${version}`);
    }
    if (version === 0 && existing.length > 0) {
      throw new Error("legacy state file; run the v2 migration");
    }
    db.exec(STATE_SCHEMA);
    db.exec(`PRAGMA user_version = ${STATE_VERSION}`);
    migrateStatusV3(db, this.now());
    ensureTokenEpoch(db, this.now());
    this.statements = this.#prepare(db);
    this.statements.ensureMeta.run(new Date(this.now()).toISOString());
    // Written last: readers use it as the "every v3 step succeeded" marker.
    db.prepare("INSERT OR REPLACE INTO metadata (name, value) VALUES ('state_features', ?)").run(STATUS_V3_FEATURE);
  }

  #prepare(db) {
    return {
      ensureMeta: db.prepare("INSERT OR IGNORE INTO metadata (name, value) VALUES ('since', ?)"),
      reserve: db.prepare(
        `INSERT INTO capacity (unit, worker, held, updated_at)
         SELECT ?, ?, 1, ?
         WHERE (SELECT COALESCE(SUM(held), 0) FROM capacity WHERE unit = ?) < ?
         ON CONFLICT(unit, worker) DO UPDATE SET held = capacity.held + 1, updated_at = excluded.updated_at`,
      ),
      sumHeld: db.prepare("SELECT COALESCE(SUM(held), 0) AS held FROM capacity WHERE unit = ?"),
      allHeld: db.prepare("SELECT unit, SUM(held) AS held FROM capacity GROUP BY unit"),
      dropHeld: db.prepare("UPDATE capacity SET held = MAX(0, held - 1), updated_at = ? WHERE unit = ? AND worker = ?"),
      deleteEmpty: db.prepare("DELETE FROM capacity WHERE unit = ? AND worker = ? AND held <= 0"),
      touchHeld: db.prepare("UPDATE capacity SET updated_at = ? WHERE worker = ? AND held > 0"),
      reapHeld: db.prepare("DELETE FROM capacity WHERE worker <> ? AND updated_at < ?"),
      dropEmpty: db.prepare("DELETE FROM capacity WHERE held <= 0 AND updated_at < ?"),

      readHealth: db.prepare(`SELECT ${HEALTH_ROW} FROM health WHERE key = ?`),
      listHealth: db.prepare(`SELECT ${HEALTH_ROW}, updated_at AS updatedAt FROM health WHERE updated_at >= ?`),
      claimLease: db.prepare(
        `INSERT INTO health (
           key, state, until, reason, reason_rank, fencing_token, probe_lease_until, updated_at
         ) VALUES ($key, $alive, 0, NULL, 0, 1, $until, $now)
         ON CONFLICT(key) DO UPDATE SET
           fencing_token = health.fencing_token + 1,
           probe_lease_until = $until,
           updated_at = $now
         WHERE health.probe_lease_until <= $now
         RETURNING fencing_token`,
      ),
      writeHealth: db.prepare(
        `INSERT INTO health (key, state, until, reason, reason_rank, fencing_token, probe_lease_until, updated_at)
         VALUES ($key, $state, $until, $reason, $rank, 0, 0, $updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           state = CASE
             WHEN excluded.state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > excluded.updated_at)
               THEN 'dead'
             ELSE excluded.state END,
           until = CASE
             WHEN excluded.state = 'alive' THEN 0
             WHEN excluded.state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > excluded.updated_at)
               THEN health.until
             WHEN excluded.until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN excluded.until
             WHEN excluded.reason_rank > health.reason_rank THEN excluded.until
             ELSE health.until END,
           reason = CASE
             WHEN excluded.state = 'alive' THEN NULL
             WHEN excluded.state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > excluded.updated_at)
               THEN health.reason
             WHEN excluded.until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN excluded.reason
             WHEN excluded.reason_rank > health.reason_rank THEN excluded.reason
             ELSE health.reason END,
           reason_rank = CASE
             WHEN excluded.state = 'alive' THEN 0
             WHEN excluded.state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > excluded.updated_at)
               THEN health.reason_rank
             WHEN excluded.until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN excluded.reason_rank
             WHEN excluded.reason_rank > health.reason_rank THEN excluded.reason_rank
             ELSE health.reason_rank END,
           updated_at = excluded.updated_at`,
      ),
      writeHealthFenced: db.prepare(
        `UPDATE health SET
           state = CASE
             WHEN $state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > $updatedAt)
               THEN 'dead'
             ELSE $state END,
           until = CASE
             WHEN $state = 'alive' THEN 0
             WHEN $state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > $updatedAt)
               THEN health.until
             WHEN $until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN $until
             WHEN $rank > health.reason_rank THEN $until
             ELSE health.until END,
           reason = CASE
             WHEN $state = 'alive' THEN NULL
             WHEN $state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > $updatedAt)
               THEN health.reason
             WHEN $until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN $reason
             WHEN $rank > health.reason_rank THEN $reason
             ELSE health.reason END,
           reason_rank = CASE
             WHEN $state = 'alive' THEN 0
             WHEN $state = 'busy' AND health.state = 'dead'
               AND (health.until = 0 OR health.until > $updatedAt)
               THEN health.reason_rank
             WHEN $until >=
               (CASE WHEN health.state = 'dead' AND health.until = 0
                 THEN 9007199254740991 ELSE health.until END)
               THEN $rank
             WHEN $rank > health.reason_rank THEN $rank
             ELSE health.reason_rank END,
           updated_at = $updatedAt
         WHERE key = $key AND fencing_token = $fence`,
      ),
      markAliveFenced: db.prepare(
        `UPDATE health SET state = 'alive', until = 0, reason = NULL, reason_rank = 0, updated_at = $updatedAt
         WHERE key = $key AND fencing_token = $fence`,
      ),
      pruneHealth: db.prepare("DELETE FROM health WHERE updated_at < ?"),

      upsertCooldown: db.prepare(
        `INSERT INTO account_cooldown (account, until, reason, reason_rank, updated_at)
         VALUES ($account, $until, $reason, $rank, $updatedAt)
         ON CONFLICT(account) DO UPDATE SET
           until = CASE
             WHEN excluded.until >= account_cooldown.until THEN excluded.until
             WHEN excluded.reason_rank > account_cooldown.reason_rank THEN excluded.until
             ELSE account_cooldown.until END,
           reason = CASE
             WHEN excluded.until >= account_cooldown.until THEN excluded.reason
             WHEN excluded.reason_rank > account_cooldown.reason_rank THEN excluded.reason
             ELSE account_cooldown.reason END,
           reason_rank = CASE
             WHEN excluded.until >= account_cooldown.until THEN excluded.reason_rank
             WHEN excluded.reason_rank > account_cooldown.reason_rank THEN excluded.reason_rank
             ELSE account_cooldown.reason_rank END,
           updated_at = excluded.updated_at`,
      ),
      selectCooldowns: db.prepare("SELECT account, until, reason FROM account_cooldown WHERE until > ?"),
      dropCooldowns: db.prepare("DELETE FROM account_cooldown WHERE until <= ?"),

      insertAdmission: db.prepare("INSERT INTO admission (unit, at, share) VALUES (?, ?, ?)"),
      thresholdAdmission: db.prepare(
        "SELECT share FROM admission WHERE unit = ? AND at > ? ORDER BY share DESC LIMIT 1 OFFSET ?",
      ),
      countAdmission: db.prepare("SELECT COUNT(*) AS n FROM admission WHERE unit = ? AND at > ?"),
      pruneAdmission: db.prepare("DELETE FROM admission WHERE at < ?"),

      upsertAffinity: db.prepare(
        `INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(digest) DO UPDATE SET length = excluded.length, unit_key = excluded.unit_key,
           expires_at = excluded.expires_at`,
      ),
      pruneAffinityExpired: db.prepare("DELETE FROM affinity WHERE expires_at <= ?"),
      pruneAffinityCount: db.prepare(
        `DELETE FROM affinity WHERE digest IN (
           SELECT digest FROM affinity ORDER BY expires_at ASC
           LIMIT (SELECT MAX(0, COUNT(*) - ?) FROM affinity))`,
      ),
      countAffinity: db.prepare("SELECT COUNT(*) AS n FROM affinity"),

      writePerf: db.prepare(PERF_WRITE),
      selectPerf: db.prepare(`SELECT ${PERF_V3_ROW} FROM perf WHERE period = ? AND minute >= ? ORDER BY minute`),
      prunePerf: db.prepare("DELETE FROM perf WHERE minute < ?"),
      writeHistory: db.prepare(
        `INSERT INTO perf_history (model, period, mean_log, weight, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(model, period) DO UPDATE SET mean_log = excluded.mean_log,
           weight = excluded.weight, updated_at = excluded.updated_at`,
      ),
      selectHistory: db.prepare(
        "SELECT model, mean_log AS meanLog, weight, updated_at AS updatedAt FROM perf_history WHERE period = ?",
      ),

      upsertSpeed: db.prepare(
        `INSERT INTO speed (model, worker, gram, rhs, weight, completed, censored, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(model, worker) DO UPDATE SET gram = excluded.gram, rhs = excluded.rhs,
           weight = excluded.weight, completed = excluded.completed, censored = excluded.censored,
           updated_at = excluded.updated_at`,
      ),
      selectSpeed: db.prepare(
        "SELECT model, worker, gram, rhs, weight, completed, censored, updated_at AS updatedAt FROM speed",
      ),
      pruneSpeed: db.prepare("DELETE FROM speed WHERE updated_at < ?"),

      upsertProof: db.prepare(
        `INSERT INTO proof (model, verified, until, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(model) DO UPDATE SET verified = MAX(proof.verified, excluded.verified),
           until = MAX(proof.until, excluded.until), updated_at = excluded.updated_at`,
      ),
      selectProof: db.prepare("SELECT model, verified, until FROM proof WHERE model = ? AND until > ?"),
      pruneProof: db.prepare("DELETE FROM proof WHERE until <= ?"),

      addTotals: db.prepare(
        `INSERT INTO totals (provider, model, uncached_input, cached_input, output, complete,
           seen_uncached, seen_cached, seen_output)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(provider, model) DO UPDATE SET
           uncached_input = totals.uncached_input + excluded.uncached_input,
           cached_input = totals.cached_input + excluded.cached_input,
           output = totals.output + excluded.output,
           complete = totals.complete + 1,
           seen_uncached = totals.seen_uncached + excluded.seen_uncached,
           seen_cached = totals.seen_cached + excluded.seen_cached,
           seen_output = totals.seen_output + excluded.seen_output`,
      ),
      addEpochTotals: db.prepare(
        `INSERT INTO token_totals (epoch, provider, model, uncached_input, cached_input,
           output, complete, seen_uncached, seen_cached, seen_output, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(epoch, provider, model) DO UPDATE SET
           uncached_input = token_totals.uncached_input + excluded.uncached_input,
           cached_input = token_totals.cached_input + excluded.cached_input,
           output = token_totals.output + excluded.output,
           complete = token_totals.complete + 1,
           seen_uncached = token_totals.seen_uncached + excluded.seen_uncached,
           seen_cached = token_totals.seen_cached + excluded.seen_cached,
           seen_output = token_totals.seen_output + excluded.seen_output,
           updated_at = excluded.updated_at`,
      ),
      selectTotals: db.prepare(
        `SELECT provider, model, uncached_input AS uncachedInput, cached_input AS cachedInput,
           output, complete, seen_uncached AS seenUncached, seen_cached AS seenCached,
           seen_output AS seenOutput FROM totals ORDER BY provider, model`,
      ),
      sumTotals: db.prepare(
        `SELECT COALESCE(SUM(uncached_input), 0) AS uncachedInput,
           COALESCE(SUM(cached_input), 0) AS cachedInput,
           COALESCE(SUM(output), 0) AS output,
           COALESCE(SUM(complete), 0) AS complete,
           COALESCE(SUM(seen_uncached), 0) AS seenUncached,
           COALESCE(SUM(seen_cached), 0) AS seenCached,
           COALESCE(SUM(seen_output), 0) AS seenOutput FROM totals`,
      ),
      clearTotals: db.prepare("DELETE FROM totals"),
      readMeta: db.prepare("SELECT value FROM metadata WHERE name = 'since'"),
      writeMeta: db.prepare("INSERT OR REPLACE INTO metadata (name, value) VALUES ('since', ?)"),

      readMetaName: db.prepare("SELECT value FROM metadata WHERE name = ?"),
      writeMetaName: db.prepare("INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)"),
      readEpochRow: db.prepare("SELECT id, since FROM token_epochs WHERE id = ?"),
      insertEpoch: db.prepare("INSERT INTO token_epochs (id, since, created_at) VALUES (?, ?, ?)"),
      selectEpochTotals: db.prepare(
        `SELECT provider, model, uncached_input AS uncachedInput, cached_input AS cachedInput,
           output, complete, seen_uncached AS seenUncached, seen_cached AS seenCached,
           seen_output AS seenOutput, updated_at AS updatedAt
         FROM token_totals WHERE epoch = ? ORDER BY provider, model`,
      ),
      countTotals: db.prepare("SELECT COUNT(*) AS n FROM totals"),
      upsertAffinityStat: db.prepare(
        `INSERT INTO affinity_stat (minute, hits, lookups, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(minute) DO UPDATE SET
           hits = affinity_stat.hits + excluded.hits,
           lookups = affinity_stat.lookups + excluded.lookups,
           updated_at = excluded.updated_at`,
      ),
      writeWorkerLoad: db.prepare(
        `INSERT INTO worker_load (
           worker, host, pid, build_version, view_schema, in_flight, catalog_ready, epoch, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(worker) DO UPDATE SET
           host = excluded.host,
           pid = excluded.pid,
           build_version = excluded.build_version,
           view_schema = excluded.view_schema,
           in_flight = excluded.in_flight,
           catalog_ready = excluded.catalog_ready,
           epoch = excluded.epoch,
           updated_at = excluded.updated_at`,
      ),
      deleteWorkerLoad: db.prepare("DELETE FROM worker_load WHERE worker = ?"),
      pruneWorkerLoad: db.prepare("DELETE FROM worker_load WHERE updated_at < ?"),
      pruneAffinityStat: db.prepare("DELETE FROM affinity_stat WHERE minute < ?"),
      pruneTokenTotals: db.prepare("DELETE FROM token_totals WHERE updated_at < ? AND epoch <> ?"),
      pruneTokenEpochs: db.prepare(
        `DELETE FROM token_epochs WHERE created_at < ? AND id <> ?
         AND NOT EXISTS (SELECT 1 FROM token_totals WHERE token_totals.epoch = token_epochs.id)`,
      ),
      sumAffinity: db.prepare(
        `SELECT COALESCE(SUM(hits), 0) AS hits, COALESCE(SUM(lookups), 0) AS lookups
         FROM affinity_stat WHERE minute BETWEEN ? AND ?`,
      ),
      selectPerfRange: db.prepare(
        `SELECT ${PERF_V3_ROW} FROM perf
         WHERE minute BETWEEN ? AND ? AND (period = ? OR ? IS NULL)
         ORDER BY minute, model`,
      ),
      selectWorkerLoads: db.prepare(
        `SELECT worker, host, pid, build_version AS buildVersion, view_schema AS viewSchema,
           in_flight AS inFlight, catalog_ready AS catalogReady, epoch, updated_at AS updatedAt
         FROM worker_load WHERE updated_at >= ? ORDER BY worker`,
      ),
      selectCapacityRows: db.prepare(
        "SELECT unit, worker, held, updated_at AS updatedAt FROM capacity WHERE updated_at >= ? ORDER BY unit, worker",
      ),
      selectHealthRows: db.prepare(
        `SELECT ${HEALTH_ROW}, updated_at AS updatedAt FROM health
         WHERE updated_at >= ? ORDER BY updated_at DESC`,
      ),
      selectProofRows: db.prepare("SELECT model, verified, until FROM proof WHERE until > ?"),
    };
  }

  #refuse(kind, message) {
    this.degraded = true;
    this.fileLost = true;
    this.refusals.push({ kind, message });
    this.#reportOnce(kind, message);
    try {
      this.db?.close();
    } catch {}
    this.db = null;
    this.statements = null;
    try {
      const db = new Database(":memory:", { create: true });
      db.exec("PRAGMA busy_timeout=2000");
      this.#install(db);
      this.db = db;
    } catch (error) {
      this.#reportOnce(`${kind}-memory`, `state store memory fallback failed: ${error?.message ?? error}`);
      this.db = null;
    }
  }

  #reportOnce(kind, message) {
    if (this.#reported.has(kind)) return;
    this.#reported.add(kind);
    report(message);
  }

  #fail(kind, error) {
    this.degraded = true;
    this.#reportOnce(kind, `state store ${kind} failed: ${error?.message ?? error}`);
  }

  /** Start the maintenance interval. One interval per store. */
  start(intervalMs = 60_000) {
    if (this.#timer !== null || !this.db) return;
    this.#timer = setInterval(() => this.prune(), intervalMs);
    this.#timer.unref?.();
  }

  /** Stop the maintenance interval. */
  stop() {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  close() {
    this.stop();
    try {
      this.db?.close();
    } catch {}
    this.db = null;
    this.statements = null;
  }

  // ---- capacity ----------------------------------------------------------

  /**
   * Take one in-flight slot for `unitKey` when the shared total stays below
   * `limit`. `limit <= 0` means unlimited and is not counted.
   * @returns {{granted: boolean, held: number}}
   */
  reserveSlot(unitKey, limit) {
    const cap = Number.isFinite(limit) ? Math.floor(limit) : 0;
    if (cap <= 0) return { granted: true, held: 0 };
    const now = this.now();
    if (this.db) {
      try {
        const result = this.statements.reserve.run(unitKey, this.worker, now, unitKey, cap);
        return { granted: result.changes === 1, held: this.heldOf(unitKey) };
      } catch (error) {
        this.#fail("reserveSlot", error);
      }
    }
    const held = this.#localHeld.get(unitKey) ?? 0;
    if (held >= cap) return { granted: false, held };
    this.#localHeld.set(unitKey, held + 1);
    this.#maybePrune(now);
    return { granted: true, held: held + 1 };
  }

  /** Give back one slot. Idempotent per reservation is the caller's duty. */
  releaseSlot(unitKey) {
    const now = this.now();
    if (this.db) {
      try {
        this.statements.dropHeld.run(now, unitKey, this.worker);
        this.statements.deleteEmpty.run(unitKey, this.worker);
      } catch (error) {
        this.#fail("releaseSlot", error);
      }
    }
    const local = this.#localHeld.get(unitKey) ?? 0;
    if (local > 1) this.#localHeld.set(unitKey, local - 1);
    else this.#localHeld.delete(unitKey);
    this.#maybePrune(now);
  }

  /** Slots open across every worker (or local slots after a failure). */
  heldOf(unitKey) {
    if (this.db) {
      try {
        return Number(this.statements.sumHeld.get(unitKey)?.held ?? 0);
      } catch (error) {
        this.#fail("heldOf", error);
      }
    }
    return this.#localHeld.get(unitKey) ?? 0;
  }

  /** All shared counts, for status and tests. */
  capacityCounts() {
    if (!this.db) return new Map(this.#localHeld);
    const counts = new Map();
    try {
      for (const row of this.statements.allHeld.all()) counts.set(row.unit, row.held);
    } catch (error) {
      this.#fail("capacityCounts", error);
    }
    return counts;
  }

  // ---- health ------------------------------------------------------------

  /** Read one row. Undefined means no cooldown has ever been recorded. */
  readHealth(key) {
    if (this.db) {
      try {
        const row = this.statements.readHealth.get(key);
        if (!row) {
          this.#localHealth.delete(key);
          return undefined;
        }
        const value = {
          state: stateName(row.state),
          until: Number(row.until ?? 0),
          reason: row.reason ?? undefined,
          fencingToken: Number(row.fencingToken ?? 0),
          probeLeaseUntil: Number(row.probeLeaseUntil ?? 0),
        };
        this.#localHealth.set(key, value);
        return { ...value };
      } catch (error) {
        this.#fail("readHealth", error);
      }
    }
    const local = this.#localHealth.get(key);
    return local ? { ...local } : undefined;
  }

  /**
   * Write health state. A fenced write applies only when the caller still owns
   * the probe lease. Neither a fenced nor an unfenced write touches the lease.
   * @returns {boolean} true when the write applied
   */
  writeHealth(key, patch = {}, { fence } = {}) {
    const now = this.now();
    const state = stateName(patch.state);
    const until = Number.isFinite(patch.until) ? Math.max(0, patch.until) : 0;
    const reason = patch.reason === undefined ? null : patch.reason;
    const rank = reasonRank(reason);
    if (this.db) {
      try {
        if (fence !== undefined && fence !== null) {
          const result = this.statements.writeHealthFenced.run({
            $key: key,
            $state: state,
            $until: until,
            $reason: reason,
            $rank: rank,
            $updatedAt: now,
            $fence: fence,
          });
          if (result.changes === 1)
            this.#localHealth.set(key, {
              state,
              until,
              reason: reason ?? undefined,
              fencingToken: fence,
              probeLeaseUntil: this.#localHealth.get(key)?.probeLeaseUntil ?? 0,
            });
          return result.changes === 1;
        }
        this.statements.writeHealth.run({
          $key: key,
          $state: state,
          $until: until,
          $reason: reason,
          $rank: rank,
          $updatedAt: now,
        });
        const current = this.readHealth(key);
        if (current) this.#localHealth.set(key, current);
        this.#maybePrune(now);
        return true;
      } catch (error) {
        this.#fail("writeHealth", error);
      }
    }
    if (fence !== undefined && fence !== null) {
      const current = this.#localHealth.get(key);
      if (!current || current.fencingToken !== fence) return false;
    }
    const current = this.#localHealth.get(key);
    if (state === "alive") {
      this.#localHealth.set(key, {
        state: "alive",
        until: 0,
        reason: undefined,
        fencingToken: current?.fencingToken ?? 0,
        probeLeaseUntil: current?.probeLeaseUntil ?? 0,
      });
      return true;
    }
    const currentRank = current ? reasonRank(current.reason) : 0;
    const currentUntil = current?.until ?? 0;
    const liveDead = current?.state === "dead" && (currentUntil === 0 || currentUntil > now);
    const busyOverDead = state === "busy" && liveDead;
    const oldDeadline = current?.state === "dead" && currentUntil === 0 ? Number.POSITIVE_INFINITY : currentUntil;
    const replace = until >= oldDeadline || rank > currentRank;
    const value = {
      state: busyOverDead ? "dead" : state,
      until: busyOverDead ? currentUntil : replace ? until : currentUntil,
      reason: busyOverDead ? current.reason : replace ? (reason ?? undefined) : current.reason,
      fencingToken: current?.fencingToken ?? 0,
      probeLeaseUntil: current?.probeLeaseUntil ?? 0,
    };
    this.#localHealth.set(key, value);
    return true;
  }

  /** Return one key to service. A fence is required only when one is given. */
  markAlive(key, { fence } = {}) {
    const now = this.now();
    if (this.db) {
      try {
        if (fence !== undefined && fence !== null) {
          const result = this.statements.markAliveFenced.run({ $key: key, $fence: fence, $updatedAt: now });
          if (result.changes === 1) {
            const current = this.#localHealth.get(key) ?? { fencingToken: fence, probeLeaseUntil: 0 };
            this.#localHealth.set(key, {
              state: "alive",
              until: 0,
              reason: undefined,
              fencingToken: current.fencingToken ?? fence,
              probeLeaseUntil: current.probeLeaseUntil ?? 0,
            });
          }
          return result.changes === 1;
        }
        this.statements.writeHealth.run({
          $key: key,
          $state: "alive",
          $until: 0,
          $reason: null,
          $rank: 0,
          $updatedAt: now,
        });
        const current = this.readHealth(key);
        if (current) this.#localHealth.set(key, current);
        this.#maybePrune(now);
        return true;
      } catch (error) {
        this.#fail("markAlive", error);
      }
    }
    return this.writeHealth(key, { state: "alive", until: 0 }, { fence });
  }

  /** Rows written at or after `ms`, oldest first. */
  listHealthChangedSince(ms) {
    if (!this.db) return [];
    try {
      return this.statements.listHealth.all(ms).map((row) => ({
        key: row.key,
        state: stateName(row.state),
        until: Number(row.until ?? 0),
        reason: row.reason ?? undefined,
        fencingToken: Number(row.fencingToken ?? 0),
        probeLeaseUntil: Number(row.probeLeaseUntil ?? 0),
        updatedAt: Number(row.updatedAt ?? 0),
      }));
    } catch (error) {
      this.#fail("listHealthChangedSince", error);
      return [];
    }
  }

  /**
   * Take the right to probe one key. A key with no row is created as ALIVE
   * with fence 1, so a first transient failure can still be probed. Every
   * successful claim rotates the fencing token, so a slower probe from an
   * earlier claim can never write its result.
   * @returns {{claimed: boolean, fence: number}}
   */
  claimProbeLease(key, leaseMs) {
    const now = this.now();
    const until = now + Math.max(1, Number.isFinite(leaseMs) ? leaseMs : 1);
    if (this.db) {
      try {
        const claimed = this.statements.claimLease.get({ $key: key, $alive: "alive", $until: until, $now: now });
        if (claimed) {
          const fence = Number(claimed.fencing_token);
          const current = this.#localHealth.get(key) ?? {
            state: "alive",
            until: 0,
            reason: undefined,
            probeLeaseUntil: 0,
          };
          this.#localHealth.set(key, { ...current, fencingToken: fence, probeLeaseUntil: until });
          return { claimed: true, fence };
        }
        const current = this.statements.readHealth.get(key);
        return { claimed: false, fence: Number(current?.fencingToken ?? 0) };
      } catch (error) {
        this.#fail("claimProbeLease", error);
      }
    }
    const current = this.#localHealth.get(key);
    if (current && current.probeLeaseUntil > now) {
      return { claimed: false, fence: current.fencingToken ?? 0 };
    }
    const fence = (current?.fencingToken ?? 0) + 1;
    const value = current
      ? { ...current, fencingToken: fence, probeLeaseUntil: until }
      : { state: "alive", until: 0, reason: undefined, fencingToken: 1, probeLeaseUntil: until };
    this.#localHealth.set(key, value);
    return { claimed: true, fence };
  }

  // ---- account cooldowns -------------------------------------------------

  /** Record or extend an account-level cooldown. */
  setAccountCooldown(accountKey, until, reason = null) {
    const target = Number.isFinite(until) ? until : 0;
    if (this.db) {
      try {
        this.statements.upsertCooldown.run({
          $account: accountKey,
          $until: target,
          $reason: reason,
          $rank: reasonRank(reason),
          $updatedAt: this.now(),
        });
        this.#maybePrune(this.now());
        return;
      } catch (error) {
        this.#fail("setAccountCooldown", error);
      }
    }
    const current = this.#localCooldowns.get(accountKey);
    if (current && current.until > target && reasonRank(reason) <= reasonRank(current.reason)) return;
    this.#localCooldowns.set(accountKey, { until: target, reason: reason ?? undefined });
  }

  /** Active cooldowns at `now`, keyed by account. */
  listAccountCooldowns(now) {
    const at = Number.isFinite(now) ? now : this.now();
    if (!this.db) return new Map(this.#localCooldowns);
    const result = new Map();
    try {
      for (const row of this.statements.selectCooldowns.all(at)) {
        result.set(row.account, { until: row.until, reason: row.reason ?? undefined });
      }
      return result;
    } catch (error) {
      this.#fail("listAccountCooldowns", error);
      return new Map(this.#localCooldowns);
    }
  }

  // ---- admission ---------------------------------------------------------

  /** Add one cache-benefit sample. */
  recordAdmission(unitKey, share, at) {
    const value = Number(share);
    if (!Number.isFinite(value)) return;
    const when = Number.isFinite(at) ? at : this.now();
    if (this.db) {
      try {
        this.statements.insertAdmission.run(unitKey, when, Math.min(1, Math.max(0, value)));
        this.#maybePrune(when);
      } catch (error) {
        this.#fail("recordAdmission", error);
      }
    }
  }

  /**
   * The `rank`-th largest share after `at`, or undefined when fewer samples
   * exist (everyone fits).
   */
  admissionThreshold(unitKey, at, rank) {
    const offset = Math.max(0, Math.floor(rank) - 1);
    if (!this.db || offset < 0) return undefined;
    try {
      const row = this.statements.thresholdAdmission.get(unitKey, at, offset);
      return row ? row.share : undefined;
    } catch (error) {
      this.#fail("admissionThreshold", error);
      return undefined;
    }
  }

  /** Samples recorded for a unit after `at`. */
  admissionCount(unitKey, at) {
    if (!this.db) return 0;
    try {
      return Number(this.statements.countAdmission.get(unitKey, at)?.n ?? 0);
    } catch (error) {
      this.#fail("admissionCount", error);
      return 0;
    }
  }

  // ---- affinity ----------------------------------------------------------

  putAffinity(digest, length, unitKey, expiresAt) {
    if (!this.db) return;
    try {
      this.statements.upsertAffinity.run(digest, Math.max(0, Math.floor(length)), unitKey, expiresAt);
    } catch (error) {
      this.#fail("putAffinity", error);
    }
  }

  /** Longest live prefix among `digests`, or undefined. */
  lookupAffinity(digests) {
    if (!this.db || !Array.isArray(digests) || digests.length === 0) return undefined;
    try {
      const query = this.#affinityQuery(digests.length);
      const row = query.get(...digests, this.now());
      return row ? { unitKey: row.unitKey, length: row.length } : undefined;
    } catch (error) {
      this.#fail("lookupAffinity", error);
      return undefined;
    }
  }

  #affinityQuery(count) {
    const cached = this.#affinityQueries.get(count);
    if (cached) return cached;
    if (this.#affinityQueries.size > 32) this.#affinityQueries.clear();
    const placeholders = new Array(count).fill("?").join(",");
    const query = this.db.prepare(
      `SELECT unit_key AS unitKey, length FROM affinity
       WHERE digest IN (${placeholders}) AND expires_at > ?
       ORDER BY length DESC, expires_at DESC LIMIT 1`,
    );
    this.#affinityQueries.set(count, query);
    return query;
  }

  /** Drop expired entries, then the oldest ones above `maxEntries`. */
  pruneAffinity(now, maxEntries) {
    if (!this.db) return;
    try {
      this.statements.pruneAffinityExpired.run(now);
      if (Number.isFinite(maxEntries) && maxEntries >= 0) {
        this.statements.pruneAffinityCount.run(maxEntries);
      }
    } catch (error) {
      this.#fail("pruneAffinity", error);
    }
  }

  /** Live affinity rows, for status and tests. */
  countAffinity() {
    if (!this.db) return 0;
    try {
      return Number(this.statements.countAffinity.get()?.n ?? 0);
    } catch (error) {
      this.#fail("countAffinity", error);
      return 0;
    }
  }

  /** Add one minute's lookup counters. Hits are a subset of lookups. */
  recordAffinityStat(minute, hits = 0, lookups = 0) {
    if (!this.db) return;
    const at = Number.isFinite(minute) ? Math.floor(minute) : Math.floor(this.now() / 60_000);
    try {
      this.statements.upsertAffinityStat.run(
        at,
        Math.max(0, Math.floor(finite(hits))),
        Math.max(0, Math.floor(finite(lookups))),
        this.now(),
      );
    } catch (error) {
      this.#fail("recordAffinityStat", error);
    }
  }

  // ---- worker heartbeat --------------------------------------------------

  /**
   * Upsert this worker's liveness row. The heartbeat runs every two seconds,
   * so the write stays a single prepared statement and never throws.
   *
   * @param {{worker: string, host?: string, pid?: number, build_version?: string,
   *   view_schema?: number, in_flight?: number, catalog_ready?: number|boolean,
   *   epoch?: string|null, updated_at?: number}} row
   */
  writeWorkerLoad(row) {
    if (!this.db) return;
    const worker = typeof row?.worker === "string" ? row.worker : "";
    if (worker === "") return;
    const updatedAt = Number.isFinite(row.updated_at) ? row.updated_at : this.now();
    const pid = Number.isFinite(row.pid) ? Math.trunc(row.pid) : 0;
    const viewSchema = Number.isFinite(row.view_schema) ? Math.trunc(row.view_schema) : 3;
    const inFlight = Math.max(0, Math.floor(finite(row.in_flight)));
    const catalogReady = row.catalog_ready === true || finite(row.catalog_ready) > 0 ? 1 : 0;
    const epoch = typeof row.epoch === "string" && row.epoch !== "" ? row.epoch : null;
    try {
      this.statements.writeWorkerLoad.run(
        worker,
        String(row.host ?? ""),
        pid,
        String(row.build_version ?? ""),
        viewSchema,
        inFlight,
        catalogReady,
        epoch,
        updatedAt,
      );
    } catch (error) {
      this.#fail("writeWorkerLoad", error);
    }
  }

  /** Remove one worker's row when it stops gracefully. */
  deleteWorkerLoad(worker) {
    if (!this.db || typeof worker !== "string" || worker === "") return;
    try {
      this.statements.deleteWorkerLoad.run(worker);
    } catch (error) {
      this.#fail("deleteWorkerLoad", error);
    }
  }

  // ---- performance -------------------------------------------------------

  /** Add one or more minute-bucket deltas. */
  addPerf(rows) {
    if (!this.db) return;
    const list = Array.isArray(rows) ? rows : [rows];
    try {
      for (const row of list) {
        if (!row?.model || !Number.isInteger(row.minute)) continue;
        this.statements.writePerf.run(
          row.model,
          row.period ?? "default",
          row.minute,
          finite(row.ttftMs),
          finite(row.ttftCount),
          finite(row.outputTokens),
          finite(row.tokenCount),
          finite(row.speedTokens),
          finite(row.generationMs),
          finite(row.speedCount),
          finite(row.totalMs),
          finite(row.totalCount),
          finite(row.totalLog),
          finite(row.totalLogSq),
          finite(row.imputedCount),
          finite(row.completeMs),
          finite(row.completeLog),
          finite(row.completeLogSq),
          finite(row.completeN ?? row.completeCount),
          finite(row.imputedMs),
          finite(row.legacyMixed),
          this.now(),
        );
      }
      this.#maybePrune(this.now());
    } catch (error) {
      this.#fail("addPerf", error);
    }
  }

  /** Every bucket of one period at or after `sinceMinute`. */
  perfWindow(period, sinceMinute) {
    if (!this.db) return [];
    try {
      return this.statements.selectPerf.all(period, sinceMinute);
    } catch (error) {
      this.#fail("perfWindow", error);
      return [];
    }
  }

  readPerfHistory(period) {
    if (!this.db) return [];
    try {
      return this.statements.selectHistory.all(period);
    } catch (error) {
      this.#fail("readPerfHistory", error);
      return [];
    }
  }

  writePerfHistory(period, rows) {
    if (!this.db) return;
    const list = Array.isArray(rows) ? rows : [rows];
    try {
      for (const row of list) {
        if (!row?.model || !Number.isFinite(row.meanLog) || !Number.isFinite(row.weight)) continue;
        this.statements.writeHistory.run(row.model, period, row.meanLog, row.weight, this.now());
      }
    } catch (error) {
      this.#fail("writePerfHistory", error);
    }
  }

  // ---- cyclic speed ------------------------------------------------------

  upsertSpeed(model, worker, gram, rhs, stats = {}) {
    if (!this.db) return;
    try {
      this.statements.upsertSpeed.run(
        model,
        worker,
        JSON.stringify(gram),
        JSON.stringify(rhs),
        finite(stats.weight),
        finite(stats.completed),
        finite(stats.censored),
        Number.isFinite(stats.updatedAt) ? stats.updatedAt : this.now(),
      );
    } catch (error) {
      this.#fail("upsertSpeed", error);
    }
  }

  /** Every worker's row. The grammar and right-hand side are JSON strings. */
  readSpeedRows() {
    if (!this.db) return [];
    try {
      return this.statements.selectSpeed.all();
    } catch (error) {
      this.#fail("readSpeedRows", error);
      return [];
    }
  }

  // ---- concurrency proof -------------------------------------------------

  /** Raise a model's verified concurrency and its expiry. */
  setProof(model, verified, until) {
    if (!this.db) return;
    const count = Number.isFinite(verified) ? Math.max(0, Math.floor(verified)) : 0;
    const expiry = Number.isFinite(until) ? until : 0;
    try {
      this.statements.upsertProof.run(model, count, expiry, this.now());
    } catch (error) {
      this.#fail("setProof", error);
    }
  }

  /** Live proof for a model, or undefined. */
  getProof(model) {
    if (!this.db) return undefined;
    try {
      const row = this.statements.selectProof.get(model, this.now());
      return row ? { verified: row.verified, until: row.until } : undefined;
    } catch (error) {
      this.#fail("getProof", error);
      return undefined;
    }
  }

  // ---- token totals ------------------------------------------------------

  /**
   * Add one completed request's provider-reported usage.
   *
   * The request-start epoch selects the `token_totals` row; a missing or
   * unknown epoch is a refusal, not a fallback to the current epoch. The same
   * transaction mirrors the aggregate into the v2 `totals` table so a code
   * rollback keeps its counters. The three-argument form is the v2 contract
   * and writes only the legacy mirror.
   *
   * A missing metric stays unobserved. Usage with no metric at all writes
   * nothing and returns false.
   *
   * @returns {boolean} true when at least one row was written
   */
  addTokenTotals(epoch, provider, model, usage) {
    let legacyOnly = false;
    if (usage === undefined && (model === undefined || typeof model === "object")) {
      legacyOnly = true;
      usage = model;
      model = provider;
      provider = epoch;
      epoch = undefined;
    }
    if (!this.db) return false;
    if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") return false;
    const values = {
      uncachedInput: tokenValue(usage, ["uncachedInput", "uncached_input", "input", "input_tokens"]),
      cachedInput: tokenValue(usage, ["cachedInput", "cached_input", "cached", "cache_read_input_tokens"]),
      output: tokenValue(usage, ["output", "outputTokens", "output_tokens", "completion_tokens"]),
    };
    const seenUncached = values.uncachedInput === null ? 0 : 1;
    const seenCached = values.cachedInput === null ? 0 : 1;
    const seenOutput = values.output === null ? 0 : 1;
    if (seenUncached + seenCached + seenOutput === 0) return false;
    let target = null;
    if (!legacyOnly) {
      if (typeof epoch !== "string" || epoch === "") return false;
      target = epoch;
    }
    const now = this.now();
    try {
      this.db.transaction(() => {
        if (target !== null) {
          this.statements.addEpochTotals.run(
            target,
            provider,
            model,
            values.uncachedInput ?? 0,
            values.cachedInput ?? 0,
            values.output ?? 0,
            seenUncached,
            seenCached,
            seenOutput,
            now,
          );
        }
        this.statements.addTotals.run(
          provider,
          model,
          values.uncachedInput ?? 0,
          values.cachedInput ?? 0,
          values.output ?? 0,
          seenUncached,
          seenCached,
          seenOutput,
        );
        // Keep the v2 `since` marker equal to the epoch it belongs to. A late
        // write to an older epoch must not move the current epoch's start.
        if (target !== null && target === this.statements.readMetaName.get("token_epoch")?.value) {
          const since = this.statements.readEpochRow.get(target)?.since;
          if (typeof since === "string" && since.length > 0) this.statements.writeMetaName.run("since", since);
        }
      })();
      return true;
    } catch (error) {
      this.#fail("addTokenTotals", error);
      return false;
    }
  }

  /** Current epoch id. Read-only; a request captures it before its first attempt. */
  captureTokenEpoch() {
    if (!this.db || this.fileLost) return null;
    try {
      const value = this.statements.readMetaName.get("token_epoch")?.value;
      return typeof value === "string" && value.length > 0 ? value : null;
    } catch (error) {
      this.#fail("captureTokenEpoch", error);
      return null;
    }
  }

  /**
   * One read transaction for the status page: epoch, totals, perf, speed,
   * workers, capacity, health, proof and affinity. Returns raw rows only.
   * Formatting and stale classification belong to snapshot.mjs.
   */
  readStatusData(request = {}) {
    const now = Number.isFinite(request.now) ? request.now : this.now();
    const minute = Math.floor(now / 60_000);
    const period =
      typeof request.period === "string"
        ? request.period
        : typeof request.period?.id === "string"
          ? request.period.id
          : null;
    const perfSinceMinute = Number.isFinite(request.perfSinceMinute) ? request.perfSinceMinute : minute - 29;
    const perfUntilMinute = Number.isFinite(request.perfUntilMinute) ? request.perfUntilMinute : minute;
    const affinitySinceMinute = Number.isFinite(request.affinitySinceMinute) ? request.affinitySinceMinute : minute - 4;
    const workerSince = Number.isFinite(request.workerSince) ? request.workerSince : now - CAPACITY_STALE_MS;
    const healthSince = Number.isFinite(request.healthSince) ? request.healthSince : now - HEALTH_RETENTION_MS;
    const mode = this.mode === "memory" ? "memory" : this.fileLost ? "unavailable" : "sqlite";
    const empty = (reason, statusMode = mode) => ({
      available: false,
      mode: statusMode,
      reason,
      epoch: null,
      tokenTotals: null,
      perfRows: [],
      speedRows: [],
      workerRows: [],
      capacityRows: [],
      healthRows: [],
      proofRows: [],
      affinityStats: null,
    });
    if (!this.db) return empty("共享存储不可用", "unavailable");
    // A memory database carries this process's values only. Publishing its
    // capacity, health, proof or totals through the shared read would label
    // local state as a global truth; the affinity counters stay readable for
    // local diagnostics.
    if (this.mode === "memory") {
      const bundle = empty("共享状态不可用", "memory");
      try {
        const affinity = this.statements.sumAffinity.get(affinitySinceMinute, minute);
        bundle.affinityStats = {
          hits: Number(affinity?.hits ?? 0),
          lookups: Number(affinity?.lookups ?? 0),
          sinceMinute: affinitySinceMinute,
          untilMinute: minute,
        };
      } catch (error) {
        this.#fail("readStatusData", error);
      }
      return bundle;
    }
    if (this.fileLost) return empty("共享存储不可用", "unavailable");
    try {
      return this.db.transaction(() => {
        const epochId = this.statements.readMetaName.get("token_epoch")?.value ?? null;
        const epochRow = epochId ? this.statements.readEpochRow.get(epochId) : null;
        const epoch = epochId ? { id: epochId, since: epochRow?.since ?? null } : null;
        const tokenRows = epochId ? this.statements.selectEpochTotals.all(epochId) : [];
        const affinity = this.statements.sumAffinity.get(affinitySinceMinute, minute);
        return {
          available: mode === "sqlite",
          mode,
          reason: mode === "sqlite" ? null : "共享状态不可用",
          epoch,
          tokenTotals: epoch ? { epoch, rows: tokenRows, models: tokenRows } : null,
          perfRows: this.statements.selectPerfRange.all(perfSinceMinute, perfUntilMinute, period, period),
          speedRows: this.statements.selectSpeed.all(),
          workerRows: this.statements.selectWorkerLoads.all(workerSince),
          capacityRows: this.statements.selectCapacityRows.all(workerSince),
          healthRows: this.statements.selectHealthRows.all(healthSince),
          proofRows: this.statements.selectProofRows.all(now),
          affinityStats: {
            hits: Number(affinity?.hits ?? 0),
            lookups: Number(affinity?.lookups ?? 0),
            sinceMinute: affinitySinceMinute,
            untilMinute: minute,
          },
        };
      })();
    } catch (error) {
      this.#fail("readStatusData", error);
      return empty("共享存储读取失败", "sqlite");
    }
  }

  /** Totals, coverage and the reporting epoch start. */
  readTokenTotals() {
    const empty = {
      since: null,
      totals: { uncachedInput: 0, cachedInput: 0, output: 0 },
      coverage: { complete: 0, uncachedInput: 0, cachedInput: 0, output: 0 },
      models: [],
    };
    if (!this.db) return empty;
    try {
      const sum = this.statements.sumTotals.get();
      const since = this.statements.readMeta.get()?.value ?? null;
      const models = this.statements.selectTotals.all().map((row) => ({
        provider: row.provider,
        model: row.model,
        uncachedInput: row.uncachedInput,
        cachedInput: row.cachedInput,
        output: row.output,
        complete: row.complete,
      }));
      return {
        since,
        totals: {
          uncachedInput: Number(sum?.uncachedInput ?? 0),
          cachedInput: Number(sum?.cachedInput ?? 0),
          output: Number(sum?.output ?? 0),
        },
        coverage: {
          complete: Number(sum?.complete ?? 0),
          uncachedInput: Number(sum?.seenUncached ?? 0),
          cachedInput: Number(sum?.seenCached ?? 0),
          output: Number(sum?.seenOutput ?? 0),
        },
        models,
      };
    } catch (error) {
      this.#fail("readTokenTotals", error);
      return empty;
    }
  }

  /**
   * Reset the legacy v2 totals, or begin a v3 epoch when `resetId` is given.
   *
   * The v3 form is one write transaction. A replay of the same `resetId`
   * returns the current epoch without creating another one; a second reset
   * within two seconds is a conflict so two racing clients cannot both win.
   * Old epoch rows stay readable, while the status read filters to the new
   * current epoch.
   *
   * @returns {{epoch: {id: string, since: string|null}, idempotent: boolean}
   *   | {conflict: true, epoch: {id: string, since: string|null}} | null}
   */
  resetTokenTotals(options = {}) {
    if (options === null || (options !== undefined && typeof options !== "object")) return null;
    const { resetId } = options;
    if (resetId === undefined) {
      if (!this.db) return false;
      try {
        this.db.transaction(() => {
          this.statements.clearTotals.run();
          this.statements.writeMeta.run(new Date(this.now()).toISOString());
        })();
        return true;
      } catch (error) {
        this.#fail("resetTokenTotals", error);
        return false;
      }
    }
    if (typeof resetId !== "string" || resetId === "") return null;
    if (!this.db || this.mode === "memory" || this.fileLost) return null;
    const now = this.now();
    try {
      return this.db.transaction(() => {
        const currentId = this.statements.readMetaName.get("token_epoch")?.value ?? null;
        const currentRow = currentId ? this.statements.readEpochRow.get(currentId) : null;
        const current = currentId ? { id: currentId, since: currentRow?.since ?? null } : null;
        const lastResetId = this.statements.readMetaName.get("last_reset_id")?.value ?? null;
        if (lastResetId === String(resetId) && current) return { epoch: current, idempotent: true };
        const lastResetAt = Number(this.statements.readMetaName.get("last_reset_at")?.value ?? 0);
        if (current && Number.isFinite(lastResetAt) && lastResetAt > 0 && now - lastResetAt < 2000) {
          return { conflict: true, epoch: current };
        }
        const id = `epoch_${now}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
        const since = new Date(now).toISOString();
        this.statements.insertEpoch.run(id, since, now);
        this.statements.writeMetaName.run("token_epoch", id);
        this.statements.writeMetaName.run("token_epoch_since", since);
        this.statements.writeMetaName.run("last_reset_id", String(resetId));
        this.statements.writeMetaName.run("last_reset_at", String(now));
        this.statements.clearTotals.run();
        this.statements.writeMeta.run(since);
        return { epoch: { id, since }, idempotent: false };
      })();
    } catch (error) {
      this.#fail("resetTokenTotals", error);
      return null;
    }
  }

  // ---- maintenance -------------------------------------------------------

  /** Reap dead capacity rows and prune every bounded table. */
  prune(now = this.now()) {
    this.#lastPrune = now;
    if (!this.db) return;
    try {
      this.statements.touchHeld.run(now, this.worker);
      this.statements.reapHeld.run(this.worker, now - CAPACITY_STALE_MS);
      this.statements.dropEmpty.run(now - 60 * 60 * 1000);
      this.statements.pruneAdmission.run(now - this.admissionWindowMs);
      this.statements.pruneHealth.run(now - HEALTH_RETENTION_MS);
      this.statements.dropCooldowns.run(now);
      this.statements.prunePerf.run(Math.floor(now / 60_000) - PERF_RETENTION_MINUTES);
      this.statements.pruneAffinityExpired.run(now);
      this.statements.pruneWorkerLoad.run(now - CAPACITY_STALE_MS);
      this.statements.pruneAffinityStat.run(Math.floor(now / 60_000) - AFFINITY_STAT_RETENTION_MINUTES);
      this.statements.pruneProof.run(now);
      this.statements.pruneSpeed.run(now - SPEED_RETENTION_MS);
      const currentEpoch = this.statements.readMetaName.get("token_epoch")?.value ?? null;
      if (typeof currentEpoch === "string" && currentEpoch !== "") {
        const cutoff = now - TOKEN_RETENTION_MS;
        this.statements.pruneTokenTotals.run(cutoff, currentEpoch);
        this.statements.pruneTokenEpochs.run(cutoff, currentEpoch);
      }
    } catch (error) {
      this.#fail("prune", error);
    }
  }

  #maybePrune(now = this.now()) {
    if (now - this.#lastPrune < 60_000) return;
    this.prune(now);
  }
}

/** Read one token metric from the first present alias. */
function tokenValue(usage, keys) {
  for (const key of keys) {
    const value = usage?.[key];
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return null;
}
