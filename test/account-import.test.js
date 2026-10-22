import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { repairIdentities, upsertCredential } from "../lib/account-import.js";
import { tempDir } from "./helpers.js";

function freshDb() {
  const path = join(tempDir(), "agent.db");
  const db = new Database(path);
  db.exec(`CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, credential_type TEXT NOT NULL,
    data TEXT NOT NULL, disabled_cause TEXT, identity_key TEXT,
    created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`);
  db.query(
    "INSERT INTO auth_credentials (id, provider, credential_type, data, identity_key) VALUES (26, 'qoder-cn', 'oauth', ?, 'email:user@qoder.com.cn')",
  ).run(JSON.stringify({ access: "a", refresh: "r", userID: "u-1", email: "user@qoder.com.cn" }));
  db.close();
  return path;
}

test("a placeholder identity is repaired in place, tokens untouched", () => {
  const path = freshDb();
  expect(repairIdentities(path, "qoder-cn")).toEqual([{ id: 26, identity: "account:qoder-cn:u-1" }]);
  const row = new Database(path).query("SELECT data, identity_key FROM auth_credentials WHERE id = 26").get();
  expect(row.identity_key).toBe("account:qoder-cn:u-1");
  expect(JSON.parse(row.data)).toMatchObject({ access: "a", refresh: "r", accountId: "qoder-cn:u-1" });
  expect(repairIdentities(path, "qoder-cn")).toEqual([]);
});

test("another account is added as its own row; the same account updates its row", () => {
  const path = freshDb();
  repairIdentities(path, "qoder-cn");
  expect(upsertCredential(path, "qoder-cn", { access: "b", userID: "u-2", accountId: "qoder-cn:u-2" })).toEqual({
    id: 27,
    created: true,
  });
  expect(upsertCredential(path, "qoder-cn", { access: "a2", userID: "u-1", accountId: "qoder-cn:u-1" })).toEqual({
    id: 26,
    created: false,
  });
});
