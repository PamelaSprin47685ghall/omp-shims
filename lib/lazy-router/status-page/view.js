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

/** Rows a route shows: units that can serve it (all of them while the catalog is unknown). */
export function visibleRows(rows, catalogReady) {
  return catalogReady ? rows.filter((row) => row.eligible !== false) : rows;
}

function healthOf(row, catalogReady) {
  const key = !catalogReady ? "unknown" : row.health === "cooling" ? "cooling" : "alive";
  return { key, text: LABELS.health[key] };
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
    routes: Object.entries(data.routes ?? {}).map(([name, rows]) => {
      const shown = visibleRows(rows, ready);
      const active = shown.findIndex((row) => ready && row.health !== "cooling");
      const other = visibleRows(data.alternate?.routes?.[name] ?? [], ready);
      const otherPeriod = LABELS.periods[data.alternate?.period] ?? "其他";
      return {
        title: `${LABELS.routes[name] ?? name} · lazy/${name}`,
        sub: active >= 0 ? `当前由 ${shown[active].unit} 服务` : "暂无可用单元",
        rows: shown.map((row, index) => ({
          n: String(index + 1),
          unit: row.unit,
          active: index === active,
          model: row.model,
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
