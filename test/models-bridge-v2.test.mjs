import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_KEY = Symbol.for("omp-shims.host-bridge.state");

delete globalThis[STATE_KEY];
delete globalThis.__OMP_SHIMS_HOST__;
const host = await import("../lib/host-bridge.mjs");
const modelsBridge = await import("../features/models-bridge.mjs");

const works = [];

function workDir(prefix = "e4-models-") {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  works.push(directory);
  return directory;
}

beforeEach(() => {
  delete globalThis[STATE_KEY];
  delete globalThis.__OMP_SHIMS_HOST__;
});

afterEach(() => {
  for (const directory of works.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRegistryClass() {
  return class FakeRegistry {
    constructor() {
      this.registered = [];
      this.unregistered = [];
      this.models = [];
    }
    async refresh() {}
    getAll() {
      return this.models;
    }
    getAvailable() {
      return this.models;
    }
    syncExtensionSources() {}
    getProviderModels() {
      return [];
    }
    registerProvider(provider, config, sourceId) {
      this.registered.push({ provider, config, sourceId });
    }
    unregisterProvider(provider) {
      this.unregistered.push(provider);
    }
  };
}

const MODELS_YAML = [
  "providers:",
  "  local-x:",
  "    baseUrl: https://proxy.example/v1",
  "    api: openai-completions",
  '    apiKey: "!echo secret-from-command"',
  "    transport: http",
  "    remoteCompaction:",
  "      threshold: 1",
  "    requestMetadata:",
  "      team: x",
  "    headers:",
  "      x-test: '1'",
  "    authHeader: true",
  "    compat:",
  "      other: flag",
  "    modelOverrides:",
  "      m1:",
  "        contextWindow: 4096",
  "    guardrailIdentifier: gid",
  "    discovery:",
  "      type: proxy",
  "    disableStrictTools: true",
  "    models:",
  "      - id: m1",
  "        contextWindow: 1000",
  "      - id: m2",
  "  keyless-y:",
  "    baseUrl: https://keyless.example/v1",
  "    api: openai-completions",
  "    auth: none",
  "    models:",
  "      - id: k1",
  "        contextWindow: 100",
].join("\n");

describe("models.yml extraction", () => {
  test("preserves unknown fields, command keys and merges modelOverrides", () => {
    const parsed = modelsBridge.parseYaml(MODELS_YAML);
    const providers = modelsBridge.extractCustomProviders(parsed);
    expect(providers).toHaveLength(2);

    const local = providers.find((entry) => entry.name === "local-x");
    expect(local.config.apiKey).toBe("!echo secret-from-command");
    expect(local.config.transport).toBe("http");
    expect(local.config.remoteCompaction).toEqual({ threshold: 1 });
    expect(local.config.requestMetadata).toEqual({ team: "x" });
    expect(local.config.headers).toEqual({ "x-test": "1" });
    expect(local.config.authHeader).toBe(true);
    expect(local.config.guardrailIdentifier).toBe("gid");
    expect(local.config.discovery).toEqual({ type: "proxy" });
    expect(local.config.disableStrictTools).toBe(true);
    expect(local.config.modelOverrides).toEqual({ m1: { contextWindow: 4096 } });
    expect(local.config.compat).toEqual({ other: "flag", disableStrictTools: true });

    expect(local.models.find((model) => model.id === "m1").contextWindow).toBe(4096);
    expect(local.models.find((model) => model.id === "m1").requestMetadata).toEqual({ team: "x" });
    expect(local.models.find((model) => model.id === "m2").api).toBe("openai-completions");
  });

  test("a keyless provider gets the exact NO_AUTH_SENTINEL", () => {
    const providers = modelsBridge.extractCustomProviders(modelsBridge.parseYaml(MODELS_YAML));
    const keyless = providers.find((entry) => entry.name === "keyless-y");
    expect(keyless.config.apiKey).toBe("N/A");
    expect(keyless.config.apiKey).not.toBe("no-auth");
  });

  test("a literal apiKey is passed through unchanged", () => {
    const doc = {
      providers: {
        literal: {
          baseUrl: "https://literal.example/v1",
          api: "openai-completions",
          apiKey: "sk-literal",
          models: [{ id: "m1" }],
        },
      },
    };
    const [provider] = modelsBridge.extractCustomProviders(doc);
    expect(provider.config.apiKey).toBe("sk-literal");
  });
});

describe("models path selection", () => {
  test("findModelsPath no longer reads OMP_SHIMS_MODELS_PATH", () => {
    const directory = workDir();
    const envPath = join(directory, "env-models.yml");
    writeFileSync(envPath, "providers: {}\n");
    const agentDir = join(directory, "agent");
    mkdirSync(agentDir, { recursive: true });

    const previous = process.env.OMP_SHIMS_MODELS_PATH;
    process.env.OMP_SHIMS_MODELS_PATH = envPath;
    try {
      expect(modelsBridge.findModelsPath(undefined, { agentDir })).toBeNull();
      expect(modelsBridge.findModelsPath(envPath, { agentDir })).toBe(envPath);
    } finally {
      if (previous === undefined) delete process.env.OMP_SHIMS_MODELS_PATH;
      else process.env.OMP_SHIMS_MODELS_PATH = previous;
    }
  });

  test("the agent directory comes from context.paths.agentDbPath", () => {
    const directory = workDir();
    const agentDir = join(directory, "state");
    mkdirSync(agentDir, { recursive: true });
    const file = join(agentDir, "models.yml");
    writeFileSync(
      file,
      "providers:\n  path-default:\n    baseUrl: https://path.example/v1\n    apiKey: k\n    models:\n      - id: m1\n      - id: m2\n",
    );

    const agentDbPath = join(agentDir, "agent.db");
    expect(modelsBridge.findModelsPath(undefined, { agentDir })).toBe(file);

    // Install uses dirname(context.paths.agentDbPath) as its default.
    const Registry = makeRegistryClass();
    host.installHostBridge({ registry: Registry });
    const registry = new Registry();
    const dispose = modelsBridge.install({}, { paths: { agentDbPath } });
    registry.getAll();
    expect(registry.registered.some((entry) => entry.provider === "path-default")).toBe(true);
    dispose();
  });

  test("a configured modelsPath wins over the path contract", () => {
    const directory = workDir();
    const configured = join(directory, "custom.yml");
    writeFileSync(configured, "providers: {}\n");
    expect(modelsBridge.findModelsPath(configured, { agentDir: directory })).toBe(configured);
  });
});

describe("installation", () => {
  test("registers providers without fabricating snapshot rows", () => {
    const directory = workDir();
    const modelsPath = join(directory, "models.yml");
    writeFileSync(modelsPath, MODELS_YAML);

    let snapshotCalls = 0;
    const snapshot = { generation: 1, credentials: [{ id: 1, provider: "built-in" }] };
    const storage = {
      credentials: {
        snapshot: () => {
          snapshotCalls += 1;
          return snapshot;
        },
      },
    };

    const Registry = makeRegistryClass();
    host.installHostBridge({ registry: Registry, storage });
    const registry = new Registry();
    const dispose = modelsBridge.install({ modelsPath, excludeProviders: [] }, { storage });

    registry.getAll();

    const local = registry.registered.find((entry) => entry.provider === "local-x");
    const keyless = registry.registered.find((entry) => entry.provider === "keyless-y");
    expect(local.config.apiKey).toBe("!echo secret-from-command");
    expect(local.sourceId).toBe("omp-shims:models-bridge");
    expect(keyless.config.apiKey).toBe("N/A");
    expect(snapshotCalls).toBe(0);
    expect(snapshot.credentials.map((entry) => entry.provider)).toEqual(["built-in"]);

    expect(host.getHostBridge().routableProviders().has("local-x")).toBe(true);
    dispose();
  });

  test("a provider removed from models.yml is unregistered on refresh", async () => {
    const directory = workDir();
    const modelsPath = join(directory, "models.yml");
    writeFileSync(
      modelsPath,
      "providers:\n  gone:\n    baseUrl: https://gone.example/v1\n    apiKey: k\n    models:\n      - id: m1\n      - id: m2\n",
    );

    const Registry = makeRegistryClass();
    host.installHostBridge({ registry: Registry });
    const registry = new Registry();
    const dispose = modelsBridge.install({ modelsPath }, {});
    registry.getAll();
    expect(registry.registered.some((entry) => entry.provider === "gone")).toBe(true);

    writeFileSync(modelsPath, "providers: {}\n");
    await registry.refresh();
    expect(registry.unregistered).toContain("gone");
    dispose();
  });

  test("publishes provider metadata before a registry exists and disposes it", async () => {
    const directory = workDir();
    const modelsPath = join(directory, "models.yml");
    writeFileSync(modelsPath, MODELS_YAML);

    const dispose = modelsBridge.install({ modelsPath }, {});
    try {
      const local = host.getCustomProvider("local-x");
      expect(local).toMatchObject({
        name: "local-x",
        baseUrl: "https://proxy.example/v1",
        api: "openai-completions",
        headers: { "x-test": "1" },
        authHeader: true,
        compat: { other: "flag", disableStrictTools: true },
        resolveApiKey: expect.any(Function),
      });
      expect(local.models.map((model) => model.id)).toEqual(["m1", "m2"]);
      expect(await host.getCustomProvider("local-x").resolveApiKey()).toBe("secret-from-command");

      const keyless = host.getCustomProvider("keyless-y");
      expect(await keyless.resolveApiKey()).toBe("N/A");
      expect(
        host
          .listCustomProviders()
          .map((entry) => entry.name)
          .sort(),
      ).toEqual(["keyless-y", "local-x"]);
      expect(host.getHostBridge().routableProviders().has("local-x")).toBe(true);
    } finally {
      dispose();
    }

    expect(host.getCustomProvider("local-x")).toBeUndefined();
    expect(host.listCustomProviders()).toEqual([]);
  });

  test("an excluded provider is not registered", () => {
    const directory = workDir();
    const modelsPath = join(directory, "models.yml");
    writeFileSync(modelsPath, MODELS_YAML);

    const Registry = makeRegistryClass();
    host.installHostBridge({ registry: Registry });
    const registry = new Registry();
    const dispose = modelsBridge.install({ modelsPath, excludeProviders: ["local-x"] }, {});
    registry.getAll();

    expect(registry.registered.some((entry) => entry.provider === "local-x")).toBe(false);
    expect(registry.registered.some((entry) => entry.provider === "keyless-y")).toBe(true);
    expect(host.getCustomProvider("local-x")).toBeUndefined();
    expect(host.getCustomProvider("keyless-y")).not.toBeUndefined();
    dispose();
  });

  test("a missing models file leaves the registry untouched", async () => {
    const Registry = makeRegistryClass();
    host.installHostBridge({ registry: Registry });
    const registry = new Registry();
    const dispose = modelsBridge.install({ modelsPath: join(workDir(), "missing.yml") }, {});
    await expect(registry.refresh()).resolves.toBeUndefined();
    expect(registry.registered).toEqual([]);
    dispose();
  });
});
