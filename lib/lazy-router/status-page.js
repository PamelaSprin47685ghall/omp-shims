// The browser view of the router: a self-contained page served at GET /.
//
// The page is static. It carries no routing data of its own; its script
// fetches the public status JSON and renders it with textContent only. The one
// server-side value (the status path) is HTML-escaped into a meta tag, and a
// hash-based Content-Security-Policy allows exactly the inline style and
// script of this file, nothing else (no external hosts, no other inline code).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Where the page is served. */
export const STATUS_PAGE_PATH = "/";
const TEMPLATE_URL = new URL("./status-page.html", import.meta.url);
const INLINE_BLOCK = /<(script|style)>([\s\S]*?)<\/\1>/g;

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for an HTML text or attribute position. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** The CSP source for one inline block. */
function hashSource(content) {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

/**
 * Render the page and its security headers.
 * @param {{statusPath: string, template?: string}} options
 * @returns {{html: string, headers: Record<string, string>}}
 */
export function renderStatusPage({ statusPath, template = readFileSync(TEMPLATE_URL, "utf8") }) {
  const html = template.replaceAll("{{statusPath}}", escapeHtml(statusPath));
  const hashes = { script: [], style: [] };
  for (const [, kind, content] of html.matchAll(INLINE_BLOCK)) hashes[kind].push(hashSource(content));
  const policy = [
    "default-src 'none'",
    `script-src ${hashes.script.join(" ")}`,
    `style-src ${hashes.style.join(" ")}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return {
    html,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": policy,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  };
}

/**
 * A handler for GET/HEAD of the page. The page is rendered once; it never
 * changes while the process runs.
 * @param {{statusPath: string}} options
 */
export function createStatusPage({ statusPath }) {
  const { html, headers } = renderStatusPage({ statusPath });
  return (method) => new Response(method === "HEAD" ? null : html, { status: 200, headers });
}
