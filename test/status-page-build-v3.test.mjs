// Build and packaging contract for the committed status-page output.
//
// The gateway never builds at runtime: `dist/**` is committed, the manifest is
// the only asset source, and `--check` must prove freshness without writing it.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const DIST = join(ROOT, "lib", "router", "status-page", "dist");
const MANIFEST_PATH = join(DIST, "manifest.json");
const SSR_PATH = join(DIST, "server", "status-page.ssr.mjs");
const SNAPSHOT_FIXTURE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "status-snapshot-v3.json"), "utf8"));
const ASSET_NAME = /^status-page\.[A-Za-z0-9_-]+\.(js|css)$/;
const ASSET_URL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/;

function manifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

function assertFile(path) {
  expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  expect({ path, size: statSync(path).size > 0 }).toEqual({ path, size: true });
}

function listAssets() {
  if (!existsSync(join(DIST, "assets"))) return [];
  return readdirSync(join(DIST, "assets")).sort();
}

describe("manifest", () => {
  test("dist exists with a schema-1 manifest and the SSR bundle", () => {
    assertFile(MANIFEST_PATH);
    assertFile(SSR_PATH);
    const data = manifest();
    expect(data.schema).toBe(1);
    expect(data.buildId).toMatch(/^sha256-[0-9a-f]{12}$/);
    expect(data.entry).toMatch(ASSET_NAME);
    expect(data.entry.endsWith(".js")).toBe(true);
    expect(Array.isArray(data.css)).toBe(true);
    expect(data.css.length).toBe(1);
    expect(data.css[0]).toMatch(ASSET_NAME);
    expect(Array.isArray(data.assets)).toBe(true);
    for (const name of data.assets) expect(name).toMatch(ASSET_NAME);
    expect(Array.isArray(data.retained)).toBe(true);
    for (const name of data.retained) expect(name).toMatch(ASSET_NAME);
    expect(data.assets).toContain(data.entry);
    for (const name of data.css) expect(data.assets).toContain(name);
    expect(data.assets.length).toBe(new Set(data.assets).size);
    expect(data.retained.length).toBe(new Set(data.retained).size);
  });

  test("every manifest asset exists on disk and no orphan is served", () => {
    const data = manifest();
    for (const name of [...data.assets, ...data.retained]) {
      if (data.retained.includes(name) && !existsSync(join(DIST, "assets", name))) continue;
      assertFile(join(DIST, "assets", name));
    }
    const known = new Set([...data.assets, ...data.retained]);
    for (const name of listAssets()) expect({ name, known: known.has(name) }).toEqual({ name, known: true });
  });

  test("asset names are hashed and stable, with no query strings", () => {
    const data = manifest();
    for (const name of [...data.assets, ...data.retained]) {
      expect(name).toMatch(ASSET_URL_NAME);
      expect(name).not.toContain("?");
      expect(name).not.toContain("/");
    }
    expect(manifest().buildId).toBe(data.buildId);
  });

  test("no asset is inlined as a data URL and no source map ships", () => {
    for (const name of listAssets()) {
      const text = readFileSync(join(DIST, "assets", name), "utf8");
      expect({ name, dataUrl: /data:(?:text|application)\//.test(text) }).toEqual({ name, dataUrl: false });
      expect({ name, map: text.includes("sourceMappingURL") }).toEqual({ name, map: false });
    }
  });

  test("package.json ships the dist directory", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("lib/");
    expect(pkg.files).toContain("lib/router/status-page/dist/");
    expect(pkg.scripts["build:status-page"]).toBe("bun scripts/build-status-page.mjs");
    expect(pkg.scripts["build:status-page:check"]).toBe("bun scripts/build-status-page.mjs --check");
  });

  test("the release workflow checks the committed build before pack and publish", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
    const check = workflow.indexOf("bun run build:status-page:check");
    const pack = workflow.indexOf("npm pack --dry-run");
    const publish = workflow.indexOf("npm publish");
    expect(check).toBeGreaterThan(-1);
    expect(pack).toBeGreaterThan(check);
    expect(publish).toBeGreaterThan(pack);
  });

  test("the snapshot fixture is a complete StatusSnapshotV3", () => {
    expect(SNAPSHOT_FIXTURE.schemaVersion).toBe(3);
    expect(SNAPSHOT_FIXTURE.snapshotId).toMatch(/^snap_[0-9a-f]{16}$/);
    expect(SNAPSHOT_FIXTURE.buildVersion).toMatch(/^sha256-[0-9a-f]{12}$/);
    expect(Object.keys(SNAPSHOT_FIXTURE.metrics)).toContain("M27");
    expect(SNAPSHOT_FIXTURE.overview.primary.length).toBe(4);
  });
});

