import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createContext, FETCH_LAYERS, installFeatures, LOAD_ORDER } from "../lib/bootstrap.js";
import { FEATURES } from "../lib/config.js";

const root = join(import.meta.dir, "..");

describe("load order", () => {
  test("covers every feature module exactly once", () => {
    // native-loop-guard is a switch on OMP itself, not a module.
    const modules = Object.keys(FEATURES).filter((name) => name !== "native-loop-guard");
    expect([...LOAD_ORDER].sort()).toEqual(modules.sort());
    expect(new Set(LOAD_ORDER).size).toBe(LOAD_ORDER.length);
  });

  test("ipv6-first is the innermost fetch layer", () => {
    expect(FETCH_LAYERS.at(-1)).toBe("ipv6-first");
  });

  test.each(LOAD_ORDER)("features/%s.js exports install()", async (name) => {
    const file = join(root, "features", `${name}.js`);
    expect(existsSync(file)).toBe(true);
    expect(typeof (await import(file)).install).toBe("function");
  });
});

describe("installFeatures", () => {
  test("installs enabled features only, and survives one that fails", async () => {
    const errors = [];
    const error = console.error;
    console.error = (line) => errors.push(line);
    try {
      const layers = [];
      const context = { ...createContext(), addFetchHandler: (handler) => layers.push(handler) };
      const started = await installFeatures(
        ["antigravity-system-instruction", "antigravity-routing", "does-not-exist"],
        {
          "antigravity-system-instruction": { enabled: true },
          "antigravity-routing": { enabled: false },
          "does-not-exist": { enabled: true },
        },
        context,
      );
      expect(started).toEqual(["antigravity-system-instruction"]);
      expect(layers).toHaveLength(1);
      expect(errors.join("\n")).toContain('feature "does-not-exist" failed to install');
    } finally {
      console.error = error;
    }
  });
});
