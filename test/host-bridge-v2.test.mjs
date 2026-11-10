import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each test starts from an empty host-bridge state. The module reads the state
// lazily on every call, so deleting the process marker is enough.
const STATE_KEY = Symbol.for("omp-shims.host-bridge.state");
const PROTOTYPE_KEY = Symbol.for("omp-shims.host-bridge.prototype");

delete globalThis[STATE_KEY];
delete globalThis.__OMP_SHIMS_HOST__;
const host = await import("../lib/host-bridge.mjs");

const originalEnv = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  OMP_AGENT_DIR: process.env.OMP_AGENT_DIR,
  PI_AGENT_DIR: process.env.PI_AGENT_DIR,
};

beforeEach(() => {
  delete globalThis[STATE_KEY];
  delete globalThis.__OMP_SHIMS_HOST__;
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeRegistryClass() {
  return class FakeRegistry {
    constructor() {
      this.registered = [];
      this.unregistered = [];
      this.synced = [];
      this.existing = {};
      this.models = [];
      this.kind = undefined;
    }
    async refresh() {
      this.refreshCalls = (this.refreshCalls ?? 0) + 1;
    }
    getAll(kind) {
      this.kind = kind;
      return this.models;
    }
    getAvailable() {
      return this.models;
    }
    getAvailableForProviders() {
      return this.models;
    }
    syncExtensionSources(ids) {
      this.synced.push([...ids]);
      return [...ids];
    }
    getProviderModels(provider) {
      return this.existing[provider] ?? [];
    }
    registerProvider(provider, config, sourceId) {
      this.registered.push({ provider, config, sourceId });
    }
    unregisterProvider(provider) {
      this.unregistered.push(provider);
    }
  };
}

describe("host bridge lifecycle", () => {
  test("a second install reuses the one bridge and one prototype hook", () => {
    const Registry = makeRegistryClass();
    const original = {
      getAll: Registry.prototype.getAll,
      refresh: Registry.prototype.refresh,
      getAvailable: Registry.prototype.getAvailable,
      syncExtensionSources: Registry.prototype.syncExtensionSources,
    };

    const first = host.installHostBridge({ registry: Registry });
    const wrapped = {
      getAll: Registry.prototype.getAll,
      refresh: Registry.prototype.refresh,
      getAvailable: Registry.prototype.getAvailable,
      syncExtensionSources: Registry.prototype.syncExtensionSources,
    };
    const second = host.installHostBridge({ registry: Registry });

    expect(second).toBe(first);
    expect(host.getHostBridge()).toBe(first);
    expect(Registry.prototype.getAll).toBe(wrapped.getAll);
    expect(Registry.prototype.getAll).not.toBe(original.getAll);
    expect(Registry.prototype.refresh).toBe(wrapped.refresh);
    expect(Registry.prototype.syncExtensionSources).toBe(wrapped.syncExtensionSources);
    expect(Registry.prototype[PROTOTYPE_KEY]).toBeDefined();
    first.dispose();
  });

  test("dispose restores the exact previous prototype methods", () => {
    const Registry = makeRegistryClass();
    const original = {
      getAll: Registry.prototype.getAll,
      refresh: Registry.prototype.refresh,
      getAvailable: Registry.prototype.getAvailable,
      getAvailableForProviders: Registry.prototype.getAvailableForProviders,
      syncExtensionSources: Registry.prototype.syncExtensionSources,
    };

    const bridge = host.installHostBridge({ registry: Registry });
    bridge.registerProviderSource({ id: "one", register: () => {} });
    expect(Registry.prototype.getAll).not.toBe(original.getAll);

    bridge.dispose();

    for (const [method, fn] of Object.entries(original)) {
      expect(Registry.prototype[method]).toBe(fn);
    }
    expect(Registry.prototype[PROTOTYPE_KEY]).toBeUndefined();
    expect(host.getHostBridge()).toBeUndefined();
  });

  test("getAll and refresh apply sources in the same oldest-first order", async () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    const order = [];

    bridge.registerProviderSource({ id: "a", register: () => order.push("a") });
    bridge.registerProviderSource({ id: "b", register: () => order.push("b") });

    const registry = new Registry();
    registry.getAll();
    expect(order).toEqual(["a", "b"]);

    order.length = 0;
    await registry.refresh();
    expect(order).toEqual(["a", "b"]);
    bridge.dispose();
  });

  test("getAll applies a source once per generation while refresh re-applies every time", async () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    let calls = 0;
    bridge.registerProviderSource({ id: "count", register: () => (calls += 1) });

    const registry = new Registry();
    registry.getAll();
    registry.getAll();
    registry.getAll();
    expect(calls).toBe(1);

    await registry.refresh();
    await registry.refresh();
    expect(calls).toBe(3);
    bridge.dispose();
  });

  test("syncExtensionSources keeps every registered source id", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    bridge.registerProviderSource({
      id: "keep",
      sourceIds: ["src-a"],
      register: (_registry, helpers) => helpers.keepSource("src-b"),
    });

    const registry = new Registry();
    registry.getAll();
    registry.syncExtensionSources(["host"]);

    const merged = registry.synced.at(-1);
    expect(merged).toContain("host");
    expect(merged).toContain("src-a");
    expect(merged).toContain("src-b");
    bridge.dispose();
  });

  test("disposing a source drops only the ids that source kept", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    const first = bridge.registerProviderSource({
      id: "first",
      sourceIds: ["shared"],
      register: () => {},
    });
    bridge.registerProviderSource({
      id: "second",
      sourceIds: ["other"],
      register: () => {},
    });

    first();
    const registry = new Registry();
    registry.getAll();
    registry.syncExtensionSources([]);

    expect(registry.synced.at(-1)).not.toContain("shared");
    expect(registry.synced.at(-1)).toContain("other");
    bridge.dispose();
  });
});

