import { describe, expect, test } from "bun:test";
import { ComposedPolicy, isSchedulePeak, OFF_PEAK_SCHEDULES } from "../lib/router/plan.mjs";
import { seededRandom } from "../lib/router/ranking.mjs";
import offPeakPolicy from "../presets/offpeak.json";

const PEAK_AT = Date.parse("2026-11-09T02:00:00Z"); // Beijing Monday 10:00
const OFF_PEAK_AT = Date.parse("2026-11-09T05:00:00Z"); // Beijing Monday 13:00
const HOLIDAY_AT = Date.parse("2026-10-01T02:00:00Z"); // National Day, Beijing 10:00
const MAKEUP_AT = Date.parse("2026-10-10T02:00:00Z"); // Saturday make-up workday

const WINDOWS = [
  { from: "09:00", to: "12:00" },
  { from: "14:00", to: "18:00" },
];

const synthetic = {
  contextWindow: 500_000,
  maxOutputTokens: 64_000,
  maxInFlight: { $comment: "documentation", "p-a": 2, "p-b/model-x": 3 },
  peakWindows: WINDOWS,
  routes: {
    base: {
      displayName: "Base",
      graph: {
        type: "fallback",
        children: [
          { type: "model", model: "p-a/one", effort: "low", intelligence: 40, cost: 1 },
          { type: "model", model: "p-b/two", effort: "high", tier: "pro", intelligence: 60, cost: 2 },
        ],
      },
    },
    alias: { sameAs: "base", displayName: "Alias" },
    derived: {
      displayName: "Derived",
      derive: {
        from: "base",
        excludeModels: ["p-b/two"],
        append: [{ type: "model", model: "p-c/three", effort: "max", intelligence: 70, cost: 0.5 }],
      },
    },
    until: { graph: { type: "model", model: "p-a/one", activeUntil: "2026-11-09T03:00:00Z" } },
    off: { graph: { type: "model", model: "p-a/one", offPeakOnly: true } },
    vendor: { graph: { type: "model", model: "p-c/three", offPeakOnly: "deepseek" } },
  },
};

/** A plan with synthetic routes and the required peak windows. */
const planData = (routes) => ({ peakWindows: WINDOWS, routes });

const accounts = [
  { provider: "p-a", account: 11, tier: "free" },
  { provider: "p-b", account: 12, tier: "pro" },
  { provider: "p-c", account: 13, tier: null },
];

function tierOf(provider, account) {
  return accounts.find((row) => row.provider === provider && row.account === account)?.tier;
}

const baseOptions = { period: "peak", accounts, tierOf, at: PEAK_AT, random: seededRandom(5) };

describe("ComposedPolicy ids and limits", () => {
  test("route ids are opaque and never prefixed", () => {
    const policy = new ComposedPolicy();
    expect(policy.modelIdOf("lazy/pro")).toBe("lazy/pro");
    expect(policy.modelIdOf("lazy/lazy/pro")).toBe("lazy/lazy/pro");
    expect(policy.modelIdOf("some-other-model")).toBe("some-other-model");
    expect(policy.routeNames).toContain("lazy/pro");
    expect(policy.displayNameOf("lazy/pro")).toBe("Lazy Pro");
  });

  test("lazy/paid resolves to exactly the kuaipao Sonnet leaf at medium effort", () => {
    const policy = new ComposedPolicy();
    expect(policy.routeNames).toContain("lazy/paid");
    expect(policy.displayNameOf("lazy/paid")).toBe("Lazy Paid · Claude Sonnet 5.5");
    const candidates = policy.candidatesFor("lazy/paid", { period: "peak", at: PEAK_AT });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      routeId: "lazy/paid",
      provider: "kuaipao",
      model: "kuaipao/claude-sonnet-5-5",
      effort: "medium",
    });
  });

  test("maxInFlight reads provider and model keys, and 0 means unlimited", () => {
    const policy = new ComposedPolicy(synthetic);
    expect(policy.maxInFlight("p-a")).toBe(2);
    expect(policy.maxInFlight("p-b/model-x")).toBe(3);
    expect(policy.maxInFlight("p-b/99")).toBe(0);
    expect(policy.maxInFlight("unknown")).toBe(0);
  });

  test("peakWindows keeps clock strings", () => {
    const policy = new ComposedPolicy(synthetic);
    expect(policy.peakWindows).toEqual(WINDOWS);
  });

  test("peakWindows is required, with no code fallback", () => {
    expect(() => new ComposedPolicy({ routes: {} })).toThrow(/peakWindows/);
    expect(() => new ComposedPolicy({ peakWindows: [], routes: {} })).toThrow(/peakWindows/);
  });
});

