// Shared cooldown state for several gateway workers.
//
// Health is in-process by design (fast `isAlive` on the routing path), but a
// benched account must be benched for every worker: otherwise a dead unit gets
// one probe and one failed request per worker per interval. This store keeps the
// authoritative rows in SQLite and the registry mirrors them:
//
//   * every state change is written through (markDead / markAlive / reschedule);
//   * each worker polls for rows changed since its last refresh (~1 s);
//   * a probe is only sent by the worker that wins an atomic lease on the row,
//     so one interval means one probe across the whole gateway.
//
// Writes are rare (failures and probe results), so the shared file never sits on
// the per-request path. Errors are swallowed: losing sharing must not lose
// routing.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `CREATE TABLE IF NOT EXISTS health (
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  since INTEGER NOT NULL,
  reason TEXT,
  next_probe_at INTEGER,
  probes INTEGER NOT NULL DEFAULT 0,
  probe_interval_ms INTEGER,
  max_probe_interval_ms INTEGER,
  probe_backoff REAL,
  updated_at INTEGER NOT NULL,
  probe_lease_until INTEGER NOT NULL DEFAULT 0
)`;

const UPSERT = `INSERT INTO health (
  key, state, since, reason, next_probe_at, probes,
  probe_interval_ms, max_probe_interval_ms, probe_backoff, updated_at, probe_lease_until
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(key) DO UPDATE SET
  state = excluded.state,
  since = excluded.since,
  reason = excluded.reason,
  next_probe_at = excluded.next_probe_at,
  probes = excluded.probes,
  probe_interval_ms = excluded.probe_interval_ms,
  max_probe_interval_ms = excluded.max_probe_interval_ms,
  probe_backoff = excluded.probe_backoff,
  updated_at = excluded.updated_at,
  probe_lease_until = 0`;

const SELECT_COLUMNS = `key, state, since, reason, next_probe_at AS nextProbeAt, probes,
  probe_interval_ms AS probeIntervalMs, max_probe_interval_ms AS maxProbeIntervalMs,
  probe_backoff AS probeBackoff, updated_at AS updatedAt`;

export class HealthStore {
  /** @param {{path?: string|null, pruneAfterMs?: number}} [options] */
  constructor({ path = null, pruneAfterMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    this.db = null;
    this.pruneAfterMs = pruneAfterMs;
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path, { create: true });
      this.db.exec("PRAGMA busy_timeout=5000");
      this.db.exec("PRAGMA journal_mode=WAL");
      this.db.exec(SCHEMA);
      this.upsert = this.db.prepare(UPSERT);
      this.selectAll = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM health`);
      this.selectSince = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM health WHERE updated_at >= ?`);
      this.claim = this.db.prepare(
        "UPDATE health SET probe_lease_until = ? WHERE key = ? AND probe_lease_until <= ?",
      );
      this.prune = this.db.prepare("DELETE FROM health WHERE updated_at < ?");
    } catch {
      try { this.db?.close(); } catch {}
      this.db = null;
    }
  }

  get enabled() {
    return this.db !== null;
  }

  /** Every row, for a worker's first load. */
  loadAll() {
    if (!this.db) return [];
    try { return this.selectAll.all(); } catch { return []; }
  }

  /** Rows written since `sinceMs` (inclusive; callers overlap deliberately). */
  changedSince(sinceMs) {
    if (!this.db) return [];
    try { return this.selectSince.all(sinceMs); } catch { return []; }
  }

  /** Write one entry; `state` is "alive" or "cooling". */
  write(record) {
    if (!this.db) return;
    try {
      this.upsert.run(
        record.key,
        record.state,
        record.since ?? 0,
        record.reason ?? null,
        record.nextProbeAt ?? null,
        record.probes ?? 0,
        record.probeIntervalMs ?? null,
        record.maxProbeIntervalMs ?? null,
        record.probeBackoff ?? null,
        record.updatedAt ?? 0,
      );
    } catch {}
  }

  /**
   * Take the right to probe `key` until `untilMs`. Returns false when another
   * worker holds a live lease, or when the row does not exist.
   */
  claimProbe(key, untilMs, nowMs) {
    if (!this.db) return false;
    try {
      return this.claim.run(untilMs, key, nowMs).changes === 1;
    } catch {
      return false;
    }
  }

  /** Drop rows nothing has touched for `pruneAfterMs`. */
  pruneStale(nowMs) {
    if (!this.db) return;
    try { this.prune.run(nowMs - this.pruneAfterMs); } catch {}
  }

  close() {
    try { this.db?.close(); } catch {}
    this.db = null;
  }
}
