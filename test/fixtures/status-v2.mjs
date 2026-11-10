// A synthetic v2 SQLite database: schema + rows, never production data.
//
// The fixture is frozen at the v2 shape so the migration test can open it,
// migrate it, close it and reopen it without depending on the product schema.

import { Database } from "bun:sqlite";

export const V2_SCHEMA_SQL = `
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

export const V2_SINCE = "2026-11-01T00:00:00.000Z";
export const V2_NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

/** All seeded rows, so a test can compare the pre- and post-migration file. */
export const V2_ROWS = Object.freeze({
  totals: [
    {
      provider: "fixture-provider",
      model: "fixture-model-a",
      uncached_input: 1_200,
      cached_input: 300,
      output: 90,
      complete: 3,
      seen_uncached: 3,
      seen_cached: 2,
      seen_output: 3,
    },
    {
      provider: "fixture-provider",
      model: "fixture-model-b",
      uncached_input: 40,
      cached_input: 0,
      output: 7,
      complete: 1,
      seen_uncached: 1,
      seen_cached: 0,
      seen_output: 1,
    },
  ],
  health: [
    {
      key: "fixture-provider/acct-a",
      state: "dead",
      until: V2_NOW + 120_000,
      reason: "429 fixture limit",
      reason_rank: 2,
      fencing_token: 1,
      probe_lease_until: V2_NOW + 30_000,
      updated_at: V2_NOW - 30_000,
    },
    {
      key: "fixture-provider/acct-b",
      state: "alive",
      until: 0,
      reason: null,
      reason_rank: 0,
      fencing_token: 1,
      probe_lease_until: 0,
      updated_at: V2_NOW - 10_000,
    },
  ],
  capacity: [
    { unit: "fixture-provider/acct-a", worker: "fixture-worker:111", held: 2, updated_at: V2_NOW - 1_000 },
    { unit: "fixture-provider/acct-b", worker: "fixture-worker:222", held: 0, updated_at: V2_NOW - 1_000 },
  ],
  affinity: [
    { digest: "fixture-digest-1", length: 2_048, unit_key: "fixture-provider/acct-a", expires_at: V2_NOW + 300_000 },
  ],
  perf: [
    {
      model: "fixture-provider/fixture-model-a",
      period: "peak",
      minute: Math.floor(V2_NOW / 60_000) - 5,
      ttft_ms: 100,
      ttft_n: 3,
      out_tokens: 300,
      token_n: 3,
      speed_tokens: 300,
      gen_ms: 1_500,
      speed_n: 3,
      total_ms: 3_000,
      total_n: 3,
      total_log: Math.log(3_000) * 3,
      total_log_sq: Math.log(3_000) ** 2 * 3,
      imputed_n: 0,
      updated_at: V2_NOW,
    },
    {
      model: "fixture-provider/fixture-model-a",
      period: "peak",
      minute: Math.floor(V2_NOW / 60_000) - 4,
      ttft_ms: 0,
      ttft_n: 0,
      out_tokens: 0,
      token_n: 0,
      speed_tokens: 0,
      gen_ms: 0,
      speed_n: 0,
      total_ms: 7_500,
      total_n: 4,
      total_log: Math.log(7_500) * 4,
      total_log_sq: Math.log(7_500) ** 2 * 4,
      imputed_n: 2,
      updated_at: V2_NOW,
    },
  ],
  speed: [
    {
      model: "fixture-provider/fixture-model-a",
      worker: "fixture-worker:111",
      gram: JSON.stringify({ mean: 7.6, precision: 4, count: 2 }),
      rhs: JSON.stringify({ sum: 15.2, samples: 2 }),
      weight: 2,
      completed: 2,
      censored: 0,
      updated_at: V2_NOW,
    },
  ],
  proof: [{ model: "fixture-provider/fixture-model-a", verified: 5, until: V2_NOW + 900_000, updated_at: V2_NOW }],
  cooldown: [
    {
      account: "fixture-account-a",
      until: V2_NOW + 60_000,
      reason: "429 fixture limit",
      reason_rank: 2,
      updated_at: V2_NOW,
    },
  ],
});

/**
 * Create a v2 database at `path`. The caller owns the file.
 *
 * @param {string} path
 * @returns {string} the same path
 */
export function createV2Fixture(path) {
  const db = new Database(path, { create: true });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 2000");
    db.exec(V2_SCHEMA_SQL);
    db.exec("PRAGMA user_version = 2");
    db.prepare("INSERT INTO metadata (name, value) VALUES ('since', ?)").run(V2_SINCE);
    const insertTotals = db.prepare(
      "INSERT INTO totals (provider, model, uncached_input, cached_input, output, complete, seen_uncached, seen_cached, seen_output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.totals) {
      insertTotals.run(
        row.provider,
        row.model,
        row.uncached_input,
        row.cached_input,
        row.output,
        row.complete,
        row.seen_uncached,
        row.seen_cached,
        row.seen_output,
      );
    }
    const insertHealth = db.prepare(
      "INSERT INTO health (key, state, until, reason, reason_rank, fencing_token, probe_lease_until, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.health) {
      insertHealth.run(
        row.key,
        row.state,
        row.until,
        row.reason,
        row.reason_rank,
        row.fencing_token,
        row.probe_lease_until,
        row.updated_at,
      );
    }
    const insertCapacity = db.prepare("INSERT INTO capacity (unit, worker, held, updated_at) VALUES (?, ?, ?, ?)");
    for (const row of V2_ROWS.capacity) {
      insertCapacity.run(row.unit, row.worker, row.held, row.updated_at);
    }
    const insertAffinity = db.prepare(
      "INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES (?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.affinity) insertAffinity.run(row.digest, row.length, row.unit_key, row.expires_at);
    const insertPerf = db.prepare(
      "INSERT INTO perf (model, period, minute, ttft_ms, ttft_n, out_tokens, token_n, speed_tokens, gen_ms, speed_n, total_ms, total_n, total_log, total_log_sq, imputed_n, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.perf) {
      insertPerf.run(
        row.model,
        row.period,
        row.minute,
        row.ttft_ms,
        row.ttft_n,
        row.out_tokens,
        row.token_n,
        row.speed_tokens,
        row.gen_ms,
        row.speed_n,
        row.total_ms,
        row.total_n,
        row.total_log,
        row.total_log_sq,
        row.imputed_n,
        row.updated_at,
      );
    }
    const insertSpeed = db.prepare(
      "INSERT INTO speed (model, worker, gram, rhs, weight, completed, censored, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.speed) {
      insertSpeed.run(
        row.model,
        row.worker,
        row.gram,
        row.rhs,
        row.weight,
        row.completed,
        row.censored,
        row.updated_at,
      );
    }
    const insertProof = db.prepare("INSERT INTO proof (model, verified, until, updated_at) VALUES (?, ?, ?, ?)");
    for (const row of V2_ROWS.proof) insertProof.run(row.model, row.verified, row.until, row.updated_at);
    const insertCooldown = db.prepare(
      "INSERT INTO account_cooldown (account, until, reason, reason_rank, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const row of V2_ROWS.cooldown) {
      insertCooldown.run(row.account, row.until, row.reason, row.reason_rank, row.updated_at);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return path;
}
