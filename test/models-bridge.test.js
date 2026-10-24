import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractCustomProviders,
  findModelsPath,
  install,
  loadModelsConfig,
  parseYaml,
  resolveApiKey,
} from "../features/models-bridge.js";
import { tempDir } from "./helpers.js";

let dir;

beforeEach(() => {
  dir = tempDir("models-bridge-test-");
});

afterEach(() => {
  delete process.env.OMP_SHIMS_MODELS_PATH;
  delete process.env.TEST_API_KEY_ENV;
  delete process.env.OMP_AGENT_DIR;
});

describe("findModelsPath", () => {
  test("returns explicit path when it exists", () => {
    const file = join(dir, "custom.yml");
    writeFileSync(file, "providers: {}");
    expect(findModelsPath(file)).toBe(file);
  });

  test("returns OMP_SHIMS_MODELS_PATH when it exists", () => {
    const file = join(dir, "env-models.yml");
    writeFileSync(file, "providers: {}");
    process.env.OMP_SHIMS_MODELS_PATH = file;
    expect(findModelsPath()).toBe(file);
  });

  test("locates models.yml in agent dir", () => {
    const agentDir = join(dir, "agent");
    mkdirSync(agentDir, { recursive: true });
    const file = join(agentDir, "models.yml");
    writeFileSync(file, "providers: {}");
    process.env.OMP_AGENT_DIR = agentDir;
    expect(findModelsPath()).toBe(file);
  });

  test("returns null when no candidate exists", () => {
    process.env.OMP_AGENT_DIR = join(dir, "nonexistent");
    expect(findModelsPath("/nonexistent/path.yml")).toBeNull();
  });
});

describe("parseYaml", () => {
  test("parses valid YAML document", () => {
    const yaml = `
providers:
  my-proxy:
    baseUrl: https://api.example.com/v1
    api: openai-completions
    models:
      - id: model-1
        name: Model One
`;
    const parsed = parseYaml(yaml);
    expect(parsed).not.toBeNull();
    expect(parsed.providers["my-proxy"].baseUrl).toBe("https://api.example.com/v1");
    expect(parsed.providers["my-proxy"].models.length).toBe(1);
  });

  test("returns null on null or empty input", () => {
    expect(parseYaml(null)).toBeNull();
    expect(parseYaml("")).toBeNull();
  });
});

describe("resolveApiKey", () => {
  test("resolves literal key", () => {
    expect(resolveApiKey("sk-secret123")).toBe("sk-secret123");
  });

  test("resolves environment variable name", () => {
    process.env.TEST_API_KEY_ENV = "sk-from-env";
    expect(resolveApiKey("TEST_API_KEY_ENV")).toBe("sk-from-env");
  });

  test("executes command starting with exclamation mark", () => {
    expect(resolveApiKey("!echo cmd-secret")).toBe("cmd-secret");
  });

  test("returns undefined for empty input", () => {
    expect(resolveApiKey("")).toBeUndefined();
    expect(resolveApiKey("   ")).toBeUndefined();
    expect(resolveApiKey(null)).toBeUndefined();
  });
});

describe("extractCustomProviders", () => {
  test("extracts providers with models and inherits baseUrl and api", () => {
    const doc = {
      providers: {
        "custom-proxy": {
          baseUrl: "https://proxy.example.com/v1",
          apiKey: "sk-token",
          api: "openai-completions",
          models: [
            { id: "m1", name: "Model 1", contextWindow: 128000 },
            { id: "m2", name: "Model 2", api: "openai-responses" },
          ],
        },
        "override-only": {
          baseUrl: "https://other.example.com",
          modelOverrides: { "some-model": { name: "Renamed" } },
        },
      },
    };

    const providers = extractCustomProviders(doc);
    expect(providers.length).toBe(1);
    expect(providers[0].name).toBe("custom-proxy");
    expect(providers[0].config.baseUrl).toBe("https://proxy.example.com/v1");
    expect(providers[0].config.apiKey).toBe("sk-token");
    expect(providers[0].config.api).toBe("openai-completions");
    expect(providers[0].config.models.length).toBe(2);
    expect(providers[0].config.models[0].api).toBe("openai-completions");
    expect(providers[0].config.models[1].api).toBe("openai-responses");
  });

  test("applies modelOverrides to custom models", () => {
    const doc = {
      providers: {
        p1: {
          baseUrl: "https://api.example.com/v1",
          apiKey: "key",
          models: [{ id: "m1", name: "Original Name" }],
          modelOverrides: {
            m1: { name: "Overridden Name", contextWindow: 256000 },
          },
        },
      },
    };

    const providers = extractCustomProviders(doc);
    expect(providers[0].config.models[0].name).toBe("Overridden Name");
    expect(providers[0].config.models[0].contextWindow).toBe(256000);
  });

  test("skips providers with no models or missing baseUrl", () => {
    expect(extractCustomProviders(null)).toEqual([]);
    expect(extractCustomProviders({})).toEqual([]);
    expect(extractCustomProviders({ providers: {} })).toEqual([]);
    expect(
      extractCustomProviders({
        providers: {
          nobase: { apiKey: "k", models: [{ id: "m" }] },
          nomodels: { baseUrl: "https://x.com", apiKey: "k", models: [] },
        },
      }),
    ).toEqual([]);
  });
});

