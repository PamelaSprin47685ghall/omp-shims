// omp-shims plugin entry.
//
// Two jobs:
//   1. install the enabled shims into the CURRENT process, so an interactive
//      `omp` session gets the same behaviour as the gateway service;
//   2. register a `/omp-shims` command to inspect and toggle features at runtime.
//
// The gateway service loads the same features through preload.js, which is the
// path that matters for the auth-gateway. This entry exists so a plain omp
// session is covered too, and so features are discoverable from inside OMP.

import {
  applyNativeLoopGuard,
  createContext,
  FETCH_LAYERS,
  installFeatures,
  PROCESS_FEATURES,
} from "./lib/bootstrap.js";
import { CONFIG_PATH, describeConfig, FEATURES, loadConfig, readConfigFile, writeConfig } from "./lib/config.js";

/** Interactive sessions get the fetch layers and process features, not the background watchers. */
const LOAD_ORDER = [...FETCH_LAYERS, ...PROCESS_FEATURES];

let installing = false;

async function installEnabled() {
  if (installing || globalThis.__OMP_SHIMS__?.started !== undefined) return;
  installing = true;
  const { features } = loadConfig();
  // Token specs live outside `features`, in the top-level `pluginBridge` section.
  const { pluginBridge } = readConfigFile();
  const started = [];
  globalThis.__OMP_SHIMS__ = {
    features,
    started,
    names: Object.keys(FEATURES),
  };

  applyNativeLoopGuard(features);
  await installFeatures(LOAD_ORDER, features, createContext({ tokens: pluginBridge?.tokens }), started);
}

export default function ompShims(pi) {
  // If preload.js has already initialized the shims (as in the auth-gateway service),
  // do not re-install them to prevent duplicate fetch wrapping and handler inversion.
  if (!installing && globalThis.__OMP_SHIMS__?.started === undefined) {
    void installEnabled();
  }

  pi.registerCommand?.("omp-shims", {
    description: "Show or toggle omp-shims features",
    handler: async (args, ctx) => {
      const argument = String(args ?? "").trim();

      if (!argument) {
        const { features } = loadConfig();
        const lines = [
          `omp-shims (config: ${CONFIG_PATH})`,
          "",
          ...describeConfig({ features }),
          "",
          "usage: /omp-shims <feature> [on|off]",
        ];
        ctx?.ui?.notify?.(lines.join("\n"), "info");
        return;
      }

      const [name, value] = argument.split(/\s+/);
      if (!(name in FEATURES)) {
        ctx?.ui?.notify?.(`Unknown feature: ${name}`, "warning");
        return;
      }
      if (value !== "on" && value !== "off") {
        ctx?.ui?.notify?.(`Usage: /omp-shims ${name} [on|off]`, "warning");
        return;
      }

      writeConfig({ [name]: { enabled: value === "on" } });
      ctx?.ui?.notify?.(`${name} set to ${value}; restart omp to apply.`, "info");
    },
  });
}
