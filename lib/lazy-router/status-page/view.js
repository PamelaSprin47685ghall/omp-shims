// The display model is shared by SSR and browser refresh. No routing decisions live here.
export const ROUTE_NAMES = Object.freeze({
  "lazy/pro": "高能力", "lazy/batch-blind": "批量长任务", "lazy/weak": "轻量",
  "lazy/default": "主代理", "lazy/task": "统一任务"
});
export const OP_NAMES = Object.freeze({
  rating: "按总耗时评分 · 带温度探索", fallback: "严格有序的后备链",
  random: "温度随机分配", model: "单一模型通道"
});
const format = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
export const msText = (ms) => !Number.isFinite(ms) || ms < 0 ? "—"
  : ms < 1000 ? Math.round(ms) + " ms" : format.format(ms / 1000) + " s";
export function relative(iso, nowMs) {
  const diff = Date.parse(iso ?? "") - nowMs;
  if (!Number.isFinite(diff)) return "—";
  const s = Math.round(Math.abs(diff) / 1000);
  const value = s < 60 ? s + " 秒" : s < 3600 ? Math.floor(s / 60) + " 分 " + s % 60 + " 秒"
    : s < 86400 ? Math.floor(s / 3600) + " 小时 " + Math.floor(s % 3600 / 60) + " 分"
    : Math.floor(s / 86400) + " 天 " + Math.floor(s % 86400 / 3600) + " 小时";
  return value + (diff >= 0 ? "后" : "前");
}
export function describeNode(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "model") return { type: "model", label: node.model ?? "未知模型",
    tier: node.tier ?? null, effort: node.effort ?? null,
    offPeakOnly: node.offPeakOnly ?? null, children: [] };
  if (!["rating", "fallback", "random"].includes(node.type)) return null;
  return { type: node.type, label: OP_NAMES[node.type],
    children: (node.children ?? []).map(describeNode).filter(Boolean) };
}
function leaves(node, result = []) {
  if (!node) return result;
  if (node.type === "model") result.push(node);
  else for (const child of node.children ?? []) leaves(child, result);
  return result;
}
function normalizeUnit(row) {
  const health = row.health === "cooling" ? "cooling" : row.health === "alive" ? "alive" : "unknown";
  return {
    name: String(row.unit ?? "未知账号"), health,
    status: health === "cooling" ? "冷却" : health === "alive" ? "可用" : "待检查",
    load: Number.isFinite(row.maxInFlight) && row.maxInFlight > 0
      ? Math.max(0, row.inFlight ?? 0) + "/" + row.maxInFlight : null,
    reason: row.reason ?? null, nextProbeAt: row.nextProbeAt ?? null,
    coolingSince: row.coolingSince ?? null
  };
}
function mapRoute(name, rows, topo, speed, proofs, ready) {
  const graph = describeNode(topo?.graph);
  const ordered = leaves(graph);
  const models = [...new Set([...ordered.map((leaf) => leaf.label), ...rows.map((row) => row.model)])];
  const channels = models.map((model) => {
    const units = rows.filter((row) => row.model === model && (row.eligible !== false || !ready)).map(normalizeUnit);
    const stats = speed?.[model] ?? {};
    const effort = [...new Set(ordered.filter((leaf) => leaf.label === model)
      .map((leaf) => leaf.effort).filter(Boolean))].join(" / ") || "—";
    return { model, effort, units, available: units.filter((unit) => unit.health === "alive").length,
      totalUnits: units.length, duration: msText(stats.totalMs),
      rd: Number.isFinite(stats.rd) ? stats.rd.toFixed(2) : "—",
      evidence: Number.isFinite(stats.weight) ? format.format(stats.weight) : "0",
      censored: Number.isFinite(stats.censored) ? format.format(stats.censored) : "0",
      verifiedMaxConcurrency: Number.isFinite(proofs?.[model]?.verifiedMaxConcurrency)
        ? proofs[model].verifiedMaxConcurrency : null
    };
  });
  const available = channels.reduce((sum, channel) => sum + channel.available, 0);
  return { id: name, title: ROUTE_NAMES[name] ?? name, graph,
    strategy: graph ? OP_NAMES[graph.type] : "未知策略",
    channels, available, total: channels.reduce((sum, channel) => sum + channel.totalUnits, 0),
    state: !ready ? "loading" : available ? "alive" : "cooling"
  };
}
export function describeStatus(data = {}) {
  const now = data.now ?? new Date().toISOString();
  const ready = Boolean(data.catalogReady);
  const routes = Object.entries(data.routes ?? {})
    .filter(([name]) => name.startsWith("lazy/"))
    .map(([name, rows]) => mapRoute(name, rows, data.topology?.[name],
      data.cyclicSpeed, data.concurrencyProof, ready));
  const uniqueModels = new Set(routes.flatMap((route) => route.channels.map((channel) => channel.model)));
  const distinctUnits = new Set(routes.flatMap((route) => route.channels.flatMap((channel) =>
    channel.units.map((unit) => channel.model + "/" + unit.name))));
  const rows = routes.flatMap((route) => route.channels.flatMap((channel) => channel.units));
  return { now, utc: Number.isFinite(Date.parse(now))
      ? new Date(now).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—",
    ready, routes,
    stats: { routes: routes.length, models: uniqueModels.size, units: distinctUnits.size,
      live: rows.filter((u) => u.health === "alive").length,
      cool: rows.filter((u) => u.health === "cooling").length,
      inFlight: (data.units ?? []).reduce((sum, unit) => sum + (unit.inFlight ?? 0), 0) },
    affinity: data.affinity?.lookups ? Math.round((data.affinity.hitRate ?? 0) * 100) + "%" : "—",
    diagnostics: Object.entries(data.perf ?? {}).filter(([name]) => uniqueModels.has(name))
      .map(([model, perf]) => ({ model, samples: perf.samples ?? 0, total: msText(perf.totalMs),
        interrupted: perf.imputedSamples ?? 0 }))
      .sort((a, b) => b.samples - a.samples)
  };
}
