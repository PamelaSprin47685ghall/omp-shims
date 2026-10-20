import { describe, expect, test } from "bun:test";
import { ModelCatalog, traitsOf } from "../lib/lazy-router/catalog.js";
import { EFFORT_POLICY, fitEffort, probeEffort, resolveEffort, targetEffort } from "../lib/lazy-router/effort.js";

const model = (efforts, extra = {}) => ({ reasoning: true, efforts, canDisable: false, ...extra });

describe("targetEffort", () => {
  test("a fixed level is used whatever the client asked for", () => {
    expect(targetEffort("low", "max")).toBe("low");
    expect(targetEffort("low", undefined)).toBe("low");
    expect(resolveEffort({ policy: "low", requested: "high", traits: model(["low", "medium", "high"]) })).toBe("low");
    expect(resolveEffort({ policy: "low", requested: "high", traits: model(["medium", "high"]) })).toBe("medium");
  });

  test("capped entries take min(requested, medium), medium when absent", () => {
    expect(targetEffort(EFFORT_POLICY.CAPPED, "max")).toBe("medium");
    expect(targetEffort(EFFORT_POLICY.CAPPED, "high")).toBe("medium");
    expect(targetEffort(EFFORT_POLICY.CAPPED, "low")).toBe("low");
    expect(targetEffort(EFFORT_POLICY.CAPPED, "minimal")).toBe("minimal");
    expect(targetEffort(EFFORT_POLICY.CAPPED, undefined)).toBe("medium");
    expect(targetEffort(EFFORT_POLICY.CAPPED, "bogus")).toBe("medium");
  });

  test("uncapped entries always use high", () => {
    expect(targetEffort(EFFORT_POLICY.HIGH, "minimal")).toBe("high");
    expect(targetEffort(undefined, undefined)).toBe("high");
  });
});

describe("fitEffort", () => {
  test("keeps a supported level", () => {
    expect(fitEffort("medium", model(["low", "medium", "high"]))).toBe("medium");
  });

  test("steps down to the nearest lower supported level", () => {
    // qoder-cn qwen3.8-flash: off/low/medium/xhigh
    expect(fitEffort("high", model(["low", "medium", "xhigh"]))).toBe("medium");
    // DeepSeek / GLM family: low/high/max
    expect(fitEffort("medium", model(["low", "high", "max"]))).toBe("low");
  });

  test("falls back to the lowest level when nothing is lower", () => {
    expect(fitEffort("minimal", model(["low", "high", "max"]))).toBe("low");
    expect(fitEffort("none", model(["low", "high"]))).toBe("low");
  });

  test("'none' survives only on models that can switch reasoning off", () => {
    expect(fitEffort("none", model(["low", "high"], { canDisable: true }))).toBe("none");
  });

  test("a model without reasoning gets no effort", () => {
    expect(fitEffort("high", { reasoning: false, efforts: [] })).toBeUndefined();
  });

  test("an unknown model or empty list passes the level through", () => {
    expect(fitEffort("high", undefined)).toBe("high");
    expect(fitEffort("high", model([]))).toBe("high");
  });
});

describe("resolveEffort / probeEffort", () => {
  test("the route-table examples", () => {
    const codex = model(["low", "medium", "high", "xhigh", "max"]);
    expect(resolveEffort({ policy: EFFORT_POLICY.CAPPED, requested: "high", traits: codex })).toBe("medium");
    const glm = model(["low", "high", "max"]);
    expect(resolveEffort({ policy: EFFORT_POLICY.HIGH, requested: "minimal", traits: glm })).toBe("high");
    const argon = model(["low", "medium", "high"]);
    expect(resolveEffort({ policy: EFFORT_POLICY.CAPPED, requested: "minimal", traits: argon })).toBe("low");
  });

  test("probes ask for low, or the closest the model accepts, never none", () => {
    expect(probeEffort(model(["minimal", "low", "medium"], { canDisable: true }))).toBe("low");
    expect(probeEffort(model(["high", "max"]))).toBe("high");
    expect(probeEffort({ reasoning: false })).toBeUndefined();
  });
});

describe("traitsOf", () => {
  test("a plugin thinkingLevelMap narrows the registry's levels (qoder-cn qwen3.8-flash)", () => {
    const traits = traitsOf({
      provider: "qoder-cn",
      id: "qwen3.8-flash",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      thinking: { mode: "effort", efforts: ["minimal", "low", "medium", "high"] },
      thinkingLevelMap: { off: "disabled", minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh" },
    });
    expect(traits.efforts).toEqual(["low", "medium"]);
    expect(traits.canDisable).toBe(true);
    expect(fitEffort("high", traits)).toBe("medium");
  });

  test("catalog models without a level map keep their declared levels", () => {
    const traits = traitsOf({
      provider: "nvidia",
      id: "z-ai/glm-5.3-flash",
      reasoning: true,
      thinking: { efforts: ["low", "high", "max"], requiresEffort: true },
    });
    expect(traits).toMatchObject({
      ref: "nvidia/z-ai/glm-5.3-flash",
      efforts: ["low", "high", "max"],
      canDisable: false,
    });
  });
});

test("ModelCatalog applies the policy's trait corrections", () => {
  const catalog = new ModelCatalog({
    overrides: { "qoder-cn/qwen3.8-flash": { $comment: "why", efforts: ["low", "medium"] } },
  });
  catalog.attach({
    getAll: () => [
      {
        provider: "qoder-cn",
        id: "qwen3.8-flash",
        reasoning: true,
        thinking: { efforts: ["minimal", "low", "medium", "high"] },
      },
    ],
  });
  const traits = catalog.find("qoder-cn/qwen3.8-flash");
  expect(traits.efforts).toEqual(["low", "medium"]);
  expect("$comment" in traits).toBe(false);
  expect(fitEffort("high", traits)).toBe("medium");
  expect(catalog.find("qoder-cn/unknown")).toBeUndefined();
});
