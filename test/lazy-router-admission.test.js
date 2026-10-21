import { describe, expect, test } from "bun:test";
import { AdmissionControl, AdmissionWindow } from "../lib/lazy-router/admission.js";

const clock = () => {
  const c = { t: 0, now: () => c.t };
  return c;
};

describe("AdmissionWindow", () => {
  test("admits everyone while the unit can afford every request (rate >= 1) or has seen none", () => {
    const window = new AdmissionWindow();
    expect(window.admits(0, 3)).toBe(true);
    for (const x of [0, 0, 0]) window.observe(x);
    expect(window.threshold(3)).toBeUndefined();
    expect(window.admits(0, 3)).toBe(true);
  });

  test("beyond that, only the best maxInFlight / N share of matches is admitted", () => {
    const window = new AdmissionWindow();
    for (const x of [0, 0.9, 0.1, 0.5, 0, 0.7, 0, 0, 0.2, 0]) window.observe(x);
    // N = 10, maxInFlight = 3: rate 0.3, threshold = the 0.7 quantile = the 3rd best sample.
    expect(window.threshold(3)).toBe(0.5);
    expect(window.admits(0.5, 3)).toBe(true); // ties at the threshold are admitted
    expect(window.admits(0.49, 3)).toBe(false);
    expect(window.admits(0.95, 3)).toBe(true);
  });

  test("when the best share is all zeros, a zero match is admitted (tie)", () => {
    const window = new AdmissionWindow();
    for (let i = 0; i < 10; i += 1) window.observe(i < 8 ? 0 : 0.6);
    expect(window.threshold(3)).toBe(0);
    expect(window.admits(0, 3)).toBe(true);
    window.observe(0.4);
    expect(window.admits(0, 3)).toBe(false);
  });

  test("samples leave the window after windowMs; the sample count is capped", () => {
    const c = clock();
    const window = new AdmissionWindow({ windowMs: 1_000, maxSamples: 5, now: c.now });
    for (let i = 0; i < 8; i += 1) window.observe(i / 10);
    expect(window.count).toBe(5);
    c.t = 1_000;
    expect(window.count).toBe(0);
    expect(window.admits(0, 1)).toBe(true);
  });
});

describe("AdmissionControl", () => {
  test("keeps one window per unit and records the sample before deciding", () => {
    const control = new AdmissionControl();
    expect(control.evaluate("u1", 0, 1)).toEqual({ admitted: true, threshold: null, window: 1 });
    expect(control.evaluate("u1", 0.8, 1)).toMatchObject({ admitted: true, threshold: 0.8, window: 2 });
    expect(control.evaluate("u1", 0, 1)).toMatchObject({ admitted: false, threshold: 0.8, window: 3 });
    expect(control.evaluate("u2", 0, 1).admitted).toBe(true);
    expect(control.windowCount("u1")).toBe(3);
    expect(control.windowCount("nobody")).toBe(0);
  });
});
