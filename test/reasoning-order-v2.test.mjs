// Contract tests for the v2 reasoning-order edge feature.
//
// Chat uses the two-phase rule. Messages and Responses use typed events.
// The regressions covered here are the ones that broke in v1: a no-space
// [DONE] terminator, a CRLF pair split across chunks, a body-only stream that
// ends without a terminal frame, an unbounded body buffer, and untouched
// non-SSE or failed responses.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { install, orderChatStream, orderTypedStream } from "../features/reasoning-order.mjs";
import { dispose as disposeInbound } from "../lib/inbound.mjs";

const originalArgv = process.argv.slice();
process.argv.push("auth-gateway", "serve");

const encoder = new TextEncoder();
const disposers = [];

/** A stream from text, optionally split into fixed-size chunks. */
function streamOf(text, size = text.length || 1) {
  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < text.length; index += size) {
        controller.enqueue(encoder.encode(text.slice(index, index + size)));
      }
      controller.close();
    },
  });
}

const collect = async (stream) => new Response(stream).text();
const sse = (value) => `data: ${JSON.stringify(value)}\n\n`;
const chatFrame = (delta, finish = null) =>
  sse({ id: "synthetic", model: "model", choices: [{ index: 0, delta, finish_reason: finish }] });
const typed = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** Parse the data payloads of an SSE stream. */
function parseEvents(text) {
  return text
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data === "[DONE]") return "[DONE]";
      if (data === "") return { comment: block };
      return JSON.parse(data);
    });
}

/** Install with a context that records the middleware. */
async function installRecording() {
  let middleware;
  const dispose = await install(
    {},
    {
      log: () => {},
      addInboundMiddleware(handler) {
        middleware = handler;
        return () => {
          middleware = undefined;
        };
      },
    },
  );
  disposers.push(dispose);
  return middleware;
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  disposeInbound();
});

afterAll(() => {
  process.argv = originalArgv.slice();
  disposeInbound();
});

describe("Chat two-phase stream", () => {
  test("a no-space [DONE] terminates after the buffered body", async () => {
    const wire = `${chatFrame({ content: "body" })}data:[DONE]\n\n`;
    const text = await collect(orderChatStream(streamOf(wire, 1)));
    expect(text.indexOf("body")).toBeLessThan(text.indexOf("[DONE]"));
    expect(text).toContain("data:[DONE]");
  });

  test("handles CRLF split byte-by-byte and keeps comments", async () => {
    const frame = (delta) => `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\r\n\r\n`;
    const wire = `: keep-alive\r\n\r\n${frame({ content: "body" })}${frame({ reasoning: "thought" })}data: [DONE]\r\n\r\n`;
    const text = await collect(orderChatStream(streamOf(wire, 1)));
    const events = parseEvents(text);
    const thought = events.findIndex((event) => event?.choices?.[0]?.delta?.reasoning);
    const body = events.findIndex((event) => event?.choices?.[0]?.delta?.content);
    expect(thought).toBeGreaterThanOrEqual(0);
    expect(thought).toBeLessThan(body);
    expect(events.at(-1)).toBe("[DONE]");
    expect(text).toContain(": keep-alive");
  });

  test("releases buffered body on flush when no terminal frame arrives", async () => {
    const text = await collect(orderChatStream(streamOf(chatFrame({ content: "held" }))));
    expect(text).toContain("held");
  });

  test("fails closed when the visible buffer passes its limit", async () => {
    const stream = orderChatStream(streamOf(chatFrame({ content: "too long" })), { maxBufferBytes: 10 });
    await expect(collect(stream)).rejects.toThrow(/buffer exceeded/);
  });
});

