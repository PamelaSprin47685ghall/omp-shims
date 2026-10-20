import { describe, expect, test } from "bun:test";
import {
  DAY_KIND,
  expandDateRange,
  HolidayCalendar,
  loadHolidayData,
  PERIOD,
  PeakSchedule,
  parseClock,
  wallClock,
} from "../lib/lazy-router/calendar.js";
import { loadPolicyData } from "../lib/lazy-router/policy.js";

const calendar = new HolidayCalendar(loadHolidayData());
const schedule = new PeakSchedule({ calendar, windows: loadPolicyData().peakWindows });
const periodAt = (iso) => schedule.at(new Date(iso));

describe("PeakSchedule (bundled data)", () => {
  test("2026-10-20 11:00 UTC is 19:00 Tuesday in Beijing: off-peak", () => {
    const reading = periodAt("2026-10-20T11:00:00Z");
    expect(reading.localTime).toBe("2026-10-20 19:00");
    expect(reading.dayKind).toBe(DAY_KIND.WORKDAY);
    expect(reading.period).toBe(PERIOD.OFF_PEAK);
  });

  test("2026-10-21 02:00 UTC is 10:00 Wednesday: peak", () => {
    expect(periodAt("2026-10-21T02:00:00Z").period).toBe(PERIOD.PEAK);
  });

  test("windows are [09:00, 12:00) and [14:00, 18:00) Beijing time", () => {
    expect(periodAt("2026-10-21T00:59:00Z").period).toBe(PERIOD.OFF_PEAK); // 08:59
    expect(periodAt("2026-10-21T01:00:00Z").period).toBe(PERIOD.PEAK); // 09:00
    expect(periodAt("2026-10-21T04:00:00Z").period).toBe(PERIOD.OFF_PEAK); // 12:00 lunch
    expect(periodAt("2026-10-21T06:00:00Z").period).toBe(PERIOD.PEAK); // 14:00
    expect(periodAt("2026-10-21T09:59:00Z").period).toBe(PERIOD.PEAK); // 17:59
    expect(periodAt("2026-10-21T10:00:00Z").period).toBe(PERIOD.OFF_PEAK); // 18:00
  });

  test("the UTC day boundary follows Beijing: 2026-10-20 23:30 UTC is Wednesday 07:30", () => {
    const reading = periodAt("2026-10-20T23:30:00Z");
    expect(reading.localTime).toBe("2026-10-21 07:30");
    expect(reading.period).toBe(PERIOD.OFF_PEAK);
  });

  test("2026-10-10 is a Saturday make-up workday: off-peak all day", () => {
    const reading = periodAt("2026-10-10T02:00:00Z"); // 10:00
    expect(reading.dayKind).toBe(DAY_KIND.MAKEUP_WORKDAY);
    expect(reading.period).toBe(PERIOD.OFF_PEAK);
  });

  test("2026-10-05 is a National Day holiday (a Monday): off-peak all day", () => {
    const reading = periodAt("2026-10-05T02:00:00Z");
    expect(reading.dayKind).toBe(DAY_KIND.HOLIDAY);
    expect(reading.holiday).toBe("国庆节");
    expect(reading.period).toBe(PERIOD.OFF_PEAK);
  });

  test("an ordinary weekend is off-peak", () => {
    expect(periodAt("2026-10-24T02:00:00Z").dayKind).toBe(DAY_KIND.WEEKEND);
    expect(periodAt("2026-10-24T02:00:00Z").period).toBe(PERIOD.OFF_PEAK);
  });

  test("2027 is covered by a marked estimate", () => {
    const reading = periodAt("2027-02-08T02:00:00Z"); // 春节 Monday, estimated
    expect(reading.calendarStatus).toBe("estimate");
    expect(reading.dayKind).toBe(DAY_KIND.HOLIDAY);
    expect(reading.period).toBe(PERIOD.OFF_PEAK);
    expect(periodAt("2027-03-03T02:00:00Z").period).toBe(PERIOD.PEAK);
    expect(calendar.coverage(2026).status).toBe("official");
  });

  test("years without a block fall back to the weekday rule", () => {
    const reading = periodAt("2028-03-01T02:00:00Z"); // Wednesday
    expect(reading.calendarStatus).toBe("uncovered");
    expect(reading.period).toBe(PERIOD.PEAK);
  });
});

describe("calendar helpers", () => {
  test("expandDateRange is inclusive and crosses months", () => {
    expect(expandDateRange("2026-09-30", "2026-10-02")).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(() => expandDateRange("2026-10-02", "2026-10-01")).toThrow();
  });

  test("parseClock", () => {
    expect(parseClock("09:00")).toBe(540);
    expect(() => parseClock("9am")).toThrow();
  });

  test("wallClock gives ISO weekdays", () => {
    expect(wallClock(new Date("2026-10-25T02:00:00Z"), "Asia/Shanghai").isoWeekday).toBe(7);
    expect(wallClock(new Date("2026-10-26T02:00:00Z"), "Asia/Shanghai").isoWeekday).toBe(1);
  });

  test("every bundled holiday range is valid and every make-up day is a weekend", () => {
    const data = loadHolidayData();
    for (const block of Object.values(data.years)) {
      for (const holiday of block.holidays) expect(expandDateRange(holiday.from, holiday.to).length).toBeGreaterThan(0);
      for (const day of block.makeupWorkdays) {
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        expect([0, 6]).toContain(weekday);
      }
    }
  });
});

describe("next period switch", () => {
  const schedule = new PeakSchedule({
    calendar: new HolidayCalendar(loadHolidayData()),
    windows: loadPolicyData().peakWindows,
  });
  const next = (iso) => {
    const found = schedule.nextSwitch(new Date(iso));
    return found && { at: found.at.toISOString(), period: found.period };
  };

  test("an off-peak evening switches at the next working morning", () => {
    expect(next("2026-10-20T11:00:00Z")).toEqual({ at: "2026-10-21T01:00:00.000Z", period: PERIOD.PEAK });
  });

  test("a peak morning switches at the lunch break", () => {
    expect(next("2026-10-21T02:00:00Z")).toEqual({ at: "2026-10-21T04:00:00.000Z", period: PERIOD.OFF_PEAK });
  });

  test("a holiday run is skipped, make-up Saturday included", () => {
    // 2026-10-01..07 is the National Day holiday, 10-10 a make-up Saturday (off-peak).
    expect(next("2026-10-02T03:00:00Z")).toEqual({ at: "2026-10-08T01:00:00.000Z", period: PERIOD.PEAK });
  });
});
