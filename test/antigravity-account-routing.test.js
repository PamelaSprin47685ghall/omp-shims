import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ULTRA_PATTERN,
  parseCooldownMs,
  selectProCandidates,
  sortByConfiguredOrder,
} from "../features/antigravity-account-routing.js";

describe("DEFAULT_ULTRA_PATTERN", () => {
  test("Gemini 4, Opus and Sonnet are Ultra-only", () => {
    for (const model of ["gemini-4-argon", "gemini-4-argon-high", "claude-opus-4-6-thinking", "claude-sonnet-4-6"]) {
      expect(DEFAULT_ULTRA_PATTERN.test(model)).toBe(true);
    }
  });

  test("Gemini 3.8 Flash and other Gemini models are Pro-first", () => {
    for (const model of ["gemini-3.8-flash", "gemini-3.8-flash-high", "gemini-3.5-flash-lite"]) {
      expect(DEFAULT_ULTRA_PATTERN.test(model)).toBe(false);
    }
  });
});

describe("parseCooldownMs", () => {
  test("reads retryDelay / quotaResetDelay seconds", () => {
    expect(parseCooldownMs('{"retryDelay": "12.5s"}', 1)).toBe(12_500);
    expect(parseCooldownMs('{"quotaResetDelay":"30s"}', 1)).toBe(30_000);
  });

  test("reads 'Resets in 1h2m3s'", () => {
    expect(parseCooldownMs("quota exhausted. Resets in 1h2m3s", 1)).toBe(3_723_000);
  });

  test("caps at one day and falls back to the default", () => {
    expect(parseCooldownMs('{"retryDelay":"999999s"}', 1)).toBe(86_400_000);
    expect(parseCooldownMs("nothing useful", 42)).toBe(42);
    expect(parseCooldownMs("", 42)).toBe(42);
  });
});

test("sortByConfiguredOrder puts configured accounts first, in order", () => {
  const accounts = [
    { id: 1, email: "c@example.com" },
    { id: 2, email: "B@example.com" },
    { id: 3, email: "a@example.com" },
  ];
  const sorted = sortByConfiguredOrder(accounts, ["a@example.com", "b@example.com"]);
  expect(sorted.map((account) => account.id)).toEqual([3, 2, 1]);
});

describe("selectProCandidates", () => {
  const now = 1_000_000;
  const pro = (id, cooldownUntil) => ({ id, email: `pro${id}@example.com`, isPro: true, cooldownUntil });
  const ultra = (id, cooldownUntil) => ({ id, email: `ultra${id}@example.com`, isUltra: true, cooldownUntil });

  test("available pros come first, then available ultras", () => {
    const pros = [pro(1, now - 1), pro(2, now + 5_000)];
    const ultras = [ultra(9, now - 1)];
    expect(selectProCandidates(now, pros, ultras).map((a) => a.id)).toEqual([1, 9]);
  });

  test("all pros cooling goes straight to ultra without re-trying any pro", () => {
    const pros = [pro(1, now + 5_000), pro(2, now + 9_000), pro(3, now + 3_000)];
    const ultras = [ultra(9, now - 1)];
    expect(selectProCandidates(now, pros, ultras).map((a) => a.id)).toEqual([9]);
  });

  test("everything cooling keeps the single soonest-expiring account", () => {
    const pros = [pro(1, now + 5_000), pro(2, now + 9_000)];
    const ultras = [ultra(9, now + 7_000)];
    expect(selectProCandidates(now, pros, ultras).map((a) => a.id)).toEqual([1]);
  });

  test("no accounts at all yields no candidates", () => {
    expect(selectProCandidates(now, [], [])).toEqual([]);
  });
});
