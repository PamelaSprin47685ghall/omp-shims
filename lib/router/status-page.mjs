// Server-rendered status page.
//
// One snapshot produces one document. The Svelte/Framework7 tree is compiled
// at release time into `status-page/dist/`, so the gateway never loads a
// compiler or a source component. This module owns the manifest, the hashed
// asset allowlist, the exact response headers, and the base-path-aware URLs
// that the hydration client reads back from the document.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderStatusDocument } from "./status-page/dist/server/status-page.ssr.mjs";

export { renderStatusDocument };

export const STATUS_PAGE_PATH = "/";
export const ASSET_PREFIX = "/assets/lazy-status";
export const DEFAULT_STATUS_PATH = "/v1/lazy/status";
export const DEFAULT_RESET_PATH = "/v1/lazy/token-totals/reset";

/** The exact status-page CSP. Inline styles are required by Framework7. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const DIST_BASE = new URL("./status-page/dist/", import.meta.url);
const MANIFEST_URL = new URL("manifest.json", DIST_BASE);
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/;

const HTML_HEADERS = Object.freeze({
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
});

const ASSET_HEADERS = Object.freeze({
  "cache-control": "public, max-age=31536000, immutable",
  "x-content-type-options": "nosniff",
});

const NOT_FOUND_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
});

function manifestError(error) {
  return new Error("status page build is missing or invalid; run bun run build:status-page", { cause: error });
}

/** Keep one manifest name bare and inside the asset allowlist. */
function assetName(value) {
  if (typeof value !== "string") throw manifestError(new TypeError("asset name must be a string"));
  const bare = value.startsWith("assets/") ? value.slice("assets/".length) : value;
  if (!ASSET_NAME.test(bare)) throw manifestError(new TypeError(`invalid manifest asset name: ${value}`));
  return bare;
}

function readManifest() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(MANIFEST_URL, "utf8"));
  } catch (error) {
    throw manifestError(error);
  }
  if (parsed?.schema !== 1) throw manifestError(new TypeError("manifest schema must be 1"));
  if (typeof parsed.buildId !== "string" || parsed.buildId === "") {
    throw manifestError(new TypeError("manifest buildId must be a non-empty string"));
  }
  const entry = assetName(parsed.entry);
  if (!entry.endsWith(".js")) throw manifestError(new TypeError("manifest entry must be JavaScript"));
  const css = Array.isArray(parsed.css) ? parsed.css.map(assetName) : [];
  const assets = Array.isArray(parsed.assets) ? parsed.assets.map(assetName) : [];
  const retained = Array.isArray(parsed.retained) ? parsed.retained.map(assetName) : [];
  return Object.freeze({
    ...parsed,
    entry,
    css: Object.freeze(css),
    assets: Object.freeze(assets),
    retained: Object.freeze(retained),
  });
}

function assetType(name) {
  return name.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
}

function readBuiltAsset(name) {
  try {
    return readFileSync(new URL(`assets/${name}`, DIST_BASE));
  } catch {
    return undefined;
  }
}

/** The build manifest and the bytes that the gateway can serve without disk I/O. */
export const STATUS_MANIFEST = readManifest();
export const STATUS_BUILD_VERSION = STATUS_MANIFEST.buildId;

const BUILT_ASSETS = new Map();
for (const name of new Set([
  ...STATUS_MANIFEST.assets,
  STATUS_MANIFEST.entry,
  ...STATUS_MANIFEST.css,
  ...STATUS_MANIFEST.retained,
])) {
  const body = readBuiltAsset(name);
  if (body) BUILT_ASSETS.set(name, { body, type: assetType(name) });
}

function notFound(method) {
  return new Response(method === "HEAD" ? null : "Not Found", { status: 404, headers: NOT_FOUND_HEADERS });
}

/** The exact options accepted by `renderStatusDocument`. */
export function statusPageOptions({
  basePath = "",
  statusPath = DEFAULT_STATUS_PATH,
  resetPath = DEFAULT_RESET_PATH,
  buildVersion = STATUS_BUILD_VERSION,
} = {}) {
  const prefix = `${basePath}${ASSET_PREFIX}`;
  return Object.freeze({
    basePath,
    statusPath: `${basePath}${statusPath}`,
    resetPath: `${basePath}${resetPath}`,
    assetBasePath: ASSET_PREFIX,
    buildVersion,
    manifest: STATUS_MANIFEST,
    entry: STATUS_MANIFEST.entry,
    css: STATUS_MANIFEST.css,
    entryUrl: `${prefix}/${STATUS_MANIFEST.entry}`,
    styleUrls: STATUS_MANIFEST.css.map((name) => `${prefix}/${name}`),
  });
}

/** Render one document from one snapshot. Kept as a named export for tests. */
export function renderStatusPage(snapshot, options = {}) {
  return renderStatusDocument(snapshot, statusPageOptions(options));
}

/**
 * Build the page and asset handler.
 *
 * `pathname` is already stripped of the external mount prefix. Unknown names
 * under the asset prefix return 404 and never fall through to the gateway.
 *
 * @param {{statusView: () => object, assetDir?: string|null, statusPath?: string, resetPath?: string}} options
 */
export function createStatusPage({ statusView, assetDir = null, statusPath, resetPath } = {}) {
  if (typeof statusView !== "function") throw new TypeError("createStatusPage needs a statusView function");
  const externalAssets = new Map();

  function externalAsset(name) {
    if (typeof assetDir !== "string" || !ASSET_NAME.test(name)) return undefined;
    if (externalAssets.has(name)) return externalAssets.get(name) || undefined;
    let asset;
    try {
      asset = { body: readFileSync(join(assetDir, name)), type: assetType(name) };
    } catch {
      asset = undefined;
    }
    externalAssets.set(name, asset);
    return asset;
  }

  function serveAsset(method, pathname) {
    const name = pathname.startsWith(`${ASSET_PREFIX}/`) ? pathname.slice(ASSET_PREFIX.length + 1) : "";
    if (!ASSET_NAME.test(name)) return notFound(method);
    const asset = BUILT_ASSETS.get(name) ?? externalAsset(name);
    if (!asset) return notFound(method);
    return new Response(method === "HEAD" ? null : asset.body, {
      status: 200,
      headers: { ...ASSET_HEADERS, "content-type": asset.type },
    });
  }

  return function statusPage(method, pathname, { basePath = "" } = {}) {
    if (method !== "GET" && method !== "HEAD") return undefined;
    if (pathname === STATUS_PAGE_PATH) {
      const options = statusPageOptions({ basePath, statusPath, resetPath });
      const document = renderStatusDocument(statusView(), options);
      return new Response(method === "HEAD" ? null : document, { status: 200, headers: HTML_HEADERS });
    }
    if (pathname === ASSET_PREFIX || pathname.startsWith(`${ASSET_PREFIX}/`)) return serveAsset(method, pathname);
    return undefined;
  };
}
