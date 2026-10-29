import { describe, expect, test } from "bun:test";
import { officialApiEquivalent, OFFICIAL_RATE_DATE } from "../lib/lazy-router/official-rate-value.js";
import { TokenTotals } from "../lib/lazy-router/token-totals.js";
import { ComposedPolicy } from "../lib/lazy-router/composed-policy.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("published model API price equivalent, never actual subscription billing", () => {
  test("GLM Flash uses Mistral's official uncached/cache/output rates", () => {
    const x = officialApiEquivalent([{ model:"mistral-vibe/zai-glm-5-3-flash",
      uncachedInput:1_000_000,cachedInput:1_000_000,output:1_000_000 }]);
    expect(x.valueUsd).toBeCloseTo(.68, 10);
    expect(x.pricedModels).toBe(1);
    expect(x.unpricedModels).toBe(0);
    expect(x.models[0].perMillion).toEqual({ uncachedInput:.15,cachedInput:.03,output:.5 });
    expect(x.ratesAsOf).toBe(OFFICIAL_RATE_DATE);
    expect(x.models[0].source).toContain("mistral.ai");
  });
  test("Terra Codex reference Standard and OpenAI Flex are charged as different equivalents", () => {
    const million={uncachedInput:1_000_000,cachedInput:1_000_000,output:1_000_000};
    const x=officialApiEquivalent([
      {model:"openai-codex/gpt-6.1-terra",...million},
      {model:"openai-api/gpt-6.1-terra",...million},
    ]);
    expect(x.valueUsd).toBeCloseTo(6.05+3.025, 10);
    expect(x.models.find((m)=>m.model.startsWith("openai-api/")).valueUsd).toBeCloseTo(3.025,10);
    expect(x.models.find((m)=>m.model.startsWith("openai-codex/")).valueUsd).toBeCloseTo(6.05,10);
  });
  test("all known DeepSeek providers price at documented underlying official reference", () => {
    const models=["ctyun/deepseek-v4.1-flash","charm-hyper/deepseek-v4.1-flash-1017",
      "opencode-go/deepseek-v4.1-flash","ollama-cloud/deepseek-v4.1-flash:1017",
      "cline-pass/deepseek-v4.1-flash-1017"];
    for(const model of models){
      const x=officialApiEquivalent([{model,uncachedInput:1_000_000,
        cachedInput:1_000_000,output:1_000_000}]);
      expect(x.valueUsd).toBeCloseTo(1.506,10);
      expect(x.models[0].basis).toContain("高峰参考价");
    }
    const mistral=officialApiEquivalent([{model:"mistral-vibe/deepseek-v4-1-flash-1017",
      uncachedInput:1_000_000,cachedInput:1_000_000,output:1_000_000}]);
    expect(mistral.valueUsd).toBeCloseTo(1.507,10);
  });
  test("known Anthropic, Google, and Mistral Small are priced; unknown never silently zero-priced", () => {
    const known=officialApiEquivalent([
      {model:"kiro/claude-opus-5-5",uncachedInput:1_000_000},
      {model:"google-antigravity/claude-opus-5-5",uncachedInput:1_000_000},
      {model:"google-antigravity/gemini-4-argon",uncachedInput:1_000_000},
      {model:"mistral-vibe/mistral-small-latest",uncachedInput:1_000_000},
    ]);
    expect(known.valueUsd).toBeCloseTo(10.15,10);
    const unknown=officialApiEquivalent([{model:"surprise/new-unpriced-model",
      uncachedInput:900000, output:700000}]);
    expect(unknown.valueUsd).toBe(0);
    expect(unknown.unpricedModels).toBe(1);
    expect(unknown.models[0].priced).toBe(false);
    expect(unknown.models[0].valueUsd).toBeNull();
  });
  test("noninteger, negative and absent telemetry cannot fabricate value", () => {
    const x=officialApiEquivalent([{model:"mistral-vibe/zai-glm-5-3-flash",
      uncachedInput:-1,cachedInput:1.1,output:undefined}]);
    expect(x.valueUsd).toBe(0);
    expect(x.totalModels).toBe(1);
  });
  test("reset button's TokenTotals.reset clears official equivalent with same totals table and new writes accrue", () => {
    const dir=mkdtempSync(join(tmpdir(),"lazy-price-reset-"));
    try{
      const totals=new TokenTotals({path:join(dir,"totals.sqlite")});
      totals.record("mistral-vibe/zai-glm-5-3-flash",
        {uncachedInput:1000000,cachedInput:1000000,output:1000000});
      totals.record("openai-api/gpt-6.1-terra",
        {uncachedInput:1000000,cachedInput:1000000,output:1000000});
      const before=totals.view();
      expect(before.officialValue.valueUsd).toBeCloseTo(3.705,9);
      expect(before.coverage.complete).toBe(2);
      expect(totals.reset()).toBe(true);
      const after=totals.view();
      expect(after.officialValue.valueUsd).toBe(0);
      expect(after.officialValue.models).toEqual([]);
      expect(after.coverage.complete).toBe(0);
      expect(after.totals.uncachedInput).toBe(0);
      totals.record("mistral-vibe/zai-glm-5-3-flash",{output:1000000});
      expect(totals.view().officialValue.valueUsd).toBeCloseTo(.5,10);
      totals.close();
    }finally { rmSync(dir,{recursive:true,force:true}); }
  });
  test("GLM Flash Lazy Task effort is max and other tasks are untouched",()=>{
    const policy=new ComposedPolicy();
    const graph=policy.routeTopology()["lazy/task"].graph;
    const glm=graph.children.find((x)=>x.model==="mistral-vibe/zai-glm-5-3-flash");
    expect(glm.effort).toBe("max");
    expect(graph.children.find((x)=>x.model==="ctyun/deepseek-v4.1-flash").effort).toBe("max");
  });
});
