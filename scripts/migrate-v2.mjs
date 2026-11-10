#!/usr/bin/env bun

// One-shot v1 to v2 migration.
//
//   bun scripts/migrate-v2.mjs --dry-run
//   bun scripts/migrate-v2.mjs --write
//
// The script converts ~/.omp/shims.json to the strict v2 schema and merges
// three v1 SQLite files into one omp-shims-state.sqlite with user_version 2.
// A dry run writes nothing. A write first copies every source into a backup
// directory, then validates the new config, then replaces the files.
//
// Options:
//   --dry-run            show the plan (default)
//   --write              apply the plan
//   --config PATH        v1 shims.json (default ~/.omp/shims.json)
//   --state-dir PATH     directory of the v1 SQLite files (default ~/.omp)
//   --backup-dir PATH    backup directory (default <state-dir>/omp-shims-backup-<ts>)
//
// Open v1 databases read-only. Copy rows inside one transaction. Skip a table
// that a source does not contain.

import { Database } from "bun:sqlite";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CONFIG_PATH, validateConfig } from "../lib/config.mjs";
import { reasonRank, STATE_SCHEMA, STATE_VERSION } from "../lib/router/state-store.mjs";

/** The five v1 Antigravity features and the source of each sub-setting. */
const ANTIGRAVITY_FEATURES = [
  "antigravity-system-instruction",
  "antigravity-routing",
  "antigravity-continuation",
  "antigravity-capture",
  "antigravity-account-routing",
];

/**
 * v1 lazy-router priors. v2 ranks with one continuous intelligence score, so
 * these values have no scoring role; keep them at their path for provenance.
 */
const LEGACY_PRIOR_KEYS = ["excellentPrior", "mediumPrior"];

/** v1 lazy-router paths that the single v2 state database replaces. */
const DROPPED_STATE_SETTINGS = [
  "healthDbPath",
  "tokenTotalsPath",
  "perfStatePath",
  "speedStatePath",
  "concurrencyProofStatePath",
];

/** v1 tables that move into the v2 state database, grouped by source file. */
const STATE_SOURCES = [
  { file: "lazy-router-health.sqlite", setting: "healthDbPath", tables: ["health"] },
  {
    file: "lazy-router-state.sqlite",
    setting: "stateDbPath",
    tables: ["account_cooldown", "admission", "perf", "perf_history", "speed", "proof", "affinity"],
  },
  { file: "lazy-router-token-totals.sqlite", setting: "tokenTotalsPath", tables: ["totals", "metadata"] },
];

/** Every table the canonical v2 schema creates. */
const TARGET_TABLES = [
  "health",
  "capacity",
  "account_cooldown",
  "admission",
  "affinity",
  "perf",
  "perf_history",
  "speed",
  "proof",
  "totals",
  "metadata",
];

/** v1 tables whose rows do not move into v2. */
const DROPPED_TABLES = ["capacity", "worker_heartbeat", "attempt"];

/** True for a JSON object (not null, not an array). */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copy JSON data. */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/** The enabled flag of a v1 feature entry. */
function enabledOf(entry) {
  if (typeof entry === "boolean") return entry;
  if (isPlainObject(entry) && entry.enabled !== undefined) return entry.enabled !== false;
  return undefined;
}

