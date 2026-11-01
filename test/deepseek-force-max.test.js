import { describe, expect, test } from "bun:test";
import { loadCompositionData } from "../lib/lazy-router/composed-policy.js";
import { resolveEffort, resolveRoutedEffort, probeEffort } from "../lib/lazy-router/effort.js";
import { FORMATS, rewriteBody } from "../lib/lazy-router/formats.js";

const routes = loadCompositionData().routes;
const taskLeaves = routes["lazy/task"].graph.children;
const withoutThinking = { reasoning: false, efforts: [], canDisable: false };
const onlyHigh = { reasoning: true, efforts: ["low", "high"], canDisable: false };

describe("lazy/task sends the explicitly configured max to every DeepSeek", () => {
  test("all seven leaves stay max and maintain their off-peak schedules", () => {
    expect(taskLeaves).toHaveLength(7);
    for (const candidate of taskLeaves) {
      expect(candidate.model).toContain("/deepseek");
      expect(candidate.effort).toBe("max");
      const effective = resolveRoutedEffort({
        route:"lazy/task", model:candidate.model, policy:candidate.effort,
        requested:"none", traits:withoutThinking,
      });
      expect(effective).toBe("max");
      expect(resolveRoutedEffort({
        route:"lazy/task", model:candidate.model, policy:candidate.effort,
        requested:"xhigh", traits:onlyHigh,
      })).toBe("max");
    }
    expect(taskLeaves.filter(x=>x.offPeakOnly).map(x=>x.offPeakOnly))
      .toEqual(["deepseek","ollama","deepseek","commandcode"]);
  });

  test("max survives all three inbound protocols, independent of native model traits", () => {
    const sample = taskLeaves[0];
    for (const [path,body,read] of [
      ["/v1/chat/completions", {messages:[],reasoning_effort:"none"},
        x=>x.reasoning_effort],
      ["/v1/responses", {input:[],reasoning:{effort:"low",summary:"auto"}},
        x=>x.reasoning?.effort],
      ["/v1/messages", {messages:[],thinking:{type:"disabled"}},
        x=>x.output_config?.effort],
    ]) {
      const level=resolveRoutedEffort({route:"lazy/task",model:sample.model,
        policy:sample.effort,requested:"none",traits:withoutThinking});
      const outgoing=rewriteBody(FORMATS[path],
        {model:"lazy/task",...body},{model:sample.model,effort:level,maxTokens:64});
      expect(read(outgoing)).toBe("max");
      expect(outgoing.model).toBe(sample.model);
    }
  });

  test("other routes, non-DeepSeek models and probes keep original capability checks",()=>{
    expect(resolveEffort({policy:"max",traits:withoutThinking})).toBeUndefined();
    expect(resolveRoutedEffort({route:"lazy/default",
      model:"openai-codex/gpt-6.1-terra",policy:"max",
      traits:withoutThinking})).toBeUndefined();
    expect(resolveRoutedEffort({route:"lazy/default",
      model:taskLeaves[0].model,policy:"max",
      traits:withoutThinking})).toBeUndefined();
    expect(resolveRoutedEffort({route:"lazy/task",
      model:"example/glm-5.3-flash",policy:"max",
      traits:withoutThinking})).toBeUndefined();
    expect(resolveRoutedEffort({route:"lazy/task",
      model:taskLeaves[0].model,policy:"high",
      traits:withoutThinking})).toBeUndefined();
    expect(probeEffort(withoutThinking)).toBeUndefined();
  });
});
