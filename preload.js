// omp-shims bootstrap.
//
// Load with the Bun runtime before OMP starts:
//   BUN_OPTIONS="--preload .../registry-capture.js --preload .../preload.js" omp ...
//
// registry-capture.js must come first: it installs itself without static
// imports so it is in place before this module's imports are evaluated.

import { loadConfig, FEATURES, readConfigFile } from "./lib/config.js";
import { addFetchHandler, preserveResponseUrl } from "./lib/fetch-chain.js";

const { features } = loadConfig();
const { pluginBridge } = readConfigFile();
const started = [];

// Diagnostics go to stderr, never stdout. Several omp subcommands parse stdout
// (for example `omp --version`, which the self-updater runs to verify a freshly
// installed binary), and anything written there makes them fail to parse and
// report a corrupt download. Logging to stderr keeps it out of the way.
function report(message, detail) {
  console.error(`[omp-shims] ${message}${detail ? ` ${JSON.stringify(detail)}` : ""}`);
}

report(
  "active:",
  Object.entries(features)
    .filter(([, entry]) => entry.enabled)
    .map(([name]) => name),
);

// OMP's built-in thinking-loop guard reacts to a loop by aborting the stream and
// retrying the identical body, which reproduces the same loop. No feature here
// compensates loops, so the guard is off by default and can be re-enabled.
if (!features["native-loop-guard"].enabled) {
  process.env.PI_NO_THINKING_LOOP_GUARD = "1";
}

const context = {
  log: (message, detail) => {
    if (process.env.OMP_SHIMS_VERBOSE === "1") report(message, detail);
  },
  addFetchHandler,
  preserveResponseUrl,
  extraHosts: [],
  tokens: pluginBridge?.tokens,
};

/** Load order matters: body rewrites run before the stream-level features. */
const LOAD_ORDER = [
  // Fetch layers, outermost first. The order IS the design: a layer's re-issued
  // calls travel back down the stack, so anything a retry needs must sit below
  // the layer that retries.
  "tool-id-hash",                   // put the client's tool ids back
  "antigravity-capture",            // watches the final stream
  "antigravity-continuation",       // owns the response; retries re-enter below
  "antigravity-system-instruction", // rewrite the outgoing envelope
  "antigravity-routing",            // rewrite model + thinking level
  "ipv6-first",                     // innermost: pin the egress address family

  // Process-level features, outside the fetch stack.
  "vendor-shims",
  "plugin-bridge",
  "traffic-log",
];

for (const name of LOAD_ORDER) {
  const entry = features[name];
  if (!entry?.enabled) continue;
  try {
    const module = await import(`./features/${name}.js`);
    module.install(entry, context);
    started.push(name);
  } catch (error) {
    // One broken feature must not stop OMP from starting.
    console.warn(`[omp-shims] feature "${name}" failed to install: ${error.message}`);
  }
}

globalThis.__OMP_SHIMS__ = {
  features,
  started,
  names: Object.keys(FEATURES),
};

report(`installed: ${started.join(", ") || "none"}`);