describe("typed Messages stream", () => {
  test("reindexes thinking before text even when text arrived first", async () => {
    const wire = [
      typed("message_start", { message: { role: "assistant", content: [] } }),
      typed("content_block_start", { index: 4, content_block: { type: "text", text: "" } }),
      typed("content_block_delta", { index: 4, delta: { type: "text_delta", text: "Body" } }),
      typed("content_block_start", { index: 10, content_block: { type: "thinking", thinking: "" } }),
      typed("content_block_delta", { index: 10, delta: { type: "thinking_delta", thinking: "Think" } }),
      typed("content_block_stop", { index: 10 }),
      typed("content_block_stop", { index: 4 }),
      typed("message_stop", {}),
    ].join("");

    const events = parseEvents(await collect(orderTypedStream(streamOf(wire, 3), "messages")));
    expect(
      events
        .filter((event) => event.type === "content_block_start")
        .map((event) => [event.index, event.content_block.type]),
    ).toEqual([
      [0, "thinking"],
      [1, "text"],
    ]);
    const thought = events.findIndex((event) => event.delta?.type === "thinking_delta");
    const body = events.findIndex((event) => event.delta?.type === "text_delta");
    expect(thought).toBeLessThan(body);
    expect(events.at(-1).type).toBe("message_stop");
  });
});

describe("typed Responses stream", () => {
  test("a no-space [DONE] cannot pass a buffered body", async () => {
    const wire = [
      typed("response.created", { sequence_number: 0, response: { id: "r", output: [] } }),
      typed("response.output_item.added", { sequence_number: 1, output_index: 0, item: { type: "message" } }),
      typed("response.output_text.delta", { sequence_number: 2, output_index: 0, delta: "Body" }),
      "data:[DONE]\n\n",
    ].join("");

    const text = await collect(orderTypedStream(streamOf(wire, 2), "responses"));
    expect(text.indexOf("Body")).toBeLessThan(text.indexOf("[DONE]"));
    expect(text).toContain("data:[DONE]");
  });

  test("reorders a late reasoning item into the completed output", async () => {
    const wire = [
      typed("response.created", { sequence_number: 0, response: { id: "r", output: [] } }),
      typed("response.output_item.added", { sequence_number: 1, output_index: 0, item: { type: "message", id: "m" } }),
      typed("response.output_text.delta", { sequence_number: 2, output_index: 0, delta: "Body" }),
      typed("response.output_item.added", {
        sequence_number: 3,
        output_index: 1,
        item: { type: "reasoning", id: "r1" },
      }),
      typed("response.reasoning_summary_text.delta", { sequence_number: 4, output_index: 1, delta: "Thought" }),
      typed("response.completed", {
        sequence_number: 5,
        response: {
          id: "r",
          output: [
            { type: "message", id: "m" },
            { type: "reasoning", id: "r1" },
          ],
        },
      }),
    ].join("");

    const events = parseEvents(await collect(orderTypedStream(streamOf(wire, 2), "responses")));
    const reasoning = events.findIndex((event) => event.type === "response.reasoning_summary_text.delta");
    const body = events.findIndex((event) => event.type === "response.output_text.delta");
    expect(reasoning).toBeLessThan(body);
    expect(events.at(-1).response.output.map((item) => item.type)).toEqual(["reasoning", "message"]);
    expect(events.map((event) => event.sequence_number)).toEqual([...Array(events.length).keys()]);
  });

  test("rejects an unknown protocol", () => {
    expect(() => orderTypedStream(streamOf(""), "unknown")).toThrow(/Unsupported/);
  });
});

describe("installed response filter", () => {
  test("non-SSE, failed, and other paths pass through untouched", async () => {
    const middleware = await installRecording();
    const request = (pathname) => new Request(`http://gateway${pathname}`, { method: "POST", body: "{}" });

    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(await middleware(request("/v1/chat/completions"), {}, async () => json)).toBe(json);

    const failed = new Response("error", {
      status: 503,
      headers: { "content-type": "text/event-stream" },
    });
    expect(await middleware(request("/v1/chat/completions"), {}, async () => failed)).toBe(failed);

    const other = new Response("data: 1\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    expect(await middleware(request("/v1/embeddings"), {}, async () => other)).toBe(other);
  });
});
