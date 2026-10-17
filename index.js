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

import { loadConfig, describeConfig, writeConfig, FEATURES, CONFIG_PATH, readConfigFile } from "./lib/config.js";
import { addFetchHandler, preserveResponseUrl } from "./lib/fetch-chain.js";

const LOAD_ORDER = [
  "tool-id-hash",
  "antigravity-capture",
  "antigravity-account-routing",
  "antigravity-continuation",
  "antigravity-system-instruction",
  "antigravity-routing",
  "ipv6-first",
  "vendor-shims",
  "plugin-bridge",
  "traffic-log",
];

const installed = new Set();
let installing = false;

// Token specs live outside `features`, so read them once here.
const { pluginBridge } = readConfigFile();

function context() {
  return {
    log: (message, detail) => {
      if (process.env.OMP_SHIMS_VERBOSE === "1") console.error(`[omp-shims] ${message}`, detail ?? "");
    },
    addFetchHandler,
    preserveResponseUrl,
    extraHosts: [],
    tokens: pluginBridge?.tokens,
  };
}

async function installEnabled() {
  if (installing || globalThis.__OMP_SHIMS__?.started !== undefined) return;
  installing = true;
  const { features } = loadConfig();
  globalThis.__OMP_SHIMS__ = {
    features,
    started: [],
    names: Object.keys(FEATURES),
  };

  if (!features["native-loop-guard"].enabled) process.env.PI_NO_THINKING_LOOP_GUARD = "1";

  for (const name of LOAD_ORDER) {
    if (installed.has(name) || !features[name]?.enabled) continue;
    try {
      const module = await import(`./features/${name}.js`);
      module.install(features[name], context());
      installed.add(name);
      globalThis.__OMP_SHIMS__.started.push(name);
    } catch (error) {
      console.error(`[omp-shims] feature "${name}" failed to install: ${error.message}`);
    }
  }
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
