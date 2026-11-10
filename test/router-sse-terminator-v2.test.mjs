// Regression tests for the response-model SSE rewrite terminator.
//
// rewriteResponseModel() re-serializes a frame only when it changes the model
// identity. The unchanged path must still return a terminated event. A bare
// frame.raw has no blank line, so a comment-only keepalive would swallow the
// next data frame, hiding a tool-call start from the client.

import { describe, expect, test } from "bun:test";
import { formatForPath } from "../lib/router/formats.mjs";
import { rewriteResponseModel } from "../lib/router/protocol-codec.mjs";
import { parseSseFrame } from "../lib/sse.mjs";

const encoder = new TextEncoder();
const CHAT = formatForPath("/v1/chat/completions");

/** A stream from text, split into fixed-size chunks. */
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

/** Rewrite an SSE body and return the bytes a client receives. */
async function rewrite(wire, size) {
  const response = new Response(streamOf(wire, size), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
  const rewritten = rewriteResponseModel(CHAT, response, "lazy/pro");
  return new Response(rewritten.body).text();
}

/** Completed SSE blocks, without their terminating blank line. */
function blocks(text) {
  return text.split("\n\n").filter((block) => block !== "");
}

const chunk = (value) => `data: ${JSON.stringify(value)}\n\n`;

describe("rewriteResponseModel SSE terminator", () => {
  test("a keepalive stays a separate event and the tool-call start survives", async () => {
    const base = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      model: "google-antigravity/gemini-4-argon",
    };
    const start = {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "vibe_send", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const first = {
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '{"session":"paris",' } }] },
          finish_reason: null,
        },
      ],
    };
    const second = {
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '"message":"hello"}' } }] },
          finish_reason: null,
        },
      ],
    };
    const finish = {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    };
    const usage = {
      ...base,
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
    const wire = `: keepalive\n\n${chunk(start)}${chunk(first)}${chunk(second)}${chunk(finish)}${chunk(usage)}data: [DONE]\n\n`;

    // Split at an awkward size so frames cross chunk boundaries.
    const text = await rewrite(wire, 7);

    expect(text).toContain(": keepalive\n\ndata: ");
    expect(text).not.toContain("keepalivedata:");
    expect(text.endsWith("\n\n")).toBe(true);
    expect(text.includes("\n\n\n")).toBe(false);

    const events = blocks(text).map((block) => parseSseFrame(block));
    expect(events[0].commentOnly).toBe(true);
    expect(events[0].data).toBe("");

    const startValue = events[1].json();
    const call = startValue.choices[0].delta.tool_calls[0];
    expect(call).toMatchObject({
      index: 0,
      id: "call_1",
      type: "function",
      function: { name: "vibe_send", arguments: "" },
    });
    expect(startValue.model).toBe("lazy/pro");

    const args = [events[2], events[3]]
      .map((frame) => frame.json().choices[0].delta.tool_calls[0].function.arguments)
      .join("");
    expect(JSON.parse(args)).toEqual({ session: "paris", message: "hello" });

    expect(events[4].json().choices[0].finish_reason).toBe("tool_calls");
    expect(events[5].json().usage.total_tokens).toBe(3);
    expect(events[6].isDone).toBe(true);
  });

  test("an unchanged frame and an unparsable frame each get one terminator", async () => {
    const wire = 'data: {"hello":"world"}\n\ndata: {not json}\n\n: keepalive\n\ndata: {"after":"keepalive"}\n\n';
    const text = await rewrite(wire, 3);

    expect(text).toBe('data: {"hello":"world"}\n\ndata: {not json}\n\n: keepalive\n\ndata: {"after":"keepalive"}\n\n');
    expect(text).not.toContain("{not json}: keepalive");
    expect(text.includes("\n\n\n")).toBe(false);
  });
});
