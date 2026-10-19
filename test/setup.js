// Runs before every test file (see bunfig.toml).
//
// Point the config file (and HOME, for spawned CLI processes) at a throwaway
// directory so no test reads or writes the developer's real ~/.omp, and clear
// any OMP_SHIMS_* toggles from the calling shell so they cannot change test
// outcomes. Bun caches os.homedir() at startup, so tests must also pass explicit
// paths to anything that would otherwise default under the home directory.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const key of Object.keys(process.env)) {
  if (key.startsWith("OMP_SHIMS_")) delete process.env[key];
}

const home = mkdtempSync(join(tmpdir(), "omp-shims-test-"));
process.env.HOME = home;
process.env.OMP_SHIMS_CONFIG = join(home, ".omp", "shims.json");
