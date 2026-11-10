// Contract tests for the v2 tool-id-hash feature.
//
// Inbound shortening and outbound restoration run through the registered
// middleware and fetch handler, with the mapping in a temporary SQLite file.
// Every test closes the process-wide store, so no state leaks between tests.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { install } from "../features/tool-id-hash.mjs";
import { dispose as disposeInbound } from "../lib/inbound.mjs";
import { resetOutboundForTests } from "../lib/outbound.mjs";
import { closeToolIdStore, SHORT_PREFIX } from "../lib/tool-id-store.mjs";
import { fakeContext, parseSse } from "./helpers.mjs";

const directories = [];
const disposers = [];

function freshPath() {
  const directory = mkdtempSync(join(tmpdir(), "omp-shims-tool-id-hash-"));
  directories.push(directory);
  return join(directory, "state.sqlite");
}

/** Install with a context that records both layers. */
async function installAt(path = freshPath(), config = {}) {
  const harness = fakeContext({ paths: { stateDbPath: path } });
  disposers.push(await install({ enabled: true, ...config }, harness.context));
  return harness;
}

/** Run a parsed body through the inbound layer and return what reached next. */
async function throughInbound(harness, body) {
  const request = new Request("http://gateway/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  });
  let seen;
  await harness.inbound[0](request, {}, async (nextRequest = request) => {
    seen = JSON.parse(await nextRequest.text());
    return new Response("ok");
  });
  return seen;
}

/** Run a response through the outbound layer. */
async function throughOutbound(harness, response) {
  return harness.outbound[0]("http://upstream.example/v1/chat/completions", {}, async () => response);
}

/** A response whose body is the parsed value. */
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A text/event-stream response from raw frames. */
function sseResponse(frames) {
  return new Response(frames.join(""), {
    headers: { "content-type": "text/event-stream", "content-length": "999" },
  });
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  disposeInbound();
  resetOutboundForTests();
  closeToolIdStore();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("JSON round trip", () => {
  test("every id spelling, tool block, function_call and content item is shortened then restored", async () => {
    const original = {
      tool_call_id: "call_a",
      tool_use_id: "call_b",
      toolUseId: "call_c",
      toolCallId: "call_d",
      toolCallID: "call_e",
      toolId: "call_f",
      call_id: "call_g",
      callId: "call_h",
      tool_calls: [{ id: "call_i", type: "function", function: { name: "run", arguments: '{"id":"keep"}' } }],
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_j", name: "run", input: { id: "do-not-touch" } }],
        },
      ],
      item: { type: "function_call", id: "call_k", name: "run", arguments: '{"id":"do-not-touch"}' },
      output: { type: "function_call_output", call_id: "call_l", output: "ok" },
    };

    const harness = await installAt();
    const rewritten = await throughInbound(harness, original);

    const ids = [
      rewritten.tool_call_id,
      rewritten.tool_use_id,
      rewritten.toolUseId,
      rewritten.toolCallId,
      rewritten.toolCallID,
      rewritten.toolId,
      rewritten.call_id,
      rewritten.callId,
      rewritten.tool_calls[0].id,
      rewritten.messages[0].content[0].id,
      rewritten.item.id,
      rewritten.output.call_id,
    ];
    for (const id of ids) {
      expect(id.startsWith(SHORT_PREFIX)).toBe(true);
      expect(id.length).toBeLessThanOrEqual(32);
    }
    expect(rewritten.messages[0].content[0].input.id).toBe("do-not-touch");
    expect(rewritten.item.arguments).toBe('{"id":"do-not-touch"}');
    expect(rewritten.tool_calls[0].function.arguments).toBe('{"id":"keep"}');

    const response = await throughOutbound(harness, jsonResponse(rewritten));
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.json()).toEqual(original);
  });

  test("ten 91-character client ids become short ids and come back exactly", async () => {
    const originals = Array.from(
      { length: 10 },
      (_, index) => `call_${index}_${"abcdefghij".repeat(8)}${"x".repeat(4)}`,
    );
    for (const id of originals) expect(id.length).toBe(91);
    const original = {
      messages: [
        {
          role: "assistant",
          content: originals.map((id) => ({ type: "tool_use", id, name: "run", input: { index: id } })),
        },
      ],
    };

    const harness = await installAt();
    const rewritten = await throughInbound(harness, original);
    const shorts = rewritten.messages[0].content.map((block) => block.id);
    for (const short of shorts) {
      expect(short.length).toBeLessThanOrEqual(32);
      expect(short.startsWith(SHORT_PREFIX)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(rewritten))).toEqual(rewritten);

    const restored = await throughOutbound(harness, jsonResponse(rewritten));
    expect(await restored.json()).toEqual(original);
  });

  test("malformed inbound and outbound JSON stays byte-identical", async () => {
    const harness = await installAt();
    const request = new Request("http://gateway/v1/chat/completions", { method: "POST", body: "{not json" });
    let received;
    await harness.inbound[0](request, {}, async (nextRequest = request) => {
      received = await nextRequest.text();
      return new Response("ok");
    });
    expect(received).toBe("{not json");

    const broken = new Response("{not json", { status: 200, headers: { "content-type": "application/json" } });
    const restored = await throughOutbound(harness, broken);
    expect(restored).toBe(broken);
    expect(await restored.text()).toBe("{not json");
  });

  test("a response above the 4 MiB restore cap passes through and reports once", async () => {
    const harness = await installAt();
    const body = JSON.stringify({ tool_call_id: "t_known", padding: "a".repeat(4 * 1024 * 1024 + 32) });
    const make = () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });

    const errors = [];
    const original = console.error;
    console.error = (...args) => {
      errors.push(args.join(" "));
    };
    try {
      const first = make();
      expect(await throughOutbound(harness, first)).toBe(first);
      const second = make();
      expect(await throughOutbound(harness, second)).toBe(second);
    } finally {
      console.error = original;
    }
    expect(errors.filter((line) => line.includes("restore cap"))).toHaveLength(1);
  });
});

