// Shared bootstrap for the two entry points (preload.js and index.js).
//
// Both install the same features in the same order with the same context, so
// the order and the install loop live here instead of being copied twice.

import { addFetchHandler, preserveResponseUrl } from "./fetch-chain.js";

/**
 * Fetch layers, outermost first. The order IS the design: a layer's re-issued
 * calls travel back down the stack, so anything a retry needs must sit below
 * the layer that retries. See lib/fetch-chain.js.
 */
export const FETCH_LAYERS = [
  "tool-id-hash", // put the client's tool ids back
  "antigravity-capture", // watches the final stream
  "antigravity-account-routing", // route by model tier (Ultra / Pro with fallback)
  "antigravity-continuation", // owns the response; retries re-enter below
  "antigravity-system-instruction", // rewrite the outgoing envelope
  "cline-pin-upstream", // pin ClinePass upstream channel
  "antigravity-routing", // rewrite model + thinking level
  "ipv6-first", // innermost: pin the egress address family
];

/** Process-level features, outside the fetch stack. */
export const PROCESS_FEATURES = ["vendor-shims", "plugin-bridge", "traffic-log"];

/** Background watchers. Only the long-running services (preload) start these. */
export const BACKGROUND_FEATURES = ["kiro-credential-sync"];

/** Everything preload.js installs, in order. */
export const LOAD_ORDER = [...FETCH_LAYERS, ...PROCESS_FEATURES, ...BACKGROUND_FEATURES];

/**
 * Write a diagnostic line to stderr.
 *
 * Never stdout: several omp subcommands parse stdout (for example
 * `omp --version`, which the self-updater runs to verify a freshly installed
 * binary), and anything written there makes them report a corrupt download.
 */
export function report(message, detail) {
  console.error(`[omp-shims] ${message}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
}

/**
 * The context object handed to every feature's `install(config, context)`.
 *
 * One object is shared by all features on purpose: vendor-shims publishes
 * `registerTransport` on it and plugin-bridge consumes it.
 */
export function createContext({ tokens } = {}) {
  return {
    log: (message, detail) => {
      if (process.env.OMP_SHIMS_VERBOSE === "1") report(message, detail);
    },
    addFetchHandler,
    preserveResponseUrl,
    extraHosts: [],
    tokens,
  };
}

/**
 * OMP's built-in thinking-loop guard reacts to a loop by aborting the stream and
 * retrying the identical body, which reproduces the same loop. No feature here
 * compensates loops, so the guard is off unless explicitly re-enabled.
 */
export function applyNativeLoopGuard(features) {
  if (!features["native-loop-guard"]?.enabled) process.env.PI_NO_THINKING_LOOP_GUARD = "1";
}

/**
 * Install every enabled feature in `names`, in order. A feature that fails to
 * load or install is reported and skipped: one broken feature must not stop OMP
 * from starting.
 *
 * @returns {Promise<string[]>} the names that were installed
 */
export async function installFeatures(names, features, context, started = []) {
  for (const name of names) {
    const entry = features[name];
    if (!entry?.enabled) continue;
    try {
      const module = await import(new URL(`../features/${name}.js`, import.meta.url).href);
      module.install(entry, context);
      started.push(name);
    } catch (error) {
      report(`feature "${name}" failed to install: ${error?.message ?? error}`);
    }
  }
  return started;
}
