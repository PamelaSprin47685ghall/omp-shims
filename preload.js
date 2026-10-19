// omp-shims bootstrap.
//
// Load with the Bun runtime before OMP starts:
//   BUN_OPTIONS="--preload .../registry-capture.js --preload .../preload.js" omp ...
//
// registry-capture.js must come first: it installs itself without static
// imports so it is in place before this module's imports are evaluated.

import { applyNativeLoopGuard, createContext, installFeatures, LOAD_ORDER, report } from "./lib/bootstrap.js";
import { FEATURES, loadConfig, readConfigFile } from "./lib/config.js";

const { features } = loadConfig();
const { pluginBridge } = readConfigFile();
const started = [];

report(
  "active:",
  Object.entries(features)
    .filter(([, entry]) => entry.enabled)
    .map(([name]) => name),
);

applyNativeLoopGuard(features);

globalThis.__OMP_SHIMS__ = {
  features,
  started,
  names: Object.keys(FEATURES),
};

await installFeatures(LOAD_ORDER, features, createContext({ tokens: pluginBridge?.tokens }), started);

report(`installed: ${started.join(", ") || "none"}`);
