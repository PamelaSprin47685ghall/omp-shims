import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_AUTH_SENTINEL, withCredentialPin } from "../lib/contracts.mjs";
import { CredentialRepository, openAgentDb } from "../lib/credentials.mjs";

/** Every test appends its cleanup here. afterEach runs them in reverse order. */
const cleanupStack = () => globalThis.__ompCredentialsV2Cleanup;

/** Register one cleanup step for the current test. */
function addCleanup(step) {
  cleanupStack().push(step);
}

beforeEach(() => {
  globalThis.__ompCredentialsV2Cleanup = [];
});

afterEach(() => {
  const stack = cleanupStack();
  globalThis.__ompCredentialsV2Cleanup = [];
  while (stack.length > 0) {
    try {
      stack.pop()();
    } catch {}
  }
});

/** Create a throwaway directory and remove it after the test. */
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "omp-credentials-v2-"));
  addCleanup(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Open a test database and close it after the test. */
function openTestDb(path, options) {
  const db = options ? new Database(path, options) : new Database(path);
  addCleanup(() => {
    try {
      db.close();
    } catch {}
  });
  return db;
}

/** Create an agent.db with the credential and revision tables. */
function createAgentDb(dir, rows) {
  const path = join(dir, "agent.db");
  const db = openTestDb(path, { create: true });
  db.exec(`
    CREATE TABLE auth_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      credential_type TEXT,
      identity_key TEXT,
      data TEXT NOT NULL,
      disabled_cause TEXT,
      updated_at INTEGER DEFAULT 0
    );
    CREATE TABLE auth_change_revision (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
    INSERT INTO auth_change_revision (id, revision) VALUES (1, 0);
  `);
  const insert = db.query(
    "INSERT INTO auth_credentials (provider, credential_type, identity_key, data, disabled_cause) VALUES (?, 'oauth', ?, ?, ?)",
  );
  const ids = rows.map((row) =>
    Number(
      insert.run(row.provider, row.identity ?? null, JSON.stringify(row.data), row.disabled ?? null).lastInsertRowid,
    ),
  );
  return { path, db, ids };
}

/** Create a repository and close it after the test. */
function makeRepo(options) {
  const repo = new CredentialRepository(options);
  addCleanup(() => repo.close());
  return repo;
}

/** Write a broker token file. */
function writeBrokerToken(dir, value = "broker-token") {
  const path = join(dir, "auth-broker.token");
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  return path;
}

/** Start a local broker and stop it after the test. */
function startBroker(fetch) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  addCleanup(() => {
    try {
      server.stop(true);
    } catch {}
  });
  return `http://127.0.0.1:${server.port}`;
}

describe("openAgentDb", () => {
  test("opens read-only with a 2000 ms busy timeout", () => {
    const dir = tempDir();
    const { path } = createAgentDb(dir, []);
    const db = openAgentDb(path);
    expect(db).toBeDefined();
    expect(Object.values(db.query("PRAGMA busy_timeout").get())[0]).toBe(2000);
    expect(() => db.exec("INSERT INTO auth_change_revision (id, revision) VALUES (9, 9)")).toThrow();
    db.close();
  });

  test("returns undefined for a missing path and never throws", () => {
    expect(openAgentDb(join(tempDir(), "missing.db"))).toBeUndefined();
    expect(openAgentDb(null)).toBeUndefined();
    expect(openAgentDb({})).toBeUndefined();
  });
});

