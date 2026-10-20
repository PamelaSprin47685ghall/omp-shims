// Beijing-time peak detection.
//
// DeepSeek's official tariff (which the route tables follow) is "peak" only on
// working weekdays, 09:00–12:00 and 14:00–18:00 Asia/Shanghai. Weekends,
// statutory holidays and even 调休 make-up workdays that fall on a weekend are
// off-peak all day. So a moment is peak exactly when it is Monday–Friday, the
// date is not a holiday, and the local time sits inside a peak window.
//
// The holiday table is data (holidays-cn.json), one block per year, so a newly
// published State Council schedule is a JSON edit, not a code change.

import { readFileSync } from "node:fs";

/** Route-table keys for the two tariff periods. */
export const PERIOD = Object.freeze({ PEAK: "peak", OFF_PEAK: "offPeak" });

/** How a calendar date is classified. */
export const DAY_KIND = Object.freeze({
  WORKDAY: "workday",
  WEEKEND: "weekend",
  HOLIDAY: "holiday",
  MAKEUP_WORKDAY: "makeup-workday",
});

const MINUTES_PER_HOUR = 60;
const MS_PER_DAY = 86_400_000;
const SATURDAY = 6;

/** The bundled calendar data. */
export function loadHolidayData(path = new URL("./holidays-cn.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** "HH:MM" → minutes after midnight. */
export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!match) throw new Error(`invalid clock time "${text}" (expected HH:MM)`);
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/** Every "YYYY-MM-DD" from `from` to `to`, inclusive. */
export function expandDateRange(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`invalid holiday range ${from}..${to}`);
  }
  const days = [];
  for (let at = start; at <= end; at += MS_PER_DAY) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/**
 * Wall-clock reading of `date` in `timeZone`.
 * @returns {{dateKey: string, isoWeekday: number, minutes: number, localTime: string}}
 *   isoWeekday is 1 (Monday) … 7 (Sunday)
 */
export function wallClock(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const utcWeekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return {
    dateKey,
    isoWeekday: utcWeekday === 0 ? 7 : utcWeekday,
    minutes: Number(parts.hour) * MINUTES_PER_HOUR + Number(parts.minute),
    localTime: `${dateKey} ${parts.hour}:${parts.minute}`,
  };
}

/** Holiday and make-up-workday lookup built from the year blocks. */
export class HolidayCalendar {
  /** @param {{timeZone: string, years: Record<string, {status: string, source: string, holidays: {name: string, from: string, to: string}[], makeupWorkdays?: string[]}>}} data */
  constructor(data) {
    this.timeZone = data.timeZone;
    this.years = new Map();
    this.days = new Map();
    for (const [year, block] of Object.entries(data.years ?? {})) {
      this.years.set(year, { status: block.status, source: block.source });
      for (const holiday of block.holidays ?? []) {
        for (const day of expandDateRange(holiday.from, holiday.to)) {
          this.days.set(day, { kind: DAY_KIND.HOLIDAY, name: holiday.name });
        }
      }
      for (const day of block.makeupWorkdays ?? []) this.days.set(day, { kind: DAY_KIND.MAKEUP_WORKDAY });
    }
  }

  /** Coverage of a year: {status, source}, or undefined when the table has no block for it. */
  coverage(year) {
    return this.years.get(String(year));
  }

  /** Classify a local date. */
  classify(dateKey, isoWeekday) {
    const special = this.days.get(dateKey);
    if (special) return special;
    return { kind: isoWeekday >= SATURDAY ? DAY_KIND.WEEKEND : DAY_KIND.WORKDAY };
  }
}

/**
 * Decides the tariff period for a moment.
 *
 * Only an ordinary weekday can be peak. A make-up workday is a weekend date by
 * construction, and DeepSeek bills it as off-peak, so it needs no special case
 * beyond being "not WORKDAY".
 */
export class PeakSchedule {
  /**
   * @param {{calendar: HolidayCalendar, windows: {from: string, to: string}[], timeZone?: string}} options
   */
  constructor({ calendar, windows, timeZone = calendar.timeZone }) {
    this.calendar = calendar;
    this.timeZone = timeZone;
    this.windows = windows.map(({ from, to }) => ({ from: parseClock(from), to: parseClock(to) }));
  }

  /**
   * @param {Date} [date]
   * @returns {{period: string, localTime: string, dayKind: string, holiday?: string, calendarStatus: string}}
   */
  at(date = new Date()) {
    const clock = wallClock(date, this.timeZone);
    const day = this.calendar.classify(clock.dateKey, clock.isoWeekday);
    const inWindow = this.windows.some((window) => clock.minutes >= window.from && clock.minutes < window.to);
    const coverage = this.calendar.coverage(clock.dateKey.slice(0, 4));
    return {
      period: day.kind === DAY_KIND.WORKDAY && inWindow ? PERIOD.PEAK : PERIOD.OFF_PEAK,
      localTime: clock.localTime,
      dayKind: day.kind,
      ...(day.name ? { holiday: day.name } : {}),
      calendarStatus: coverage?.status ?? "uncovered",
    };
  }
}
