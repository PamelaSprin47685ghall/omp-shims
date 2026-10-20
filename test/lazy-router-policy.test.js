import { describe, expect, test } from "bun:test";
import { PERIOD } from "../lib/lazy-router/calendar.js";
import { loadPolicyData, RoutePolicy } from "../lib/lazy-router/policy.js";

const policy = new RoutePolicy(loadPolicyData());
const order = (route, period) => policy.candidates(route, period).candidates.map((c) => `${c.unit.label} ${c.model}`);

describe("bundled route tables", () => {
  test("peak default follows the priority list, expanding unit groups in credential order", () => {
    expect(order("default", PERIOD.PEAK)).toEqual([
      "cx-18 openai-codex/gpt-6.1-sol",
      "ki-16 kiro/claude-opus-5-5",
      "cc-17 commandcode/minimax/minimax-m3.1-flash:free",
      "ag-u5 google-antigravity/gemini-4-argon",
      "ag-p22 google-antigravity/gemini-4-argon",
      "ag-p23 google-antigravity/gemini-4-argon",
      "ag-p24 google-antigravity/gemini-4-argon",
      "cx-19 openai-codex/gpt-6.1-sol",
      "cp-15 cline-pass/glm-5.3-flash",
      "cp-27 cline-pass/glm-5.3-flash",
      "ol-31 ollama-cloud/glm-5.3-flash",
      "qd-26 qoder-cn/qwen3.8-flash",
      "ch-21 charm-hyper/qwen3.8-flash",
      "xa-20 xai-oauth/grok-4.7",
      "ct-yml ctyun/deepseek-v4-pro-0813-oc",
      "nv-29 nvidia/z-ai/glm-5.3-flash",
    ]);
  });

  test("off-peak default is opencode-go first, then the whole peak list", () => {
    const offPeak = order("default", PERIOD.OFF_PEAK);
    expect(offPeak[0]).toBe("og-30 opencode-go/deepseek-v4.1-flash");
    expect(offPeak.slice(1)).toEqual(order("default", PERIOD.PEAK));
  });

  test("capped entries are exactly the codex, kiro and gemini-4 ones", () => {
    const capped = policy
      .candidates("default", PERIOD.PEAK)
      .candidates.filter((c) => c.effort === "capped")
      .map((c) => c.unit.label);
    expect(capped).toEqual(["cx-18", "ki-16", "ag-u5", "ag-p22", "ag-p23", "ag-p24", "cx-19"]);
  });

  test("task lists differ by period", () => {
    expect(order("task", PERIOD.PEAK)[0]).toBe("cc-17 commandcode/minimax/minimax-m3.1-flash:free");
    expect(order("task", PERIOD.OFF_PEAK).slice(0, 2)).toEqual([
      "cc-17 commandcode/minimax/minimax-m3.1-flash:free",
      "ct-yml ctyun/deepseek-v4-pro-0813-oc",
    ]);
  });

  test("vision derives from task and requires image input", () => {
    const { candidates, require } = policy.candidates("vision", PERIOD.PEAK);
    expect(require).toEqual(["text", "image"]);
    expect(candidates).toEqual(policy.candidates("task", PERIOD.PEAK).candidates);
  });

  test("pinned units carry their credential id; single-key units do not", () => {
    const units = Object.fromEntries(
      policy.candidates("default", PERIOD.OFF_PEAK).candidates.map((c) => [c.unit.label, c.unit]),
    );
    expect(units["ag-p23"].credentialId).toBe(23);
    expect(units["cx-19"].credentialId).toBe(19);
    expect(units["ki-16"].credentialId).toBeUndefined();
  });

  test("routeFor accepts only lazy models with a table", () => {
    expect(policy.routeFor("lazy/task")).toBe("task");
    expect(policy.routeFor("lazy/nope")).toBeUndefined();
    expect(policy.routeFor("kiro/claude-opus-5-5")).toBeUndefined();
  });
});

describe("validation", () => {
  const base = () => ({
    units: { a: { provider: "p" }, b: { provider: "q" } },
    routes: { r: { periods: { peak: [{ units: ["a"], model: "p/m" }] } } },
  });

  test("a unit must belong to the model's provider", () => {
    const data = base();
    data.routes.r.periods.peak[0].units = ["b"];
    expect(() => new RoutePolicy(data)).toThrow(/cannot serve/);
  });

  test("unknown units and sameAs cycles are rejected at load time", () => {
    const unknown = base();
    unknown.routes.r.periods.peak[0].units = ["zz"];
    expect(() => new RoutePolicy(unknown)).toThrow(/unknown unit/);

    const cycle = base();
    cycle.routes.r.periods = { peak: [{ sameAs: "offPeak" }], offPeak: [{ sameAs: "peak" }] };
    expect(() => new RoutePolicy(cycle)).toThrow(/cycle/);
  });
});