describe("CredentialRepository.resolve", () => {
  test("selects by id and filters, skips unusable rows, and honors invalidate", async () => {
    const dir = tempDir();
    const { path, db, ids } = createAgentDb(dir, [
      { provider: "p", data: { email: "empty@example.com", access: "   " } },
      { provider: "p", data: { email: "sentinel@example.com", access: NO_AUTH_SENTINEL } },
      {
        provider: "p",
        data: { email: "a@example.com", access: "secret-a", expires: 11, tier: "pro", accountId: "acct-a" },
      },
      { provider: "other", data: { email: "other@example.com", access: "secret-other" } },
    ]);
    const repo = makeRepo({ agentDbPath: path, brokerUrl: "http://127.0.0.1:9" });

    expect((await repo.resolve("p")).id).toBe(ids[2]);
    expect((await repo.resolve("p", { id: ids[2] })).secret).toBe("secret-a");
    expect((await repo.resolve("p", { email: "A@EXAMPLE.COM" })).id).toBe(ids[2]);
    expect((await repo.resolve("p", { accountId: "acct-a" })).id).toBe(ids[2]);
    expect((await repo.resolve("p", { tier: "PRO" })).id).toBe(ids[2]);
    expect(await repo.resolve("p", { id: 999_999 })).toBeUndefined();
    expect(await repo.resolve("p", { email: "empty@example.com" })).toBeUndefined();
    expect(await repo.resolve("p", { email: "sentinel@example.com" })).toBeUndefined();
    expect(await repo.resolve("other")).toMatchObject({ id: ids[3], secret: "secret-other" });

    // The parsed row is cached for 60 seconds; invalidate drops it.
    db.query("UPDATE auth_credentials SET data = ? WHERE id = ?").run(
      JSON.stringify({ email: "a@example.com", access: "secret-a2", expires: 11, tier: "pro", accountId: "acct-a" }),
      ids[2],
    );
    expect((await repo.resolve("p", { id: ids[2] })).secret).toBe("secret-a");
    repo.invalidate(ids[2]);
    expect((await repo.resolve("p", { id: ids[2] })).secret).toBe("secret-a2");
    repo.invalidate();
    expect((await repo.resolve("p", { id: ids[2] })).secret).toBe("secret-a2");
  });

  test("an active pin is authoritative and never falls back to the database", async () => {
    const dir = tempDir();
    const { path, ids } = createAgentDb(dir, [
      { provider: "p", data: { email: "row@example.com", access: "row-secret" } },
      { provider: "other", data: { email: "other@example.com", access: "other-secret" } },
    ]);
    const repo = makeRepo({ agentDbPath: path, brokerUrl: "http://127.0.0.1:9" });
    const pin = {
      provider: "p",
      credentialId: 777,
      accountId: "pinned",
      email: "pin@example.com",
      secret: "pin-secret",
      tier: "ultra",
      expiresAt: 99,
    };

    const pinned = await withCredentialPin(pin, () => repo.resolve("p", { id: 777 }));
    expect(pinned).toMatchObject({
      id: 777,
      provider: "p",
      accountId: "pinned",
      email: "pin@example.com",
      secret: "pin-secret",
      expiresAt: 99,
      tier: "ultra",
    });
    expect(await withCredentialPin(pin, () => repo.resolve("p", { id: ids[0] }))).toBeUndefined();
    expect(await withCredentialPin(pin, () => repo.resolve("p", { email: "row@example.com" }))).toBeUndefined();
    expect((await withCredentialPin(pin, () => repo.resolve("other"))).secret).toBe("other-secret");
    expect(await withCredentialPin({ ...pin, secret: "" }, () => repo.resolve("p", { id: 777 }))).toBeUndefined();
    expect(
      await withCredentialPin({ ...pin, secret: NO_AUTH_SENTINEL }, () => repo.resolve("p", { id: 777 })),
    ).toBeUndefined();
  });

  test("an identity-only pin resolves its own row and refuses another identity", async () => {
    const dir = tempDir();
    const { path, ids } = createAgentDb(dir, [
      { provider: "google-antigravity", data: { email: "row@example.com", access: "row-secret" } },
      { provider: "google-antigravity", data: { email: "other@example.com", access: "other-secret" } },
    ]);
    const repo = makeRepo({ agentDbPath: path, brokerUrl: "http://127.0.0.1:9" });
    const pin = { provider: "google-antigravity", credentialId: ids[0], email: "row@example.com" };

    // GatewayDispatcher pins an attempt by identity; the secret still comes
    // from agent.db.
    const pinned = await withCredentialPin(pin, () => repo.resolve("google-antigravity", { id: ids[0] }));
    expect(pinned).toMatchObject({ id: ids[0], secret: "row-secret" });

    // The pin also narrows a call that supplies no filter of its own.
    const implicit = await withCredentialPin(pin, () => repo.resolve("google-antigravity"));
    expect(implicit).toMatchObject({ id: ids[0], secret: "row-secret" });

    // Another account cannot slip through the identity pin.
    expect(await withCredentialPin(pin, () => repo.resolve("google-antigravity", { id: ids[1] }))).toBeUndefined();
    expect(
      await withCredentialPin(pin, () => repo.resolve("google-antigravity", { email: "other@example.com" })),
    ).toBeUndefined();

    // An explicit invalid secret on the same pin still rejects it.
    expect(
      await withCredentialPin({ ...pin, secret: "" }, () => repo.resolve("google-antigravity", { id: ids[0] })),
    ).toBeUndefined();
    expect(
      await withCredentialPin({ ...pin, secret: NO_AUTH_SENTINEL }, () =>
        repo.resolve("google-antigravity", { id: ids[0] }),
      ),
    ).toBeUndefined();
  });
});

