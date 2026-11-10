import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FEATURE_NAMES = [
  "gateway-compat",
  "sse-heartbeat",
  "reasoning-order",
  "tool-id-hash",
  "antigravity",
  "copilot-auto",
  "lazy-router",
  "cline-pin-upstream",
  "ipv6-first",
  "plugin-bridge",
  "models-bridge",
  "traffic-log",
  "kiro-credential-sync",
];

const PRELOAD_EXPECTED = [
  "gateway-compat",
  "sse-heartbeat",
  "reasoning-order",
  "tool-id-hash",
  "antigravity",
  "copilot-auto",
  "cline-pin-upstream",
  "ipv6-first",
  "plugin-bridge",
  "models-bridge",
  "kiro-credential-sync",
];

const EXTENSION_EXPECTED = [
  "tool-id-hash",
  "antigravity",
  "copilot-auto",
  "cline-pin-upstream",
  "ipv6-first",
  "plugin-bridge",
  "models-bridge",
];

const originalArgv = process.argv.slice();
const originalGuard = process.env.PI_NO_THINKING_LOOP_GUARD;
const sandboxes = [];

/** Run with no service token in argv, so isServiceProcess() is false. */
function hideServiceArgs() {
  process.argv = process.argv.filter((arg) => !["auth-gateway", "auth-broker", "serve"].includes(arg));
  return () => {
    process.argv = originalArgv.slice();
  };
}

/**
 * Build a throwaway copy of the real runtime, config and contracts modules.
 * The copy gets stub inbound/outbound ports and fake feature modules, so the
 * install order and lifecycle run without touching the repository.
 */
