// Copy-only deployment contract.
//
// The shared asset directory must survive a package rollback: the script only
// copies, never moves, never deletes, and keeps a manifest per build.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.mjs";

const SCRIPT = join(import.meta.dir, "..", "scripts", "deploy-status-assets.mjs");
const directories = [];

function sourceTree(buildId, assets, retained = []) {
  const root = tempDir("omp-status-deploy-");
  directories.push(root);
  mkdirSync(join(root, "assets"), { recursive: true });
  mkdirSync(join(root, "server"), { recursive: true });
  writeFileSync(join(root, "server", "status-page.ssr.mjs"), `// ${buildId}\n`);
  for (const name of new Set([...assets, ...retained])) {
    writeFileSync(join(root, "assets", name), `/* ${name} ${buildId} */\n`);
  }
  writeFileSync(
    join(root, "manifest.json"),
    `${JSON.stringify(
      { schema: 1, buildId, entry: assets[0], css: assets.filter((name) => name.endsWith(".css")), assets, retained },
      null,
      2,
    )}\n`,
  );
  return root;
}

function run(source, target) {
  return Bun.spawnSync(["bun", SCRIPT, "--from", source, "--to", target], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
}

function names(directory) {
  return readdirSync(directory).sort();
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("deploy-status-assets", () => {
  test("copies current and retained assets, keeps old files, and never moves", () => {
    const source = sourceTree(
      "sha256-aaaaaaaaaaaa",
      ["status-page.current.js", "status-page.current.css"],
      ["status-page.previous.js", "status-page.previous.css"],
    );
    const target = tempDir("omp-status-assets-");
    directories.push(target);
    writeFileSync(join(target, "status-page.oldest.js"), "/* keep me */\n");
    mkdirSync(join(target, "manifests"), { recursive: true });
    writeFileSync(join(target, "manifests", "sha256-000000000000.json"), "{}\n");

    const result = run(source, target);
    expect(result.exitCode).toBe(0);
    expect(names(target)).toContain("status-page.current.js");
    expect(names(target)).toContain("status-page.current.css");
    expect(names(target)).toContain("status-page.previous.js");
    expect(names(target)).toContain("status-page.previous.css");
    expect(names(target)).toContain("status-page.oldest.js");
    expect(readFileSync(join(target, "status-page.oldest.js"), "utf8")).toContain("keep me");

    // Copy, not move: the source still holds every asset.
    for (const name of names(join(source, "assets"))) {
      expect({ name, source: existsSync(join(source, "assets", name)) }).toEqual({ name, source: true });
    }

    // One immutable manifest per build, and the old manifest is untouched.
    expect(existsSync(join(target, "manifests", "sha256-aaaaaaaaaaaa.json"))).toBe(true);
    expect(existsSync(join(target, "manifests", "sha256-000000000000.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")).buildId).toBe("sha256-aaaaaaaaaaaa");
  });

  test("two releases retain both manifests and every asset", () => {
    const target = tempDir("omp-status-assets-");
    directories.push(target);
    const first = sourceTree("sha256-111111111111", ["status-page.a.js", "status-page.a.css"]);
    const second = sourceTree(
      "sha256-222222222222",
      ["status-page.b.js", "status-page.b.css"],
      ["status-page.a.js", "status-page.a.css"],
    );
    expect(run(first, target).exitCode).toBe(0);
    expect(run(second, target).exitCode).toBe(0);

    const manifests = names(join(target, "manifests"));
    expect(manifests).toContain("sha256-111111111111.json");
    expect(manifests).toContain("sha256-222222222222.json");
    for (const name of ["status-page.a.js", "status-page.a.css", "status-page.b.js", "status-page.b.css"]) {
      expect({ name, exists: existsSync(join(target, name)) }).toEqual({ name, exists: true });
    }
  });

  test("is idempotent and rejects a missing manifest", () => {
    const source = sourceTree("sha256-333333333333", ["status-page.c.js", "status-page.c.css"]);
    const target = tempDir("omp-status-assets-");
    directories.push(target);
    expect(run(source, target).exitCode).toBe(0);
    const first = names(target);
    expect(run(source, target).exitCode).toBe(0);
    expect(names(target)).toEqual(first);

    const empty = tempDir("omp-status-empty-");
    directories.push(empty);
    const failed = run(empty, target);
    expect(failed.exitCode).not.toBe(0);
  });

  test("requires --to", () => {
    const result = Bun.spawnSync(["bun", SCRIPT], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("--to is required");
  });
});
