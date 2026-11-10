// Host-compatibility entrypoint for `@earendil-works/pi-coding-agent`.
//
// pi provider plugins import two type-only declarations plus `getAgentDir`, the
// runtime helper that locates the agent's state directory. Oh My Pi has no such
// package, so the import cannot resolve without this shim. Types are erased at
// runtime; only `getAgentDir` has to behave.
//
// Precedence matches OMP's packages/utils/src/dirs.ts:
//   PI_CODING_AGENT_DIR, OMP_AGENT_DIR, PI_AGENT_DIR, then ~/.omp/agent.

import { homedir } from "node:os";
import { join } from "node:path";

let cachedKey;
let cachedValue;

/**
 * Directory holding this agent's state (credentials, caches, settings).
 *
 * The result is cached until one of the environment variables changes, so a
 * profile switch or a test that points at a temporary directory sees the new
 * path instead of a stale one.
 */
export function getAgentDir() {
  const env = process.env;
  const key = `${env.PI_CODING_AGENT_DIR ?? ""}\0${env.OMP_AGENT_DIR ?? ""}\0${env.PI_AGENT_DIR ?? ""}`;
  if (cachedKey === key) return cachedValue;

  const override = env.PI_CODING_AGENT_DIR || env.OMP_AGENT_DIR || env.PI_AGENT_DIR;
  cachedKey = key;
  cachedValue = override || join(homedir(), ".omp", "agent");
  return cachedValue;
}