describe("install", () => {
  test("registers custom providers and augments credentials snapshot on ModelRegistry refresh", async () => {
    const modelsFile = join(dir, "models.yml");
    writeFileSync(
      modelsFile,
      `
providers:
  my-proxy:
    baseUrl: https://api.my-proxy.com/v1
    apiKey: sk-my-token
    api: openai-completions
    models:
      - id: proxy-gpt-5
        name: Proxy GPT-5
        contextWindow: 128000
        maxTokens: 16384
`,
    );

    const registered = [];
    const configKeys = new Map();
    let snapshotCalls = 0;

    class FakeModelRegistry {
      constructor() {
        this.authStorage = {
          keys: {
            setConfig: (provider, token) => configKeys.set(provider, token),
          },
          credentials: {
            snapshot: () => {
              snapshotCalls++;
              return {
                generation: 1,
                generatedAt: Date.now(),
                credentials: [{ id: 1, provider: "built-in", credential: {}, identityKey: null }],
              };
            },
          },
        };
      }

      registerProvider(name, config, source) {
        registered.push({ name, config, source });
      }

      async refresh() {
        return "refreshed";
      }

      getAll() {
        return [];
      }
    }

    const observers = [];
    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map([["ModelRegistry", FakeModelRegistry]]),
      observe: (name, cb) => {
        if (name === "ModelRegistry") observers.push(cb);
      },
    };

    install({ modelsPath: modelsFile }, { log: () => {} });

    const registry = new FakeModelRegistry();
    await registry.refresh();

    // Verify registerProvider was called
    expect(registered.length).toBe(1);
    expect(registered[0].name).toBe("my-proxy");
    expect(registered[0].config.baseUrl).toBe("https://api.my-proxy.com/v1");
    expect(registered[0].config.models.length).toBe(1);
    expect(registered[0].config.models[0].id).toBe("proxy-gpt-5");
    expect(registered[0].source).toBe("omp-shims:models-bridge");

    // Verify authStorage.keys.setConfig was called
    expect(configKeys.get("my-proxy")).toBe("sk-my-token");

    // Verify authStorage.credentials.snapshot was hooked to include my-proxy
    const snap = registry.authStorage.credentials.snapshot();
    expect(snap.credentials.some((c) => c.provider === "my-proxy")).toBe(true);
    expect(snap.credentials.some((c) => c.provider === "built-in")).toBe(true);
  });

  test("excludeProviders keeps cloud-synced self providers out of the local gateway registry", async () => {
    const modelsFile = join(dir, "models-self.yml");
    writeFileSync(
      modelsFile,
      [
        "providers:",
        "  kw92.cyou:",
        "    baseUrl: https://ai.kw92.cyou:20000/v1",
        "    apiKey: local-proxy-token",
        "    api: openai-completions",
        "    models:",
        "      - id: mistral-vibe/zai-glm-5-3-flash",
        "  external-proxy:",
        "    baseUrl: https://external.example/v1",
        "    apiKey: external-token",
        "    api: openai-completions",
        "    models:",
        "      - id: external/model",
        "",
      ].join("\n"),
    );

    const registered = [];
    const configKeys = new Map();
    class FakeModelRegistry {
      constructor() {
        this.authStorage = {
          keys: { setConfig: (provider, token) => configKeys.set(provider, token) },
          credentials: { snapshot: () => ({ generation: 1, generatedAt: Date.now(), credentials: [] }) },
        };
      }
      registerProvider(name) { registered.push(name); }
      async refresh() {}
      getAll() { return []; }
    }
    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map([["ModelRegistry", FakeModelRegistry]]),
      observe: () => {},
    };
    const lines = [];
    install({ modelsPath: modelsFile, excludeProviders: ["kw92.cyou"] }, { log: (line) => lines.push(line) });
    const registry = new FakeModelRegistry();
    await registry.refresh();

    expect(registered).toEqual(["external-proxy"]);
    expect(configKeys.has("kw92.cyou")).toBe(false);
    expect(configKeys.get("external-proxy")).toBe("external-token");
    expect(registry.authStorage.credentials.snapshot().credentials.map((entry) => entry.provider)).toEqual(["external-proxy"]);
    expect(lines.some((line) => line.includes("skipped local provider kw92.cyou"))).toBe(true);
  });

  test("getAll registers once per registry; refresh re-registers; the sync hook is not stacked", async () => {
    const modelsFile = join(dir, "models-once.yml");
    writeFileSync(
      modelsFile,
      "providers:\n  once-proxy:\n    baseUrl: https://once.example/v1\n    apiKey: k\n    api: openai-completions\n    models:\n      - id: m1\n",
    );
    const registered = [];
    let syncWraps = 0;
    class FakeModelRegistry {
      constructor() {
        let sync = (enabled) => enabled;
        // Count every time a layer replaces syncExtensionSources.
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
      async refresh() {
        return "refreshed";
      }
      getAll() {
        return [];
      }
    }
    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map([["ModelRegistry", FakeModelRegistry]]),
      observe: () => {},
    };
    install({ modelsPath: modelsFile }, { log: () => {} });

    const registry = new FakeModelRegistry();
    for (let i = 0; i < 100; i++) registry.getAll();
    expect(registered).toEqual(["once-proxy"]);
    await registry.refresh();
    await registry.refresh();
    expect(registered).toEqual(["once-proxy", "once-proxy", "once-proxy"]);
    expect(syncWraps).toBe(1);
    expect([...registry.syncExtensionSources(new Set(["x"]))].sort()).toEqual(["omp-shims:models-bridge", "x"]);
  });

  test("handles missing models.yml gracefully without throwing", async () => {
    class FakeModelRegistry {
      async refresh() {
        return "refreshed";
      }
      getAll() {
        return [];
      }
    }

    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map([["ModelRegistry", FakeModelRegistry]]),
      observe: () => {},
    };

    install({ modelsPath: join(dir, "nonexistent.yml") }, { log: () => {} });

    const registry = new FakeModelRegistry();
    await expect(registry.refresh()).resolves.toBe("refreshed");
  });
});
