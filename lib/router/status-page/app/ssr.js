import Framework7 from "framework7";
import Framework7Svelte from "framework7-svelte";
import { render } from "svelte/server";
import StatusApp from "./StatusApp.svelte";

Framework7.use(Framework7Svelte);

const DEFAULT_ASSET_BASE = "/assets/lazy-status";

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * JSON inside an inert <template> is parsed as HTML text, not as a raw-text
 * element. Escaping `<` also prevents `</template>`; escaping `&` preserves
 * entity-looking payloads byte-for-byte after JSON.parse.
 */
export function escapeTemplateJson(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function normalizeBase(basePath) {
  if (typeof basePath !== "string" || basePath.length === 0) return "";
  const trimmed = basePath.replace(/\/+$/, "");
  if (!trimmed.startsWith("/")) throw new Error(`status base path must start with "/": ${basePath}`);
  return trimmed;
}

function joinUrl(basePath, path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`status URL path must start with "/": ${path}`);
  }
  return `${basePath}${path}`;
}

function assetUrl(basePath, assetBasePath, name) {
  const base = typeof assetBasePath === "string" && assetBasePath.length > 0 ? assetBasePath : DEFAULT_ASSET_BASE;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/.test(name)) {
    throw new Error(`status asset name is not allowlisted: ${name}`);
  }
  return joinUrl(basePath, `${base.replace(/\/+$/, "")}/${name}`);
}

function resolveAssets(options) {
  const manifest = options.manifest && typeof options.manifest === "object" ? options.manifest : {};
  const buildVersion = options.buildVersion ?? manifest.buildId;
  if (typeof buildVersion !== "string" || buildVersion.length === 0) {
    throw new Error("renderStatusDocument requires buildVersion or manifest.buildId");
  }

  const entry = options.entry ?? manifest.entry;
  if (typeof entry !== "string" || entry.length === 0) {
    throw new Error("renderStatusDocument requires an entry asset");
  }

  const css = Array.isArray(options.css) ? options.css : (manifest.css ?? []);
  if (!Array.isArray(css) || css.some((name) => typeof name !== "string")) {
    throw new Error("renderStatusDocument css must be an array of asset names");
  }

  const basePath = normalizeBase(options.basePath);
  const entryUrl = options.entryUrl ?? assetUrl(basePath, options.assetBasePath, entry);
  const styleUrls =
    Array.isArray(options.styleUrls) && options.styleUrls.length > 0
      ? options.styleUrls
      : css.map((name) => assetUrl(basePath, options.assetBasePath, name));

  const statusPath = options.statusPath ?? joinUrl(basePath, "/v1/lazy/status");
  const resetPath = options.resetPath ?? joinUrl(basePath, "/v1/lazy/token-totals/reset");
  if (!statusPath.startsWith("/") || !resetPath.startsWith("/")) {
    throw new Error("status bootstrap paths must be absolute");
  }

  return { buildVersion, entryUrl, styleUrls, statusPath, resetPath, basePath };
}

/**
 * Build the complete status document. Every value is server-rendered; the
 * only bootstrap payload is an inert JSON template. No inline script exists,
 * so `script-src 'self'` needs no exception.
 */
export function renderStatusDocument(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new TypeError("renderStatusDocument requires a snapshot");
  }
  if (typeof snapshot.snapshotId !== "string" || typeof snapshot.generatedAt !== "string") {
    throw new TypeError("snapshot must carry snapshotId and generatedAt");
  }

  const assets = resolveAssets({
    ...options,
    buildVersion: options.buildVersion ?? options.manifest?.buildId ?? snapshot.buildVersion,
  });
  const nowMs = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(nowMs)) throw new TypeError("snapshot.generatedAt is not a valid ISO timestamp");

  const rendered = render(StatusApp, {
    props: {
      snapshot,
      nowMs,
      connection: { state: "server", lastGoodAt: snapshot.generatedAt, error: null },
      jsReady: false,
      versionMismatch: null,
    },
  });

  const snapshotId = escapeAttribute(snapshot.snapshotId);
  const styles = assets.styleUrls
    .map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}">`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN" class="md" data-js="off">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <meta name="robots" content="noindex, nofollow">
    <meta name="status-build" content="${escapeAttribute(assets.buildVersion)}">
    <meta name="status-snapshot" content="${snapshotId}">
    <meta name="lazy-status-path" content="${escapeAttribute(assets.statusPath)}">
    <meta name="lazy-reset-path" content="${escapeAttribute(assets.resetPath)}">
    <title>Lazy 路由观测</title>
${styles}
  </head>
  <body class="status-body">
    <a class="status-skip" href="#main-content">跳到主要内容</a>
    <noscript>
      <p class="status-noscript">页面内容已完整呈现；实时刷新与累计统计重置需要 JavaScript。</p>
    </noscript>
    <div id="status-root" data-snapshot-id="${snapshotId}">${rendered.body}</div>
    <template id="status-snapshot">${escapeTemplateJson(snapshot)}</template>
    <script type="module" src="${escapeAttribute(assets.entryUrl)}"></script>
  </body>
</html>
`;
}
