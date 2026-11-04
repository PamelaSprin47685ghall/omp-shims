import { describe, expect, test } from "bun:test";
import { containsImage, FORMATS, probeBody, rewriteBody, rewriteResponseModel, STREAM_EVENT } from "../lib/lazy-router/formats.js";
import { SseScanner } from "../lib/lazy-router/sse.js";

const chat = FORMATS["/v1/chat/completions"];
const responses = FORMATS["/v1/responses"];
const messages = FORMATS["/v1/messages"];

describe("rewriteBody", () => {
  test("chat: model, reasoning_effort and max_completion_tokens; the original is untouched", () => {
    const original = { model: "lazy/default", max_tokens: 10, reasoning_effort: "max", messages: [] };
    const next = rewriteBody(chat, original, { model: "p/m", effort: "medium", maxTokens: 64000 });
    expect(next).toEqual({ model: "p/m", reasoning_effort: "medium", max_completion_tokens: 64000, messages: [] });
    expect(original.model).toBe("lazy/default");
  });

  test("chat: a lazy streaming request asks the provider for usage", () => {
    const next = rewriteBody(
      chat,
      { model: "lazy/default", stream: true, stream_options: { extra: true }, messages: [] },
      { model: "p/m", effort: "medium", maxTokens: 64000 },
    );
    expect(next.stream_options).toEqual({ extra: true, include_usage: true });
  });

  test("chat: no effort removes the field", () => {
    const next = rewriteBody(
      chat,
      { model: "x", reasoning_effort: "low" },
      { model: "p/m", effort: undefined, maxTokens: 1 },
    );
    expect("reasoning_effort" in next).toBe(false);
  });

  test("responses: reasoning.effort keeps other reasoning options", () => {
    const next = rewriteBody(
      responses,
      { model: "x", reasoning: { effort: "high", summary: "auto" } },
      { model: "p/m", effort: "low", maxTokens: 64000 },
    );
    expect(next.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(next.max_output_tokens).toBe(64000);
  });

  test("messages: output_config.effort replaces a thinking budget; none disables thinking", () => {
    const body = { model: "x", max_tokens: 5, thinking: { type: "enabled", budget_tokens: 9 } };
    expect(messages.readEffort(body)).toBe("high");
    const next = rewriteBody(messages, body, { model: "p/m", effort: "medium", maxTokens: 64000 });
    expect(next).toEqual({ model: "p/m", max_tokens: 64000, output_config: { effort: "medium" } });
    const off = rewriteBody(messages, body, { model: "p/m", effort: "none", maxTokens: 64000 });
    expect(off.thinking).toEqual({ type: "disabled" });
    expect(off.output_config).toBeUndefined();
  });
});

test("containsImage finds image parts in every dialect", () => {
  expect(containsImage([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:" } }] }])).toBe(true);
  expect(containsImage([{ role: "user", content: [{ type: "input_image", image_url: "data:" }] }])).toBe(true);
  expect(containsImage([{ role: "user", content: [{ type: "tool_result", content: [{ type: "image" }] }] }])).toBe(
    true,
  );
  expect(containsImage([{ role: "user", content: "just text" }])).toBe(false);
});

test("probeBody is a tiny non-streaming chat completion", () => {
  expect(probeBody({ model: "p/m", effort: "low", maxTokens: 32, prompt: "Reply OK" })).toEqual({
    model: "p/m",
    stream: false,
    messages: [{ role: "user", content: "Reply OK" }],
    reasoning_effort: "low",
    max_completion_tokens: 32,
  });
});

describe("stream events", () => {
  test("SseScanner yields complete events across chunk boundaries and skips keep-alives", () => {
    const scanner = new SseScanner();
    expect(scanner.push(': ping\n\ndata: {"a"')).toEqual([]);
    expect(scanner.push(':1}\n\nevent: error\ndata: {"type":"error"}\n\n')).toEqual([
      { data: { a: 1 } },
      { name: "error", data: { type: "error" } },
    ]);
  });

  test("chat: the gateway's role preamble is not progress; content and errors are", () => {
    expect(chat.classifyEvent({ data: { choices: [{ delta: { role: "assistant" } }] } })).toBe(STREAM_EVENT.PREAMBLE);
    expect(chat.classifyEvent({ data: { choices: [{ delta: { content: "P" } }] } })).toBe(STREAM_EVENT.PROGRESS);
    expect(chat.classifyEvent({ data: { choices: [{ delta: { reasoning_content: "…" } }] } })).toBe(
      STREAM_EVENT.PROGRESS,
    );
    expect(chat.classifyEvent({ data: { error: { message: "x" } } })).toBe(STREAM_EVENT.ERROR);
  });

  test("responses and messages", () => {
    expect(responses.classifyEvent({ name: "response.created", data: { type: "response.created" } })).toBe(
      STREAM_EVENT.PREAMBLE,
    );
    expect(responses.classifyEvent({ data: { type: "response.output_text.delta" } })).toBe(STREAM_EVENT.PROGRESS);
    expect(responses.classifyEvent({ data: { type: "response.failed" } })).toBe(STREAM_EVENT.ERROR);
    expect(messages.classifyEvent({ name: "message_start", data: { type: "message_start" } })).toBe(
      STREAM_EVENT.PREAMBLE,
    );
    expect(messages.classifyEvent({ data: { type: "content_block_delta" } })).toBe(STREAM_EVENT.PROGRESS);
    expect(messages.classifyEvent({ data: { type: "error" } })).toBe(STREAM_EVENT.ERROR);
  });
});
describe("rewriteResponseModel", () => {
  test("non-streaming JSON keeps the Lazy model identity", async () => {
    const response = new Response(JSON.stringify({ id: "x", model: "kiro/claude-opus-5-5", choices: [] }), {
      headers: { "content-type": "application/json", "content-length": "99" },
    });
    const rewritten = rewriteResponseModel(chat, response, "lazy/default");
    expect(await rewritten.json()).toEqual({ id: "x", model: "lazy/default", choices: [] });
    expect(rewritten.headers.get("content-length")).toBeNull();
  });

  test("chat SSE rewrites top-level model across chunk boundaries", async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"x","model":"kiro/cla'));
        controller.enqueue(new TextEncoder().encode('ude-opus-5-5","choices":[{"delta":{"content":"ok"}}]}\n\n'));
        controller.close();
      },
    });
    const response = new Response(source, { headers: { "content-type": "text/event-stream" } });
    const text = await rewriteResponseModel(chat, response, "lazy/default").text();
    expect(text).toContain('"model":"lazy/default"');
    expect(text).not.toContain("kiro/claude-opus-5-5");
    expect(text).toContain('"content":"ok"');
  });

  test("Responses and Messages rewrite their nested model identity", async () => {
    const responseEvent = new Response(
      'event: response.created\ndata: {"type":"response.created","response":{"id":"r","model":"ctyun/glm-5.3-oc"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
    const responseText = await rewriteResponseModel(responses, responseEvent, "lazy/default").text();
    expect(responseText).toContain('"model":"lazy/default"');
    expect(responseText).not.toContain("ctyun/glm-5.3-oc");

    const messageEvent = new Response(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m","model":"qoder-cn/qwen3.8-flash"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
    const messageText = await rewriteResponseModel(messages, messageEvent, "lazy/task").text();
    expect(messageText).toContain('"model":"lazy/task"');
    expect(messageText).not.toContain("qoder-cn/qwen3.8-flash");
  });
});