describe("provider registration guard", () => {
  test("a one-model registration cannot wipe an existing multi-model catalog", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    bridge.registerProviderSource({
      id: "guard",
      register: (registry, helpers) => {
        helpers.registerProvider(
          registry,
          "github-copilot",
          { oauth: true, baseUrl: "https://proxy.test", models: [{ id: "auto" }] },
          "src",
        );
        helpers.registerProvider(
          registry,
          "fresh",
          { baseUrl: "https://fresh.test", models: [{ id: "m1" }, { id: "m2" }] },
          "src",
        );
      },
    });

    const registry = new Registry();
    registry.existing["github-copilot"] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    registry.getAll();

    const copilot = registry.registered.find((entry) => entry.provider === "github-copilot");
    const fresh = registry.registered.find((entry) => entry.provider === "fresh");
    expect(copilot.config.models).toBeUndefined();
    expect("oauth" in copilot.config).toBe(false);
    expect(copilot.config.baseUrl).toBe("https://proxy.test");
    expect(fresh.config.models).toHaveLength(2);
    bridge.dispose();
  });

  test("a one-model registration still passes when no larger catalog exists", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    bridge.registerProviderSource({
      id: "guard",
      register: (registry, helpers) => {
        helpers.registerProvider(registry, "new-provider", { baseUrl: "https://x", models: [{ id: "only" }] }, "src");
      },
    });
    const registry = new Registry();
    registry.getAll();
    const entry = registry.registered.find((item) => item.provider === "new-provider");
    expect(entry.config.models).toHaveLength(1);
    bridge.dispose();
  });
});

