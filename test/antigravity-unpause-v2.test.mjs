// The unpause preload is a side-effecting module with top-level await. This
// test guards the two properties a preload needs: it loads at all, and it
// degrades to a single message when no OMP auth core is reachable instead of
// killing the process that preloaded it.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRY = pathToFileURL(join(import.meta.dir, "..", "antigravity-unpause.mjs")).href;

test("the unpause preload exits cleanly when no OMP auth core is present", () => {
  const child = Bun.spawnSync([process.execPath, "-e", `await import(${JSON.stringify(ENTRY)})`], {
    env: { PATH: process.env.PATH ?? "" },
  });
  const output = `${child.stdout} ${child.stderr}`;
  expect(child.exitCode).toBe(0);
  expect(output).toContain("antigravity-unpause: no OMP auth core found");
});
