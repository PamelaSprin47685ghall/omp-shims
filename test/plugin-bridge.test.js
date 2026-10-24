import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { install, makeTokenResolver } from "../features/plugin-bridge.js";
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

describe("registry hooks", () => {
  test("repeated registrations are not logged again and the sync hook is not stacked", async () => {
    const pluginsDir = tempDir();
    const packageDir = join(pluginsDir, "node_modules", "fake-plugin");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(pluginsDir, "package.json"), JSON.stringify({ dependencies: { "fake-plugin": "*" } }));
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "fake-plugin", main: "./index.js" }));
    writeFileSync(
      join(packageDir, "index.js"),
      'export default (pi) => pi.registerProvider("fake", { models: [{ id: "m" }], streamSimple: () => {} });\n',
    );

    const registered = [];
    let syncWraps = 0;
    class FakeModelRegistry {
      constructor() {
        let sync = (enabled) => enabled;
        Object.defineProperty(this, "syncExtensionSources", {
          get: () => sync,
          set: (next) => {
            syncWraps++;
            sync = next;
          },
        });
      }
      registerProvider(name) {
        registered.push(name);
      }
      async refresh() {}
      async refreshDiscoverableProviders(providers, strategy) {
        this.discoveries ??= [];
        this.discoveries.push({ providers: [...providers], strategy });
      }
      getAll() {
        return [];
      }
    }
    const previousHost = globalThis.__OMP_SHIMS_HOST__;
    globalThis.__OMP_SHIMS_HOST__ = { captured: new Map([["ModelRegistry", FakeModelRegistry]]), observe: () => {} };
    const lines = [];
    try {
      install({ pluginsDir }, { log: (line) => lines.push(line) });
      const registry = new FakeModelRegistry();
      registry.getAll();
      await registry.refresh(); // joins the pass getAll started
      await registry.refresh();
      await registry.refresh();
      expect(registered.length).toBeGreaterThanOrEqual(2);
      expect(syncWraps).toBe(1);
      expect([...registry.syncExtensionSources(new Set(["x"]))].sort()).toEqual(["omp-shims:fake-plugin", "omp-shims:internal", "x"]);
      expect(lines.filter((line) => line.startsWith("plugin-bridge: registered fake "))).toHaveLength(1);
      expect(registry.discoveries.length).toBeGreaterThanOrEqual(1);
      expect(registry.discoveries.at(-1)).toEqual({ providers: ["mistral-vibe"], strategy: "online-if-uncached" });
    } finally {
      globalThis.__OMP_SHIMS_HOST__ = previousHost;
    }
  });
});
