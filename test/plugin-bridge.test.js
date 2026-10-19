import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTokenResolver } from "../features/plugin-bridge.js";
import { tempDir } from "./helpers.js";

const TOKEN = "tok_0123456789abcdefghijklmnop";

afterEach(() => {
  delete process.env.OMP_SHIMS_TEST_TOKEN;
});

describe("makeTokenResolver", () => {
  test("resolves literal values and environment variables", () => {
    process.env.OMP_SHIMS_TEST_TOKEN = ` ${TOKEN} `;
    const resolve = makeTokenResolver({ a: "literal", b: { value: "v" }, c: { env: "OMP_SHIMS_TEST_TOKEN" } });
    expect(resolve("a")).toBe("literal");
    expect(resolve("b")).toBe("v");
    expect(resolve("c")).toBe(TOKEN);
    expect(resolve("missing")).toBeUndefined();
  });

  test("treats unresolved $PLACEHOLDERS as no credential", () => {
    expect(makeTokenResolver({ a: "$COMMAND_CODE_API_KEY" })("a")).toBeUndefined();
  });

  test("reads a dotted path from a JSON file", () => {
    const file = join(tempDir(), "creds.json");
    writeFileSync(file, JSON.stringify({ auth: { token: TOKEN } }));
    expect(makeTokenResolver({ a: { json: { file, path: "auth.token" } } })("a")).toBe(TOKEN);
    expect(makeTokenResolver({ a: { json: { file, path: "auth.nope" } } })("a")).toBeUndefined();
  });

  test("reads a token from a SQLite query, unwrapping JSON blobs", () => {
    const file = join(tempDir(), "data.sqlite3");
    const db = new Database(file);
    db.run("CREATE TABLE kv (key TEXT, value TEXT)");
    db.run("INSERT INTO kv VALUES ('plain', ?), ('blob', ?)", [TOKEN, JSON.stringify({ access_token: TOKEN })]);
    db.close();
    const query = (key) => ({ sqlite: { file, query: `SELECT value FROM kv WHERE key = '${key}'` } });
    const resolve = makeTokenResolver({ plain: query("plain"), blob: query("blob") });
    expect(resolve("plain")).toBe(TOKEN);
    expect(resolve("blob")).toBe(TOKEN);
  });

  test("falls through sources in order", () => {
    const resolve = makeTokenResolver({
      a: { env: "OMP_SHIMS_TEST_TOKEN", json: { file: "/nonexistent", path: "x" } },
    });
    expect(resolve("a")).toBeUndefined();
  });
});