/** Read a JSON file. Return undefined when it does not exist. */
function readJson(path) {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${path}: ${error.message}`);
  }
}

/**
 * Merge the five v1 Antigravity keys into features.antigravity.
 * Only keys that the v1 file contains are mapped; v2 defaults fill the rest.
 */
function mergeAntigravity(features, notes) {
  const present = ANTIGRAVITY_FEATURES.filter((name) => Object.hasOwn(features, name));
  if (present.length === 0) return;

  const existing = features.antigravity;
  const merged = isPlainObject(existing)
    ? cloneJson(existing)
    : typeof existing === "boolean"
      ? { enabled: existing }
      : {};

  const allOff = present.length === ANTIGRAVITY_FEATURES.length;
  if (merged.enabled === undefined) {
    merged.enabled = !(allOff && present.every((name) => enabledOf(features[name]) === false));
  }

  const setting = (name) => features[name];
  const systemInstruction = setting("antigravity-system-instruction");
  if (systemInstruction !== undefined && merged.systemInstruction === undefined) {
    merged.systemInstruction = enabledOf(systemInstruction) !== false;
  }

  const routing = setting("antigravity-routing");
  if (routing !== undefined) {
    if (merged.routing === undefined) merged.routing = enabledOf(routing) !== false;
    if (isPlainObject(routing) && routing.effort !== undefined && merged.effort === undefined) {
      merged.effort = routing.effort;
    }
  }

  const continuation = setting("antigravity-continuation");
  if (continuation !== undefined) {
    if (merged.continuation === undefined) merged.continuation = enabledOf(continuation) !== false;
    if (isPlainObject(continuation)) {
      for (const key of ["maxContinuations", "locationRetries", "idleTimeoutMs"]) {
        if (continuation[key] !== undefined && merged[key] === undefined) merged[key] = continuation[key];
      }
      if (continuation.out !== undefined && merged.continuationOut === undefined) {
        merged.continuationOut = continuation.out;
      }
    }
  }

  const capture = setting("antigravity-capture");
  if (capture !== undefined) {
    if (merged.capture === undefined) merged.capture = enabledOf(capture) !== false;
    if (isPlainObject(capture)) {
      if (capture.out !== undefined && merged.captureOut === undefined) merged.captureOut = capture.out;
      if (capture.sampleEvery !== undefined && merged.sampleEvery === undefined) {
        merged.sampleEvery = capture.sampleEvery;
      }
    }
  }

  const accountRouting = setting("antigravity-account-routing");
  if (accountRouting !== undefined) {
    if (merged.accountRouting === undefined) merged.accountRouting = enabledOf(accountRouting) !== false;
    if (isPlainObject(accountRouting)) {
      for (const key of ["ultraAccounts", "proAccounts", "cooldownMs", "ultraModelPattern"]) {
        if (accountRouting[key] !== undefined && merged[key] === undefined) merged[key] = accountRouting[key];
      }
      if (accountRouting.out !== undefined && merged.accountsOut === undefined) {
        merged.accountsOut = accountRouting.out;
      }
    }
  }

  features.antigravity = merged;
  for (const name of present) delete features[name];
  notes.push(`features.antigravity: merged ${present.join(", ")}`);
}

/**
 * Convert one v1 config object to the v2 schema. This function is pure.
 *
 * @param {Record<string, any>} raw
 * @param {{ path?: string, stateDbPath?: string }} [options]
 * @returns {{ config: Record<string, any>, notes: string[], alreadyV2: boolean }}
 */
export function migrateV1Config(
  raw,
  { path = CONFIG_PATH, stateDbPath = join(dirname(path), "omp-shims-state.sqlite") } = {},
) {
  if (!isPlainObject(raw)) throw new Error(`the config root must be a JSON object (${path})`);

  const features = isPlainObject(raw.features) ? cloneJson(raw.features) : {};
  const notes = [];
  const hadLegacyAntigravity = ANTIGRAVITY_FEATURES.some((name) => Object.hasOwn(features, name));
  const hadVendorShims = Object.hasOwn(features, "vendor-shims");
  const hadLoopGuard = Object.hasOwn(features, "native-loop-guard");
  const alreadyV2 = raw.version === 2 && !hadLegacyAntigravity && !hadVendorShims && !hadLoopGuard;

  mergeAntigravity(features, notes);

  if (hadVendorShims) {
    delete features["vendor-shims"];
    notes.push("features.vendor-shims: dropped (no v2 feature replaces it)");
  }

  const nextRuntime = isPlainObject(raw.runtime) ? cloneJson(raw.runtime) : {};
  if (hadLoopGuard) {
    const guard = features["native-loop-guard"];
    delete features["native-loop-guard"];
    if (nextRuntime.thinkingLoopGuard === undefined) nextRuntime.thinkingLoopGuard = enabledOf(guard) !== false;
    notes.push(`features.native-loop-guard: dropped; runtime.thinkingLoopGuard = ${nextRuntime.thinkingLoopGuard}`);
  }

  const routing = features["lazy-router"]?.routing;
  if (isPlainObject(routing)) {
    for (const key of LEGACY_PRIOR_KEYS) {
      if (!Object.hasOwn(routing, key)) continue;
      notes.push(
        `features["lazy-router"].routing.${key}: carried ` +
          "(v2 ranks with continuous intelligence; value retained for reference, not used)",
      );
    }
    if (Object.hasOwn(routing, "temperature")) {
      notes.push(`features["lazy-router"].routing.temperature: kept (v1 value preserved)`);
    }
  }

  const lazy = features["lazy-router"];
  if (isPlainObject(lazy)) {
    for (const key of DROPPED_STATE_SETTINGS) {
      if (!Object.hasOwn(lazy, key)) continue;
      delete lazy[key];
      notes.push(`features["lazy-router"].${key}: dropped (v2 uses one state database)`);
    }
    if (Object.hasOwn(lazy, "stateDbPath")) {
      delete lazy.stateDbPath;
      notes.push(`features["lazy-router"].stateDbPath: moved to stateDbPath (merged state database)`);
    }
  }

  const next = { version: 2 };
  next.stateDbPath = stateDbPath;
  if (Object.keys(nextRuntime).length > 0) next.runtime = nextRuntime;
  next.features = features;
  if (raw.pluginBridge !== undefined) next.pluginBridge = cloneJson(raw.pluginBridge);

  // Validate before any write. A v1 key that has no mapping fails here.
  validateConfig(next, { path });
  return { config: next, notes, alreadyV2 };
}

/** Copy one SQLite file and its WAL sidecars into the backup directory. */
function backupDatabase(path, backupDir, stamp) {
  const backups = [];
  for (const suffix of ["", "-wal", "-shm"]) {
    if (!existsSync(`${path}${suffix}`)) continue;
    const target = join(backupDir, `${basename(path)}.bak-${stamp}${suffix}`);
    copyFileSync(`${path}${suffix}`, target);
    chmodSync(target, 0o600);
    backups.push(target);
  }
  return backups;
}

/** The v1 database path for one group, honoring the migrated config. */
function sourcePath(stateDir, config, group) {
  const configured = config?.features?.["lazy-router"]?.[group.setting];
  return typeof configured === "string" && configured !== "" ? configured : join(stateDir, group.file);
}

/** True when a source database contains one table. */
function tableExists(db, table) {
  return Boolean(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

/** Copy named columns from one source table into the canonical target. */
function copyColumns(source, target, table, columns, rows) {
  const available = new Set(
    source
      .query(`PRAGMA table_info("${table}")`)
      .all()
      .map((column) => column.name),
  );
  const selected = columns.filter((column) => available.has(column));
  const insert = target.prepare(
    `INSERT INTO "${table}" (${selected.map((name) => `"${name}"`).join(", ")}) ` +
      `VALUES (${selected.map(() => "?").join(", ")})`,
  );
  for (const row of rows) insert.run(...selected.map((column) => row[column]));
  return rows.length;
}

/** Copy the columns that both schemas share. Return the row count. */
function copyCommon(source, target, table) {
  if (!tableExists(source, table)) return undefined;
  const columns = source
    .query(`PRAGMA table_info("${table}")`)
    .all()
    .map((column) => column.name);
  return copyColumns(source, target, table, columns, source.query(`SELECT * FROM "${table}"`).all());
}

/** Map a v1 health row to the v2 shape. A cooldown lasts until a probe succeeds. */
function copyHealth(source, target) {
  if (!tableExists(source, "health")) return undefined;
  const rows = source.query("SELECT * FROM health").all();
  const insert = target.prepare(
    `INSERT INTO health (key, state, until, reason, reason_rank, fencing_token, probe_lease_until, updated_at)
     VALUES (?, ?, 0, ?, ?, 0, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.key,
      row.state === "cooling" ? "dead" : row.state,
      row.reason ?? null,
      reasonRank(row.reason),
      row.probe_lease_until ?? 0,
      row.updated_at,
    );
  }
  return rows.length;
}

