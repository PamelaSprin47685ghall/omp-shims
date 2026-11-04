// Cross-worker state that used to be per-process singletons.
//
// One gateway worker is one JavaScript thread; four workers mean four copies of
// every in-memory structure. Cooldowns already live in health-store.js. This
// store holds the rest, in one SQLite file:
//
//   capacity         distributed in-flight semaphore per unit, with heartbeat
//                    and reaping so a dead worker cannot hold slots forever
//   admission        cache-benefit samples per limited unit (rolling window)
//   account_cooldown account-level 429 cooldowns (Antigravity tiers)
//
// The request path only touches SQLite for *limited* units and for account
// routing; everything else stays in-process. Reads are mirrored and refreshed,
// writes are write-through, and a store error degrades to the previous
// per-worker behaviour instead of rejecting traffic.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS capacity (
  unit TEXT NOT NULL,
  worker TEXT NOT NULL,
  held INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (unit, worker)
);
CREATE TABLE IF NOT EXISTS admission (
  unit TEXT NOT NULL,
  at INTEGER NOT NULL,
  share REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS admission_unit_at ON admission (unit, at);
CREATE TABLE IF NOT EXISTS account_cooldown (
  account TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS perf (
  model TEXT NOT NULL, period TEXT NOT NULL, minute INTEGER NOT NULL,
  ttft_ms REAL NOT NULL DEFAULT 0, ttft_n INTEGER NOT NULL DEFAULT 0,
  out_tokens REAL NOT NULL DEFAULT 0, token_n INTEGER NOT NULL DEFAULT 0,
  speed_tokens REAL NOT NULL DEFAULT 0, gen_ms REAL NOT NULL DEFAULT 0,
  speed_n INTEGER NOT NULL DEFAULT 0, total_ms REAL NOT NULL DEFAULT 0,
  total_n INTEGER NOT NULL DEFAULT 0, total_log REAL NOT NULL DEFAULT 0,
  total_log_sq REAL NOT NULL DEFAULT 0, imputed_n INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, period, minute)
);
CREATE TABLE IF NOT EXISTS perf_history (
  model TEXT NOT NULL, period TEXT NOT NULL,
  mean_log REAL NOT NULL, weight REAL NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, period)
);
CREATE TABLE IF NOT EXISTS speed (
  model TEXT NOT NULL, worker TEXT NOT NULL,
  gram TEXT NOT NULL, rhs TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0, completed REAL NOT NULL DEFAULT 0,
  censored REAL NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY (model, worker)
);
CREATE TABLE IF NOT EXISTS proof (
  model TEXT PRIMARY KEY, verified INTEGER NOT NULL,
  until INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  worker TEXT PRIMARY KEY, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempt (
  id TEXT PRIMARY KEY, model TEXT NOT NULL, worker TEXT NOT NULL,
  started_at INTEGER NOT NULL, first_token_at INTEGER, finished_at INTEGER, ok INTEGER
);
CREATE INDEX IF NOT EXISTS attempt_overlap ON attempt (model, ok, started_at, finished_at);
CREATE TABLE IF NOT EXISTS affinity (
  digest TEXT PRIMARY KEY, length INTEGER NOT NULL,
  unit_key TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS affinity_expires ON affinity (expires_at);
`;

export class SharedStateStore {
  /**
   * @param {{path?: string|null, now?: () => number, worker?: string,
   *   heartbeatMs?: number, staleMs?: number, refreshMs?: number,
   *   admissionWindowMs?: number}} [options]
   */
  constructor({
    path = null,
    now = Date.now,
    worker = `${hostname()}:${process.pid}`,
    heartbeatMs = 10_000,
    staleMs = 60_000,
    refreshMs = 250,
    admissionWindowMs = 300_000,
  } = {}) {
    this.db = null;
    this.now = now;
    this.worker = worker;
    this.staleMs = staleMs;
    this.admissionWindowMs = admissionWindowMs;
    /** unit → in-flight across workers, kept fresh by the timer */
    this.totals = new Map();
    this.timers = [];
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path, { create: true });
      this.db.exec("PRAGMA busy_timeout=5000");
      this.db.exec("PRAGMA journal_mode=WAL");
      this.db.exec(SCHEMA);
      // Older files predate the token-phase interval.
      try { this.db.exec("ALTER TABLE attempt ADD COLUMN first_token_at INTEGER"); } catch {}
      this.upsertHeld = this.db.prepare(
        "INSERT INTO capacity (unit, worker, held, updated_at) VALUES (?, ?, 1, ?) " +
        "ON CONFLICT(unit, worker) DO UPDATE SET held = held + 1, updated_at = excluded.updated_at",
      );
      this.sumHeld = this.db.prepare("SELECT COALESCE(SUM(held), 0) AS held FROM capacity WHERE unit = ?");
      this.allHeld = this.db.prepare("SELECT unit, SUM(held) AS held FROM capacity GROUP BY unit");
      this.dropHeld = this.db.prepare(
        "UPDATE capacity SET held = held - 1, updated_at = ? WHERE unit = ? AND worker = ? AND held > 0",
      );
      this.touchHeld = this.db.prepare("UPDATE capacity SET updated_at = ? WHERE worker = ? AND held > 0");
      this.reapHeld = this.db.prepare("DELETE FROM capacity WHERE worker <> ? AND updated_at < ?");
      this.reapEmpty = this.db.prepare("DELETE FROM capacity WHERE held <= 0 AND updated_at < ?");
      this.insertSample = this.db.prepare("INSERT INTO admission (unit, at, share) VALUES (?, ?, ?)");
      this.thresholdSample = this.db.prepare(
        "SELECT share FROM admission WHERE unit = ? AND at > ? ORDER BY share DESC LIMIT 1 OFFSET ?",
      );
      this.countSamples = this.db.prepare("SELECT COUNT(*) AS n FROM admission WHERE unit = ? AND at > ?");
      this.pruneSamples = this.db.prepare("DELETE FROM admission WHERE at < ?");
      this.upsertCooldown = this.db.prepare(
        "INSERT INTO account_cooldown (account, until, reason, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(account) DO UPDATE SET until = excluded.until, reason = excluded.reason, " +
        "updated_at = excluded.updated_at",
      );
      this.selectCooldowns = this.db.prepare(
        "SELECT account, until, reason FROM account_cooldown WHERE until > ?",
      );
      this.dropCooldowns = this.db.prepare("DELETE FROM account_cooldown WHERE until <= ?");
      this.addPerf = this.db.prepare(
        "INSERT INTO perf (model, period, minute, ttft_ms, ttft_n, out_tokens, token_n, speed_tokens, gen_ms, " +
        "speed_n, total_ms, total_n, total_log, total_log_sq, imputed_n, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(model, period, minute) DO UPDATE SET " +
        "ttft_ms = ttft_ms + excluded.ttft_ms, ttft_n = ttft_n + excluded.ttft_n, " +
        "out_tokens = out_tokens + excluded.out_tokens, token_n = token_n + excluded.token_n, " +
        "speed_tokens = speed_tokens + excluded.speed_tokens, gen_ms = gen_ms + excluded.gen_ms, " +
        "speed_n = speed_n + excluded.speed_n, total_ms = total_ms + excluded.total_ms, " +
        "total_n = total_n + excluded.total_n, total_log = total_log + excluded.total_log, " +
        "total_log_sq = total_log_sq + excluded.total_log_sq, imputed_n = imputed_n + excluded.imputed_n, " +
        "updated_at = excluded.updated_at",
      );
      this.selectPerf = this.db.prepare(
        "SELECT model, period, minute, ttft_ms AS ttftMs, ttft_n AS ttftCount, out_tokens AS outputTokens, " +
        "token_n AS tokenCount, speed_tokens AS speedTokens, gen_ms AS generationMs, speed_n AS speedCount, " +
        "total_ms AS totalMs, total_n AS totalCount, total_log AS totalLog, total_log_sq AS totalLogSq, " +
        "imputed_n AS imputedCount FROM perf WHERE minute >= ?",
      );
      this.prunePerf = this.db.prepare("DELETE FROM perf WHERE minute < ?");
      this.upsertHistory = this.db.prepare(
        "INSERT INTO perf_history (model, period, mean_log, weight, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(model, period) DO UPDATE SET mean_log = excluded.mean_log, weight = excluded.weight, " +
        "updated_at = excluded.updated_at",
      );
      this.selectHistory = this.db.prepare(
        "SELECT model, period, mean_log AS meanLog, weight, updated_at AS updatedAt FROM perf_history",
      );
      this.upsertSpeed = this.db.prepare(
        "INSERT INTO speed (model, worker, gram, rhs, weight, completed, censored, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(model, worker) DO UPDATE SET gram = excluded.gram, rhs = excluded.rhs, " +
        "weight = excluded.weight, completed = excluded.completed, censored = excluded.censored, " +
        "updated_at = excluded.updated_at",
      );
      this.selectSpeed = this.db.prepare(
        "SELECT model, worker, gram, rhs, weight, completed, censored, updated_at AS updatedAt FROM speed",
      );
      this.pruneSpeed = this.db.prepare("DELETE FROM speed WHERE updated_at < ?");
      this.upsertProof = this.db.prepare(
        "INSERT INTO proof (model, verified, until, updated_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(model) DO UPDATE SET verified = MAX(verified, excluded.verified), " +
        "until = MAX(until, excluded.until), updated_at = excluded.updated_at",
      );
      this.selectProof = this.db.prepare("SELECT model, verified FROM proof WHERE until > ?");
      this.pruneProof = this.db.prepare("DELETE FROM proof WHERE until <= ?");
      this.insertAttempt = this.db.prepare(
        "INSERT INTO attempt (id, model, worker, started_at, finished_at, ok) VALUES (?, ?, ?, ?, NULL, NULL) " +
        "ON CONFLICT(id) DO UPDATE SET model = excluded.model, started_at = excluded.started_at",
      );
      this.finishAttempt = this.db.prepare("UPDATE attempt SET finished_at = ?, ok = ? WHERE id = ?");
      this.firstTokenAttempt = this.db.prepare("UPDATE attempt SET first_token_at = ? WHERE id = ?");
      this.countCoverage = this.db.prepare(
        "SELECT COUNT(*) AS n FROM attempt WHERE model = ? AND id <> ? AND ok = 1 " +
        "AND first_token_at IS NOT NULL AND first_token_at <= ? AND finished_at > ?",
      );
      this.pruneAttempts = this.db.prepare("DELETE FROM attempt WHERE started_at < ?");
      this.touchWorker = this.db.prepare(
        "INSERT INTO worker_heartbeat (worker, updated_at) VALUES (?, ?) " +
        "ON CONFLICT(worker) DO UPDATE SET updated_at = excluded.updated_at",
      );
      this.countOpenAttempts = this.db.prepare(
        "SELECT COUNT(*) AS n FROM attempt a JOIN worker_heartbeat w ON w.worker = a.worker " +
        "WHERE a.finished_at IS NULL AND a.started_at >= ? AND w.updated_at >= ?",
      );
      this.upsertAffinity = this.db.prepare(
        "INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(digest) DO UPDATE SET length = excluded.length, unit_key = excluded.unit_key, " +
        "expires_at = excluded.expires_at",
      );
      this.selectAffinityLengths = this.db.prepare(
        "SELECT DISTINCT length FROM affinity WHERE expires_at > ? ORDER BY length",
      );
      this.pruneAffinity = this.db.prepare("DELETE FROM affinity WHERE expires_at <= ?");
      this.affinityQueries = new Map();
    } catch {
      try { this.db?.close(); } catch {}
      this.db = null;
      return;
    }

    this.refresh();
    const refresh = setInterval(() => this.refresh(), refreshMs);
    const upkeep = setInterval(() => this.upkeep(), heartbeatMs);
    refresh.unref?.();
    upkeep.unref?.();
    this.timers.push(refresh, upkeep);
  }

  get enabled() {
    return this.db !== null;
  }

  close() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    try { this.db?.close(); } catch {}
    this.db = null;
  }

  // ---- capacity -----------------------------------------------------------

  /**
   * Take one in-flight slot for `unit` if the *shared* count stays at or below
   * `limit`. Returns an idempotent release, or undefined when the unit is full.
   * A store failure admits and counts locally: availability beats exactness.
   */
  acquire(unit, limit) {
    if (!this.db) return () => {};
    const now = this.now();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.upsertHeld.run(unit, this.worker, now);
      const held = this.sumHeld.get(unit)?.held ?? 0;
      if (held > limit) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db.exec("COMMIT");
    } catch {
      try { this.db.exec("ROLLBACK"); } catch {}
      return () => {};
    }
    this.totals.set(unit, (this.totals.get(unit) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#release(unit);
    };
  }

  #release(unit) {
    const count = this.totals.get(unit) ?? 0;
    if (count > 0) this.totals.set(unit, count - 1);
    if (!this.db) return;
    try {
      this.dropHeld.run(this.now(), unit, this.worker);
    } catch {}
  }

  /** Shared in-flight counts, refreshed every `refreshMs` and adjusted locally. */
  counts() {
    return this.totals;
  }

  refresh() {
    if (!this.db) return;
    try {
      const next = new Map();
      for (const row of this.allHeld.all()) next.set(row.unit, row.held);
      this.totals = next;
    } catch {}
  }

  /** Heartbeat, reap dead workers, prune old samples and expired cooldowns. */
  upkeep() {
    if (!this.db) return;
    const now = this.now();
    try {
      this.touchHeld.run(now, this.worker);
      this.reapHeld.run(this.worker, now - this.staleMs);
      this.reapEmpty.run(now - 60 * 60_000);
      this.pruneSamples.run(now - this.admissionWindowMs);
      this.dropCooldowns.run(now);
      this.prunePerf.run(Math.floor(now / 60_000) - 60);
      this.pruneProof.run(now);
      this.pruneAttempts.run(now - 60 * 60_000);
      this.touchWorker.run(this.worker, now);
      this.pruneAffinity.run(now);
      this.pruneSpeed.run(now - 2 * 24 * 60 * 60_000);
    } catch {}
  }

  // ---- admission ----------------------------------------------------------

  /** One cache-benefit sample for a limited unit. */
  observe(unit, share) {
    if (!this.db) return;
    try {
      this.insertSample.run(unit, this.now(), share);
    } catch {}
  }

  /** The maxInFlight-th largest sample in the window, or undefined when everyone fits. */
  threshold(unit, capacity) {
    if (!this.db || capacity <= 0) return undefined;
    try {
      const row = this.thresholdSample.get(unit, this.now() - this.admissionWindowMs, capacity - 1);
      return row?.share ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Samples currently inside the window. */
  windowCount(unit) {
    if (!this.db) return 0;
    try {
      return this.countSamples.get(unit, this.now() - this.admissionWindowMs)?.n ?? 0;
    } catch {
      return 0;
    }
  }

  /** Drop samples that fell out of every window. */
  pruneAdmission() {
    if (!this.db) return;
    try { this.pruneSamples.run(this.now() - this.admissionWindowMs); } catch {}
  }

  // ---- account cooldowns --------------------------------------------------

  setCooldown(account, until, reason = null) {
    if (!this.db) return;
    try { this.upsertCooldown.run(account, until, reason, this.now()); } catch {}
  }

  /** account → until, for cooldowns still in force. */
  cooldowns() {
    const map = new Map();
    if (!this.db) return map;
    try {
      for (const row of this.selectCooldowns.all(this.now())) map.set(row.account, row.until);
    } catch {}
    return map;
  }

  clearExpiredCooldowns() {
    if (!this.db) return;
    try { this.dropCooldowns.run(this.now()); } catch {}
  }

  // ---- perf window --------------------------------------------------------

  /** Add one sample to a model's minute bucket; every field is a sum. */
  perfAdd(model, period, minute, bucket) {
    if (!this.db) return;
    try {
      this.addPerf.run(
        model, period, minute,
        bucket.ttftMs ?? 0, bucket.ttftCount ?? 0,
        bucket.outputTokens ?? 0, bucket.tokenCount ?? 0,
        bucket.speedTokens ?? 0, bucket.generationMs ?? 0, bucket.speedCount ?? 0,
        bucket.totalMs ?? 0, bucket.totalCount ?? 0,
        bucket.totalLog ?? 0, bucket.totalLogSq ?? 0, bucket.imputedCount ?? 0,
        this.now(),
      );
    } catch {}
  }

  /** Every bucket at or after `sinceMinute`, summed across workers. */
  perfWindow(sinceMinute) {
    if (!this.db) return [];
    try { return this.selectPerf.all(sinceMinute); } catch { return []; }
  }

  /** Last-writer-wins weak prior; the window buckets stay the authoritative data. */
  perfHistorySet(model, period, meanLog, weight) {
    if (!this.db) return;
    try { this.upsertHistory.run(model, period, meanLog, weight, this.now()); } catch {}
  }

  perfHistoryRows() {
    if (!this.db) return [];
    try { return this.selectHistory.all(); } catch { return []; }
  }

  // ---- cyclic speed -------------------------------------------------------

  /** This worker's sufficient statistics for one model. */
  speedPut(model, stats) {
    if (!this.db) return;
    try {
      // The caller's clock is authoritative: the statistics are decayed to
      // `stats.updatedAt`, so the row must carry that same instant.
      this.upsertSpeed.run(
        model, this.worker, JSON.stringify(stats.gram), JSON.stringify(stats.rhs),
        stats.weight, stats.completed, stats.censored,
        Number.isFinite(stats.updatedAt) ? stats.updatedAt : this.now(),
      );
    } catch {}
  }

  /** Every worker's statistics; readers decay and sum them. */
  speedRows() {
    if (!this.db) return [];
    try { return this.selectSpeed.all(); } catch { return []; }
  }

  // ---- concurrency proof --------------------------------------------------

  /** Raise a model's verified concurrency; `until` is a lower bound on its lifetime. */
  proofMax(model, verified, until) {
    if (!this.db) return;
    try { this.upsertProof.run(model, verified, until, this.now()); } catch {}
  }

  proofRows() {
    if (!this.db) return [];
    try { return this.selectProof.all(this.now()); } catch { return []; }
  }

  /** Remember one upstream attempt from its start until it finishes. */
  attemptBegin(id, model, worker, startedAt) {
    if (!this.db) return;
    try { this.insertAttempt.run(id, model, worker, startedAt); } catch {}
  }

  /** The first output token: the proof interval starts here, not at the request. */
  attemptFirstToken(id, at) {
    if (!this.db) return;
    try { this.firstTokenAttempt.run(at, id); } catch {}
  }

  attemptFinish(id, finishedAt, ok) {
    if (!this.db) return;
    try { this.finishAttempt.run(finishedAt, ok ? 1 : 0, id); } catch {}
  }

  /**
   * Successful attempts whose generation interval ([first token, end]) covers
   * one instant. The maximum of this over every generation start is the exact
   * peak overlap of the token phases, which is the only number a proof may
   * claim. Time spent waiting for the first token never counts.
   */
  attemptCoverage(model, id, at) {
    if (!this.db) return 0;
    try {
      return this.countCoverage.get(model, id, at, at)?.n ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Upstream attempts still open across live workers. A dead worker's rows are
   * excluded by its missing heartbeat, so a crash cannot inflate the count.
   */
  openAttempts(sinceMs = this.now() - 60 * 60_000, freshMs = 30_000) {
    if (!this.db) return 0;
    try {
      return this.countOpenAttempts.get(sinceMs, this.now() - freshMs)?.n ?? 0;
    } catch {
      return 0;
    }
  }

  // ---- affinity -----------------------------------------------------------

  affinityPut(digest, length, unitKey, expiresAt) {
    if (!this.db) return;
    try { this.upsertAffinity.run(digest, length, unitKey, expiresAt); } catch {}
  }

  /** Lengths other workers have recorded and that are still live. */
  affinityLengths() {
    if (!this.db) return [];
    try { return this.selectAffinityLengths.all(this.now()).map((row) => row.length); } catch { return []; }
  }

  /** Live entries for the given digests: digest → {length, unitKey}. */
  affinityFind(digests) {
    const found = new Map();
    if (!this.db || digests.length === 0) return found;
    try {
      const stmt = this.#affinityQuery(digests.length);
      for (const row of stmt.all(...digests, this.now())) {
        found.set(row.digest, { length: row.length, unitKey: row.unitKey });
      }
    } catch {}
    return found;
  }

  #affinityQuery(count) {
    let stmt = this.affinityQueries.get(count);
    if (stmt) return stmt;
    if (this.affinityQueries.size > 32) {
      this.affinityQueries.clear();
    }
    const placeholders = new Array(count).fill("?").join(",");
    stmt = this.db.prepare(
      `SELECT digest, length, unit_key AS unitKey FROM affinity WHERE digest IN (${placeholders}) AND expires_at > ?`,
    );
    this.affinityQueries.set(count, stmt);
    return stmt;
  }
}