describe("global mapping", () => {
  test("the same original keeps one short across separate requests", async () => {
    const harness = await installAt();
    const first = await throughInbound(harness, { tool_call_id: "call_shared" });
    const second = await throughInbound(harness, { tool_call_id: "call_shared" });
    expect(second.tool_call_id).toBe(first.tool_call_id);
  });

  test("two concurrent requests with the same original get the same short", async () => {
    const harness = await installAt();
    const body = { tool_call_id: "call_concurrent", tool_calls: [{ id: "call_other" }] };
    const [left, right] = await Promise.all([throughInbound(harness, body), throughInbound(harness, body)]);
    expect(left.tool_call_id).toBe(right.tool_call_id);
    expect(left.tool_calls[0].id).toBe(right.tool_calls[0].id);
    expect(left.tool_call_id).not.toBe(left.tool_calls[0].id);
  });

  test("a reopened database still resolves a short minted by an earlier request", async () => {
    const path = freshPath();
    const first = await installAt(path);
    const rewritten = await throughInbound(first, { tool_call_id: "call_persisted" });
    const short = rewritten.tool_call_id;

    for (const dispose of disposers.splice(0).reverse()) await dispose();
    closeToolIdStore();

    const second = await installAt(path);
    const restored = await throughOutbound(second, jsonResponse({ tool_call_id: short, content: "ok" }));
    expect(await restored.json()).toEqual({ tool_call_id: "call_persisted", content: "ok" });
  });
});

describe("unknown and failed ids", () => {
  test("an upstream-generated unknown id passes through unchanged", async () => {
    const harness = await installAt();
    const rewritten = await throughInbound(harness, { tool_call_id: "call_known" });
    const known = rewritten.tool_call_id;

    const body = {
      tool_call_id: known,
      messages: [{ content: [{ type: "tool_use", id: `${SHORT_PREFIX}unknown`, name: "run" }] }],
    };
    const restored = await throughOutbound(harness, jsonResponse(body));
    const value = await restored.json();
    expect(value.tool_call_id).toBe("call_known");
    expect(value.messages[0].content[0].id).toBe(`${SHORT_PREFIX}unknown`);
  });

  test("an unavailable store leaves the inbound body and the response untouched", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-shims-tool-id-hash-bad-"));
    directories.push(directory);
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "not a directory");
    const harness = await installAt(join(blocker, "state.sqlite"));

    const text = JSON.stringify({ tool_call_id: "call_broken" });
    const request = new Request("http://gateway/v1/chat/completions", { method: "POST", body: text });
    let received;
    await harness.inbound[0](request, {}, async (nextRequest = request) => {
      received = await nextRequest.text();
      return new Response("ok");
    });
    expect(received).toBe(text);

    const body = { tool_call_id: `${SHORT_PREFIX}broken` };
    const response = jsonResponse(body);
    const restored = await throughOutbound(harness, response);
    expect(await restored.text()).toBe(JSON.stringify(body));
  });
});

describe("SSE round trip", () => {
  test("Chat, Messages, and Responses frames restore their ids", async () => {
    const harness = await installAt();
    const rewritten = await throughInbound(harness, {
      tool_call_id: "call_chat",
      tool_use_id: "call_messages",
      toolCallId: "call_responses",
      call_id: "call_output",
    });

    const wire = [
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ id: rewritten.tool_call_id, function: { name: "run" } }] } }],
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "content_block_start",
        content_block: { type: "tool_use", id: rewritten.tool_use_id, name: "run" },
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "response.output_item.added",
        item: { type: "function_call", id: rewritten.toolCallId, name: "run" },
        output: { type: "function_call_output", call_id: rewritten.call_id },
      })}\n\n`,
      "data:[DONE]\n\n",
    ];

    const rebuilt = await throughOutbound(harness, sseResponse(wire));
    expect(rebuilt.headers.get("content-length")).toBeNull();
    const text = await rebuilt.text();
    const payloads = parseSse(text);

    expect(payloads[0].choices[0].delta.tool_calls[0].id).toBe("call_chat");
    expect(payloads[1].content_block.id).toBe("call_messages");
    expect(payloads[2].item.id).toBe("call_responses");
    expect(payloads[2].output.call_id).toBe("call_output");
    expect(text).toContain("data:[DONE]");
    expect(text.endsWith("\n\n")).toBe(true);
  });

  test("a frame with no minted id is forwarded byte for byte", async () => {
    const harness = await installAt();
    const wire = 'data: {"text":"hello"}\n\n';
    const rebuilt = await throughOutbound(harness, sseResponse([wire]));
    expect(await rebuilt.text()).toBe(wire);
  });
});

describe("install", () => {
  test("a second install returns the same disposer and one set of layers", async () => {
    const harness = await installAt();
    const second = await install(
      { enabled: true },
      {
        addInboundMiddleware: (handler) => {
          harness.inbound.push(handler);
          return () => {};
        },
        addFetchHandler: (handler) => {
          harness.outbound.push(handler);
          return () => {};
        },
      },
    );
    expect(second).toBe(disposers.at(-1));
    expect(harness.inbound).toHaveLength(1);
    expect(harness.outbound).toHaveLength(1);
  });
});