describe("credential rejection and listing", () => {
  test("disabled and unusable rows never leak a secret", async () => {
    const dir = tempDir();
    const { path } = createAgentDb(dir, [
      { provider: "p", data: { email: "ok@example.com", access: "ok-secret" } },
      { provider: "p", data: { email: "disabled@example.com", access: "disabled-secret" }, disabled: "reauth" },
      { provider: "p", data: { email: "empty@example.com", access: "" } },
      { provider: "p", data: { email: "missing@example.com" } },
      { provider: "p", data: { email: "sentinel@example.com", access: NO_AUTH_SENTINEL } },
      { provider: "p", data: { email: "padded@example.com", access: ` ${NO_AUTH_SENTINEL} ` } },
      { provider: "disabled-only", data: { email: "only@example.com", access: "only-secret" }, disabled: "revoked" },
    ]);
    const repo = makeRepo({ agentDbPath: path, brokerUrl: "http://127.0.0.1:9" });

    for (const email of [
      "disabled@example.com",
      "empty@example.com",
      "missing@example.com",
      "sentinel@example.com",
      "padded@example.com",
    ]) {
      expect(await repo.resolve("p", { email })).toBeUndefined();
    }

    const accounts = await repo.listAccounts("p");
    expect(accounts).toHaveLength(6);
    const disabled = accounts.find((account) => account.email === "disabled@example.com");
    expect(disabled).toMatchObject({ disabled: true });
    expect("secret" in disabled).toBe(false);
    const disabledOnly = await repo.listAccounts("disabled-only");
    expect(disabledOnly[0]).toMatchObject({ disabled: true });
    expect("secret" in disabledOnly[0]).toBe(false);
    expect(await repo.listProviders()).toEqual(["disabled-only", "p"]);
  });
});

describe("CredentialRepository.refresh", () => {
  test("shares one broker request for concurrent calls and never writes agent.db", async () => {
    const dir = tempDir();
    const { path, db, ids } = createAgentDb(dir, [
      { provider: "p", data: { email: "a@example.com", access: "old-secret", expires: 1 } },
    ]);
    const tokenPath = writeBrokerToken(dir, "broker-token");
    let calls = 0;
    let authorization;
    let arrived;
    const firstArrived = new Promise((resolve) => {
      arrived = resolve;
    });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const brokerUrl = startBroker(async (request) => {
      calls += 1;
      authorization = request.headers.get("authorization");
      arrived();
      await gate;
      return Response.json({ entry: { credential: { access: "fresh-secret", expires: 12_345 } } });
    });
    const repo = makeRepo({ agentDbPath: path, brokerUrl, brokerTokenPath: tokenPath });

    const snapshot = {
      bytes: readFileSync(path),
      revision: db.query("SELECT revision FROM auth_change_revision WHERE id = 1").get().revision,
      rows: db.query("SELECT id, data, disabled_cause, updated_at FROM auth_credentials ORDER BY id").all(),
    };

    const first = repo.refresh(ids[0]);
    await firstArrived;
    const second = repo.refresh(ids[0]);
    release();
    const [one, two] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(authorization).toBe("Bearer broker-token");
    expect(one).toEqual({ secret: "fresh-secret", expiresAt: 12_345 });
    expect(two).toEqual(one);
    expect(readFileSync(path).equals(snapshot.bytes)).toBe(true);
    expect(db.query("SELECT revision FROM auth_change_revision WHERE id = 1").get().revision).toBe(snapshot.revision);
    expect(db.query("SELECT id, data, disabled_cause, updated_at FROM auth_credentials ORDER BY id").all()).toEqual(
      snapshot.rows,
    );
  });

  test("returns undefined for a broker error and an invalid target", async () => {
    const dir = tempDir();
    const { path, ids } = createAgentDb(dir, [{ provider: "p", data: { access: "old" } }]);
    const tokenPath = writeBrokerToken(dir);
    const brokerUrl = startBroker(() => new Response("no", { status: 500 }));
    const repo = makeRepo({ agentDbPath: path, brokerUrl, brokerTokenPath: tokenPath });
    expect(await repo.refresh(ids[0])).toBeUndefined();

    const unsafe = makeRepo({
      agentDbPath: path,
      brokerUrl: "http://evil.example:8765",
      brokerTokenPath: tokenPath,
    });
    expect(await unsafe.refresh(ids[0])).toBeUndefined();
  });
});

