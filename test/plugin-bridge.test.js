import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { install, makeTokenResolver, normalizeQoderCapacityEvent, normalizeNativeMistralEvent } from "../features/plugin-bridge.js";
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

describe("Qoder capacity normalization", () => {
  test("marks hard account capacity as resource_exhausted for host credential rotation", () => {
    const event = {
      type: "error",
      error: {
        errorMessage:
          "[Qoder CN 无可用容量] 网关回 serviceAvailable:false（子码 RESOURCE_LIMIT，队列长度 0，优先级通道 p3）",
      },
    };
    const normalized = normalizeQoderCapacityEvent("qoder-cn", event);
    expect(normalized).not.toBe(event);
    expect(normalized.error.errorMessage).toContain("resource_exhausted");
    expect(event.error.errorMessage).not.toContain("resource_exhausted");
  });

  test("does not relabel ordinary provider errors or other providers", () => {
    const ordinary = { type: "error", error: { errorMessage: "Qoder server error" } };
    const other = {
      type: "error",
      error: { errorMessage: "serviceAvailable:false RESOURCE_LIMIT" },
    };
    expect(normalizeQoderCapacityEvent("qoder-cn", ordinary)).toBe(ordinary);
    expect(normalizeQoderCapacityEvent("fake", other)).toBe(other);
  });
});

describe("OAuth bridge", () => {
  test("registers providers announced before registerOAuthProvider becomes available", async () => {
    const pluginsDir = tempDir();
    const packageDir = join(pluginsDir, "node_modules", "fake-oauth-plugin");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(pluginsDir, "package.json"), JSON.stringify({ dependencies: { "fake-oauth-plugin": "*" } }));
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "fake-oauth-plugin", main: "./index.js" }));
    writeFileSync(
      join(packageDir, "index.js"),
      'export default (pi) => pi.registerProvider("fake-oauth", { oauth: { refreshToken: async (credential) => credential }, models: [{ id: "m" }], streamSimple: () => {} });\n',
    );

    const observers = new Map();
    const previousHost = globalThis.__OMP_SHIMS_HOST__;
    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map(),
      observe(name, observer) {
        const list = observers.get(name) ?? [];
        list.push(observer);
        observers.set(name, list);
      },
    };
    const registered = [];
    try {
      await install({ pluginsDir }, { log: () => {} });
      await Bun.sleep(10);
      expect(registered).toHaveLength(0);
      const registerOauth = (oauth) => registered.push(oauth);
      globalThis.__OMP_SHIMS_HOST__.captured.set("registerOAuthProvider", registerOauth);
      for (const observer of observers.get("registerOAuthProvider") ?? []) observer(registerOauth);
      await Bun.sleep(30);
      expect(registered.map((oauth) => oauth.id)).toContain("fake-oauth");
      expect(registered.find((oauth) => oauth.id === "fake-oauth")?.sourceId).toBe("omp-shims:oauth");
    } finally {
      globalThis.__OMP_SHIMS_HOST__ = previousHost;
    }
  });
});

describe("registry hooks", () => {
  test("plugin provider overrides a built-in provider before the first synchronous getAll", async () => {
    const pluginsDir = tempDir();
    const packageDir = join(pluginsDir, "node_modules", "fake-commandcode-plugin");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(pluginsDir, "package.json"), JSON.stringify({ dependencies: { "fake-commandcode-plugin": "*" } }));
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "fake-commandcode-plugin", main: "./index.js" }));
    writeFileSync(
      join(packageDir, "index.js"),
      'export default (pi) => pi.registerProvider("commandcode", { api: "commandcode-custom", models: [{ id: "stealth/glyph-cluster:free" }], streamSimple: () => {} });\n',
    );

    class FakeModelRegistry {
      constructor() {
        this.config = { api: "openai-completions", models: [{ id: "stealth/glyph-cluster:free" }] };
      }
      registerProvider(_name, config) {
        this.config = config;
      }
      async refresh() {}
      getAll() {
        return this.config.models.map((model) => ({ ...model, provider: "commandcode", api: model.api ?? this.config.api }));
      }
    }
    const previousHost = globalThis.__OMP_SHIMS_HOST__;
    globalThis.__OMP_SHIMS_HOST__ = { captured: new Map([["ModelRegistry", FakeModelRegistry]]), observe: () => {} };
    try {
      await install({ pluginsDir }, { log: () => {}, registerTransport: () => {} });
      const [glyph] = new FakeModelRegistry().getAll();
      expect(glyph.api).toBe("commandcode-custom");
    } finally {
      globalThis.__OMP_SHIMS_HOST__ = previousHost;
    }
  });

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
      await install({ pluginsDir }, { log: (line) => lines.push(line) });
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

describe("native Mistral stream events for OMP Gateway", () => {
  test("text/thinking start and delta carry safe content for host consumers", () => {
    for (const prefix of ["text", "thinking"]) {
      const started = normalizeNativeMistralEvent({
        type: prefix + "_start", contentIndex: 0, partial: { content: [] },
      });
      expect(started.content).toEqual([]);
      const delta = normalizeNativeMistralEvent({
        type: prefix + "_delta", delta: "visible", contentIndex: 0,
      });
      expect(delta.content).toBe("visible");
      expect(delta.delta).toBe("visible");
      const already = { type: prefix + "_delta", delta: "visible", content: "original" };
      expect(normalizeNativeMistralEvent(already)).toBe(already);
    }
  });

  test("end events carry the actual content blocks expected by OMP", () => {
    expect(normalizeNativeMistralEvent({ type: "text_end", content: "YES" }).content)
      .toEqual([{ type: "text", text: "YES" }]);
    expect(normalizeNativeMistralEvent({ type: "thinking_end", content: "reason" }).content)
      .toEqual([{ type: "thinking", thinking: "reason", thinkingSignature: "" }]);
    const already = { type: "text_end", content: [{ type: "text", text: "YES" }] };
    expect(normalizeNativeMistralEvent(already)).toBe(already);
  });

  test("tool events, terminal events and error objects remain untouched", () => {
    for (const event of [
      { type: "toolcall_end", toolCall: { id: "call_1", name: "run" } },
      { type: "done", message: { content: [] } },
      { type: "error", error: { message: "bad" } },
    ]) expect(normalizeNativeMistralEvent(event)).toBe(event);
  });
});
