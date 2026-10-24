// The browser view of the router: a status page at GET / and its assets.
//
// The page is rendered on the server from the same status data as the JSON
// endpoint, so it shows the full state on first paint, with or without
// JavaScript. Its stylesheet and script are same-origin files under
// ASSET_PREFIX; the script refreshes the view from the JSON every few seconds.
// The display model (status-page/view.js) is shared by both sides, so they
// cannot drift apart. Every value is HTML-escaped here and assigned with
// textContent in the browser; the CSP allows only same-origin style, script
// and fetches.

import { readFileSync } from "node:fs";
import { describeStatus, relative } from "./status-page/view.js";

/** Where the page is served. */
export const STATUS_PAGE_PATH = "/";
/** Public prefix of the page's own static files. */
export const ASSET_PREFIX = "/assets/lazy-status";

const PAGE_DIR = new URL("./status-page/", import.meta.url);
const TEMPLATE = readFileSync(new URL("index.html", PAGE_DIR), "utf8");

/** The only files served under ASSET_PREFIX, with their types. */
const ASSET_TYPES = {
  "style.css": "text/css; charset=utf-8",
  "client.js": "text/javascript; charset=utf-8",
  "view.js": "text/javascript; charset=utf-8",
  "labels.js": "text/javascript; charset=utf-8",
};
const ASSETS = new Map(
  Object.entries(ASSET_TYPES).map(([name, type]) => [
    `${ASSET_PREFIX}/${name}`,
    { body: readFileSync(new URL(name, PAGE_DIR), "utf8"), type },
  ]),
);

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const COMMON_HEADERS = {
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escape text for an HTML text or attribute position. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** A tag with escaped text; `attrs` values are escaped, `inner` must already be HTML. */
function tag(name, attrs = {}, inner = "") {
  const attributes = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join("");
  return `<${name}${attributes}>${inner}</${name}>`;
}
const text = (name, value, attrs) => tag(name, attrs, escapeHtml(value));

function renderRow(row, nowMs) {
  const unit =
    text("span", row.unit, { class: "unit" }) +
    (row.active ? text("span", "首选", { class: "tag" }) : "") +
    (row.load ? text("span", `并发 ${row.load}`, { class: "tag load" }) : "");
  const classes = row.active ? "active" : "";
  return tag(
    "tr",
    { class: classes },
    [
      text("td", row.n, { class: "dim" }),
      tag("td", {}, unit),
      text("td", row.model, { class: "mono" }),
      text("td", row.effort),
      text("td", row.intelligence),
      text("td", row.rating, { class: "mono" }),
      text("td", row.rd, { class: "mono" }),
      text("td", row.routingScore, { class: "mono" }),
      text("td", row.ttft, { class: "mono" }),
      text("td", row.speed, { class: "mono" }),
      text("td", row.total, { class: "mono" }),
      tag("td", {}, text("span", row.health.text, { class: `badge b-${row.health.key}` })),
      text("td", row.reason ?? "—", { class: row.reason ? "" : "dim" }),
      text("td", relative(row.coolingSince, nowMs), { class: "dim", "data-since": row.coolingSince ?? "" }),
      text("td", relative(row.nextProbeAt, nowMs), { "data-until": row.nextProbeAt ?? "" }),
    ].join(""),
  );
}

const TABLE_HEAD =
  "<thead><tr><th>#</th><th>单元</th><th>模型</th><th>推理强度</th><th>智力</th><th>Rating</th><th>RD</th><th>路由分</th><th>首字延迟</th><th>生成速度</th><th>总耗时</th><th>状态</th><th>冷却原因</th><th>冷却开始</th><th>下次探测</th></tr></thead>";

function renderCard(route, nowMs) {
  const heading = tag(
    "h2",
    {},
    text("span", route.title, { class: "title" }) + text("small", route.sub, { class: "sub" }),
  );
  const rows = route.rows.map((row) => renderRow(row, nowMs)).join("");
  const table = tag("div", { class: "scroll" }, tag("table", {}, `${TABLE_HEAD}${tag("tbody", {}, rows)}`));
  const other = tag(
    "details",
    {},
    text("summary", route.other.summary) + tag("ol", {}, route.other.items.map((item) => text("li", item)).join("")),
  );
  return tag("div", { class: "card" }, heading + table + other);
}

const MODELS_HEAD =
  "<thead><tr><th>模型</th><th>首字延迟</th><th>生成速度</th><th>总耗时</th><th>样本</th><th>补全样本</th><th>输出 tokens</th><th>数据覆盖</th></tr></thead>";

/** The per-model latency and speed table, over the rolling window. */
function renderModels(models, nowMs) {
  const rows = models
    .map((row) =>
      tag(
        "tr",
        {},
        [
          text("td", row.model, { class: "mono" }),
          text("td", row.ttft, { class: "mono" }),
          text("td", row.speed, { class: "mono" }),
          text("td", row.total, { class: "mono" }),
          text("td", row.samples, { class: "dim" }),
          text("td", row.imputed, { class: "dim" }),
          text("td", row.tokens, { class: "dim" }),
          text("td", row.coverage, { class: "dim" }),
        ].join(""),
      ),
    )
    .join("");
  const body = models.length > 0 ? rows : text("tr", {}, text("td", "近 30 分钟还没有样本", { class: "dim" }));
  const table = tag("div", { class: "scroll" }, tag("table", {}, `${MODELS_HEAD}${tag("tbody", {}, body)}`));
  return tag(
    "div",
    { class: "card" },
    tag(
      "h2",
      {},
      text("span", "模型延迟与速度", { class: "title" }) +
        text("small", "近 30 分钟滚动窗口 · 用户中断按右删失贝叶斯估计完成态；路由采用 Glicko-like Rating/RD 加权", { class: "sub" }),
    ) + table,
  );
}

/**
 * The full page for a status document.
 * @param {any} status the router's status view
 * @param {{statusPath: string, nowMs?: number}} options
 */
export function renderStatusPage(status, { statusPath, nowMs = Date.now() }) {
  const view = describeStatus(status);
  const fields = {
    statusPath: escapeHtml(statusPath),
    assets: escapeHtml(ASSET_PREFIX),
    periodKey: escapeHtml(view.period.key),
    period: escapeHtml(view.period.text),
    local: escapeHtml(view.local),
    day: escapeHtml(view.day),
    calendar: escapeHtml(view.calendar),
    nextAt: escapeHtml(view.next?.at ?? ""),
    nextSuffix: escapeHtml(view.next?.suffix ?? ""),
    next: escapeHtml(view.next ? relative(view.next.at, nowMs) + view.next.suffix : "—"),
    updatedAt: escapeHtml(view.updatedAt ?? ""),
    affinity: escapeHtml(view.affinity),
    routes: view.routes.map((route) => renderCard(route, nowMs)).join(""),
    models: renderModels(view.models, nowMs),
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key) => fields[key] ?? match);
}

/**
 * Handlers for the page and its assets; undefined for any other path.
 * @param {{statusPath: string, statusView: () => any}} options
 * @returns {(method: string, pathname: string) => Response|undefined}
 */
export function createStatusPage({ statusPath, statusView }) {
  return (method, pathname) => {
    if (method !== "GET" && method !== "HEAD") return undefined;
    const respond = (body, type, extra = {}) =>
      new Response(method === "HEAD" ? null : body, {
        status: 200,
        headers: { "content-type": type, ...COMMON_HEADERS, ...extra },
      });
    if (pathname === STATUS_PAGE_PATH) {
      return respond(renderStatusPage(statusView(), { statusPath }), "text/html; charset=utf-8", {
        "content-security-policy": CONTENT_SECURITY_POLICY,
        "cache-control": "no-store",
      });
    }
    const asset = ASSETS.get(pathname);
    return asset ? respond(asset.body, asset.type) : undefined;
  };
}
