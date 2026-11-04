import { describe, expect, test } from "bun:test";
import { orderChatStream, withReasoningOrder } from "../lib/reasoning-order.js";

const headers = { "content-type": "text/event-stream; charset=utf-8" };
const sse = (obj) => "data: " + JSON.stringify(obj) + "\n\n";
const done = "data: [DONE]\n\n";
const frame = (delta, finish_reason = null) => sse({
  id: "synthetic", model: "model", choices: [{ index: 0, delta, finish_reason }],
});
const parse = (wire) => wire.split(/\r?\n\r?\n/).filter(Boolean)
  .map((part) => {
    const lines = part.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    if (!lines.length) return { comment: part };
    const raw = lines.map((line) => line.slice(5).trimStart()).join("\n");
    return raw === "[DONE]" ? "[DONE]" : JSON.parse(raw);
  });
const deltas = (events) => events
  .flatMap((e) => e?.choices ?? [])
  .map((choice) => choice.delta ?? {});
const text = (events, name) => deltas(events).map((delta) => delta[name] ?? "").join("");
const streamOf = (...chunks) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  },
});
const collect = async (stream) => await new Response(stream).text();

describe("strict reasoning-before-body SSE shim", () => {
  test("reorders interleaved fragments without parsing any body into thinking", async () => {
    const data = [
      frame({ role: "assistant" }),
      frame({ reasoning_content: "think 1" }),
      frame({ content: "body 1" }),
      frame({ reasoning_content: "think 2", content: "body 2" }),
      frame({ content: "body 3" }, "stop"),
      sse({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      done,
    ].join("");
    const events = parse(await collect(orderChatStream(streamOf(
      data.slice(0, 7), data.slice(7, 22), data.slice(22),
    ))));
    const messages = deltas(events);
    const firstBody = messages.findIndex((delta) => Boolean(delta.content));
    const lastThought = messages.findLastIndex((delta) => Boolean(delta.reasoning_content));
    expect(lastThought).toBeLessThan(firstBody);
    expect(text(events, "reasoning_content")).toBe("think 1think 2");
    expect(text(events, "content")).toBe("body 1body 2body 3");
    expect(messages[0].role).toBe("assistant");
    expect(events.find((event) => event?.usage)?.usage.prompt_tokens).toBe(10);
    expect(events.at(-1)).toBe("[DONE]");
    expect(events.at(-3).choices[0].finish_reason).toBe("stop");
  });

  test("explicit Mistral thinking content blocks are separated, while prose stays prose", async () => {
    const payload = frame({ content: [
      { type: "text", text: "visible " },
      { type: "thinking", thinking: [{ type: "text", text: "private" }] },
      { type: "text", text: "answer" },
    ] });
    const events = parse(await collect(orderChatStream(streamOf(payload + done))));
    expect(text(events, "reasoning_content")).toBe("private");
    expect(text(events, "content")).toBe("visible answer");
    expect(events.at(-1)).toBe("[DONE]");
  });

  test("literal <think> in normal text is not misclassified as reasoning", async () => {
    const events = parse(await collect(orderChatStream(streamOf(
      frame({ content: "The exact string is <think>normal text</think>." }) + done,
    ))));
    expect(text(events, "reasoning_content")).toBe("");
    expect(text(events, "content")).toBe("The exact string is <think>normal text</think>.");
  });

  test("buffers tool-call arguments until after all reasoning and preserves finish", async () => {
    const a = frame({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "run", arguments: "{" } }] });
    const b = frame({ reasoning_text: "reason", tool_calls: [{ index: 0, function: { arguments: "}" } }] });
    const events = parse(await collect(orderChatStream(streamOf(a, b, frame({}, "tool_calls"), done))));
    const del = deltas(events);
    expect(del.findIndex((e) => e.reasoning_text)).toBeLessThan(del.findIndex((e) => e.tool_calls));
    expect(del.filter((e) => e.tool_calls).flatMap((e) => e.tool_calls)
      .map((t) => t.function.arguments).join("")).toBe("{}");
    expect(events.at(-2).choices[0].finish_reason).toBe("tool_calls");
  });

  test("handles CRLF and chunk-split SSE frames with comments", async () => {
    const content = ": keep-alive\r\n\r\n" + frame({ content: "text" }).replaceAll("\n", "\r\n")
      + frame({ reasoning: "thought" }).replaceAll("\n", "\r\n") + done.replaceAll("\n", "\r\n");
    const events = parse(await collect(orderChatStream(streamOf(...Array.from(content)))));
    expect(text(events, "reasoning")).toBe("thought");
    expect(text(events, "content")).toBe("text");
    expect(events[0].comment).toContain("keep-alive");
  });

  test("byte buffer limit fails closed rather than leaking prematurely", async () => {
    const stream = orderChatStream(streamOf(frame({ content: "too long" }) + done), { maxBufferBytes: 10 });
    await expect(collect(stream)).rejects.toThrow("buffer exceeded");
  });

  test("request filtering leaves non-SSE, failed, and other dialects unchanged", async () => {
    const response = new Response(frame({ content: "body" }) + done, { headers });
    const handler = withReasoningOrder(async () => response);
    const actual = await handler(new Request("http://gateway.test/v1/embeddings", { method: "POST" }));
    expect(actual).toBe(response);
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(await withReasoningOrder(async () => json)(
      new Request("http://gateway.test/v1/chat/completions", { method: "POST" }),
    )).toBe(json);
    const error = new Response("error", { status: 503, headers });
    expect(await withReasoningOrder(async () => error)(
      new Request("http://gateway.test/v1/chat/completions", { method: "POST" }),
    )).toBe(error);
  });

  test("preserves response headers and emits one final completion", async () => {
    const handler = withReasoningOrder(async () => new Response(
      frame({ content: "first" }) + frame({ reasoning_content: "before" })
        + frame({}, "stop") + done,
      { headers: { ...headers, "content-length": "1000", "x-lazy-router-model": "a/b" } },
    ));
    const response = await handler(new Request("http://gateway.test/v1/chat/completions", { method: "POST" }));
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-lazy-router-model")).toBe("a/b");
    const result = await response.text();
    expect(result).toContain("before");
    expect(result.indexOf("before")).toBeLessThan(result.indexOf("first"));
    expect(result.match(/\[DONE\]/g)).toHaveLength(1);
  });

  test("cancels the original upstream stream on downstream cancellation", async () => {
    let cancelled = false;
    const upstream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(frame({ reasoning_content: "thinking" }))); },
      cancel() { cancelled = true; },
    });
    const reader = orderChatStream(upstream).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cancelled).toBe(true);
  });
});
