// Server-rendered operations dashboard. Reads are public; reset requires bearer auth.
// All dynamic text and attributes are escaped. No inline scripts or styles.
import { readFileSync } from "node:fs";
import { describeStatus, relative } from "./status-page/view.js";

export const STATUS_PAGE_PATH = "/";
export const ASSET_PREFIX = "/assets/lazy-status";
const BASE = new URL("./status-page/", import.meta.url);
const TEMPLATE = readFileSync(new URL("index.html", BASE), "utf8");
const TYPE = Object.freeze({
  "style.css": "text/css; charset=utf-8",
  "client.js": "text/javascript; charset=utf-8",
});
const ASSETS = new Map(Object.entries(TYPE).map(([file, type]) =>
  [ASSET_PREFIX + "/" + file, { type, body: readFileSync(new URL(file, BASE), "utf8") }]));
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'",
  "connect-src 'self'", "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");
const HEADERS = {
  "cache-control": "no-cache",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const CODES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => CODES[char]);
const txt = (value) => escapeHtml(value);
const element = (tag, content = "", className = "") =>
  "<" + tag + (className ? ' class="' + txt(className) + '"' : "") + ">" + content + "</" + tag + ">";
const fmt = (n) => Number.isFinite(n) ? new Intl.NumberFormat("zh-CN").format(n) : "—";
const fmtTokens = (n) => Number.isFinite(n) ? (n / 1_000_000).toFixed(1) + " M" : "—";
// Fixed USD/CNY reference rate for displayed API-price equivalents only.
const USD_CNY = 6.6620;
const fmtCny = (usd) => Number.isFinite(usd) ? "CNY ¥" + (usd * USD_CNY).toFixed(2) : "—";
function renderOverview(view, totals) {
  const stats = view.stats;
  const data = totals?.totals ?? {};
  const coverage = totals?.coverage ?? {};
  const since = totals?.since ? totals.since.slice(0, 16).replace("T", " ") + " UTC" : "尚未启用计数器";
  const entry = (label, value, details, token = false) => element("article",
    element("span", txt(label)) + element("strong", txt(value))
    + element("small", txt(details)), "metric" + (token ? " token" : ""));
  const official = totals?.officialValue;
  const money = (n) => Number.isFinite(n) ? "USD $" + n.toFixed(4) : "—";
  const value = official ? money(official.valueUsd) : "—";
  const cny = official ? fmtCny(official.valueUsd) : "—";
  const valueCoverage = official ? "官方定价覆盖 " + official.pricedModels + " / " + official.totalModels
    + " 模型" + (official.unpricedModels ? " · 有未定价模型" : "") : "尚无可用价目";
  return [
    entry("Lazy 路由", stats.routes, stats.models + " 个实际模型"),
    entry("可用账号通道", stats.live, "冷却 " + stats.cool + " · 总计 " + stats.units),
    entry("路由前缀亲和命中率", view.affinity, "仅 Lazy 路由请求；与上游缓存 Token 无关"),
    entry("累计未缓存输入", fmtTokens(data.uncachedInput), "上报 " + fmt(coverage.uncachedInput ?? 0)
      + " / " + fmt(coverage.complete ?? 0) + " 次 · " + since, true),
    entry("累计缓存输入", fmtTokens(data.cachedInput), "上报 " + fmt(coverage.cachedInput ?? 0)
      + " / " + fmt(coverage.complete ?? 0) + " 次 · " + since, true),
    entry("累计输出", fmtTokens(data.output), "上报 " + fmt(coverage.output ?? 0)
      + " / " + fmt(coverage.complete ?? 0) + " 次 · " + since, true),
    entry("累计官方 API 价格等效价值", value, cny + " · " + valueCoverage + " · " + since, true)
  ].join("");
}
function renderOfficialValueDetails(totals) {
  const value = totals?.officialValue;
  if (!value) return "";
  const fmtUsd = (x) => Number.isFinite(x) ? "USD $" + x.toFixed(6) : "未定价";
  const headers = ["模型", "等效价值", "官方参考单价（每百万 Token：未缓存 / 缓存 / 输出）", "参考价格来源"];
  const head = element("thead", element("tr", headers.map((h) => element("th", txt(h))).join("")));
  const rows = value.models.map((row) => {
    const rate = row.perMillion;
    const cell = rate ? [rate.uncachedInput, rate.cachedInput, rate.output].map((x) => "$" + x).join(" / ") : "—";
    const source = row.source ? '<a href="' + txt(row.source)
      + '" rel="noopener noreferrer" target="_blank">官方价格</a>' : "—";
    const equivalent = row.priced ? fmtUsd(row.valueUsd) + " / " + fmtCny(row.valueUsd) : "未定价";
    return element("tr", element("td", txt(row.model)) + element("td", txt(equivalent))
      + element("td", txt(cell + " · " + row.basis)) + element("td", source));
  }).join("");
  return element("details",
    element("summary", txt("各模型等效价值明细 · 基准日 " + value.ratesAsOf))
    + element("p", txt(value.note + " · 固定汇率：1 USD = 6.6620 CNY（2026-10-29）"))
    + element("div", element("table", head + element("tbody", rows)), "scroll"), "pricing-details");
}
function renderTree(node) {
  if (!node) return element("div", txt("暂无组合结构"), "empty");
  const label = node.type === "model" ? node.label : node.label;
  const meta = node.type === "model"
    ? [node.tier ? "tier=" + node.tier : "", node.effort ? "effort=" + node.effort : "",
       node.offPeakOnly ? "仅" + node.offPeakOnly + "闲时" : ""].filter(Boolean).join(" · ")
    : "";
  const title = element("span", txt(label), node.type === "model" ? "leaf" : "op")
    + (meta ? " " + element("em", txt(meta)) : "");
  const subtree = node.children?.length
    ? element("ul", node.children.map((entry) => element("li", renderTreeNode(entry))).join("")) : "";
  return element("ul", element("li", title + subtree), "tree");
}
function renderTreeNode(node) {
  const meta = node.type === "model" ? [
    node.tier ? "tier=" + node.tier : "",
    node.effort ? "effort=" + node.effort : "",
    node.offPeakOnly ? "仅" + node.offPeakOnly + "闲时" : ""
  ].filter(Boolean).join(" · ") : "";
  return element("span", txt(node.label), node.type === "model" ? "leaf" : "op")
    + (meta ? " " + element("em", txt(meta)) : "")
    + (node.children?.length ? element("ul", node.children.map((item) =>
      element("li", renderTreeNode(item))).join("")) : "");
}
function renderChannel(channel, nowMs) {
  const cells = [
    ["预测总耗时", channel.duration], ["RD", channel.rd],
    ["证据权重", channel.evidence],
    ["右删失", channel.censored],
    ["无错并发实证", channel.verifiedMaxConcurrency ?? "—"],
  ].map(([key, value]) => element("div", element("small", txt(key))
      + element("strong", txt(value)), "measure")).join("");
  const accounts = channel.units.map((unit) =>
    element("div", txt(unit.name + " · " + unit.status)
      + (unit.load ? " " + element("span", txt(unit.load), "load") : "")
      + (unit.nextProbeAt
        ? element("small", txt("下次探测 " + relative(unit.nextProbeAt, nowMs))) : ""),
      "account " + unit.health)).join("");
  const problems = channel.units.filter((unit) => unit.reason);
  const detail = problems.length ? element("details",
    element("summary", txt("冷却详情 (" + problems.length + ")")) +
    problems.map((unit) => element("p", txt(unit.name + " · " + unit.reason
      + (unit.nextProbeAt ? " · " + relative(unit.nextProbeAt, nowMs) : "")))).join("")) : "";
  return element("section",
    element("div", element("div",
      element("div", txt(channel.model), "model")
      + element("p", txt("effort " + channel.effort + " · " + channel.available
        + "/" + channel.totalUnits + " 个账号可用"), "description")
    ) + element("div", cells, "metrics"), "channel-main")
    + element("div", accounts || element("span",
      txt(channel.totalUnits ? "此刻没有可用账号" : "当前时段无候选或尚未注册"), "empty"), "accounts")
    + detail, "channel");
}
function renderRoute(route, nowMs) {
  const flag = route.state === "alive" ? "有可用容量"
    : route.state === "loading" ? "模型目录加载中" : "暂无可用账号";
  const header = element("header",
    element("div", element("h3", txt(route.title))
      + element("code", txt(route.id))) +
    element("div", element("span", txt(flag), "flag " + route.state)
      + element("p", txt(route.available + "/" + route.total + " 个账号通道可用")), "route-status"),
    "route-head");
  const strategy = element("div", element("small", txt("路由组合 · " + route.strategy))
    + renderTree(route.graph), "strategy");
  return element("article", header + strategy +
    element("div", route.channels.map((row) => renderChannel(row, nowMs)).join("") ||
      element("div", txt("没有候选通道"), "empty")), "route");
}
function renderDiagnostics(rows) {
  if (!rows.length) return element("div", txt("目前没有这组模型的滚动样本"), "empty");
  const head = element("thead", element("tr", ["模型", "最近完整耗时", "30 分钟样本", "删失样本"]
    .map((label) => element("th", txt(label))).join("")));
  const body = element("tbody", rows.map((r) => element("tr",
    [r.model, r.total, r.samples, r.interrupted].map((value) =>
      element("td", txt(value))).join(""))).join(""));
  return element("div", element("div", element("table", head + body), "scroll"), "diag route");
}
export function renderStatusPage(status, { statusPath, nowMs = Date.now() }) {
  const view = describeStatus(status);
  const fields = {
    statusPath: txt(statusPath), assets: txt(ASSET_PREFIX),
    utc: txt(view.utc), updatedAt: txt(view.now), affinity: txt(view.affinity),
    overview: renderOverview(view, status.tokenTotals),
    valueDetails: renderOfficialValueDetails(status.tokenTotals),
    routes: view.routes.map((route) => renderRoute(route, nowMs)).join(""),
    diagnostics: renderDiagnostics(view.diagnostics),
  };
  return TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key) => fields[key] ?? match);
}
export function createStatusPage({ statusPath, statusView }) {
  return (method, pathname) => {
    if (method !== "GET" && method !== "HEAD") return undefined;
    const respond = (body, type, extra = {}) => new Response(method === "HEAD" ? null : body, {
      status: 200, headers: { "content-type": type, ...HEADERS, ...extra },
    });
    if (pathname === "/") return respond(renderStatusPage(statusView(), { statusPath }),
      "text/html; charset=utf-8", { "content-security-policy": CONTENT_SECURITY_POLICY,
      "cache-control": "no-store" });
    const asset = ASSETS.get(pathname);
    return asset ? respond(asset.body, asset.type) : undefined;
  };
}
