#!/usr/bin/env bun
// Copy the committed status-page assets into the shared deployment directory.
//
// The gateway package is replaced atomically, but a browser tab may still hold
// the previous build. The deployment directory is therefore additive:
//
//   * copy the current build's `assets` and `retained` files;
//   * keep every file already there (never delete, never move);
//   * keep every manifest snapshot already there, and add this build's;
//   * leave the source `dist` untouched.
//
// Usage:
//   bun scripts/deploy-status-assets.mjs --to /srv/omp/status-assets
//   bun scripts/deploy-status-assets.mjs --from lib/router/status-page/dist --to /srv/omp/status-assets

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_SOURCE = join(REPO_ROOT, "lib", "router", "status-page", "dist");

function usage(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.stderr.write("usage: bun scripts/deploy-status-assets.mjs [--from <dist>] --to <asset-dir>\n");
  process.exit(2);
}

/** Read `--name value` and `--name=value`, rejecting unknown flags. */
function parseArgs(argv) {
  const options = { from: DEFAULT_SOURCE, to: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const [name, inline] = token.split("=", 2);
    if (name !== "--from" && name !== "--to") usage(`unknown argument: ${token}`);
    const value = inline ?? argv[(index += 1)];
    if (typeof value !== "string" || value === "") usage(`${name} needs a path`);
    if (value.startsWith("--")) usage(`${name} needs a path`);
    options[name.slice(2)] = value;
  }
  if (!options.to) usage("--to is required");
  return options;
}

function fail(message) {
  process.stderr.write(`deploy-status-assets: ${message}\n`);
  process.exit(1);
}

function readManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  if (manifest?.schema !== 1 || typeof manifest.buildId !== "string" || manifest.buildId === "") {
    fail(`${path} is not a status-page manifest`);
  }
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.retained)) {
    fail(`${path} has no assets/retained arrays`);
  }
  return manifest;
}

function names(manifest) {
  return [...new Set([...manifest.assets, ...manifest.retained])].filter(
    (name) => typeof name === "string" && name !== "" && !name.includes("/") && !name.includes("\\"),
  );
}

function copyIfPresent(source, target, name, copied, skipped) {
  const from = join(source, "assets", name);
  const to = join(target, name);
  if (!existsSync(from)) {
    skipped.push(name);
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied.push(name);
}

function main() {
  const { from, to } = parseArgs(process.argv.slice(2));
  const source = resolve(from);
  const target = resolve(to);
  const manifestPath = join(source, "manifest.json");
  if (!existsSync(manifestPath)) fail(`no manifest at ${manifestPath}; run bun run build:status-page`);
  const manifest = readManifest(manifestPath);
  mkdirSync(target, { recursive: true });

  const copied = [];
  const skipped = [];
  for (const name of names(manifest)) copyIfPresent(source, target, name, copied, skipped);

  // Keep one immutable manifest file per build next to the assets. The script
  // never removes an older one: rollback evidence must outlive two releases.
  const manifests = join(target, "manifests");
  mkdirSync(manifests, { recursive: true });
  const manifestCopy = join(manifests, `${manifest.buildId}.json`);
  if (!existsSync(manifestCopy)) writeFileSync(manifestCopy, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    `deploy-status-assets: build ${manifest.buildId}; copied ${copied.length} asset(s); kept ${skipped.length} missing/retained reference(s)\n`,
  );
  for (const name of skipped) process.stdout.write(`  missing in source: ${name}\n`);
}

main();
