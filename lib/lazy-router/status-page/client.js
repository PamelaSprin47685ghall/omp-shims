// Browser side of the status page: refresh from the status JSON every few
// seconds and keep relative times live. Every value goes in via textContent.

import { describeStatus, relative } from "./view.js";

const REFRESH_MS = 10_000;
const TICK_MS = 1_000;
const STATUS_PATH = document.querySelector('meta[name="lazy-status-path"]').content;
const byId = (id) => document.getElementById(id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function timeCell(kind, iso, className) {
  const cell = el("td", null, className);
  cell.dataset[kind] = iso ?? "";
  return cell;
}

function renderRow(row) {
  const tr = el("tr", null, row.active ? "active" : "");
  const unit = el("td");
  unit.append(el("span", row.unit, "unit"));
  if (row.active) unit.append(el("span", "首选", "tag"));
  if (row.load) unit.append(el("span", `并发 ${row.load}`, "tag load"));
  const health = el("td");
  health.append(el("span", row.health.text, `badge b-${row.health.key}`));
  tr.append(
    el("td", row.n, "dim"),
    unit,
    el("td", row.model, "mono"),
    el("td", row.effort),
    el("td", row.intelligence),
    el("td", row.rating, "mono"),
    el("td", row.rd, "mono"),
    el("td", row.routingScore, "mono"),
    el("td", row.ttft, "mono"),
    el("td", row.speed, "mono"),
    el("td", row.total, "mono"),
    health,
    el("td", row.reason ?? "—", row.reason ? "" : "dim"),
    timeCell("since", row.coolingSince, "dim"),
    timeCell("until", row.nextProbeAt, ""),
  );
  return tr;
}

function renderModels(models) {
  const card = byId("models-card").content.firstElementChild.cloneNode(true);
  const body = card.querySelector("tbody");
  if (models.length === 0) {
    const row = el("tr");
    row.append(el("td", "近 30 分钟还没有样本", "dim"));
    body.append(row);
    return card;
  }
  for (const row of models) {
    const tr = el("tr");
    tr.append(
      el("td", row.model, "mono"),
      el("td", row.ttft, "mono"),
      el("td", row.speed, "mono"),
      el("td", row.total, "mono"),
      el("td", row.samples, "dim"),
      el("td", row.imputed, "dim"),
      el("td", row.tokens, "dim"),
      el("td", row.coverage, "dim"),
    );
    body.append(tr);
  }
  return card;
}

function renderCard(route) {
  const card = byId("route-card").content.firstElementChild.cloneNode(true);
  card.querySelector(".title").textContent = route.title;
  card.querySelector(".sub").textContent = route.sub;
  const body = card.querySelector("tbody");
  for (const row of route.rows) body.append(renderRow(row));
  card.querySelector("summary").textContent = route.other.summary;
  const list = card.querySelector("ol");
  for (const item of route.other.items) list.append(el("li", item));
  return card;
}

function render(view) {
  const period = byId("period");
  period.textContent = view.period.text;
  period.className = `pill ${view.period.key}`;
  byId("local").textContent = view.local;
  byId("day").textContent = view.day;
  byId("calendar").textContent = view.calendar;
  byId("affinity").textContent = view.affinity;
  const next = byId("next");
  next.dataset.until = view.next?.at ?? "";
  next.dataset.suffix = view.next?.suffix ?? "";
  byId("updated").dataset.since = view.updatedAt ?? "";
  byId("models").replaceChildren(renderModels(view.models));
  byId("routes").replaceChildren(...view.routes.map(renderCard));
}

function tick() {
  const now = Date.now();
  for (const node of document.querySelectorAll("[data-since]")) node.textContent = relative(node.dataset.since, now);
  for (const node of document.querySelectorAll("[data-until]")) {
    node.textContent = node.dataset.until ? relative(node.dataset.until, now) + (node.dataset.suffix ?? "") : "—";
  }
}

async function refresh() {
  const banner = byId("banner");
  try {
    const response = await fetch(STATUS_PATH, { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(describeStatus(await response.json()));
    banner.hidden = true;
  } catch (error) {
    banner.textContent = `刷新失败：${error.message}。显示的是上一次的数据，稍后自动重试。`;
    banner.hidden = false;
  }
  tick();
}

byId("live").textContent = "每 10 秒自动刷新";
tick();
setInterval(refresh, REFRESH_MS);
setInterval(tick, TICK_MS);
