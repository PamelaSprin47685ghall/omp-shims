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
    for (const id of ["overview", "routes", "diagnostics"]) {
      const next = snapshot.getElementById(id);
      if (!next) throw new Error("界面结构不完整");
      byId(id).replaceChildren(...Array.from(next.childNodes));
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
