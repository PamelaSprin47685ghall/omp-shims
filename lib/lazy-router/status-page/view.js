// Status JSON → display model, shared by the server render and the browser.
//
// Pure functions over plain data: no DOM, no Node APIs. The output holds only
// strings and flags, which the server escapes into HTML and the browser
// assigns with textContent.

import { LABELS } from "./labels.js";

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;
const DAY_S = 86400;

/** "3 分 12 秒", "2 小时 5 分", "1 天 4 小时". */
export function formatSpan(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / DAY_S);
  const hours = Math.floor((s % DAY_S) / HOUR_S);
  const minutes = Math.floor((s % HOUR_S) / MINUTE_S);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${s % MINUTE_S} 秒`;
  return `${s} 秒`;
}

/** Relative text for an ISO time: "… 后" for the future, "… 前" for the past. */
export function relative(iso, nowMs) {
  if (!iso) return "—";
  const delta = (Date.parse(iso) - nowMs) / SECOND_MS;
  return delta >= 0 ? `${formatSpan(delta)}后` : `${formatSpan(-delta)}前`;
}

/** "1/3": in-flight load of a limited unit; null for an unlimited one. */
export function loadText(row) {
  return row.maxInFlight ? `${row.inFlight ?? 0}/${row.maxInFlight}` : null;
}

/** "1.2 秒" / "840 毫秒": a first-token latency. */
export function ttftText(perf) {
  if (!perf || !Number.isFinite(perf.ttftMs)) return "—";
  return perf.ttftMs >= 1000 ? `${(perf.ttftMs / 1000).toFixed(1)} 秒` : `${perf.ttftMs} 毫秒`;
}

/** "4.6 秒" / "1 分 12 秒": the window's average total request duration. */
export function totalText(perf) {
  if (!perf || !Number.isFinite(perf.totalMs)) return "—";
  const ms = perf.totalMs;
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  return formatSpan(ms / SECOND_MS);
}

/** "37.4 tok/s": the window's generation speed, tokens over generation time. */
export function speedText(perf) {
  if (!perf || !Number.isFinite(perf.tokensPerSecond)) return "—";
  return `${perf.tokensPerSecond.toFixed(1)} tok/s`;
}

/** "128 条 · 命中 62%": the prefix-affinity map at a glance. */
export function affinityText(affinity) {
  if (!affinity) return "—";
  const rate =
    affinity.hitRate === null || affinity.hitRate === undefined ? "—" : `${Math.round(affinity.hitRate * 100)}%`;
  return `${affinity.entries} 条 · 命中 ${rate}（${affinity.hits}/${affinity.lookups}）`;
}

/** Rows a route shows: units that can serve it (all of them while the catalog is unknown). */
export function visibleRows(rows, catalogReady) {
  return catalogReady ? rows.filter((row) => row.eligible !== false) : rows;
}

function healthOf(row, catalogReady) {
  const key = !catalogReady ? "unknown" : row.health === "cooling" ? "cooling" : "alive";
  return { key, text: LABELS.health[key] };
}

/**
 * Every model the window has samples for, busiest first, for the page's own
 * table. Routed and directly-called models land in the same list.
 * @param {any} perf the status document's `perf` map
 */
export function modelRows(perf) {
  return Object.entries(perf ?? {})
    .map(([model, sample]) => ({
      model,
      ttft: ttftText(sample),
      speed: speedText(sample),
      total: totalText(sample),
      samples: String(sample.samples ?? 0),
      tokens: sample.tokens === null || sample.tokens === undefined ? "—" : String(sample.tokens),
      imputed: String(sample.imputedSamples ?? 0),
      coverage: `首字 ${sample.ttftSamples ?? 0}/${sample.samples ?? 0} · usage ${sample.tokenSamples ?? 0}/${sample.samples ?? 0} · 速度 ${sample.speedSamples ?? 0}/${sample.samples ?? 0}`,
      order: sample.samples ?? 0,
    }))
.sort((a, b) => b.order - a.order || a.model.localeCompare(b.model));
}

/**
 * The display model of a status document.
 * @param {any} data the /v1/lazy/status JSON
 */
export function describeStatus(data) {
  const ready = Boolean(data.catalogReady);
  const clock = data.clock ?? {};
  const periodKey = data.period === "peak" ? "peak" : "offPeak";
  return {
    period: { key: periodKey, text: LABELS.periods[periodKey] },
    local: clock.localTime ?? "—",
    day: (LABELS.dayKinds[clock.dayKind] ?? clock.dayKind ?? "—") + (clock.holiday ? ` · ${clock.holiday}` : ""),
    calendar: LABELS.calendars[clock.calendarStatus] ?? clock.calendarStatus ?? "—",
    next: data.nextSwitch
      ? { at: data.nextSwitch.at, suffix: `（${LABELS.periods[data.nextSwitch.period] ?? ""}）` }
      : null,
    updatedAt: data.now ?? null,
    affinity: affinityText(data.affinity),
    models: modelRows(data.perf),
    routes: Object.entries(data.routes ?? {}).map(([name, rows]) => {
      const shown = visibleRows(rows, ready);
      const active = shown.findIndex((row) => ready && row.health !== "cooling");
      const other = visibleRows(data.alternate?.routes?.[name] ?? [], ready);
      const otherPeriod = LABELS.periods[data.alternate?.period] ?? "其他";
      return {
        title: `${LABELS.routes[name] ?? name} · lazy/${name}`,
        sub: active >= 0 ? `基础首选 ${shown[active].unit} 服务` : "暂无可用单元",
        rows: shown.map((row, index) => ({
          n: String(index + 1),
          unit: row.unit,
          active: index === active,
          load: loadText(row),
          model: row.model,
          intelligence: row.intelligence === "excellent" ? "优秀" : row.intelligence === "low" ? "偏低" : "中等",
          rating: Number.isFinite(row.rating) ? row.rating.toFixed(3) : "—",
          rd: Number.isFinite(row.rd) ? row.rd.toFixed(3) : "—",
          routingScore: Number.isFinite(row.routingScore) ? row.routingScore.toFixed(3) : "—",
          ttft: ttftText(data.perf?.[row.model]),
          speed: speedText(data.perf?.[row.model]),
          total: totalText(data.perf?.[row.model]),
          effort: LABELS.efforts[row.effortPolicy] ?? row.effortPolicy ?? "—",
          health: healthOf(row, ready),
          reason: row.reason ?? null,
          coolingSince: row.coolingSince ?? null,
          nextProbeAt: row.nextProbeAt ?? null,
        })),
        other: {
          summary: `${otherPeriod}时段顺序（${other.length} 个单元）`,
          items: other.map((row) => `${row.unit} · ${row.model}`),
        },
      };
    }),
  };
}
