// The page refreshes from the status JSON, then reuses the server renderer.
//
// One poll at a time. The JSON answer is the change detector: only when the
// route health or period changes does the page fetch the server-rendered HTML
// and replace its sections. This keeps one display model on the server.

const REFRESH_MS = 10_000;
const RESET_PATH = "/v1/lazy/token-totals/reset";
const byId = (id) => document.getElementById(id);
const banner = byId("banner");
let inFlight = false;
let lastSignature = null;

/** The status path advertised by the server. */
function statusPath() {
  const meta = document.querySelector('meta[name="lazy-status-path"]');
  return meta?.content || "/v1/lazy/status";
}

/** A stable signature of everything the page displays. */
function signature(status) {
  return JSON.stringify({
    period: status.period,
    next: status.nextSwitch?.at ?? null,
    ready: status.catalogReady,
    routes: Object.entries(status.routes ?? {}).map(([id, rows]) => [
      id,
      rows.map((row) => [row.unit, row.model, row.health, row.inFlight ?? 0, row.maxInFlight ?? 0, row.reason ?? null]),
    ]),
    totals: status.tokenTotals?.totals ?? null,
  });
}

/** Fetch the status JSON. */
async function fetchStatus() {
  const response = await fetch(statusPath(), {
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Fetch the server-rendered page and move its sections into this document. */
async function fetchPage() {
  const response = await fetch("/", {
    cache: "no-store",
    credentials: "omit",
    headers: { accept: "text/html" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

/** Replace the dynamic sections from a fresh server render. */
function applyPage(snapshot) {
  for (const id of ["overview", "value-details", "routes", "diagnostics"]) {
    const next = snapshot.getElementById(id);
    const current = byId(id);
    if (!next || !current) throw new Error("界面结构不完整");
    const keepOpen = id === "value-details" && current.querySelector("details")?.open === true;
    current.replaceChildren(...Array.from(next.childNodes));
    if (keepOpen) {
      const details = current.querySelector("details");
      if (details) details.open = true;
    }
  }
  for (const id of ["utc", "affinity", "status-endpoint"]) {
    const next = snapshot.getElementById(id);
    if (next) byId(id)?.replaceChildren(...Array.from(next.childNodes));
  }
  const updated = byId("updated");
  if (updated) updated.dataset.since = snapshot.getElementById("updated")?.dataset.since ?? "";
}

/** Refresh once. A second call during a refresh returns at once. */
async function refresh(force = false) {
  if (inFlight) return;
  inFlight = true;
  try {
    const status = await fetchStatus();
    const next = signature(status);
    if (force || lastSignature === null || next !== lastSignature) {
      applyPage(await fetchPage());
      lastSignature = next;
    }
    banner.hidden = true;
    const live = byId("live");
    if (live) live.textContent = "每 10 秒刷新";
  } catch {
    const live = byId("live");
    if (live) live.textContent = "等待刷新";
    banner.textContent = "刷新暂时失败，页面保留上次成功的状态；将自动重试。";
    banner.hidden = false;
  } finally {
    inFlight = false;
    tick();
  }
}

/** Update the relative "last updated" text. */
function tick() {
  const updated = byId("updated");
  if (!updated) return;
  const value = Date.parse(updated.dataset.since ?? "");
  if (!Number.isFinite(value)) {
    updated.textContent = "—";
    return;
  }
  const delta = Math.round(Math.abs(Date.now() - value) / 1000);
  updated.textContent =
    (delta < 60 ? `${delta} 秒` : `${Math.round(delta / 60)} 分`) + (value > Date.now() ? "后" : "前");
}

/* Public dashboard stays read-only unless an operator enters the gateway
 * bearer token for this one action. The token is never stored. */
const resetButton = byId("reset-totals");
const resetResult = byId("reset-result");
resetButton?.addEventListener("click", async () => {
  if (location.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(location.hostname)) {
    resetResult.textContent = "请使用 HTTPS 打开管理页面后再重置。";
    return;
  }
  if (!confirm("确定清零累计未缓存输入、累计缓存输入、累计输出及上报次数？路由评分和账号状态不受影响。")) return;
  const token = prompt("请输入 Gateway 管理 Token（只用于本次请求，不保存）：");
  if (!token) return;
  resetButton.disabled = true;
  resetResult.textContent = "正在重置…";
  try {
    const response = await fetch(RESET_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        authorization: `Bearer ${token.trim()}`,
        "content-type": "application/json",
        "x-lazy-reset": "token-totals",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error(response.status === 401 ? "管理 Token 错误或无权限" : `HTTP ${response.status}`);
    resetResult.textContent = "累积 Token 统计已清零。";
    await refresh(true);
  } catch (error) {
    resetResult.textContent = `重置失败：${error.message}`;
  } finally {
    resetButton.disabled = false;
  }
});

const initial = byId("updated");
if (initial) initial.dataset.since = initial.dataset.since || new Date().toISOString();
tick();
setInterval(() => void refresh(), REFRESH_MS);
setInterval(tick, 1000);