function createSandbox({ throwing = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "omp-shims-runtime-v2-"));
  sandboxes.push(root);
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "features"), { recursive: true });

  const sourceLib = new URL("../lib/", import.meta.url);
  for (const file of ["runtime.mjs", "config.mjs", "contracts.mjs"]) {
    copyFileSync(new URL(file, sourceLib), join(root, "lib", file));
  }
  writeFileSync(
    join(root, "lib", "inbound.mjs"),
    ["export function addInboundMiddleware() {", "  return () => {};", "}", ""].join("\n"),
  );
  writeFileSync(
    join(root, "lib", "outbound.mjs"),
    [
      "export function addFetchHandler() {",
      "  return () => {};",
      "}",
      "export function preserveResponseUrl(response) {",
      "  return response;",
      "}",
      "",
    ].join("\n"),
  );

  for (const name of FEATURE_NAMES) {
    const file = join(root, "features", `${name}.mjs`);
    if (throwing.includes(name)) {
      writeFileSync(
        file,
        `export async function install() {\n  throw new Error(${JSON.stringify(`boom:${name}`)});\n}\n`,
      );
      continue;
    }
    writeFileSync(
      file,
      [
        "export async function install(config, context) {",
        "  globalThis.__RUNTIME_CONTEXT__ = context;",
        `  (globalThis.__RUNTIME_INSTALLS__ ??= []).push(${JSON.stringify(name)});`,
        "  return () => {",
        `    (globalThis.__RUNTIME_DISPOSALS__ ??= []).push(${JSON.stringify(name)});`,
        "  };",
        "}",
        "",
      ].join("\n"),
    );
  }

  const runtimeUrl = pathToFileURL(join(root, "lib", "runtime.mjs")).href;
  const configUrl = pathToFileURL(join(root, "lib", "config.mjs")).href;

  return {
    root,
    installs: () => globalThis.__RUNTIME_INSTALLS__ ?? [],
    disposals: () => globalThis.__RUNTIME_DISPOSALS__ ?? [],
    reset() {
      delete globalThis.__RUNTIME_INSTALLS__;
      delete globalThis.__RUNTIME_DISPOSALS__;
      delete globalThis.__RUNTIME_CONTEXT__;
    },
    async load(overrides) {
      const [runtime, config] = await Promise.all([import(runtimeUrl), import(configUrl)]);
      return { ...runtime, config: config.validateConfig(overrides ?? {}) };
    },
    async unload() {
      try {
        const runtime = await import(runtimeUrl);
        await runtime.stopRuntime();
      } catch {}
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function withSandbox(options, run) {
  const sandbox = createSandbox(options);
  const restoreArgv = hideServiceArgs();
  sandbox.reset();
  try {
    const runtime = await sandbox.load(options?.configOverrides);
    await run(sandbox, runtime);
  } finally {
    await sandbox.unload();
    sandbox.cleanup();
    restoreArgv();
  }
}

afterEach(() => {
  process.argv = originalArgv.slice();
  if (originalGuard === undefined) delete process.env.PI_NO_THINKING_LOOP_GUARD;
  else process.env.PI_NO_THINKING_LOOP_GUARD = originalGuard;
  delete globalThis.__OMP_SHIMS__;
  for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("preload runtime", () => {
  test("installs the enabled features in phase order and disposes in reverse", async () => {
    await withSandbox({}, async (sandbox, runtime) => {
      process.argv.push("auth-gateway", "serve");
      const handle = await runtime.startRuntime({ mode: "preload", config: runtime.config });

      expect(sandbox.installs()).toEqual(PRELOAD_EXPECTED);
      expect(handle.started).toEqual(PRELOAD_EXPECTED);
      expect(handle.mode).toBe("preload");
      expect(handle.names).toEqual(FEATURE_NAMES);
      expect(globalThis.__OMP_SHIMS__).toBe(handle);

      const context = globalThis.__RUNTIME_CONTEXT__;
      expect(context.paths.stateDbPath).toBe(runtime.config.stateDbPath);
      expect(context.paths.stateDbPath).toMatch(/omp-shims-state\.sqlite$/);
      expect(context.paths.logsDir).toMatch(/\.omp[/\\]logs$/);
      expect(context.paths.configPath).toMatch(/shims\.json$/);
      expect(context.paths.agentDbPath).toMatch(/\.omp[/\\]agent[/\\]agent\.db$/);
      expect(context.paths.brokerTokenPath).toMatch(/\.omp[/\\]auth-broker\.token$/);
      expect(context.paths.gatewayTokenPath).toMatch(/\.omp[/\\]auth-gateway\.token$/);
      expect(context.paths.pluginsDir).toMatch(/\.omp[/\\]plugins$/);

      // A second start is a no-op and returns the same handle.
      const again = await runtime.startRuntime({ mode: "preload" });
      expect(again).toBe(handle);
      expect(sandbox.installs()).toEqual(PRELOAD_EXPECTED);

      await runtime.stopRuntime();
      expect(sandbox.disposals()).toEqual([...PRELOAD_EXPECTED].reverse());
      expect(globalThis.__OMP_SHIMS__).toBeUndefined();
    });
  });

  test("an interactive extension skips EDGE and BACKGROUND features", async () => {
    await withSandbox({}, async (sandbox, runtime) => {
      const handle = await runtime.startRuntime({ mode: "extension", config: runtime.config });
      expect(handle.mode).toBe("extension");
      expect(sandbox.installs()).toEqual(EXTENSION_EXPECTED);
      expect(sandbox.installs()).not.toContain("gateway-compat");
      expect(sandbox.installs()).not.toContain("sse-heartbeat");
      expect(sandbox.installs()).not.toContain("reasoning-order");
      expect(sandbox.installs()).not.toContain("kiro-credential-sync");
      await runtime.stopRuntime();
    });
  });

  test("loop guard is disabled only in a service process, and restored on dispose", async () => {
    await withSandbox({}, async (_sandbox, runtime) => {
      process.argv.push("auth-broker", "serve");
      process.env.PI_NO_THINKING_LOOP_GUARD = "previous";
      const handle = await runtime.startRuntime({ mode: "preload", config: runtime.config });
      expect(process.env.PI_NO_THINKING_LOOP_GUARD).toBe("1");
      await handle.dispose();
      expect(process.env.PI_NO_THINKING_LOOP_GUARD).toBe("previous");
    });

    await withSandbox({ configOverrides: { runtime: { thinkingLoopGuard: true } } }, async (_sandbox, runtime) => {
      process.argv.push("auth-gateway", "serve");
      process.env.PI_NO_THINKING_LOOP_GUARD = "previous";
      const handle = await runtime.startRuntime({ mode: "preload", config: runtime.config });
      expect(process.env.PI_NO_THINKING_LOOP_GUARD).toBe("previous");
      await handle.dispose();
    });

    await withSandbox({}, async (_sandbox, runtime) => {
      delete process.env.PI_NO_THINKING_LOOP_GUARD;
      expect(process.argv).not.toContain("auth-gateway");
      expect(process.argv).not.toContain("auth-broker");
      expect(process.env.PI_NO_THINKING_LOOP_GUARD).toBeUndefined();
      const handle = await runtime.startRuntime({ mode: "extension", config: runtime.config });
      expect(process.env.PI_NO_THINKING_LOOP_GUARD).toBeUndefined();
      await handle.dispose();
    });
  });

  test("a failing feature is reported and skipped", async () => {
    await withSandbox({ throwing: ["gateway-compat"] }, async (sandbox, runtime) => {
      const handle = await runtime.startRuntime({ mode: "preload", config: runtime.config });
      expect(handle.started).toEqual(PRELOAD_EXPECTED.filter((name) => name !== "gateway-compat"));
      expect(sandbox.installs()).toEqual(PRELOAD_EXPECTED.filter((name) => name !== "gateway-compat"));
      await runtime.stopRuntime();
      expect(sandbox.disposals()).toEqual([...PRELOAD_EXPECTED].filter((name) => name !== "gateway-compat").reverse());
    });
  });
});
