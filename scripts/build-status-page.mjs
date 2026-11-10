import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = join(ROOT, "lib/router/status-page/app");
const DIST = join(ROOT, "lib/router/status-page/dist");
const TMP = join(ROOT, ".tmp/status-page");
const CHECK = process.argv.includes("--check");
const RUN_ID = `${process.pid}-${Date.now().toString(36)}`;

const CLIENT_CONFIG = join(APP, "vite.config.mjs");
const SSR_CONFIG = join(APP, "vite.ssr.config.mjs");

function fail(message) {
  console.error(`build-status-page: ${message}`);
  process.exit(1);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  if (await exists(root)) await walk(root);
  return found.sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function buildClient(outDir) {
  await rm(outDir, { recursive: true, force: true });
  await viteBuild({
    configFile: CLIENT_CONFIG,
    root: APP,
    build: { outDir, emptyOutDir: true },
  });
}

async function buildServer(outDir) {
  await rm(outDir, { recursive: true, force: true });
  await viteBuild({
    configFile: SSR_CONFIG,
    root: APP,
    build: { outDir, emptyOutDir: true },
  });
}

/**
 * Rolldown emits `// node_modules/...` / `// lib/...` source markers. They
 * encode the build host's dependency layout, so remove them before hashing;
 * otherwise the same source yields a different buildId from another checkout.
 */
function stripSourcePathComments(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*\/\/\s*(?:node_modules\/|lib\/|\.{1,2}\/|[A-Za-z]:[\\/]|\/)/.test(line))
    .join("\n");
}

async function collectClientAssets(clientDir) {
  const assetDir = join(clientDir, "assets");
  const files = await listFiles(assetDir);
  const names = files.map((file) => relative(assetDir, file));
  const js = names.filter((name) => name.endsWith(".js"));
  const css = names.filter((name) => name.endsWith(".css")).sort();
  const other = names.filter((name) => !name.endsWith(".js") && !name.endsWith(".css"));

  if (js.length !== 1) {
    fail(`client build must emit exactly one JS entry, found ${js.length}: ${js.join(", ")}`);
  }
  if (css.length === 0) {
    fail("client build emitted no CSS file");
  }
  if (other.length > 0) {
    fail(`client build emitted unexpected assets: ${other.join(", ")}`);
  }

  return { entry: js[0], css, assetDir };
}

/**
 * Framework7's core CSS carries an embedded icon font. The status page uses
 * no icon glyphs, the CSP has no font-src, and the build contract forbids data
 * URLs. Remove that face and rename the CSS so its immutable hash matches the
 * bytes actually served.
 */
