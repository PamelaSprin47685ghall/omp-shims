import { describe, expect, test } from "bun:test";
import { parseCooldownMs, sortByConfiguredOrder } from "../features/antigravity-account-routing.js";

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