/** Add the v2 reason rank to an account cooldown row. */
function copyAccountCooldown(source, target) {
  if (!tableExists(source, "account_cooldown")) return undefined;
  const rows = source.query("SELECT * FROM account_cooldown").all();
  const insert = target.prepare(
    "INSERT INTO account_cooldown (account, until, reason, reason_rank, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(row.account, row.until, row.reason ?? null, reasonRank(row.reason), row.updated_at);
  }
  return rows.length;
}

/** Copy the admission window. The v2 id is autoincremented. */
function copyAdmission(source, target) {
  if (!tableExists(source, "admission")) return undefined;
  const rows = source.query("SELECT * FROM admission").all();
  const insert = target.prepare("INSERT INTO admission (unit, at, share) VALUES (?, ?, ?)");
  for (const row of rows) insert.run(row.unit, row.at, row.share);
  return rows.length;
}

/** Copy only the affinity rows that have not expired. */
function copyAffinity(source, target, now) {
  if (!tableExists(source, "affinity")) return undefined;
  const rows = source.query("SELECT * FROM affinity WHERE expires_at > ?").all(now);
  const insert = target.prepare("INSERT INTO affinity (digest, length, unit_key, expires_at) VALUES (?, ?, ?, ?)");
  for (const row of rows) insert.run(row.digest, row.length, row.unit_key, row.expires_at);
  return rows.length;
}