async function stripEmbeddedFonts(assetDir, cssNames) {
  const normalized = [];
  for (const name of cssNames) {
    const path = join(assetDir, name);
    const source = await readFile(path, "utf8");
    const stripped = stripEmbeddedFontFaces(source);
    if (/url\((["']?)data:/i.test(stripped)) {
      fail(`CSS still contains a data URL after font stripping: ${name}`);
    }
    const digest = sha256(stripped).slice(0, 8);
    const nextName = name.replace(/\.[^.]*\.css$/, `.${digest}.css`);
    if (nextName !== name) await rm(path, { force: true });
    await writeFile(join(assetDir, nextName), stripped);
    normalized.push(nextName);
  }
  return normalized.sort();
}

function stripEmbeddedFontFaces(source) {
  return source.replace(/@font-face\s*\{[^{}]*\}/g, (block) => (/url\((["']?)data:/i.test(block) ? "" : block));
}

function retentionPlan(oldManifest, newAssets) {
  if (!oldManifest || !Array.isArray(oldManifest.assets)) return [];
  const oldAssets = oldManifest.assets.filter((name) => typeof name === "string");
  const unchanged = oldAssets.length === newAssets.size && oldAssets.every((name) => newAssets.has(name));
  if (unchanged) {
    return (oldManifest.retained ?? []).filter((name) => typeof name === "string").sort();
  }
  return oldAssets.filter((name) => !newAssets.has(name)).sort();
}

async function copyRetained(retained, candidateAssets) {
  const copied = [];
  const seen = new Set();
  for (const name of retained) {
    if (seen.has(name)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/.test(name)) continue;
    const source = join(DIST, "assets", name);
    if (!(await exists(source))) {
      console.warn(`build-status-page: retained asset missing from previous dist: ${name}`);
      continue;
    }
    const destination = join(candidateAssets, name);
    if (name.endsWith(".css")) {
      await writeFile(destination, stripEmbeddedFontFaces(await readFile(source, "utf8")));
    } else {
      await cp(source, destination);
    }
    seen.add(name);
    copied.push(name);
  }
  return copied.sort();
}

async function copyRetainedAssets(oldManifest, newAssets, candidateAssets) {
  const retained = retentionPlan(oldManifest, newAssets);
  return copyRetained(retained, candidateAssets);
}

async function buildCandidate() {
  const work = join(TMP, CHECK ? `check-${RUN_ID}` : `build-${RUN_ID}`);
  const clientDir = join(work, "client");
  const serverDir = join(work, "server");
  const candidate = join(work, "dist");

  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });

  await buildClient(clientDir);
  await buildServer(serverDir);

  const { entry, css, assetDir } = await collectClientAssets(clientDir);
  const normalizedCss = await stripEmbeddedFonts(assetDir, css);
  const serverFile = join(serverDir, "status-page.ssr.mjs");
  if (!(await exists(serverFile))) {
    fail("SSR build did not emit status-page.ssr.mjs");
  }
  const serverSource = await readFile(serverFile, "utf8");
  await writeFile(serverFile, stripSourcePathComments(serverSource));

  const candidateAssets = join(candidate, "assets");
  const candidateServer = join(candidate, "server");
  await mkdir(candidateAssets, { recursive: true });
  await mkdir(candidateServer, { recursive: true });

  for (const name of [entry, ...normalizedCss]) {
    await cp(join(assetDir, name), join(candidateAssets, name));
  }
  await cp(serverFile, join(candidateServer, "status-page.ssr.mjs"));

  const hashed = [
    { name: "server/status-page.ssr.mjs", path: join(candidateServer, "status-page.ssr.mjs") },
    { name: `assets/${entry}`, path: join(candidateAssets, entry) },
    ...normalizedCss.map((name) => ({ name: `assets/${name}`, path: join(candidateAssets, name) })),
  ];
  hashed.sort((a, b) => a.name.localeCompare(b.name));
  const digestInput = [];
  for (const item of hashed) {
    digestInput.push(`${item.name}\0${sha256(await readFile(item.path))}`);
  }
  const buildId = `sha256-${sha256(digestInput.join("\n")).slice(0, 12)}`;

  const oldManifest = await readJson(join(DIST, "manifest.json"));
  const newAssets = new Set([entry, ...normalizedCss]);
  const retained = await copyRetainedAssets(oldManifest, newAssets, candidateAssets);

  const manifest = {
    assets: [entry, ...normalizedCss],
    buildId,
    css: normalizedCss,
    entry,
    retained,
    schema: 1,
  };
  await writeFile(join(candidate, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return { candidate, manifest, work };
}

async function compare(candidate) {
  if (!(await exists(DIST))) {
    fail("dist does not exist; run bun run build:status-page first");
  }

  const candidateFiles = await listFiles(candidate);
  const distFiles = await listFiles(DIST);
  const toRel = (root, file) => relative(root, file).split("\\").join("/");
  const candidateMap = new Map(candidateFiles.map((file) => [toRel(candidate, file), file]));
  const distMap = new Map(distFiles.map((file) => [toRel(DIST, file), file]));

  const problems = [];
  for (const name of candidateMap.keys()) {
    if (!distMap.has(name)) problems.push(`missing from dist: ${name}`);
  }
  for (const name of distMap.keys()) {
    if (!candidateMap.has(name)) problems.push(`extra in dist: ${name}`);
  }

  for (const [name, candidateFile] of candidateMap) {
    const distFile = distMap.get(name);
    if (!distFile) continue;
    const a = sha256(await readFile(candidateFile));
    const b = sha256(await readFile(distFile));
    if (a !== b) problems.push(`content differs: ${name}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`build-status-page: ${problem}`);
    fail(`committed dist is stale (${problems.length} difference${problems.length === 1 ? "" : "s"})`);
  }

  const manifest = await readJson(join(DIST, "manifest.json"));
  console.log(`build-status-page: dist is fresh (${manifest?.buildId ?? "unknown build"})`);
}

async function publish(candidate) {
  const next = join(TMP, `dist.next-${RUN_ID}`);
  const previous = join(TMP, `dist.previous-${RUN_ID}`);
  await rm(next, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  await rename(candidate, next);

  const hadDist = await exists(DIST);
  if (hadDist) await rename(DIST, previous);
  try {
    await rename(next, DIST);
  } catch (error) {
    if (hadDist) await rename(previous, DIST);
    throw error;
  }
  if (hadDist) await rm(previous, { recursive: true, force: true });
}

async function report(candidate, manifest) {
  const files = await listFiles(candidate);
  let total = 0;
  const rows = [];
  for (const file of files) {
    const bytes = (await stat(file)).size;
    total += bytes;
    rows.push(`${relative(candidate, file).split("\\").join("/")}  ${bytes} B`);
  }
  console.log(`build-status-page: build ${manifest.buildId}`);
  for (const row of rows) console.log(`  ${row}`);
  console.log(`  total ${total} B (${(total / 1024).toFixed(1)} KiB)`);
}

async function main() {
  await mkdir(TMP, { recursive: true });
  const { candidate, manifest } = await buildCandidate();

  if (CHECK) {
    await compare(candidate);
    return;
  }

  await report(candidate, manifest);
  await publish(candidate);
  console.log("build-status-page: wrote lib/router/status-page/dist");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
