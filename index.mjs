// omp-shims extension entry.
//
// This entry covers a plain OMP session. The gateway service loads the same
// runtime through preload.mjs. It does three jobs:
//   1. start the runtime in "extension" mode;
//   2. register /omp-shims to inspect and toggle features;
//   3. leave the built-in provider catalog alone.
//
// It never calls pi.registerProvider(). In ../oh-my-pi, a registration for
// "github-copilot" replaces the complete built-in model catalog and passes an
// invalid boolean `oauth` field. The copilot-auto feature bridges the
// github-copilot/auto alias without touching that catalog or OAuth.

// OMP 18.18.6 pauses google-antigravity in its compiled auth catalog. The
// plugin entry is what a normal `omp` session loads, so run the opt-out preload
// here as well as through BUN_OPTIONS in the service units. Import it first:
// its top-level await must finish before OMP resolves the command's provider
// roster (`omp login`, `omp token`, `omp models`).
import "./antigravity-unpause.mjs";

import {
  CONFIG_PATH,
  describeConfig,
  FEATURE_CATALOG,
  FEATURE_ENV_VARS,
  loadConfig,
  writeConfig,
} from "./lib/config.mjs";
import { report } from "./lib/contracts.mjs";
import { startRuntime } from "./lib/runtime.mjs";

export default function ompShims(pi) {
  void startRuntime({ mode: "extension" }).catch((error) => {
    report(`extension runtime failed to start: ${error?.message ?? error}`);
  });

  pi.registerCommand?.("omp-shims", {
    description: "Show or toggle omp-shims features",
    handler: async (args, ctx) => {
      const argument = String(args ?? "").trim();

      if (argument === "" || argument === "status") {
        const handle = globalThis.__OMP_SHIMS__;
        const config = loadConfig();
        const overridden = Object.entries(config.sources)
          .filter(([, source]) => source === "env")
          .map(([name]) => name);
        const lines = [
          `omp-shims v2 (config: ${CONFIG_PATH})`,
          `runtime: ${handle ? `${handle.mode}, ${handle.started.length} feature(s)` : "not started"}`,
          "",
          ...describeConfig(config),
          ...(overridden.length > 0 ? ["", `env overrides: ${overridden.join(", ")}`] : []),
          "",
          "usage: /omp-shims [status|<feature> on|off]",
        ];
        ctx?.ui?.notify?.(lines.join("\n"), "info");
        return;
      }

      const [name, value] = argument.split(/\s+/);
      if (!Object.hasOwn(FEATURE_CATALOG, name)) {
        ctx?.ui?.notify?.(`Unknown feature: ${name}`, "warning");
        return;
      }
      if (value !== "on" && value !== "off") {
        ctx?.ui?.notify?.(`Usage: /omp-shims ${name} on|off`, "warning");
        return;
      }

      try {
        writeConfig({ [name]: { enabled: value === "on" } });
        const source = loadConfig().sources?.[name];
        const override = source === "env" ? ` ${FEATURE_ENV_VARS[name]} overrides the file until it is unset.` : "";
        ctx?.ui?.notify?.(`${name} set to ${value}; restart omp to apply.${override}`, "info");
      } catch (error) {
        ctx?.ui?.notify?.(`Cannot update ${CONFIG_PATH}: ${error.message}`, "error");
      }
    },
  });
}