/** Split the v1 provider-qualified model at the first slash. */
function copyTotals(source, target) {
  if (!tableExists(source, "totals")) return undefined;
  const rows = source.query("SELECT * FROM totals").all();
  const insert = target.prepare(
    `INSERT INTO totals (
       provider, model, uncached_input, cached_input, output, complete,
       seen_uncached, seen_cached, seen_output
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let copied = 0;
  for (const row of rows) {
    if (typeof row.model !== "string") continue;
    const slash = row.model.indexOf("/");
    if (slash <= 0) continue;
    insert.run(
      row.model.slice(0, slash),
      row.model.slice(slash + 1),
      row.uncachedInput ?? 0,
      row.cachedInput ?? 0,
      row.output ?? 0,
      row.complete ?? 0,
      row.seenUncached ?? 0,
      row.seenCached ?? 0,
      row.seenOutput ?? 0,
    );
    copied += 1;
  }
  return copied;
}

/** Copy every present v1 source into the canonical target. Return the counts. */
function copyAll(groups, target, now) {
  const counts = Object.fromEntries(TARGET_TABLES.map((table) => [table, 0]));
  for (const group of groups) {
    const source = new Database(group.path, { readonly: true });
    try {
      for (const table of group.tables) {
        let count;
        if (table === "health") count = copyHealth(source, target);
        else if (table === "account_cooldown") count = copyAccountCooldown(source, target);
        else if (table === "admission") count = copyAdmission(source, target);
        else if (table === "affinity") count = copyAffinity(source, target, now);
        else if (table === "totals") count = copyTotals(source, target);
        else count = copyCommon(source, target, table);
        if (count !== undefined) counts[table] = count;
      }
    } finally {
      source.close();
    }
  }
  return counts;
}

/** v1 tables that must not reach the v2 file, in a stable order. */
function detectDropped(groups) {
  const dropped = new Set();
  for (const group of groups) {
    const source = new Database(group.path, { readonly: true });
    try {
      for (const table of DROPPED_TABLES) if (tableExists(source, table)) dropped.add(table);
    } finally {
      source.close();
    }
  }
  return [...dropped];
}

/**
 * Merge the v1 databases into one v2 state database.
 *
 * @param {{
 *   stateDir?: string,
 *   targetPath?: string,
 *   config?: Record<string, any>,
 *   dryRun?: boolean,
 *   backupDir?: string,
 *   now?: number,
 * }} [options]
 * @returns {{
 *   counts: Record<string, number>,
 *   dropped: string[],
 *   missing: string[],
 *   targetPath: string,
 *   wrote: boolean,
 *   backups: string[],
 *   reason?: string,
 * }}
 */
export function migrateStateDbs({
  stateDir = join(homedir(), ".omp"),
  targetPath = join(stateDir, "omp-shims-state.sqlite"),
  config,
  dryRun = true,
  backupDir,
  now = Date.now(),
} = {}) {
  const groups = STATE_SOURCES.map((group) => ({ ...group, path: sourcePath(stateDir, config, group) }));
  const present = groups.filter((group) => existsSync(group.path));
  const missing = groups.filter((group) => !existsSync(group.path)).map((group) => group.path);

  const result = {
    counts: Object.fromEntries(TARGET_TABLES.map((table) => [table, 0])),
    dropped: [],
    missing,
    targetPath,
    wrote: false,
    backups: [],
  };

  if (present.length === 0) {
    result.reason = "no v1 state database found";
    return result;
  }

  if (existsSync(targetPath)) {
    const current = new Database(targetPath, { readonly: true });
    try {
      const version = current.query("PRAGMA user_version").get()?.user_version;
      const tables = current
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all();
      if (version === STATE_VERSION && tables.length > 0) {
        result.reason = `already at user_version ${STATE_VERSION}`;
        return result;
      }
      if (tables.length > 0) {
        throw new Error(`target ${targetPath} exists with user_version ${version}; move it away first`);
      }
    } finally {
      current.close();
    }
  }

  result.dropped = detectDropped(present);

  if (dryRun) {
    const memory = new Database(":memory:");
    try {
      memory.exec(STATE_SCHEMA);
      result.counts = memory.transaction(() => copyAll(present, memory, now))();
    } finally {
      memory.close();
    }
    return result;
  }

  result.counts = Object.fromEntries(TARGET_TABLES.map((table) => [table, 0]));

  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const directory = backupDir ?? join(stateDir, `omp-shims-backup-${stamp}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const group of present) result.backups.push(...backupDatabase(group.path, directory, stamp));

  mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(targetPath), `.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  const target = new Database(temporary, { create: true });
  try {
    target.exec("PRAGMA busy_timeout = 5000");
    target.exec(STATE_SCHEMA);
    result.counts = target.transaction(() => copyAll(present, target, now))();
    target.exec(`PRAGMA user_version = ${STATE_VERSION}`);
  } finally {
    target.close();
  }

  chmodSync(temporary, 0o600);
  renameSync(temporary, targetPath);
  result.wrote = true;
  return result;
}

/** Write one file with mode 0600 through a temporary file and a rename. */
function writeAtomically(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Back up one file when it exists. */
function backupFile(path, backupDir, stamp) {
  if (!existsSync(path)) return undefined;
  const target = join(backupDir, `${basename(path)}.bak-${stamp}`);
  copyFileSync(path, target);
  chmodSync(target, 0o600);
  return target;
}

/** Print the migration plan or result. */
function printSummary({ configPath, migration, state, dryRun }) {
  console.log(`omp-shims migrate v1 -> v2 (${dryRun ? "dry run" : "write"})`);
  console.log(`config: ${configPath}`);
  if (!migration) console.log("  absent; no config to convert");
  else if (migration.alreadyV2) console.log("  already v2; no change");
  else for (const note of migration.notes) console.log(`  ${note}`);
  console.log(`state:  ${state.targetPath}`);
  for (const [table, count] of Object.entries(state.counts)) {
    console.log(`  ${table.padEnd(20)} ${count}`);
  }
  if (state.dropped.length > 0) console.log(`  v1 rows not migrated: ${state.dropped.join(", ")}`);
  for (const path of state.missing) console.log(`  missing source: ${path}`);
  if (state.reason) console.log(`  ${state.reason}`);
  if (state.backups.length > 0) console.log(`backup: ${dirname(state.backups[0])}`);
  console.log(dryRun ? "nothing written" : "migration complete");
}

/**
 * Run the migration command.
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv = process.argv.slice(2)) {
  let write = false;
  let configPath = CONFIG_PATH;
  let stateDir = join(homedir(), ".omp");
  let backupDir;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") write = false;
    else if (argument === "--write") write = true;
    else if (argument === "--config") configPath = argv[++index] ?? "";
    else if (argument === "--state-dir") stateDir = argv[++index] ?? "";
    else if (argument === "--backup-dir") backupDir = argv[++index] ?? "";
    else if (argument === "--help" || argument === "-h") {
      console.log(
        "usage: bun scripts/migrate-v2.mjs [--dry-run|--write] [--config PATH] [--state-dir PATH] [--backup-dir PATH]",
      );
      return 0;
    } else {
      console.error(`migrate-v2: unknown argument "${argument}"`);
      return 2;
    }
  }
  if (write && argv.includes("--dry-run")) {
    console.error("migrate-v2: --write and --dry-run cannot be combined");
    return 2;
  }
  if (!configPath || !stateDir) {
    console.error("migrate-v2: --config and --state-dir need a value");
    return 2;
  }

  let migration;
  let v1Config;
  try {
    const raw = readJson(configPath);
    v1Config = raw;
    const stateDbPath = join(stateDir, "omp-shims-state.sqlite");
    if (raw !== undefined) migration = migrateV1Config(raw, { path: configPath, stateDbPath });
  } catch (error) {
    console.error(`migrate-v2: ${error.message}`);
    console.error("migrate-v2: nothing was written");
    return 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const directory = backupDir ?? join(stateDir, `omp-shims-backup-${stamp}`);

  let state;
  try {
    state = migrateStateDbs({
      stateDir,
      targetPath: join(stateDir, "omp-shims-state.sqlite"),
      config: v1Config,
      dryRun: !write,
      backupDir: write ? directory : undefined,
    });
  } catch (error) {
    console.error(`migrate-v2: ${error.message}`);
    console.error("migrate-v2: nothing was written");
    return 1;
  }

  if (write) {
    try {
      if (existsSync(configPath) && !migration?.alreadyV2) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        backupFile(configPath, directory, stamp);
      }
      if (migration && !migration.alreadyV2) {
        writeAtomically(configPath, `${JSON.stringify(migration.config, null, 2)}\n`);
      }
    } catch (error) {
      console.error(`migrate-v2: ${error.message}`);
      return 1;
    }
  }

  printSummary({ configPath, migration, state, dryRun: !write });
  return 0;
}

if (import.meta.main) {
  const code = await main();
  process.exitCode = code;
}
