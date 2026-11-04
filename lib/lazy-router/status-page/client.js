// Refetch the same server-rendered view. This avoids a second, drifting UI model.
const REFRESH_MS = 10000;
const byId = (id) => document.getElementById(id);
const warning = byId("banner");
function relative(iso) {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return "—";
  const delta = Math.round(Math.abs(value - Date.now()) / 1000);
  return (delta < 60 ? delta + " 秒" : Math.round(delta / 60) + " 分")
    + (value > Date.now() ? "后" : "前");
}
async function refresh() {
  try {
    const response = await fetch("/", { cache: "no-store",
      headers: { accept: "text/html" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const html = await response.text();
    const snapshot = new DOMParser().parseFromString(html, "text/html");
    for (const id of ["overview", "value-details", "routes", "diagnostics"]) {
      const next = snapshot.getElementById(id);
      if (!next) throw new Error("界面结构不完整");
      const preserveDetailsOpen = id === "value-details"
        && byId(id).querySelector("details")?.open === true;
      byId(id).replaceChildren(...Array.from(next.childNodes));
      if (preserveDetailsOpen) {
        const details = byId(id).querySelector("details");
        if (details) details.open = true;
      }
    }
    for (const id of ["utc", "affinity"]) {
      byId(id).textContent = snapshot.getElementById(id)?.textContent ?? "—";
    }
    byId("updated").dataset.since = snapshot.getElementById("updated")?.dataset.since ?? "";
    warning.hidden = true;
    byId("live").textContent = "每 10 秒刷新";
  } catch (error) {
    warning.textContent = "刷新暂时失败，页面保留上次成功的状态；将自动重试。";
    warning.hidden = false;
    byId("live").textContent = "等待刷新";
  }
  tick();
}
function tick() {
  byId("updated").textContent = relative(byId("updated").dataset.since);
}
tick();
setInterval(refresh, REFRESH_MS);
setInterval(tick, 1000);


// Public dashboard remains read-only unless an operator explicitly enters the
// Gateway bearer token for this one action. Never persist it to browser storage.
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
    const response = await fetch("/v1/lazy/token-totals/reset", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        authorization: "Bearer " + token.trim(),
        "content-type": "application/json",
        "x-lazy-reset": "token-totals",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error(response.status === 401
      ? "管理 Token 错误或无权限" : "HTTP " + response.status);
    resetResult.textContent = "累积 Token 统计已清零。";
    await refresh();
  } catch (error) {
    resetResult.textContent = "重置失败：" + error.message;
  } finally {
    resetButton.disabled = false;
  }
});
