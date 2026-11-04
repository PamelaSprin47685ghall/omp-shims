import { describe, expect, test } from "bun:test";
import { restoreToolIds, rewriteToolIds } from "../features/tool-id-hash.js";
import { reasoningEffortOf } from "../lib/lazy-router/mistral-native-fallback.js";
import { convertChatJson, convertChatResponse, requestAsChat } from "../lib/lazy-router/protocol-interoperability.js";
import { chatAsResponses, responsesAsChat, responsesSseAsChat } from "../lib/lazy-router/responses-wire.js";

const CHAT = {
  id: "chatcmpl-1",
  created: 1,
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: {
        role: "assistant",
        content: "answer",
        reasoning_content: "plan",
        reasoning_signature: "sig",
      },
    },
  ],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 2,
    total_tokens: 12,
    prompt_tokens_details: { cached_tokens: 4 },
  },
};

const SSE = [
  'data: {"choices":[{"delta":{"reasoning_content":"pl"}}]}',
  'data: {"choices":[{"delta":{"reasoning_content":"an","reasoning_signature":"sig"}}]}',
  'data: {"choices":[{"delta":{"content":"OK"}}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
  "data: [DONE]",
  "",
].join("\n\n");

describe("typed bridge identities and reasoning", () => {
  test("non-streaming Messages keeps thinking and a message id", () => {
    const message = convertChatJson("/v1/messages", CHAT, "lazy/task");
    expect(message.id.startsWith("msg_")).toBe(true);
    expect(message.content).toEqual([
      { type: "thinking", thinking: "plan", signature: "sig" },
      { type: "text", text: "answer" },
    ]);
  });

  test("non-streaming Responses uses protocol ids and a summary", () => {
    const response = convertChatJson("/v1/responses", CHAT, "lazy/task");
    expect(response.id.startsWith("resp_")).toBe(true);
    const [reasoning, message] = response.output;
    expect(reasoning.id.startsWith("rs_")).toBe(true);
    expect(reasoning).toMatchObject({
      type: "reasoning",
      status: "completed",
      encrypted_content: "sig",
      summary: [{ type: "summary_text", text: "plan" }],
    });
    expect(message.id.startsWith("msg_")).toBe(true);
  });

  test("streaming Messages emits thinking, signature and text blocks", async () => {
    const text = await (
      await convertChatResponse(
        "/v1/messages",
        new Response(SSE, {
          headers: { "content-type": "text/event-stream" },
        }),
        "lazy/task",
      )
    ).text();
    expect(text).toContain('"id":"msg_');
    expect(text).toContain('"type":"thinking"');
    expect(text).toContain('"type":"thinking_delta","thinking":"pl"');
    expect(text).toContain('"type":"signature_delta","signature":"sig"');
    expect(text).toContain('"type":"text_delta","text":"OK"');
    expect(text).toContain('"stop_reason":"end_turn"');
    expect(text).toContain("event: message_stop");
  });

  test("streaming Responses emits a reasoning item before the message", async () => {
    const text = await (
      await convertChatResponse(
        "/v1/responses",
        new Response(SSE, {
          headers: { "content-type": "text/event-stream" },
        }),
        "lazy/task",
      )
    ).text();
    expect(text).toContain('"id":"resp_');
    expect(text).toContain("event: response.output_item.added");
    expect(text).toContain('"type":"reasoning"');
    expect(text).toContain("response.reasoning_summary_text.delta");
    expect(text).toContain("response.reasoning_summary_text.done");
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("event: response.completed");
    const reasoning = /"id":"(rs_[^"]+)","type":"reasoning"/.exec(text)?.[1];
    const message = /"id":"(msg_[^"]+)","type":"message"/.exec(text)?.[1];
    expect(reasoning).toBeString();
    expect(message).toBeString();
    expect(text).toContain(`"id":"${reasoning}","type":"reasoning"`);
    expect(text).toContain(`"id":"${message}","type":"message"`);
  });

  test("Messages history replays thinking as reasoning_content", () => {
    const chat = requestAsChat("/v1/messages", {
      model: "x",
      max_tokens: 16,
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "plan", signature: "sig" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    });
    expect(chat.messages[1]).toMatchObject({
      role: "assistant",
      content: "answer",
      reasoning_content: "plan",
      reasoning_signature: "sig",
    });
  });

  test("thinking-only assistant turns are not discarded", () => {
    const chat = requestAsChat("/v1/messages", {
      model: "x",
      max_tokens: 16,
      messages: [
        { role: "assistant", content: [{ type: "thinking", thinking: "plan" }] },
        { role: "user", content: "next" },
      ],
    });
    expect(chat.messages[0]).toMatchObject({ role: "assistant", reasoning_content: "plan" });
  });

  test("summary and content are not concatenated twice", () => {
    const chat = requestAsChat("/v1/responses", {
      model: "x",
      input: [
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "plan" }],
          content: [{ type: "reasoning_text", text: "plan" }],
        },
        { role: "assistant", content: [{ type: "output_text", text: "answer" }] },
      ],
    });
    expect(chat.messages[0].reasoning_content).toBe("plan");
    const fromOutput = responsesAsChat(
      {
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "plan" }],
            content: [{ type: "reasoning_text", text: "plan" }],
          },
        ],
      },
      "m",
    );
    expect(fromOutput.choices[0].message.reasoning_content).toBe("plan");
  });
});