describe("SSR bundle", () => {
  test("has no bare Svelte/Framework7 import and no runtime build hook", () => {
    const source = readFileSync(SSR_PATH, "utf8");
    const importLines = source
      .split(/\r?\n/)
      .filter((line) => /^\s*import\b/.test(line) || /^\s*export\b[^;]*\bfrom\b/.test(line));
    const bare = importLines
      .map((line) => line.match(/["'](svelte|framework7|framework7-svelte)(?:\/[^"']*)?["']/))
      .filter(Boolean)
      .map((match) => match[1]);
    expect(bare).toEqual([]);
    expect(source).not.toMatch(/^\s*import\s*\(/m);
    expect(source).not.toMatch(/require\(["'](?:svelte|framework7|vite)/);
    expect(source).not.toContain("createServer");
  });

  test("imports and renders the fixture to a complete document", async () => {
    const { renderStatusDocument } = await import(pathToFileURL(SSR_PATH).href);
    expect(typeof renderStatusDocument).toBe("function");
    const html = renderStatusDocument(SNAPSHOT_FIXTURE, {
      basePath: "",
      statusPath: "/v1/lazy/status",
      resetPath: "/v1/lazy/token-totals/reset",
      assetBasePath: "/assets/lazy-status",
      buildVersion: manifest().buildId,
      manifest: manifest(),
      entry: manifest().entry,
      css: manifest().css,
      entryUrl: `/assets/lazy-status/${manifest().entry}`,
      styleUrls: manifest().css.map((name) => `/assets/lazy-status/${name}`),
    });
    expect(typeof html).toBe("string");
    expect(html).toContain("<html");
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('class="md"');
    expect((html.match(/id="status-root"/g) ?? []).length).toBe(1);
    expect((html.match(/id="status-snapshot"/g) ?? []).length).toBe(1);
    expect(html).toContain("data-snapshot-id");
    expect(html).toContain(SNAPSHOT_FIXTURE.snapshotId);
    expect(html).toMatch(/<meta[^>]+name="status-build"/);
    expect(html).toContain(manifest().buildId);
    expect(html).toContain("当前时段");
    expect(html).toContain("专业路由");
    expect(html).toContain("账号健康");
    expect(html).toContain("30 分钟");
    expect(html).toContain("<noscript");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toContain("{@html}");
  });

  test("two renders produce byte-identical HTML", async () => {
    const { renderStatusDocument } = await import(pathToFileURL(SSR_PATH).href);
    const options = {
      basePath: "/ops",
      statusPath: "/ops/v1/lazy/status",
      resetPath: "/ops/v1/lazy/token-totals/reset",
      assetBasePath: "/ops/assets/lazy-status",
      buildVersion: manifest().buildId,
      manifest: manifest(),
      entry: manifest().entry,
      css: manifest().css,
      entryUrl: `/ops/assets/lazy-status/${manifest().entry}`,
      styleUrls: manifest().css.map((name) => `/ops/assets/lazy-status/${name}`),
    };
    expect(renderStatusDocument(SNAPSHOT_FIXTURE, options)).toBe(renderStatusDocument(SNAPSHOT_FIXTURE, options));
  });
});

describe("freshness check", () => {
  test("build:status-page:check exits 0 and leaves dist untouched", () => {
    const before = listAssets().map((name) => ({
      name,
      at: statSync(join(DIST, "assets", name)).mtimeMs,
      hash: readFileSync(join(DIST, "assets", name)).toString("base64"),
    }));
    const result = Bun.spawnSync(["bun", "run", "build:status-page:check"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      // `bun test` sets NODE_ENV=test; the committed build is a production
      // build, so compare like CI does.
      env: { ...process.env, NODE_ENV: "production", TMPDIR: process.env.TMPDIR ?? "/tmp" },
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const after = listAssets().map((name) => ({
      name,
      at: statSync(join(DIST, "assets", name)).mtimeMs,
      hash: readFileSync(join(DIST, "assets", name)).toString("base64"),
    }));
    expect(after).toEqual(before);
  }, 180_000);
});
