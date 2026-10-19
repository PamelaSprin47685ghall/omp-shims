import { describe, expect, test } from "bun:test";
import { install as installRouting, resolveRoute } from "../features/antigravity-routing.js";
import { install as installSystemInstruction } from "../features/antigravity-system-instruction.js";
import { CLOUD_CODE_URL, fakeContext, recordingNext } from "./helpers.js";

/** Drive a single fetch layer and return the body that reached `next`. */
async function sentBody(installFeature, config, body, url = CLOUD_CODE_URL) {
  const { context, handlers } = fakeContext();
  installFeature(config, context);
  const { next, calls } = recordingNext();
  await handlers[0](url, { method: "POST", body: JSON.stringify(body) }, next);
  return JSON.parse(calls[0].init.body);
}

describe("antigravity-system-instruction", () => {
  const envelope = {
    requestType: "agent",
    request: {
      systemInstruction: { parts: [{ text: "be nice" }] },
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    },
  };

  test("moves the system prompt into a leading user turn", async () => {
    const body = await sentBody(installSystemInstruction, {}, envelope);
    expect(body.request.systemInstruction).toBeUndefined();
    expect(body.request.contents).toEqual([
      { role: "user", parts: [{ text: "be nice" }] },
      { role: "user", parts: [{ text: "hi" }] },
    ]);
  });

  test("leaves non-agent envelopes and other hosts alone", async () => {
    const other = { ...envelope, requestType: "chat" };
    expect(await sentBody(installSystemInstruction, {}, other)).toEqual(other);
    expect(await sentBody(installSystemInstruction, {}, envelope, "https://example.com/v1/chat")).toEqual(envelope);
  });

  test("raises a small maxOutputTokens floor so function calls are not truncated upstream", async () => {
    const body = await sentBody(installSystemInstruction, {}, {
      ...envelope,
      request: { ...envelope.request, generationConfig: { maxOutputTokens: 4096 } },
    });
    expect(body.request.generationConfig.maxOutputTokens).toBe(8192);
  });

  test("keeps an output budget that already clears the floor", async () => {
    const budget = {
      ...envelope,
      request: { ...envelope.request, generationConfig: { maxOutputTokens: 32_000 } },
    };
    expect((await sentBody(installSystemInstruction, {}, budget)).request.generationConfig.maxOutputTokens).toBe(32_000);
  });
});

describe("antigravity-routing", () => {
  test("resolveRoute maps Flash models to their -tiered variants", () => {
    expect(resolveRoute("gemini-3.7-flash", {}, "HIGH")).toEqual({ model: "gemini-3.7-flash-tiered", level: "HIGH" });
    expect(resolveRoute("gemini-3.6-flash-low", {}, "HIGH")).toEqual({
      model: "gemini-3.6-flash-tiered",
      level: "LOW",
    });
    expect(
      resolveRoute("gemini-3.8-flash", { generationConfig: { thinkingConfig: { thinkingLevel: "MEDIUM" } } }, "HIGH"),
    ).toEqual({ model: "gemini-3.8-flash-tiered", level: "MEDIUM" });
    expect(resolveRoute("gemini-3.5-flash", {}, "HIGH")).toBeUndefined();
  });

  test("rewrites the model and swaps the thinking budget for a level", async () => {
    const body = await sentBody(
      installRouting,
      { effort: "medium" },
      {
        requestType: "agent",
        model: "gemini-3.7-flash",
        request: { generationConfig: { thinkingConfig: { thinkingBudget: 1024 } } },
      },
    );
    expect(body.model).toBe("gemini-3.7-flash-tiered");
    expect(body.request.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "MEDIUM" });
  });

  test("OMP_SHIMS_AG_EFFORT sets the default thinking level", async () => {
    process.env.OMP_SHIMS_AG_EFFORT = "low";
    try {
      const body = await sentBody(
        installRouting,
        { effort: "high" },
        { requestType: "agent", model: "gemini-3.8-flash" },
      );
      expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe("LOW");
    } finally {
      delete process.env.OMP_SHIMS_AG_EFFORT;
    }
  });

  test("leaves tiny output budgets alone", async () => {
    const original = {
      requestType: "agent",
      model: "gemini-3.7-flash",
      request: { generationConfig: { maxOutputTokens: 100 } },
    };
    expect(await sentBody(installRouting, {}, original)).toEqual(original);
  });
});
