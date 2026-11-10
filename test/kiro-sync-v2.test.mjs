// Contract tests for the v2 kiro credential sync.
//
// The feature delegates the write to CredentialRepository, so these tests use
// a temporary kiro-cli database and a temporary agent.db. An invalid refresh
// token must leave the stored credential untouched, and the disposer must stop
// the polling timer.

import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import { install } from "../features/kiro-credential-sync.mjs";
import { tempDir } from "./helpers.mjs";

const disposers = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** Build a kiro-cli source database and a broker agent.db with one kiro row. */
function makeDatabases(token) {
  const directory = tempDir("e5-kiro-");
  const source = join(directory, "data.sqlite3");
  const sourceDb = new Database(source);
  sourceDb.exec("CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT)");
  sourceDb.query("INSERT INTO auth_kv (key, value) VALUES (?, ?)").run("kirocli:social:token", JSON.stringify(token));
  sourceDb.close();

  const agent = join(directory, "agent.db");
  const agentDb = new Database(agent);
  agentDb.exec(
    "CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, identity_key TEXT, disabled_cause TEXT, updated_at INTEGER)",
  );
  agentDb.exec("CREATE TABLE auth_change_revision (id INTEGER PRIMARY KEY, revision INTEGER)");
  agentDb
    .query("INSERT INTO auth_credentials (id, provider, credential_type, data) VALUES (1, 'kiro', 'oauth', ?)")
    .run(JSON.stringify({ access: "old-access", refresh: "old-refresh|desktop", expires: 1 }));
  agentDb.exec("INSERT INTO auth_change_revision (id, revision) VALUES (1, 0)");
  agentDb.close();

  return { directory, source, agent };
}

/** Read the kiro row and revision back. */
function readState(agent) {
  const db = new Database(agent, { readonly: true });
  try {
    const row = db.query("SELECT data FROM auth_credentials WHERE id = 1").get();
    const revision = db.query("SELECT revision FROM auth_change_revision WHERE id = 1").get();
    return { data: JSON.parse(row.data), revision: revision.revision };
  } finally {
    db.close();
  }
}

/** A token with a future expiry. */
function token(overrides = {}) {
  return {
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    region: "us-east-1",
    ...overrides,
  };
}

test("a valid token is copied and the revision is bumped", async () => {
  const { source, agent } = makeDatabases(token());
  const dispose = await install(
    { enabled: true, dbPath: source, pollMs: 60_000 },
    { log: () => {}, paths: { agentDbPath: agent } },
  );
  disposers.push(dispose);

  const state = readState(agent);
  expect(state.data.access).toBe("new-access");
  expect(state.data.refresh).toBe("new-refresh|desktop");
  expect(state.data.region).toBe("us-east-1");
  expect(state.revision).toBe(1);
});

test("an undefined-looking refresh token writes nothing", async () => {
  const { source, agent } = makeDatabases(token({ refresh_token: "undefined" }));
  const dispose = await install(
    { enabled: true, dbPath: source, pollMs: 60_000 },
    { log: () => {}, paths: { agentDbPath: agent } },
  );
  disposers.push(dispose);

  const state = readState(agent);
  expect(state.data.access).toBe("old-access");
  expect(state.data.refresh).toBe("old-refresh|desktop");
  expect(state.revision).toBe(0);
});

test("the timer is unref'd and the disposer clears it", async () => {
  const { source, agent } = makeDatabases(token());
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let capturedTimer;
  let unrefCalled = false;
  let clearedTimer;

  globalThis.setInterval = (callback, interval, ...rest) => {
    const timer = originalSetInterval(callback, interval, ...rest);
    capturedTimer = timer;
    const realUnref = timer.unref?.bind(timer);
    try {
      timer.unref = () => {
        unrefCalled = true;
        return realUnref?.();
      };
    } catch {}
    return timer;
  };
  globalThis.clearInterval = (timer) => {
    clearedTimer = timer;
    return originalClearInterval(timer);
  };

  let dispose;
  let timer;
  try {
    dispose = await install(
      { enabled: true, dbPath: source, pollMs: 60_000 },
      { log: () => {}, paths: { agentDbPath: agent } },
    );
    timer = capturedTimer;
    expect(timer).toBeDefined();
    expect(unrefCalled).toBe(true);
    dispose();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }

  expect(clearedTimer).toBe(timer);
});
