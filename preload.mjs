// omp-shims preload entry.
//
// Load it in this order, before OMP starts:
//   BUN_OPTIONS="--preload .../registry-capture.mjs --preload .../preload.mjs" omp ...
//
// registry-capture.mjs must come first. It installs its hook without static
// imports, so the hook exists before this module's import graph is evaluated.

import { startRuntime } from "./lib/runtime.mjs";

await startRuntime({ mode: "preload" });