describe("catalog composition", () => {
  test("deduplicates ids and injects exactly one github-copilot/auto row", () => {
    const rows = host.composeModelCatalog({
      base: [
        { id: "github-copilot/gpt-4o", object: "model", owned_by: "github-copilot" },
        { id: "github-copilot/gpt-4o", object: "model", owned_by: "github-copilot" },
        { id: "ext/x", object: "model", owned_by: "ext" },
      ],
      extension: [
        { id: "ext/x", object: "model", owned_by: "ext" },
        { id: "ext/y", object: "model", owned_by: "ext" },
      ],
    });

    const ids = rows.map((row) => row.id);
    expect(ids.filter((id) => id === "github-copilot/gpt-4o")).toHaveLength(1);
    expect(ids.filter((id) => id === "ext/x")).toHaveLength(1);
    expect(ids.filter((id) => id === "ext/y")).toHaveLength(1);
    expect(ids.filter((id) => id === "github-copilot/auto")).toHaveLength(1);
  });

  test("does not invent a Copilot alias when no Copilot row exists", () => {
    const rows = host.composeModelCatalog({ base: [{ id: "other/model" }], extension: [] });
    expect(rows.some((row) => row.id === "github-copilot/auto")).toBe(false);
  });

  test("keeps an existing Copilot auto descriptor single", () => {
    const rows = host.composeModelCatalog({
      base: [
        { id: "github-copilot/gpt-4o", owned_by: "github-copilot" },
        { id: "github-copilot/auto", owned_by: "github-copilot" },
      ],
      extension: [],
    });
    expect(rows.filter((row) => row.id === "github-copilot/auto")).toHaveLength(1);
  });

  test("accepts a plain row array as the base", () => {
    const rows = host.composeModelCatalog([
      { id: "github-copilot/one", owned_by: "github-copilot" },
      { id: "github-copilot/one", owned_by: "github-copilot" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1].id).toBe("github-copilot/auto");
  });
});

describe("extension provider metadata", () => {
  test("registers, reads and lists models with the router row shape", () => {
    const remove = host.registerExtensionProviderMeta("ext", {
      api: "openai-completions",
      models: [{ id: "big", contextWindow: 1000, maxTokens: 10 }, { id: "no-window" }],
    });

    const rows = host.listExtensionProviders();
    expect(rows).toEqual([
      {
        id: "ext/big",
        object: "model",
        owned_by: "ext",
        api: "openai-completions",
        context_length: 1000,
        max_output_tokens: 10,
        input_modalities: ["text"],
      },
    ]);
    expect(host.getExtensionProviderMeta("ext").models).toHaveLength(2);
    expect(host.getHostBridge()).toBeUndefined();
    remove();
    expect(host.listExtensionProviders()).toEqual([]);
    expect(host.getExtensionProviderMeta("ext")).toBeUndefined();
  });

  test("rejects an empty provider name", () => {
    expect(() => host.registerExtensionProviderMeta("", {})).toThrow(TypeError);
    expect(() => host.registerExtensionProviderMeta("x", null)).toThrow(TypeError);
  });

  test("publishes transport metadata and refreshes dynamic models once per minute", async () => {
    const fetched = [];
    const stream = () => {};
    const remove = host.registerExtensionProviderMeta("kiro", {
      api: "anthropic-messages",
      baseUrl: "https://kiro.test",
      headers: { "x-kiro": "1" },
      models: [{ id: "old", contextWindow: 100 }],
      streamSimple: stream,
      fetchDynamicModels: async (token) => {
        fetched.push(token);
        return [{ id: "fresh", contextWindow: 200, maxTokens: 20 }];
      },
      resolveApiKey: () => "meta-token",
    });

    expect(host.getExtensionProvider("kiro")).toMatchObject({
      id: "kiro",
      api: "anthropic-messages",
      baseUrl: "https://kiro.test",
      headers: { "x-kiro": "1" },
      streamSimple: stream,
      fetchDynamicModels: expect.any(Function),
      resolveApiKey: expect.any(Function),
    });
    expect(host.listRegisteredExtensionProviders().map((entry) => entry.id)).toEqual(["kiro"]);

    await host.refreshExtensionProviders();
    expect(fetched).toEqual(["meta-token"]);
    expect(host.listExtensionProviders().map((row) => row.id)).toEqual(["kiro/fresh"]);

    await host.refreshExtensionProviders();
    expect(fetched).toHaveLength(1);

    remove();
    expect(host.getExtensionProvider("kiro")).toBeUndefined();
  });

  test("falls back to credentials and never rejects a broken provider", async () => {
    const seen = [];
    host.registerExtensionProviderMeta("dynamic", {
      models: [{ id: "before", contextWindow: 10 }],
      fetchDynamicModels: async (token) => {
        seen.push(token);
        return [{ id: "after", contextWindow: 20 }];
      },
    });
    await host.refreshExtensionProviders({
      credentials: {
        resolve: async (id) => (id === "dynamic" ? { secret: "credential-token" } : undefined),
      },
    });
    expect(seen).toEqual(["credential-token"]);
    expect(host.listExtensionProviders().map((row) => row.id)).toEqual(["dynamic/after"]);

    host.registerExtensionProviderMeta("broken", {
      models: [],
      fetchDynamicModels: () => {
        throw new Error("boom");
      },
    });
    await expect(
      host.refreshExtensionProviders({
        credentials: {
          resolve: () => {
            throw new Error("unavailable");
          },
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("custom provider metadata", () => {
  test("publishes the config and resolves literal, environment and sentinel keys", async () => {
    const remove = host.registerCustomProviderMeta("literal", {
      baseUrl: "https://literal.test/v1",
      api: "openai-responses",
      apiKey: " sk-literal ",
      headers: { "x-test": "1" },
      authHeader: true,
      compat: { other: true },
      models: [{ id: "m1", contextWindow: 10 }],
    });

    expect(host.getCustomProvider("literal")).toMatchObject({
      name: "literal",
      baseUrl: "https://literal.test/v1",
      api: "openai-responses",
      apiKey: " sk-literal ",
      headers: { "x-test": "1" },
      authHeader: true,
      compat: { other: true },
      resolveApiKey: expect.any(Function),
    });
    expect(await host.getCustomProvider("literal").resolveApiKey()).toBe("sk-literal");

    process.env.OMP_SHIMS_TEST_KEY = "env-secret";
    try {
      host.registerCustomProviderMeta("from-env", {
        baseUrl: "https://env.test/v1",
        api: "openai-completions",
        apiKey: "OMP_SHIMS_TEST_KEY",
        models: [{ id: "m1" }],
      });
      expect(await host.getCustomProvider("from-env").resolveApiKey()).toBe("env-secret");
    } finally {
      delete process.env.OMP_SHIMS_TEST_KEY;
    }

    host.registerCustomProviderMeta("keyless", {
      baseUrl: "https://keyless.test/v1",
      api: "openai-completions",
      auth: "none",
      models: [{ id: "m1" }],
    });
    expect(await host.getCustomProvider("keyless").resolveApiKey()).toBe("N/A");

    expect(
      host
        .listCustomProviders()
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(["from-env", "keyless", "literal"]);

    remove();
    expect(host.getCustomProvider("literal")).toBeUndefined();
  });

  test("runs a command key lazily and caches the result for one minute", async () => {
    const directory = mkdtempSync(join(tmpdir(), "e4-command-"));
    const marker = join(directory, "count");
    try {
      host.registerCustomProviderMeta("command", {
        baseUrl: "https://command.test/v1",
        api: "openai-completions",
        apiKey: `!printf x >> '${marker}'; printf secret`,
        models: [{ id: "m1" }],
      });
      const provider = host.getCustomProvider("command");
      expect(await provider.resolveApiKey()).toBe("secret");
      expect(await provider.resolveApiKey()).toBe("secret");
      expect(readFileSync(marker, "utf8")).toBe("x");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("routable providers", () => {
  test("merges source allowances, metadata names and the storage snapshot", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({
      registry: Registry,
      storage: {
        credentials: {
          snapshot: () => ({ credentials: [{ provider: "from-storage" }, { provider: "from-storage" }] }),
        },
      },
    });
    bridge.registerProviderSource({
      id: "allow",
      register: (_registry, helpers) => helpers.noteRoutable("from-source"),
    });
    host.registerExtensionProviderMeta("from-meta", { models: [] });

    // A source allowance is recorded when the source is applied, not when it is
    // registered; the first getAll is that point.
    new Registry().getAll();

    const providers = bridge.routableProviders();
    expect(providers.has("from-source")).toBe(true);
    expect(providers.has("from-meta")).toBe(true);
    expect(providers.has("from-storage")).toBe(true);
    bridge.dispose();
  });

  test("adopts the live registry's auth storage when the caller passed none", () => {
    const Registry = makeRegistryClass();
    const bridge = host.installHostBridge({ registry: Registry });
    const registry = new Registry();
    registry.authStorage = {
      credentials: { snapshot: () => ({ credentials: [{ provider: "via-registry" }] }) },
    };
    registry.getAll();
    expect(bridge.routableProviders().has("via-registry")).toBe(true);
    bridge.dispose();
  });
});

describe("getAgentDir", () => {
  test("honours PI_CODING_AGENT_DIR, then OMP_AGENT_DIR, then PI_AGENT_DIR, then the default", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/e4-a";
    process.env.OMP_AGENT_DIR = "/tmp/e4-b";
    process.env.PI_AGENT_DIR = "/tmp/e4-c";
    expect(host.getAgentDir()).toBe("/tmp/e4-a");

    delete process.env.PI_CODING_AGENT_DIR;
    expect(host.getAgentDir()).toBe("/tmp/e4-b");

    delete process.env.OMP_AGENT_DIR;
    expect(host.getAgentDir()).toBe("/tmp/e4-c");

    delete process.env.PI_AGENT_DIR;
    expect(host.getAgentDir().endsWith("/.omp/agent")).toBe(true);
  });

  test("refreshes the cached value when the environment changes", () => {
    process.env.PI_AGENT_DIR = "/tmp/e4-first";
    expect(host.getAgentDir()).toBe("/tmp/e4-first");
    process.env.PI_AGENT_DIR = "/tmp/e4-second";
    expect(host.getAgentDir()).toBe("/tmp/e4-second");
  });
});
