import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_KEY = Symbol.for("omp-shims.host-bridge.state");

delete globalThis[STATE_KEY];
delete globalThis.__OMP_SHIMS_HOST__;
const host = await import("../lib/host-bridge.mjs");
const pluginBridge = await import("../features/plugin-bridge.mjs");

const works = [];

function workDir(prefix = "e4-plugin-") {
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

function writeFile(root, relativePath, content) {
  const file = join(root, relativePath);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function makeRegistryClass() {
  return class FakeRegistry {
    constructor() {
      this.registered = [];
      this.unregistered = [];
      this.keys = [];
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
    get authStorage() {
      return {
        keys: {
          setConfig: (provider, token) => this.keys.push([provider, token]),
        },
      };
    }
  };
}

function writePlugin(pluginsDir, name, manifestExtra, files) {
  const packageDir = join(pluginsDir, "node_modules", ...name.split("/"));
  mkdirSync(packageDir, { recursive: true });
  writeFile(packageDir, "package.json", JSON.stringify({ name, version: "1.0.0", ...manifestExtra }));
  for (const [relativePath, content] of Object.entries(files)) writeFile(packageDir, relativePath, content);
  return packageDir;
}

describe("manifest entry preference", () => {
  test("omp.extensions wins over pi.extensions and main", () => {
    const directory = workDir();
    writeFile(directory, "omp.mjs", "export default () => {};\n");
    writeFile(directory, "pi.mjs", "export default () => {};\n");
    writeFile(directory, "main.mjs", "export default () => {};\n");
    const packageJson = {
      omp: { extensions: ["omp.mjs"] },
      pi: { extensions: ["pi.mjs"] },
      main: "main.mjs",
    };
    expect(pluginBridge.entryPointsOf(directory, packageJson, packageJson.omp, null)).toEqual([
      join(directory, "omp.mjs"),
    ]);
  });

  test("pi.extensions wins when omp declares none", () => {
    const directory = workDir();
    writeFile(directory, "pi.mjs", "export default () => {};\n");
    writeFile(directory, "main.mjs", "export default () => {};\n");
    const packageJson = { omp: {}, pi: { extensions: ["pi.mjs"] }, main: "main.mjs" };
    expect(pluginBridge.entryPointsOf(directory, packageJson, packageJson.omp, null)).toEqual([
      join(directory, "pi.mjs"),
    ]);
  });

  test("main is the fallback, and a bare index.js is never assumed", () => {
    const directory = workDir();
    writeFile(directory, "main.mjs", "export default () => {};\n");
    writeFile(directory, "index.js", "export default () => {};\n");

    const withMain = { omp: {}, main: "main.mjs" };
    expect(pluginBridge.entryPointsOf(directory, withMain, withMain.omp, null)).toEqual([join(directory, "main.mjs")]);

    const withoutMain = { omp: {} };
    expect(pluginBridge.entryPointsOf(directory, withoutMain, withoutMain.omp, null)).toEqual([]);
  });

  test("a declared directory expands to its index file", () => {
    const directory = workDir();
    writeFile(directory, "dist/index.mjs", "export default () => {};\n");
    const packageJson = { omp: { extensions: ["dist"] } };
    expect(pluginBridge.entryPointsOf(directory, packageJson, packageJson.omp, null)).toEqual([
      join(directory, "dist", "index.mjs"),
    ]);
  });
});

describe("discovery policy", () => {
  test("disabled lock entries are skipped", () => {
    const pluginsDir = workDir("e4-plugins-disabled-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/off": "1" } }));
    writeFile(
      pluginsDir,
      "omp-plugins.lock.json",
      JSON.stringify({ plugins: { "@test/off": { enabled: false, enabledFeatures: null } } }),
    );
    writePlugin(
      pluginsDir,
      "@test/off",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": "export default () => {};\n",
      },
    );

    expect(pluginBridge.discoverPlugins(pluginsDir)).toEqual([]);
  });

  test("enabledFeatures selects named features instead of defaults", () => {
    const directory = workDir();
    writeFile(directory, "base.mjs", "export default () => {};\n");
    writeFile(directory, "extra.mjs", "export default () => {};\n");
    writeFile(directory, "default.mjs", "export default () => {};\n");
    writeFile(directory, "off.mjs", "export default () => {};\n");
    const manifest = {
      extensions: ["base.mjs"],
      features: {
        extra: { extensions: ["extra.mjs"] },
        defaultOn: { extensions: ["default.mjs"], default: true },
        defaultOff: { extensions: ["off.mjs"], default: false },
      },
    };
    const packageJson = { omp: manifest };

    expect(pluginBridge.entryPointsOf(directory, packageJson, manifest, ["extra"])).toEqual([
      join(directory, "base.mjs"),
      join(directory, "extra.mjs"),
    ]);
    expect(pluginBridge.entryPointsOf(directory, packageJson, manifest, null)).toEqual([
      join(directory, "base.mjs"),
      join(directory, "default.mjs"),
    ]);
  });

  test("lockfile enabledFeatures drives discovery", () => {
    const pluginsDir = workDir("e4-plugins-features-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/feat": "1" } }));
    writeFile(
      pluginsDir,
      "omp-plugins.lock.json",
      JSON.stringify({ plugins: { "@test/feat": { enabled: true, enabledFeatures: ["extra"] } } }),
    );
    writePlugin(
      pluginsDir,
      "@test/feat",
      {
        omp: {
          extensions: ["base.mjs"],
          features: { extra: { extensions: ["extra.mjs"] }, off: { extensions: ["off.mjs"], default: true } },
        },
      },
      {
        "base.mjs": "export default () => {};\n",
        "extra.mjs": "export default () => {};\n",
        "off.mjs": "export default () => {};\n",
      },
    );

    const [plugin] = pluginBridge.discoverPlugins(pluginsDir);
    expect(plugin.entries).toHaveLength(2);
    expect(plugin.entries.some((entry) => entry.endsWith("extra.mjs"))).toBe(true);
    expect(plugin.entries.some((entry) => entry.endsWith("off.mjs"))).toBe(false);
  });

  test("an entry that escapes the package directory is rejected", () => {
    const directory = workDir();
    writeFile(directory, "evil.mjs", "export default () => {};\n");
    const packageDir = join(directory, "package");
    mkdirSync(packageDir, { recursive: true });
    writeFile(packageDir, "ok.mjs", "export default () => {};\n");

    const packageJson = { omp: { extensions: ["../evil.mjs", "/etc/passwd", "ok.mjs"] } };
    expect(pluginBridge.entryPointsOf(packageDir, packageJson, packageJson.omp, null)).toEqual([
      join(packageDir, "ok.mjs"),
    ]);
  });
});

