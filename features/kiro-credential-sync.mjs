// Keep the auth-broker's kiro credential in sync with kiro-cli.
//
// kiro-cli rotates its social token in its own sqlite database. The broker's
// snapshot is only written at login time, so once the copy goes stale the
// broker retries a refresh that cannot work and the gateway pays that failed
// refresh on every request.
//
// This feature polls the source file. A cheap mtime check skips the poll when
// nothing changed. CredentialRepository.syncKiroCredential() rejects an empty
// or "undefined" refresh token and performs the write in one transaction, so no
// SQL lives in this module.
//
// Config (~/.omp/shims.json):
//   "kiro-credential-sync": { "enabled": true, "dbPath": null, "pollMs": 60000 }

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CredentialRepository } from "../lib/credentials.mjs";

export const name = "kiro-credential-sync";
export const phase = "background";

const DEFAULT_POLL_MS = 60_000;

/**
 * Install the kiro-cli watcher.
 * @param {Record<string, any>} config the feature settings
 * @param {{ log?: Function }} context
 * @returns {() => void} a disposer that stops the timer and closes the repository
 */
export async function install(config, context = {}) {
  if (config?.enabled === false) return () => {};
  const log = context.log ?? (() => {});
  const dbPath = config.dbPath ?? join(homedir(), ".local", "share", "kiro-cli", "data.sqlite3");
  const parsedPoll = Number.parseInt(String(config.pollMs ?? DEFAULT_POLL_MS), 10);
  const pollMs = Number.isFinite(parsedPoll) && parsedPoll > 0 ? parsedPoll : DEFAULT_POLL_MS;

  if (!existsSync(dbPath)) {
    log(`kiro-credential-sync: kiro-cli database not found at ${dbPath}; skipping`);
    return () => {};
  }

  const agentDbPath = context.paths?.agentDbPath;
  if (typeof agentDbPath !== "string" || agentDbPath === "") {
    log("kiro-credential-sync: agent.db path is missing; skipping");
    return () => {};
  }
  if (!existsSync(agentDbPath)) {
    log("kiro-credential-sync: agent.db not found; skipping");
    return () => {};
  }

  const repository = new CredentialRepository({ agentDbPath, kiroDbPath: dbPath });
  let lastMtimeMs = -1;
  let stopped = false;

  function sync() {
    if (stopped) return;
    let mtimeMs;
    try {
      mtimeMs = statSync(dbPath).mtimeMs;
    } catch {
      return;
    }
    if (mtimeMs === lastMtimeMs) return;

    let result;
    try {
      result = repository.syncKiroCredential(dbPath, { agentDbPath });
    } catch (error) {
      log(`kiro-credential-sync: sync failed: ${error?.message ?? error}`);
      return;
    }
    if (result?.changed) {
      lastMtimeMs = mtimeMs;
      log("kiro-credential-sync: broker kiro credential refreshed");
      return;
    }

    // A write failure may clear on the next poll, so keep the old mtime.
    if (result?.reason === "agent database write failed") return;
    lastMtimeMs = mtimeMs;
    if (result?.reason !== "credential is already current") {
      log(`kiro-credential-sync: no update: ${result?.reason ?? "unknown reason"}`);
    }
  }

  // Run once immediately, then poll. The mtime check keeps the common poll
  // cheap, and the repository repeats the check after reading the token.
  sync();
  const timer = setInterval(sync, pollMs);
  timer.unref?.();
  log(`kiro-credential-sync: watching ${dbPath} every ${pollMs}ms`);

  return () => {
    stopped = true;
    clearInterval(timer);
    try {
      repository.close();
    } catch {}
  };
}
