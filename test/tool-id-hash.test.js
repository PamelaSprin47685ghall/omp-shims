import { describe, expect, test } from "bun:test";
import { install, restoreToolIds, rewriteToolIds } from "../features/tool-id-hash.js";
import { originalFor } from "../lib/id-map.js";
import { fakeContext, parseSse, sseResponse } from "./helpers.js";

const ALNUM9 = /^[A-Za-z0-9]{9}/;

function sampleRequest() {
  return {
    messages: [
      {
        role: "assistant",
        tool_calls: [
          { id: "call_0000000000000001", type: "function" },
          { id: "call_0000000000000002", type: "function" },
        ],
      },
      { role: "tool", tool_call_id: "call_0000000000000001", content: "a" },
      { role: "tool", tool_call_id: "call_0000000000000002", content: "b" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1" }] },
    ],
  };
}

describe("rewriteToolIds", () => {
  test("gives colliding ids distinct prefixes that never form nine alphanumerics", () => {
    const body = rewriteToolIds(sampleRequest());
    const [first, second] = body.messages[0].tool_calls.map((call) => call.id);
    expect(first).not.toBe("call_0000000000000001");
    expect(first.slice(0, 9)).not.toBe(second.slice(0, 9));
    for (const id of [first, second]) expect(id).not.toMatch(ALNUM9);
  });

  test("keeps tool calls and their results paired", () => {
    const body = rewriteToolIds(sampleRequest());
    expect(body.messages[1].tool_call_id).toBe(body.messages[0].tool_calls[0].id);
    expect(body.messages[2].tool_call_id).toBe(body.messages[0].tool_calls[1].id);
    expect(body.messages[4].content[0].tool_use_id).toBe(body.messages[3].content[0].id);
  });

  test("is deterministic for the same id", () => {
    const a = rewriteToolIds(sampleRequest()).messages[0].tool_calls[0].id;
    const b = rewriteToolIds(sampleRequest()).messages[0].tool_calls[0].id;
    expect(a).toBe(b);
  });

  test("leaves empty and non-string ids alone", () => {
    expect(rewriteToolIds({ tool_call_id: "" })).toEqual({ tool_call_id: "" });
    expect(rewriteToolIds({ tool_call_id: 7 })).toEqual({ tool_call_id: 7 });
  });
});

describe("restoreToolIds", () => {
  test("round-trips every id it minted", () => {
    expect(restoreToolIds(rewriteToolIds(sampleRequest()))).toEqual(sampleRequest());
  });

  test("leaves ids it did not mint untouched", () => {
    expect(restoreToolIds({ tool_call_id: "abc_hxyz" })).toEqual({ tool_call_id: "abc_hxyz" });
  });
});

describe("install", () => {
  // install() patches Bun.serve, so it is installed exactly once, as in production.
  const { context, handlers } = fakeContext();
  install({}, context);

  test("restores ids in JSON responses", async () => {
    const hashed = rewriteToolIds({ tool_call_id: "call_42" }).tool_call_id;
    expect(originalFor(hashed)).toBe("call_42");

    const response = await handlers[0]("https://a.example/", {}, async () => Response.json({ toolCallId: hashed }));
    expect(await response.json()).toEqual({ toolCallId: "call_42" });
  });

  test("restores ids in event streams, line by line", async () => {
    const hashed = rewriteToolIds({ tool_call_id: "call_43" }).tool_call_id;
    const response = await handlers[0]("https://a.example/", {}, async () =>
      sseResponse([{ tool_calls: [{ id: hashed }] }, { text: "hello" }]),
    );
    expect(parseSse(await response.text())).toEqual([{ tool_calls: [{ id: "call_43" }] }, { text: "hello" }]);
  });

  test("hashes ids in inbound requests served through Bun.serve", async () => {
    const server = Bun.serve({ port: 0, fetch: async (request) => new Response(await request.text()) });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        body: JSON.stringify({ tool_call_id: "call_0000000000000009" }),
      });
      const { tool_call_id } = await response.json();
      expect(tool_call_id).not.toBe("call_0000000000000009");
      expect(originalFor(tool_call_id)).toBe("call_0000000000000009");
    } finally {
      server.stop(true);
    }
  });
});
