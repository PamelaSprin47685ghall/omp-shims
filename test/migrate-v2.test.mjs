import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS } from "../lib/config.mjs";
import { migrateStateDbs, migrateV1Config } from "../scripts/migrate-v2.mjs";

const script = join(import.meta.dir, "..", "scripts", "migrate-v2.mjs");

/** A fresh temporary directory. */
function tempDir(prefix = "omp-shims-migrate-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** The v1 health table. */
function createHealthDb(path) {
  const db = new Database(path, { create: true });
  db.exec(`CREATE TABLE health (
    key TEXT PRIMARY KEY, state TEXT NOT NULL, since INTEGER NOT NULL, reason TEXT,
    next_probe_at INTEGER, probes INTEGER NOT NULL DEFAULT 0, probe_interval_ms INTEGER,
    max_probe_interval_ms INTEGER, probe_backoff REAL, updated_at INTEGER NOT NULL,
    probe_lease_until INTEGER NOT NULL DEFAULT 0
  )`);
  db.query(
    "INSERT INTO health (key, state, since, reason, updated_at, probe_lease_until) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("openai-codex:plus#1", "cooling", 1, "rate limit 429", 10, 7);
  db.close();
}

/** The v1 shared-state table. */
function createStateDb(path) {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE capacity (unit TEXT NOT NULL, worker TEXT NOT NULL, held INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (unit, worker));
    CREATE TABLE admission (unit TEXT NOT NULL, at INTEGER NOT NULL, share REAL NOT NULL);
    CREATE TABLE account_cooldown (account TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE perf (model TEXT NOT NULL, period TEXT NOT NULL, minute INTEGER NOT NULL, ttft_ms REAL NOT NULL DEFAULT 0,
      ttft_n INTEGER NOT NULL DEFAULT 0, out_tokens REAL NOT NULL DEFAULT 0, token_n INTEGER NOT NULL DEFAULT 0,
      speed_tokens REAL NOT NULL DEFAULT 0, gen_ms REAL NOT NULL DEFAULT 0, speed_n INTEGER NOT NULL DEFAULT 0,
      total_ms REAL NOT NULL DEFAULT 0, total_n INTEGER NOT NULL DEFAULT 0, total_log REAL NOT NULL DEFAULT 0,
      total_log_sq REAL NOT NULL DEFAULT 0, imputed_n INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      PRIMARY KEY (model, period, minute));
    CREATE TABLE perf_history (model TEXT NOT NULL, period TEXT NOT NULL, mean_log REAL NOT NULL, weight REAL NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (model, period));
    CREATE TABLE speed (model TEXT NOT NULL, worker TEXT NOT NULL, gram TEXT NOT NULL, rhs TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0, completed REAL NOT NULL DEFAULT 0, censored REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL, PRIMARY KEY (model, worker));
    CREATE TABLE proof (model TEXT PRIMARY KEY, verified INTEGER NOT NULL, until INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE worker_heartbeat (worker TEXT PRIMARY KEY, updated_at INTEGER NOT NULL);
    CREATE TABLE attempt (id TEXT PRIMARY KEY, model TEXT NOT NULL, worker TEXT NOT NULL, started_at INTEGER NOT NULL,
      first_token_at INTEGER, finished_at INTEGER, ok INTEGER);
    CREATE TABLE affinity (digest TEXT PRIMARY KEY, length INTEGER NOT NULL, unit_key TEXT NOT NULL, expires_at INTEGER NOT NULL);
  `);
  db.query("INSERT INTO capacity (unit, worker, held, updated_at) VALUES ('u', 'w', 1, 1)").run();
  db.query("INSERT INTO admission (unit, at, share) VALUES ('u', 1, 0.5)").run();
  db.query("INSERT INTO account_cooldown (account, until, reason, updated_at) VALUES ('a', 9, 'rate limit', 9)").run();
  db.query(
    "INSERT INTO perf (model, period, minute, ttft_ms, ttft_n, updated_at) VALUES ('p/m', 'peak', 1, 2, 1, 3)",
  ).run();
  db.query(
    "INSERT INTO perf_history (model, period, mean_log, weight, updated_at) VALUES ('p/m', 'peak', 1, 2, 3)",
  ).run();
  db.query("INSERT INTO speed (model, worker, gram, rhs, updated_at) VALUES ('p/m', 'w', '[]', '[]', 3)").run();
  db.query("INSERT INTO proof (model, verified, until, updated_at) VALUES ('p/m', 2, 3, 4)").run();
  db.query("INSERT INTO worker_heartbeat (worker, updated_at) VALUES ('w', 1)").run();
  db.query("INSERT INTO attempt (id, model, worker, started_at, ok) VALUES ('i', 'p/m', 'w', 1, 1)").run();
  db.query("INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES ('valid', 4, 'u', 2000)").run();
  db.query("INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES ('expired', 4, 'u', 500)").run();
  db.close();
}

/** The v1 token totals table. */
function createTotalsDb(path) {
  const db = new Database(path, { create: true });
  db.exec(`CREATE TABLE totals (model TEXT PRIMARY KEY, uncachedInput INTEGER NOT NULL DEFAULT 0,
    cachedInput INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0,
    seenUncached INTEGER NOT NULL DEFAULT 0, seenCached INTEGER NOT NULL DEFAULT 0, seenOutput INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  db.query("INSERT INTO totals (model, uncachedInput, cachedInput, output, complete) VALUES (?, ?, ?, ?, ?)").run(
    "mistral/deepseek-v4-1-flash-1017",
    5,
    6,
    7,
    8,
  );
  db.query("INSERT INTO metadata (name, value) VALUES ('since', '2026-01-01')").run();
  db.close();
}

/** Write the three v1 database files into one directory. */
function createV1State(dir) {
  createHealthDb(join(dir, "lazy-router-health.sqlite"));
  createStateDb(join(dir, "lazy-router-state.sqlite"));
  createTotalsDb(join(dir, "lazy-router-token-totals.sqlite"));
}

describe("migrateV1Config", () => {
  test("merges the five Antigravity keys and drops removed features", () => {
    const { config, notes } = migrateV1Config({
      features: {
        "antigravity-system-instruction": true,
        "antigravity-routing": { enabled: true, effort: "medium" },
        "antigravity-continuation": { enabled: true, maxContinuations: 5, out: "/tmp/continuation.jsonl" },
        "antigravity-capture": { enabled: false, sampleEvery: 25, out: "/tmp/capture.jsonl" },
        "antigravity-account-routing": {
          enabled: true,
          ultraAccounts: ["ultra@example.test"],
          proAccounts: ["pro@example.test"],
          cooldownMs: 10,
        },
        "vendor-shims": { enabled: false },
        "native-loop-guard": true,
        "lazy-router": {
          enabled: true,
          routing: { excellentPrior: 3, mediumPrior: 2, temperature: 0.6, intelligenceCenter: 42 },
        },
      },
      pluginBridge: { tokens: { kiro: { value: "redacted" } } },
    });

    expect(config.version).toBe(2);
    expect(config.stateDbPath.endsWith("omp-shims-state.sqlite")).toBe(true);
    expect(config.runtime).toEqual({ thinkingLoopGuard: true });
    expect(config.features["vendor-shims"]).toBeUndefined();
    expect(config.features["native-loop-guard"]).toBeUndefined();
    expect(config.features["antigravity-system-instruction"]).toBeUndefined();

    const antigravity = config.features.antigravity;
    expect(antigravity).toMatchObject({
      enabled: true,
      systemInstruction: true,
      routing: true,
      effort: "medium",
      continuation: true,
      maxContinuations: 5,
      continuationOut: "/tmp/continuation.jsonl",
      capture: false,
      captureOut: "/tmp/capture.jsonl",
      sampleEvery: 25,
      accountRouting: true,
      ultraAccounts: ["ultra@example.test"],
      proAccounts: ["pro@example.test"],
      cooldownMs: 10,
    });
    expect(config.features["lazy-router"].routing).toEqual({
      intelligenceCenter: 42,
      excellentPrior: 3,
      mediumPrior: 2,
      temperature: 0.6,
    });
    expect(config.features["lazy-router"].stateDbPath).toBeUndefined();
    expect(config.pluginBridge).toEqual({ tokens: { kiro: { value: "redacted" } } });
    expect(notes.join("\n")).toContain("features.vendor-shims: dropped");
    expect(notes.join("\n")).toContain(
      'features["lazy-router"].routing.excellentPrior: carried ' +
        "(v2 ranks with continuous intelligence; value retained for reference, not used)",
    );
    expect(notes.join("\n")).toContain(
      'features["lazy-router"].routing.mediumPrior: carried ' +
        "(v2 ranks with continuous intelligence; value retained for reference, not used)",
    );
    expect(notes.join("\n")).toContain('features["lazy-router"].routing.temperature: kept (v1 value preserved)');
  });

  test("keeps a v1 routing temperature instead of resetting it to the v2 default", () => {
    const { config, notes } = migrateV1Config({
      features: { "lazy-router": { routing: { temperature: 0.5 } } },
    });

    expect(config.features["lazy-router"].routing.temperature).toBe(0.5);
    expect(notes.join("\n")).toContain('features["lazy-router"].routing.temperature: kept (v1 value preserved)');
  });

  test("a version 2 config with only the carried priors needs no rewrite", () => {
    const { alreadyV2 } = migrateV1Config({
      version: 2,
      features: {
        "lazy-router": { routing: { excellentPrior: 3, mediumPrior: 2, temperature: 0.6 } },
      },
    });

    expect(alreadyV2).toBe(true);
  });

  test("a version 2 config with a structural legacy key still needs a rewrite", () => {
    const { alreadyV2 } = migrateV1Config({
      version: 2,
      features: { "vendor-shims": false },
    });

    expect(alreadyV2).toBe(false);
  });

  test("the v2 default routing temperature matches the verified v1 default", () => {
    expect(DEFAULTS["lazy-router"].routing.temperature).toBe(0.6);
  });

  test("keeps an explicitly disabled Antigravity feature off", () => {
    const { config } = migrateV1Config({
      features: {
        "antigravity-system-instruction": false,
        "antigravity-routing": false,
        "antigravity-continuation": false,
        "antigravity-capture": false,
        "antigravity-account-routing": false,
      },
    });
    expect(config.features.antigravity.enabled).toBe(false);
  });

  test("rejects an unknown feature and writes nothing", () => {
    expect(() => migrateV1Config({ features: { nope: true } })).toThrow(/Unknown feature "nope"/);
  });
});

describe("migrateStateDbs", () => {
  test("dry run reports counts, writes no file, and filters expired affinity", () => {
    const dir = tempDir();
    createV1State(dir);
    const state = migrateStateDbs({ stateDir: dir, dryRun: true, now: 1000 });

    expect(state.wrote).toBe(false);
    expect(existsSync(join(dir, "omp-shims-state.sqlite"))).toBe(false);
    expect(state.counts.health).toBe(1);
    expect(state.counts.account_cooldown).toBe(1);
    expect(state.counts.admission).toBe(1);
    expect(state.counts.affinity).toBe(1);
    expect(state.counts.perf).toBe(1);
    expect(state.counts.perf_history).toBe(1);
    expect(state.counts.speed).toBe(1);
    expect(state.counts.proof).toBe(1);
    expect(state.counts.totals).toBe(1);
    expect(state.counts.metadata).toBe(1);
    expect(state.counts.capacity).toBe(0);
    expect(state.dropped).toEqual(["capacity", "worker_heartbeat", "attempt"]);
  });

  test("write creates the canonical v2 file and maps the rows", () => {
    const dir = tempDir();
    createV1State(dir);
    const targetPath = join(dir, "omp-shims-state.sqlite");
    const state = migrateStateDbs({ stateDir: dir, dryRun: false, now: 1000 });

    expect(state.wrote).toBe(true);
    expect(state.backups.length).toBeGreaterThan(0);
    expect(existsSync(targetPath)).toBe(true);

    const db = new Database(targetPath, { readonly: true });
    try {
      expect(db.query("PRAGMA user_version").get().user_version).toBe(2);
      expect(db.query("SELECT name FROM sqlite_master WHERE name = 'attempt'").get()).toBeNull();

      const health = db.query("SELECT * FROM health").get();
      expect(health).toMatchObject({
        key: "openai-codex:plus#1",
        state: "dead",
        until: 0,
        reason_rank: 2,
        fencing_token: 0,
        probe_lease_until: 7,
      });

      const cooldown = db.query("SELECT * FROM account_cooldown").get();
      expect(cooldown.reason_rank).toBe(2);

      expect(db.query("SELECT COUNT(*) AS n FROM capacity").get().n).toBe(0);
      expect(db.query("SELECT COUNT(*) AS n FROM affinity").get().n).toBe(1);
      expect(db.query("SELECT digest FROM affinity").get().digest).toBe("valid");

      const totals = db.query("SELECT * FROM totals").get();
      expect(totals).toMatchObject({
        provider: "mistral",
        model: "deepseek-v4-1-flash-1017",
        uncached_input: 5,
        cached_input: 6,
        output: 7,
        complete: 8,
      });
      expect(db.query("SELECT value FROM metadata WHERE name = 'since'").get().value).toBe("2026-01-01");
    } finally {
      db.close();
    }
  });

  test("a second run is idempotent", () => {
    const dir = tempDir();
    createV1State(dir);
    migrateStateDbs({ stateDir: dir, dryRun: false, now: 1000 });
    const second = migrateStateDbs({ stateDir: dir, dryRun: false, now: 2000 });
    expect(second.wrote).toBe(false);
    expect(second.reason).toBe("already at user_version 2");
  });

  test("no v1 database means no write", () => {
    const dir = tempDir();
    const state = migrateStateDbs({ stateDir: dir, dryRun: false });
    expect(state.wrote).toBe(false);
    expect(state.reason).toBe("no v1 state database found");
    expect(existsSync(join(dir, "omp-shims-state.sqlite"))).toBe(false);
  });
});

describe("migrate-v2 main", () => {
  test("--dry-run writes nothing and prints the mapping", () => {
    const dir = tempDir();
    createV1State(dir);
    const configPath = join(dir, "shims.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        features: {
          "antigravity-continuation": { enabled: true },
          "lazy-router": { routing: { excellentPrior: 2 } },
        },
      }),
      { mode: 0o600 },
    );
    const before = readFileSync(configPath, "utf8");

    const result = Bun.spawnSync([process.execPath, script, "--dry-run", "--config", configPath, "--state-dir", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("routing.excellentPrior: carried");
    expect(result.stdout.toString()).toContain("features.antigravity: merged");
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(existsSync(join(dir, "omp-shims-state.sqlite"))).toBe(false);
  });

  test("--write stores the config with mode 0600", () => {
    const dir = tempDir();
    createV1State(dir);
    const configPath = join(dir, "shims.json");
    writeFileSync(configPath, JSON.stringify({ features: { "lazy-router": { enabled: true } } }), { mode: 0o644 });

    const result = Bun.spawnSync([process.execPath, script, "--write", "--config", configPath, "--state-dir", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(configPath, "utf8")).stateDbPath).toBe(join(dir, "omp-shims-state.sqlite"));
  });
});