describe("Responses wire preserves reasoning in both directions", () => {
  test("responsesAsChat carries reasoning and its signature", () => {
    const chat = responsesAsChat(
      {
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "sig" },
          { type: "message", content: [{ type: "output_text", text: "answer" }] },
        ],
      },
      "m",
    );
    expect(chat.choices[0].message).toMatchObject({
      content: "answer",
      reasoning_content: "plan",
      reasoning_signature: "sig",
    });
  });

  test("chatAsResponses emits a reasoning item and keeps include", () => {
    const body = chatAsResponses(
      {
        messages: [
          {
            role: "assistant",
            content: "answer",
            reasoning_content: "plan",
            reasoning_signature: "sig",
          },
        ],
      },
      "m",
      { include: ["reasoning.encrypted_content"] },
    );
    expect(body.input[0]).toMatchObject({
      type: "reasoning",
      encrypted_content: "sig",
      summary: [{ type: "summary_text", text: "plan" }],
    });
    expect(body.input[1]).toMatchObject({ role: "assistant" });
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
  });

  test("responsesSseAsChat maps reasoning deltas", async () => {
    const source = new Response(
      "event: response.reasoning_summary_text.delta\n" +
        'data: {"type":"response.reasoning_summary_text.delta","delta":"plan"}\n\n' +
        "event: response.completed\n" +
        'data: {"type":"response.completed","response":{"usage":{}}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
    const text = await responsesSseAsChat(source, "m").text();
    expect(text).toContain('"reasoning_content":"plan"');
  });
});

describe("Mistral effort from OMP parsed options", () => {
  test("reads the real typed-parser shapes", () => {
    expect(reasoningEffortOf({ reasoning: "high" })).toBe("high");
    expect(reasoningEffortOf({ reasoning: { effort: "low" } })).toBe("low");
    expect(reasoningEffortOf({ reasoningEffort: "max" })).toBe("max");
    expect(reasoningEffortOf({ explicitThinkingBudgetTokens: 1024 })).toBe("high");
    expect(reasoningEffortOf({ disableReasoning: true, reasoning: "high" })).toBe("none");
    expect(reasoningEffortOf({})).toBeUndefined();
  });
});

describe("tool id hashing covers typed streaming shapes", () => {
  test("restores an Anthropic content_block tool id", () => {
    const hashed = rewriteToolIds({
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_abc", name: "calc", input: {} },
    });
    expect(hashed.content_block.id).not.toBe("toolu_abc");
    expect(restoreToolIds(hashed).content_block.id).toBe("toolu_abc");
  });

  test("pairs Responses call ids without touching the item id", () => {
    const call = rewriteToolIds({ type: "function_call", id: "fc_1", call_id: "call_1" });
    const result = rewriteToolIds({ type: "function_call_output", call_id: "call_1" });
    expect(call.id).toBe("fc_1");
    expect(call.call_id).not.toBe("call_1");
    expect(call.call_id).toBe(result.call_id);
    expect(restoreToolIds(call).call_id).toBe("call_1");
    expect(restoreToolIds(result).call_id).toBe("call_1");
  });
});