describe("eager init and host wiring", () => {
  test("a hanging plugin is isolated by the eager timeout", async () => {
    const pluginsDir = workDir("e4-plugins-hang-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/hang": "1" } }));
    writePlugin(
      pluginsDir,
      "@test/hang",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": "export default function () { return new Promise(() => {}); }\n",
      },
    );

    const started = Date.now();
    const dispose = await pluginBridge.install({ pluginsDir, eagerTimeoutMs: 40 }, {});
    const elapsed = Date.now() - started;

    expect(typeof dispose).toBe("function");
    expect(elapsed).toBeLessThan(1000);
    dispose();
  });

  test("a failing plugin is reported and skipped", async () => {
    const pluginsDir = workDir("e4-plugins-fail-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/fail": "1" } }));
    writePlugin(
      pluginsDir,
      "@test/fail",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": "export default function () { throw new Error('boom'); }\n",
      },
    );

    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const dispose = await pluginBridge.install({ pluginsDir, eagerTimeoutMs: 1000 }, {});
      dispose();
    } finally {
      console.error = original;
    }
    expect(errors.some((line) => line.includes("boom"))).toBe(true);
  });

  test("OAuth registration reaches the captured export and tokens come from context.tokens", async () => {
    const Registry = makeRegistryClass();
    const oauthCalls = [];
    globalThis.__OMP_SHIMS_HOST__ = {
      captured: new Map([
        ["ModelRegistry", Registry],
        [
          "registerOAuthProvider",
          (config) => {
            oauthCalls.push(config);
          },
        ],
      ]),
      observe(name, observer) {
        const value = this.captured.get(name);
        if (value !== undefined) observer(value);
        return () => {};
      },
      resolve(name) {
        return this.captured.get(name);
      },
    };

    const pluginsDir = workDir("e4-plugins-oauth-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/oauth": "1" } }));
    writePlugin(
      pluginsDir,
      "@test/oauth",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": [
          "export default function init(pi) {",
          "  pi.registerProvider('oauth-x', {",
          "    baseUrl: 'https://oauth.test/v1',",
          "    api: 'openai-completions',",
          "    oauth: { name: 'OAuth X', login: async () => 'key' },",
          "    models: [{ id: 'a', contextWindow: 10 }, { id: 'b', contextWindow: 10 }],",
          "  });",
          "}",
        ].join("\n"),
      },
    );

    // The path contract, not a config literal and not an environment variable.
    const dispose = await pluginBridge.install(
      { eagerTimeoutMs: 1000 },
      {
        paths: { pluginsDir, agentDbPath: join(pluginsDir, "agent.db"), brokerTokenPath: join(pluginsDir, "token") },
        tokens: { "oauth-x": { value: "tok-from-context" } },
      },
    );

    expect(oauthCalls).toHaveLength(1);
    expect(oauthCalls[0].id).toBe("oauth-x");
    expect(oauthCalls[0].name).toBe("OAuth X");

    const registry = new Registry();
    registry.getAll();
    expect(registry.registered.some((entry) => entry.provider === "oauth-x")).toBe(true);
    expect(registry.keys).toContainEqual(["oauth-x", "tok-from-context"]);
    dispose();
  });

  test("text_end.content is passed through as a string, not coerced to blocks", async () => {
    const pluginsDir = workDir("e4-plugins-shape-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/shape": "1" } }));
    writePlugin(
      pluginsDir,
      "@test/shape",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": [
          'import { EventStream } from "@earendil-works/pi-ai";',
          "export default function init(pi) {",
          "  pi.registerProvider('shape-x', {",
          "    baseUrl: 'https://shape.test/v1',",
          "    api: 'shape-api',",
          "    models: [{ id: 'a', contextWindow: 10 }, { id: 'b', contextWindow: 10 }],",
          "    streamSimple() { return new EventStream(); },",
          "  });",
          "}",
        ].join("\n"),
      },
    );

    const dispose = await pluginBridge.install({ pluginsDir, eagerTimeoutMs: 1000 }, {});
    try {
      const shim = await host.loadVendorShim("@earendil-works/pi-ai");
      const stream = shim.streamSimple({ api: "shape-api" }, {}, {});
      expect(stream).toBeInstanceOf(shim.EventStream);

      stream.push({ type: "text_end", content: "plain text" });
      expect(stream.queue).toHaveLength(1);
      expect(stream.queue[0].content).toBe("plain text");
      expect(Array.isArray(stream.queue[0].content)).toBe(false);
    } finally {
      dispose();
    }
  });

  test("provider transport metadata is published for the router", async () => {
    const pluginsDir = workDir("e4-plugins-meta-");
    writeFile(pluginsDir, "package.json", JSON.stringify({ dependencies: { "@test/meta": "1" } }));
    writePlugin(
      pluginsDir,
      "@test/meta",
      { omp: { extensions: ["index.mjs"] } },
      {
        "index.mjs": [
          "export default function init(pi) {",
          "  pi.registerProvider('meta-x', {",
          "    baseUrl: 'https://meta.test/v1',",
          "    api: 'meta-api',",
          "    headers: { 'x-meta': '1' },",
          "    models: [{ id: 'a', contextWindow: 10 }],",
          "    streamSimple() {},",
          "    async fetchDynamicModels(token) { return [{ id: token, contextWindow: 10 }]; },",
          "  });",
          "}",
        ].join("\n"),
      },
    );

    const dispose = await pluginBridge.install(
      { pluginsDir, eagerTimeoutMs: 1000 },
      { tokens: { "meta-x": { value: "tok-meta" } } },
    );
    try {
      const meta = host.getExtensionProvider("meta-x");
      expect(meta.baseUrl).toBe("https://meta.test/v1");
      expect(meta.api).toBe("meta-api");
      expect(meta.headers).toEqual({ "x-meta": "1" });
      expect(typeof meta.streamSimple).toBe("function");
      expect(meta.models.map((model) => model.id)).toEqual(["a"]);
      expect(await meta.resolveApiKey()).toBe("tok-meta");
      expect(host.listRegisteredExtensionProviders().some((entry) => entry.id === "meta-x")).toBe(true);

      await host.refreshExtensionProviders();
      expect(host.listExtensionProviders().some((row) => row.id === "meta-x/tok-meta")).toBe(true);
    } finally {
      dispose();
    }
    expect(host.getExtensionProvider("meta-x")).toBeUndefined();
  });

  test("unsupported host methods are reported, not swallowed", () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const pluginHost = pluginBridge.createPluginHost(() => {});
      pluginHost.registerCommand("hello", { handler() {} });
      pluginHost.registerTool("tool", {});
    } finally {
      console.error = original;
    }
    expect(errors.some((line) => line.includes("registerCommand"))).toBe(true);
    expect(errors.some((line) => line.includes("registerTool"))).toBe(true);
  });
});
