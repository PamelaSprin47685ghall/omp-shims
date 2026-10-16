// Keep the auth-broker's stored kiro OAuth credential in sync with kiro-cli.
//
// kiro-cli rotates its social token hourly in its own sqlite database, but the
// broker's credential snapshot is only written at `/login` time. Once the stored
// copy goes stale, the broker's refresh sweep tries (and fails: "Unknown OAuth
// provider: kiro") every interval, and the gateway's per-request credential
// preflight pays the failed refresh before falling back — the observed kiro
// latency. The plugin's own streaming path already reads kiro-cli's sqlite
// directly, so the broker copy only needs to be *fresh enough* to stop the
// refresh attempts and to give the gateway a usable bearer token.
//
// This feature watches kiro-cli's token row and rewrites the broker credential
// (agent.db `auth_credentials`) whenever the access token or its expiry changes,
// bumping `auth_change_revision` so the broker's snapshot stream picks it up.
//
// Config (~/.omp/shims.json):
//   "kiro-credential-sync": { "enabled": true, "dbPath": null, "pollMs": 60000 }
// Env:
//   OMP_SHIMS_KIRO_SYNC_DB     path to kiro-cli data.sqlite3
//   OMP_SHIMS_KIRO_SYNC_POLL   poll interval in ms (default 60000)

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_POLL_MS = 60_000;

/** Read kiro-cli's social token row as a plain object, or undefined. */
function readKiroCliToken(dbPath) {
  const { Database } = require("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT value FROM auth_kv WHERE key = 'kirocli:social:token'").get();
    if (!row || typeof row.value !== "string") return undefined;
    const parsed = JSON.parse(row.value);
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") return undefined;
    return parsed;
  } finally {
    db.close();
  }
}

export function install(config, context) {
  const log = context.log ?? (() => {});
  const dbPath =
    process.env.OMP_SHIMS_KIRO_SYNC_DB ??
    config.dbPath ??
    join(homedir(), ".local", "share", "kiro-cli", "data.sqlite3");
  const pollMs = Number.parseInt(process.env.OMP_SHIMS_KIRO_SYNC_POLL ?? String(config.pollMs ?? DEFAULT_POLL_MS), 10) || DEFAULT_POLL_MS;

  if (!existsSync(dbPath)) {
    log(`kiro-credential-sync: kiro-cli database not found at ${dbPath}; skipping`);
    return;
  }

  const agentDb = join(homedir(), ".omp", "agent", "agent.db");
  if (!existsSync(agentDb)) {
    log("kiro-credential-sync: agent.db not found; skipping");
    return;
  }

  let lastSignature = "";

  function sync() {
    let token;
    try {
      token = readKiroCliToken(dbPath);
    } catch (error) {
      log(`kiro-credential-sync: cannot read kiro-cli token: ${error.message}`);
      return;
    }
    if (!token) {
      log("kiro-credential-sync: no social token row; skipping");
      return;
    }

    const expiresAt = typeof token.expires_at === "string" ? Date.parse(token.expires_at) : Date.now() + 3600_000;
    const signature = `${token.access_token}:${expiresAt}`;
    if (signature === lastSignature) return;

    const { Database } = require("bun:sqlite");
    let db;
    try {
      db = new Database(agentDb);
    } catch (error) {
      log(`kiro-credential-sync: cannot open agent.db: ${error.message}`);
      return;
    }

    try {
      const row = db.query("SELECT id, data FROM auth_credentials WHERE provider = 'kiro' ORDER BY id LIMIT 1").get();
      if (!row) {
        log("kiro-credential-sync: no kiro credential row in agent.db; nothing to sync");
        return;
      }

      const current = JSON.parse(row.data);
      const next = {
        ...current,
        access: token.access_token,
        refresh: `${token.refresh_token}|desktop`,
        expires: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 3600_000,
        region: token.region || current.region || "us-east-1",
        profileArn: token.profile_arn || current.profileArn,
      };

      const update = db.transaction(() => {
        db.query("UPDATE auth_credentials SET data = ?, updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?").run(
          JSON.stringify(next),
          row.id,
        );
        db.query("UPDATE auth_change_revision SET revision = revision + 1 WHERE id = 1").run();
      });
      update();
      lastSignature = signature;
      log(`kiro-credential-sync: broker kiro credential refreshed (expires ${new Date(next.expires).toISOString()})`);
    } catch (error) {
      try {
        db.rollbackTransaction?.();
      } catch {}
      log(`kiro-credential-sync: update failed: ${error.message}`);
    } finally {
      db.close();
    }
  }

  // Run once immediately, then poll. The mtime check keeps the common no-change
  // poll cheap without holding the sqlite lock.
  sync();
  const timer = setInterval(sync, pollMs);
  timer.unref?.();
  log(`kiro-credential-sync: watching ${dbPath} every ${pollMs}ms`);
}
