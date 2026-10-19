// Host-compatibility entrypoint for `@earendil-works/pi-coding-agent`.
//
// pi provider plugins import two type-only declarations plus `getAgentDir`, the
// runtime helper that locates the agent's state directory. Oh My Pi has no such
// package, so the import fails to resolve and the plugin cannot load.
//
// Types are erased at runtime; only `getAgentDir` has to behave, and it is
// implemented from the host's own conventions rather than reimplementing pi.

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Directory holding this agent's state (credentials, caches, settings).
 *
 * Honours the same environment override pi uses so a caller can point the
 * plugin at a specific agent directory.
 */
export function getAgentDir() {
  const override = process.env.OMP_AGENT_DIR ?? process.env.PI_AGENT_DIR;
  if (override) return override;

  // OMP keeps agent state under ~/.omp/agent. Return that layout even before
  // the directory exists, since the caller only appends a filename.
  return join(homedir(), ".omp", "agent");
}
