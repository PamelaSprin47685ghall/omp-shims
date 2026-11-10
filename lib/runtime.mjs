// The shim runtime: install the enabled features once, in phase order.
//
// Mechanism lives here; policy lives in lib/config.mjs and presets/*.json.
// Every feature module exports install(featureConfig, context) and may return a
// disposer. A feature that fails to load or install is reported and skipped:
// one broken feature must not stop OMP from starting.

import { homedir } from "node:os";
import { join } from "node:path";

import { CONFIG_PATH, FEATURE_CATALOG, loadConfig } from "./config.mjs";
import { isServiceProcess, PHASES, report, verboseLog } from "./contracts.mjs";
import { addInboundMiddleware } from "./inbound.mjs";
import { addFetchHandler, preserveResponseUrl } from "./outbound.mjs";

/** Install phases, outermost and earliest first. */
const PHASE_ORDER = [PHASES.EDGE, PHASES.OUTBOUND, PHASES.PROCESS, PHASES.BACKGROUND];

/** An interactive OMP session has no server edge and no long-lived watchers. */
const INTERACTIVE_PHASES = new Set([PHASES.OUTBOUND, PHASES.PROCESS]);

let current = null;
let pending = null;

/** Feature names in install order for one session mode. */
function orderedFeatures(interactive) {
  const names = [];
  for (const phase of PHASE_ORDER) {
    if (interactive && !INTERACTIVE_PHASES.has(phase)) continue;
    for (const [name, entry] of Object.entries(FEATURE_CATALOG)) {
      if (entry.phase === phase) names.push(name);
    }
  }
  return names;
}

/**
 * OMP's built-in thinking-loop guard aborts a looping stream and retries the
 * identical body, which reproduces the loop. The v2 policy turns it off in a
 * long-lived service unless `runtime.thinkingLoopGuard` says otherwise. An
 * interactive session keeps the guard OMP selected.
 *
 * @returns {(() => void) | undefined} a restore function when this call changed the environment
 */
function applyLoopGuard(config) {
  if (!isServiceProcess()) return undefined;
  if (config.runtime?.thinkingLoopGuard) return undefined;
  if (process.env.PI_NO_THINKING_LOOP_GUARD === "1") return undefined;

  const previous = process.env.PI_NO_THINKING_LOOP_GUARD;
  process.env.PI_NO_THINKING_LOOP_GUARD = "1";
  return () => {
    if (previous === undefined) delete process.env.PI_NO_THINKING_LOOP_GUARD;
    else process.env.PI_NO_THINKING_LOOP_GUARD = previous;
  };
}

/** One context object is shared by all features on purpose: ports and paths are shared. */
function createContext(config) {
  const ompDir = join(homedir(), ".omp");
  return {
    addInboundMiddleware,
    addFetchHandler,
    preserveResponseUrl,
    extraHosts: [],
    tokens: config.pluginBridge?.tokens ?? {},
    paths: {
      stateDbPath: config.stateDbPath,
      logsDir: join(ompDir, "logs"),
      configPath: config.configPath ?? CONFIG_PATH,
      agentDbPath: join(ompDir, "agent", "agent.db"),
      brokerTokenPath: join(ompDir, "auth-broker.token"),
      gatewayTokenPath: join(ompDir, "auth-gateway.token"),
      pluginsDir: join(ompDir, "plugins"),
    },
    log: verboseLog,
  };
}

/** Accept a disposer, a list of disposers, or an object with dispose(). */
function collectDisposers(result, disposers) {
  if (typeof result === "function") {
    disposers.push(result);
    return;
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      if (typeof item === "function") disposers.push(item);
    }
    return;
  }
  if (result && typeof result.dispose === "function") {
    disposers.push(() => result.dispose());
  }
}

async function installFeature(name, entry, context, disposers, started) {
  try {
    const module = await import(new URL(`../features/${name}.mjs`, import.meta.url).href);
    if (typeof module.install !== "function") throw new TypeError(`features/${name}.mjs has no install() export`);
    const result = await module.install(entry, context);
    collectDisposers(result, disposers);
    started.push(name);
  } catch (error) {
    report(`feature "${name}" failed to install: ${error?.message ?? error}`);
  }
}

async function boot(options) {
  const mode = options.mode ?? "preload";
  const interactive = mode === "extension";
  const config = options.config ?? loadConfig();
  const restoreGuard = applyLoopGuard(config);
  const disposers = [];
  const started = [];

  const handle = {
    mode,
    names: Object.keys(FEATURE_CATALOG),
    features: config.features,
    config,
    started,
    dispose: undefined,
  };

  let disposed = false;
  handle.dispose = async () => {
    if (disposed) return;
    disposed = true;
    if (current === handle) current = null;
    if (globalThis.__OMP_SHIMS__ === handle) delete globalThis.__OMP_SHIMS__;
    restoreGuard?.();
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        await disposers[index]();
      } catch (error) {
        report(`a disposer failed: ${error?.message ?? error}`);
      }
    }
    disposers.length = 0;
  };

  try {
    const context = createContext(config);
    for (const name of orderedFeatures(interactive)) {
      const entry = config.features[name];
      if (!entry?.enabled) continue;
      await installFeature(name, entry, context, disposers, started);
    }
  } catch (error) {
    await handle.dispose();
    throw error;
  }

  current = handle;
  globalThis.__OMP_SHIMS__ = handle;
  report(`installed: ${started.join(", ") || "none"}`, { mode });
  return handle;
}

/**
 * Start the runtime once. A second call returns the live handle, so a preload
 * and an extension in one process never install a feature twice.
 *
 * @param {{ mode?: "preload" | "extension", config?: object }} [options]
 * @returns {Promise<{ started: string[], features: Record<string, any>, dispose: () => Promise<void> }>}
 */
export function startRuntime(options = {}) {
  if (current) return Promise.resolve(current);
  if (!pending) {
    pending = boot(options).finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** Stop the runtime and run every disposer in reverse install order. */
export async function stopRuntime() {
  if (pending) await pending.catch(() => undefined);
  const handle = current;
  if (!handle) {
    if (globalThis.__OMP_SHIMS__) delete globalThis.__OMP_SHIMS__;
    return;
  }
  await handle.dispose();
}
