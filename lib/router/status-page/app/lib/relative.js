const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function asTime(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Relative age for a past instant. `—` is reserved for unknown values. */
export function formatRelativePast(value, nowMs) {
  const time = asTime(value);
  if (time === null || !Number.isFinite(nowMs)) return "—";
  const delta = Math.max(0, nowMs - time);
  if (delta < 5_000) return "刚刚";
  if (delta < MINUTE) return `${Math.floor(delta / 1000)} 秒前`;
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`;
  return `${Math.floor(delta / DAY)} 天前`;
}

/** Relative distance to a future instant. */
export function formatRelativeFuture(value, nowMs) {
  const time = asTime(value);
  if (time === null || !Number.isFinite(nowMs)) return "—";
  const delta = Math.max(0, time - nowMs);
  if (delta < MINUTE) return `${Math.max(1, Math.ceil(delta / 1000))} 秒后`;
  if (delta < HOUR) return `${Math.ceil(delta / MINUTE)} 分钟后`;
  if (delta < DAY) return `${Math.ceil(delta / HOUR)} 小时后`;
  return `${Math.ceil(delta / DAY)} 天后`;
}

/** Server-provided milliseconds, already bounded and classified. */
export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "—";
  if (ageMs < 5_000) return "刚刚";
  if (ageMs < MINUTE) return `${Math.floor(ageMs / 1000)} 秒前`;
  if (ageMs < HOUR) return `${Math.floor(ageMs / MINUTE)} 分钟前`;
  return `${Math.floor(ageMs / HOUR)} 小时前`;
}

/** Deterministic absolute text for <time title> and disclosure rows. */
export function formatAbsolute(value) {
  const time = asTime(value);
  if (time === null) return "—";
  const iso = new Date(time).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}
