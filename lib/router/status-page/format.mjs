// The one place where status-page numbers become text.
// Pure and import-free, so the server, the Svelte components, and tests agree.

export const DASH = "—";
export const UNKNOWN_LABEL = "无数据";
export const USD_CNY_RATE = 6.662;

const zhInteger = new Intl.NumberFormat("zh-CN");

// Large units in descending order: one step up moves toward the front.
const UNITS = Object.freeze([
  Object.freeze({ scale: 1e9, suffix: "B" }),
  Object.freeze({ scale: 1e6, suffix: "M" }),
  Object.freeze({ scale: 1e3, suffix: "K" }),
]);

// One formatter per legal fraction-digit count, so refresh loops do not rebuild them.
const decimals = Object.freeze(
  Array.from(
    { length: 21 },
    (_, places) =>
      new Intl.NumberFormat("zh-CN", {
        minimumFractionDigits: places,
        maximumFractionDigits: places,
      }),
  ),
);

/** Round to a whole number and keep "-0" out of the page. */
function whole(value) {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** Clamp fraction digits into the range Intl accepts, so no input can throw. */
function places(digits) {
  if (typeof digits !== "number" || !Number.isFinite(digits)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(digits)));
}

/** Parse an instant without letting hostile input throw. */
function instant(iso) {
  try {
    return Date.parse(iso);
  } catch {
    return NaN;
  }
}

/** A compact token count with a K/M/B unit at one decimal. */
export function formatTokens(value) {
  if (!Number.isFinite(value) || value < 0) return DASH;
  const count = whole(value);
  if (count < 1000) return zhInteger.format(count);
  let index = UNITS.findIndex((unit) => count >= unit.scale);
  if (index < 0) index = UNITS.length - 1;
  // 999_999 must read as 1.0 M, never as 1000.0 K.
  while (index > 0 && Math.round((count / UNITS[index].scale) * 10) / 10 >= 1000) index -= 1;
  let scaled = Math.round((count / UNITS[index].scale) * 10) / 10;
  // A known nonzero count never shows as 0.0; move to a smaller unit instead.
  while (scaled === 0 && index < UNITS.length - 1) {
    index += 1;
    scaled = Math.round((count / UNITS[index].scale) * 10) / 10;
  }
  return `${scaled.toFixed(1)} ${UNITS[index].suffix}`;
}

/** Every digit of a token count, for tooltips and proofs. */
export function formatTokensExact(value) {
  if (!Number.isFinite(value) || value < 0) return DASH;
  return zhInteger.format(whole(value));
}

/** A share of a total, at one decimal. */
export function formatPercent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return DASH;
  return `${((100 * numerator) / denominator).toFixed(1)}%`;
}

/** A 0..1 ratio as a percentage. */
export function formatRatio(ratio) {
  return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(1)}%` : DASH;
}

/** A locale-formatted number pinned to a fixed number of decimals. */
export function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? decimals[places(digits)].format(value) : DASH;
}

/** The same as formatNumber, with one decimal as the usual default. */
export function formatDecimal(value, digits = 1) {
  return formatNumber(value, digits);
}

/** A whole count for row counters. */
export function formatCount(value) {
  return Number.isFinite(value) ? zhInteger.format(whole(value)) : DASH;
}

/** A human duration in the unit that fits its range. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)} 分 ${Math.floor((ms % 60_000) / 1000)} 秒`;
  }
  return `${Math.floor(ms / 3_600_000)} 小时 ${Math.floor((ms % 3_600_000) / 60_000)} 分`;
}

/** A duration with no unit conversion, for exact measurements. */
export function formatDurationExact(ms) {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  return `${Math.round(ms)} ms`;
}

/** A USD amount at proof-level precision. */
export function formatUsd(value) {
  return Number.isFinite(value) && value >= 0 ? `USD $${value.toFixed(4)}` : DASH;
}

/** The CNY equivalent at the pinned exchange rate. */
export function formatCny(usd) {
  return Number.isFinite(usd) && usd >= 0 ? `CNY ¥${(usd * USD_CNY_RATE).toFixed(2)}` : DASH;
}

/** Both currencies side by side. */
export function formatCurrencyPair(usd) {
  if (!Number.isFinite(usd) || usd < 0) return DASH;
  return `${formatUsd(usd)} · ${formatCny(usd)}`;
}

/** A time relative to now, using the page's coarse segments. */
export function formatRelative(iso, nowMs) {
  const target = instant(iso);
  if (!Number.isFinite(target) || !Number.isFinite(nowMs)) return DASH;
  const diff = target - nowMs;
  // A fresh snapshot is generated at `now`; "0 秒后" would read as a future
  // event. Sub-second differences are the same instant for display purposes.
  if (Math.abs(diff) < 1000) return "刚刚";
  const seconds = Math.round(Math.abs(diff) / 1000);
  const value =
    seconds < 60
      ? `${seconds} 秒`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`
          : `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`;
  return value + (diff > 0 ? "后" : "前");
}

/** The exact value when there is one, else the unknown label. */
export function exactOrUnknown(value) {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return UNKNOWN_LABEL;
}

/** Whether a value carries data rather than absence. */
export function isKnown(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length > 0;
  return true;
}