describe("CredentialRepository.resolveTokenSpec", () => {
  test("reads values, env, JSON, and explicit SQLite columns", () => {
    const dir = tempDir();
    const repo = makeRepo({ agentDbPath: join(dir, "missing-agent.db") });
    process.env.OMP_V2_TEST_TOKEN = " env-token ";
    addCleanup(() => {
      delete process.env.OMP_V2_TEST_TOKEN;
    });

    expect(repo.resolveTokenSpec({ value: "  literal-token  " })).toBe("literal-token");
    expect(repo.resolveTokenSpec({ value: "" })).toBeUndefined();
    expect(repo.resolveTokenSpec({ env: "OMP_V2_TEST_TOKEN" })).toBe("env-token");
    expect(repo.resolveTokenSpec({ value: "$OMP_V2_TEST_TOKEN" })).toBe("env-token");
    expect(repo.resolveTokenSpec({ value: "$OMP_V2_TEST_MISSING" })).toBe("$OMP_V2_TEST_MISSING");

    const jsonPath = join(dir, "tokens.json");
    writeFileSync(jsonPath, JSON.stringify({ nested: { token: "json-token" } }));
    expect(repo.resolveTokenSpec({ json: { file: jsonPath, path: "nested.token" } })).toBe("json-token");
    expect(repo.resolveTokenSpec({ json: { file: jsonPath, path: "nested.missing" } })).toBeUndefined();

    const sqlitePath = join(dir, "tokens.db");
    const sqlite = openTestDb(sqlitePath, { create: true });
    sqlite.exec("CREATE TABLE tokens (label TEXT, api_key TEXT, other TEXT)");
    sqlite.query("INSERT INTO tokens VALUES (?, ?, ?)").run("x", "col-token", "y".repeat(40));
    expect(
      repo.resolveTokenSpec({
        sqlite: { file: sqlitePath, query: "SELECT label, api_key, other FROM tokens", column: "api_key" },
      }),
    ).toBe("col-token");
    expect(repo.resolveTokenSpec({ sqlite: { file: sqlitePath, query: "SELECT label, other FROM tokens" } })).toBe("x");
    expect(
      repo.resolveTokenSpec({ sqlite: { file: sqlitePath, query: "SELECT api_key FROM tokens", column: "bad-name" } }),
    ).toBeUndefined();
    expect(repo.resolveTokenSpec({ sqlite: { file: sqlitePath, table: "tokens", column: "api_key" } })).toBe(
      "col-token",
    );
  });
});

describe("CredentialRepository.syncKiroCredential", () => {
  test("rejects invalid refresh_token values without writing agent.db", () => {
    const dir = tempDir();
    const { path, db, ids } = createAgentDb(dir, [
      { provider: "kiro", data: { access: "old-access", refresh: "old-refresh", expires: 1, region: "us-east-1" } },
    ]);
    const kiroPath = join(dir, "kiro.db");
    const kiro = openTestDb(kiroPath, { create: true });
    kiro.exec("CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT)");
    let tick = 0;
    const writeKiro = (fields) => {
      tick += 1;
      kiro
        .query(
          "INSERT INTO auth_kv (key, value) VALUES ('kirocli:social:token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(JSON.stringify(fields));
      const stamp = new Date(Date.now() + tick * 5_000);
      utimesSync(kiroPath, stamp, stamp);
    };
    const storedRow = () => db.query("SELECT data, updated_at FROM auth_credentials WHERE id = ?").get(ids[0]);
    const revision = () => db.query("SELECT revision FROM auth_change_revision WHERE id = 1").get().revision;
    const repo = makeRepo({ agentDbPath: path, brokerUrl: "http://127.0.0.1:9", kiroDbPath: kiroPath });

    for (const refreshToken of ["undefined", "", "   "]) {
      const before = storedRow();
      const beforeRevision = revision();
      writeKiro({
        access_token: "valid-access",
        refresh_token: refreshToken,
        expires_at: "2030-01-01T00:00:00Z",
      });
      const result = repo.syncKiroCredential(kiroPath, { agentDbPath: path });
      expect(result.changed).toBe(false);
      expect(result.reason).toMatch(/refresh token/);
      expect(storedRow()).toEqual(before);
      expect(revision()).toBe(beforeRevision);
    }

    writeKiro({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_at: "2030-01-01T00:00:00Z",
      region: "eu-west-1",
    });
    expect(repo.syncKiroCredential(kiroPath, { agentDbPath: path })).toEqual({ changed: true });
    const stored = JSON.parse(storedRow().data);
    expect(stored.access).toBe("new-access");
    expect(stored.refresh).toBe("new-refresh|desktop");
    expect(stored.region).toBe("eu-west-1");
    expect(revision()).toBe(1);
  });
});
