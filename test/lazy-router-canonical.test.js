import { describe, expect, test } from "bun:test";
import { canonicalBytes, stableJson } from "../lib/lazy-router/canonical.js";
import { FORMATS } from "../lib/lazy-router/formats.js";

const CHAT = FORMATS["/v1/chat/completions"];
const RESPONSES = FORMATS["/v1/responses"];
const MESSAGES = FORMATS["/v1/messages"];
const bytes = (format, body) => canonicalBytes(format.transcript(body)).toString("utf8");

const PNG = "iVBORw0KGgo=";

/** One conversation (system, image, thinking, a tool round trip, a reply) in each dialect. */
const chat = {
  model: "lazy/default",
  temperature: 0.2,
  reasoning_effort: "high",
  messages: [
    { role: "system", content: "You are terse." },
    {
      role: "user",
      content: [
        { type: "text", text: "Weather in Paris? 你好" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${PNG}`, detail: "high" } },
      ],
    },
    {
      role: "assistant",
      reasoning_content: "Need the tool.",
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "weather", arguments: '{"unit":"c","city":"Paris"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "18C" },
    { role: "assistant", content: "18°C." },
  ],
};

const responses = {
  model: "lazy/default",
  instructions: "You are terse.",
  reasoning: { effort: "high" },
  max_output_tokens: 99,
  input: [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Weather in Paris? 你好" },
        { type: "input_image", image_url: `data:image/png;base64,${PNG}` },
      ],
    },
    { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Need the tool." }] },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "weather", arguments: '{"city":"Paris","unit":"c"}' },
    { type: "function_call_output", call_id: "call_1", output: "18C" },
    {
      type: "message",
      role: "assistant",
      id: "msg_9",
      content: [{ type: "output_text", text: "18°C.", annotations: [] }],
    },
  ],
};

const messages = {
  model: "lazy/default",
  max_tokens: 1000,
  system: [{ type: "text", text: "You are terse.", cache_control: { type: "ephemeral" } }],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Weather in Paris? 你好", cache_control: { type: "ephemeral" } },
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Need the tool.", signature: "sig-abc" },
        { type: "tool_use", id: "toolu_1", name: "weather", input: { city: "Paris", unit: "c" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "18C" }] }],
    },
    { role: "assistant", content: "18°C." },
  ],
};

describe("canonical transcript", () => {
  test("the same conversation reads the same in all three dialects", () => {
    const reference = bytes(CHAT, chat);
    expect(bytes(RESPONSES, responses)).toBe(reference);
    expect(bytes(MESSAGES, messages)).toBe(reference);
    expect(
      reference
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line).slice(0, 2)),
    ).toEqual([
      ["system", "text"],
      ["user", "text"],
      ["user", "image"],
      ["assistant", "thinking"],
      ["assistant", "tool_call"],
      ["tool", "tool_result"],
      ["assistant", "text"],
    ]);
  });

  test("ids, cache_control, signatures, sampling and limits do not change the bytes", () => {
    const noisy = structuredClone(chat);
    noisy.temperature = 1;
    noisy.max_tokens = 5;
    noisy.stream = true;
    noisy.messages[2].tool_calls[0].id = "call_other";
    noisy.messages[3].tool_call_id = "call_other";
    expect(bytes(CHAT, noisy)).toBe(bytes(CHAT, chat));
  });

  test("a later turn extends the earlier transcript byte for byte", () => {
    const earlier = canonicalBytes(CHAT.transcript({ messages: chat.messages.slice(0, 2) }));
    const later = canonicalBytes(CHAT.transcript(chat));
    expect(later.length).toBeGreaterThan(earlier.length);
    expect(later.subarray(0, earlier.length).equals(earlier)).toBe(true);
  });

  test("works on UTF-8 bytes", () => {
    const out = canonicalBytes(CHAT.transcript({ messages: [{ role: "user", content: "你好" }] }));
    expect(out).toBeInstanceOf(Buffer);
    expect(out.length).toBe(Buffer.byteLength('["user","text","你好"]\n'));
  });

  test("content changes do change the bytes", () => {
    const edited = structuredClone(chat);
    edited.messages[4].content = "19°C.";
    expect(bytes(CHAT, edited)).not.toBe(bytes(CHAT, chat));
  });

  test("malformed bodies read as empty instead of throwing", () => {
    expect(bytes(CHAT, { messages: "nope" })).toBe("");
    expect(bytes(RESPONSES, { input: 42 })).toBe("");
    expect(bytes(MESSAGES, { messages: [{ role: "user", content: 7 }] })).toBe("");
    expect(bytes(CHAT, undefined)).toBe("");
  });

  test("stableJson sorts keys at every depth", () => {
    expect(stableJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });
});