describe("ComposedPolicy graph semantics", () => {
  const policy = new ComposedPolicy(synthetic);

  test("model leaves expand per account and keep numeric ids", () => {
    const candidates = policy.candidatesFor("base", baseOptions);
    expect(candidates.map((candidate) => candidate.model)).toEqual(["p-a/one", "p-b/two"]);
    expect(candidates[0]).toMatchObject({
      routeId: "base",
      provider: "p-a",
      account: 11,
      unitKey: "p-a/11",
      model: "p-a/one",
      effort: "low",
      tier: "free",
      intelligence: 40,
      cost: 1,
    });
    expect(candidates[0].leafKey).toBe("base:root.0");
  });

  test("the tier filter accepts only matching accounts", () => {
    const wrongTiers = [
      { provider: "p-a", account: 11, tier: "free" },
      { provider: "p-b", account: 12, tier: "free" },
    ];
    const candidates = policy.candidatesFor("base", {
      ...baseOptions,
      accounts: wrongTiers,
      tierOf: undefined,
    });
    expect(candidates.map((candidate) => candidate.model)).toEqual(["p-a/one"]);
  });

  test("without accounts one provider-level template is returned per leaf", () => {
    const candidates = policy.candidatesFor("base", { period: "peak", at: PEAK_AT });
    expect(candidates.map((candidate) => candidate.account)).toEqual([null, null]);
    expect(candidates[1].tiers).toEqual(["pro"]);
  });

  test("sameAs reuses the source graph", () => {
    const base = policy.candidatesFor("base", baseOptions);
    const alias = policy.candidatesFor("alias", baseOptions);
    expect(alias.map((candidate) => candidate.model)).toEqual(base.map((candidate) => candidate.model));
    expect(policy.displayNameOf("alias")).toBe("Alias");
  });

  test("derive excludes models and appends new leaves after the source", () => {
    const derived = policy.candidatesFor("derived", baseOptions);
    expect(derived.map((candidate) => candidate.model)).toEqual(["p-a/one", "p-c/three"]);
  });

  test("activeUntil hides a leaf at the deadline", () => {
    expect(policy.candidatesFor("until", baseOptions).map((candidate) => candidate.model)).toEqual(["p-a/one"]);
    expect(policy.candidatesFor("until", { ...baseOptions, at: Date.parse("2026-11-09T03:00:00Z") })).toEqual([]);
  });

  test("offPeakOnly true follows the caller's period", () => {
    expect(policy.candidatesFor("off", baseOptions)).toEqual([]);
    expect(policy.candidatesFor("off", { ...baseOptions, period: "offPeak" })).toHaveLength(1);
  });

  test("offPeakOnly deepseek follows the vendor clock and holidays", () => {
    const vendorPeak = { ...baseOptions, period: "offPeak", at: PEAK_AT };
    expect(policy.candidatesFor("vendor", vendorPeak)).toEqual([]);
    expect(policy.candidatesFor("vendor", { ...baseOptions, at: OFF_PEAK_AT })).toHaveLength(1);
    expect(policy.candidatesFor("vendor", { ...baseOptions, period: "offPeak", at: HOLIDAY_AT })).toHaveLength(1);
  });

  test("a rating node keeps fallback precedence inside each child", () => {
    const rated = new ComposedPolicy(
      planData({
        rated: {
          graph: {
            type: "rating",
            children: [
              {
                type: "fallback",
                children: [
                  { type: "model", model: "p-a/first", intelligence: 10, cost: 1 },
                  { type: "model", model: "p-a/second", intelligence: 90, cost: 1 },
                ],
              },
              { type: "model", model: "p-b/third", intelligence: 50, cost: 1 },
            ],
          },
        },
      }),
    );
    const ratedAccounts = [
      { provider: "p-a", account: 1, tier: "free" },
      { provider: "p-b", account: 2, tier: "free" },
    ];
    const candidates = rated.candidatesFor("rated", {
      period: "peak",
      accounts: ratedAccounts,
      tierOf: () => "free",
      at: PEAK_AT,
      random: seededRandom(3),
      temperature: 0,
    });
    const models = candidates.map((candidate) => candidate.model);
    expect(models.indexOf("p-a/first")).toBeLessThan(models.indexOf("p-a/second"));
    expect(models).toHaveLength(3);
  });
});

