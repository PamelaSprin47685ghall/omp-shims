import { afterEach, describe, expect, test } from "bun:test";
import { setHostStream } from "../vendor/earendil-works-pi-ai/index.js";
import { streamOpenAICompletions } from "@mariozechner/pi-ai";
import {
  streamMistralVibe,
  withMistralThinkingHistory,
} from "../lib/mistral-vibe-transport.js";

afterEach(() => setHostStream(null));

const model = { provider: "mistral-vibe", api: "mistral-vibe-native",
  id: "zai-glm-5-3-flash", baseUrl: "https://api.mistral.ai/v1", reasoning: true };
const toolCall = { type: "toolCall", id: "call_7", name: "get_time", arguments: { city: "Tokyo" } };
const assistant = (thinking, text) => ({
  role: "assistant",
  content: [
    { type: "thinking", thinking, thinkingSignature: "native-signature" },
    { type: "text", text },
  ],
});

describe("Mistral Vibe pre-serialization thinking replay", () => {
  test("repairs pi-ai's actual plain text assistant history to Vibe native blocks", () => {
    const context = { messages: [{ role: "user", content: "Question" },
      assistant("The private reasoning.", "YES"), { role: "user", content: "Follow-up" }] };
    const payload = { messages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "YES" },
      { role: "user", content: "Follow-up" },
    ] };
    const corrected = withMistralThinkingHistory(payload, context);
    expect(corrected.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: [{ type: "text", text: "The private reasoning." }],
          signature: "native-signature" },
        { type: "text", text: "YES" },
      ],
    });
    expect(payload.messages[1].content).toBe("YES");
    expect(context.messages[1].content[0].thinking).toBe("The private reasoning.");
  });

  test("preserves tool call identities, serialized arguments, and thinking-only responses", () => {
    const context = { messages: [
      { role: "assistant", content: [
        { type: "thinking", thinking: "Call get_time." }, toolCall,
      ] },
    ] };
    const calls = [{ id: "call_7", type: "function",
      function: { name: "get_time", arguments: JSON.stringify({ city: "Tokyo" }) } }];
    const payload = { messages: [{ role: "assistant", content: null, tool_calls: calls }] };
    const actual = withMistralThinkingHistory(payload, context);
    expect(actual.messages[0].content).toEqual([
      { type: "thinking", thinking: [{ type: "text", text: "Call get_time." }] },
    ]);
    expect(actual.messages[0].tool_calls).toEqual(calls);
  });

  test("does not misattach different or ambiguous assistant history", () => {
    const different = withMistralThinkingHistory(
      { messages: [{ role: "assistant", content: "ALTERNATE" }] },
      { messages: [assistant("secret", "YES")] },
    );
    expect(different).toBeUndefined();
    const empty = withMistralThinkingHistory({ messages: [] }, { messages: [assistant("a", "b")] });
    expect(empty).toBeUndefined();
  });

  test("delegates standard OpenAI transport, modifying only Mistral onPayload", async () => {
    const context = { messages: [assistant("Keep this thinking", "OK")] };
    const modelSeen = [];
    setHostStream((receivedModel, receivedContext, opts) => {
      modelSeen.push({ receivedModel, receivedContext });
      return opts.onPayload({ messages: [{ role: "assistant", content: "OK" }], stream: true },
        receivedModel);
    });
    const corrected = await streamMistralVibe(model, context, {});
    expect(corrected.messages[0].content[0].type).toBe("thinking");
    expect(modelSeen[0].receivedModel.api).toBe("openai-completions");
    expect(model.api).toBe("mistral-vibe-native");
    expect(modelSeen[0].receivedContext).toBe(context);
  });

  test("composes user-provided onPayload before the replay without changing unrelated fields", async () => {
    const context = { messages: [assistant("Explanation", "OK")] };
    setHostStream((_model, _context, opts) =>
      opts.onPayload({ messages: [{ role: "assistant", content: "OK" }] }, model));
    const fixed = await streamMistralVibe(model, context, {
      onPayload: (payload) => ({ ...payload, metadata: { source: "custom" } }),
    });
    expect(fixed.metadata).toEqual({ source: "custom" });
    expect(fixed.messages[0].content[0].type).toBe("thinking");
  });

  test("real OMP OpenAI serializer emits Mistral-native thinking before sending HTTP", async () => {
    const originalFetch = globalThis.fetch;
    const captured = [];
    setHostStream((m, c, o) => streamOpenAICompletions(m, c, o));
    globalThis.fetch = async (target, init) => {
      const request = target instanceof Request ? target : new Request(target, init);
      const body = JSON.parse(await request.clone().text());
      captured.push(body);
      const chunk = (choices) => JSON.stringify({
        id: "chatcmpl-test", object: "chat.completion.chunk", created: 1,
        model: "zai-glm-5-3-flash", choices,
      });
      const data = [
        "data: " + chunk([{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }]),
        "data: " + chunk([{ index: 0, delta: {}, finish_reason: "stop" }]),
        "data: [DONE]",
        "",
      ].join("\n");
      return new Response(data, {
        status: 200, headers: { "content-type": "text/event-stream" },
      });
    };
    try {
      const context = {
        systemPrompt: "synthetic system",
        messages: [
          { role: "user", content: "first question" },
          { ...assistant("Actual historical reasoning", "YES"), api: "mistral-vibe-native",
            provider: "mistral-vibe", model: "zai-glm-5-3-flash", stopReason: "stop",
            timestamp: Date.now() },
          { role: "user", content: "continue" },
        ],
      };
      const stream = streamMistralVibe({
        ...model, input: ["text"], contextWindow: 128000, maxTokens: 4096,
      }, context, { apiKey: "test-only-key", maxTokens: 8, temperature: 0, maxRetries: 0 });
      for await (const _event of stream) {}
      expect(captured).toHaveLength(1);
      const msgs = captured[0].messages;
      const historical = msgs.filter((msg) => msg.role === "assistant");
      expect(historical).toHaveLength(1);
      expect(historical[0].content[0]).toEqual({
        type: "thinking", thinking: [{ type: "text", text: "Actual historical reasoning" }],
        signature: "native-signature",
      });
      expect(historical[0].content[1]).toEqual({ type: "text", text: "YES" });
      expect(msgs.at(-1).content).toBe("continue");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("never transforms other providers' outbound calls", () => {
    const other = { messages: [{ role: "assistant", content: "OK" }] };
    expect(other.messages[0].content).toBe("OK");
  });
});