describe("ComposedPolicy peak schedule", () => {
  const policy = new ComposedPolicy(synthetic);

  test("Beijing windows are peak on an ordinary weekday", () => {
    expect(policy.periodAt(PEAK_AT)).toBe("peak");
    expect(policy.periodAt(Date.parse("2026-11-09T03:59:00Z"))).toBe("peak");
    expect(policy.periodAt(Date.parse("2026-11-09T04:00:00Z"))).toBe("offPeak");
    expect(policy.periodAt(Date.parse("2026-11-09T06:00:00Z"))).toBe("peak");
    expect(policy.periodAt(Date.parse("2026-11-09T10:00:00Z"))).toBe("offPeak");
  });

  test("a statutory holiday is off-peak all day", () => {
    expect(policy.periodAt(HOLIDAY_AT)).toBe("offPeak");
    expect(policy.scheduleAt(HOLIDAY_AT)).toMatchObject({ period: "offPeak", dayKind: "holiday" });
  });

  test("a weekend make-up workday is still off-peak under Mon-Fri", () => {
    const schedule = policy.scheduleAt(MAKEUP_AT);
    expect(schedule.dayKind).toBe("makeup-workday");
    expect(schedule.period).toBe("offPeak");
  });

  test("a weekend is off-peak", () => {
    expect(policy.periodAt(Date.parse("2026-11-08T02:00:00Z"))).toBe("offPeak");
  });
});

describe("off-peak schedule policy", () => {
  test("schedule names come from presets/offpeak.json", () => {
    expect(OFF_PEAK_SCHEDULES).toEqual(Object.keys(offPeakPolicy.schedules));
    for (const name of OFF_PEAK_SCHEDULES) {
      expect(() => isSchedulePeak(name, PEAK_AT, undefined)).not.toThrow();
    }
  });

  test("an unknown schedule name is rejected at graph compilation", () => {
    expect(
      () =>
        new ComposedPolicy(
          planData({ vendor: { graph: { type: "model", model: "p-a/one", offPeakOnly: "not-a-schedule" } } }),
        ),
    ).toThrow(/invalid offPeakOnly/);
  });
});

describe("ComposedPolicy rejects broken graphs", () => {
  test("route alias cycles are rejected", () => {
    expect(() => new ComposedPolicy(planData({ a: { sameAs: "b" }, b: { sameAs: "a" } }))).toThrow(/cycle/);
  });

  test("derive cycles are rejected", () => {
    expect(() => new ComposedPolicy(planData({ a: { derive: { from: "b" } }, b: { derive: { from: "a" } } }))).toThrow(
      /cycle/,
    );
  });

  test("empty composites and bad model references are rejected", () => {
    expect(() => new ComposedPolicy(planData({ a: { graph: { type: "rating", children: [] } } }))).toThrow();
    expect(() => new ComposedPolicy(planData({ a: { graph: { type: "model", model: "no-slash" } } }))).toThrow(
      /provider\/model/,
    );
  });

  test("an embedded credential is rejected", () => {
    expect(
      () => new ComposedPolicy(planData({ a: { graph: { type: "model", model: "p/m", credentialId: 7 } } })),
    ).toThrow(/accounts/);
  });

  test("an unknown route id is an error, not an empty list", () => {
    expect(() => new ComposedPolicy(synthetic).candidatesFor("missing", { period: "peak" })).toThrow(/unknown route/);
  });
});
