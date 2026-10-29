import { describe, expect, test } from "bun:test";
import { normalizeGatewayOptionalNulls } from "../lib/gateway-compat.js";
import { withBody, withInboundRewrite } from "../lib/inbound.js";

describe("provider-neutral Gateway optional-null compatibility", () => {
  const original = {
    model: "mistral-vibe/deepseek-v4-1-flash-1017",
    messages: [
      { role: "system", content: "Synthetic text." },
      { role: "assistant", content: null, tool_calls: [
        { id: "call_1", type: "function", function: { name: "run", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "call_1", content: null },
    ],
    tools: null,
    metadata: null,
    temperature: 0,
    stream: false,
  };

  test.each(["/v1/chat/completions", "/v1/responses", "/v1/messages"])(
    "official SDK null optionals accepted on %s without modifying nested semantics",
    (pathname) => {
      const changed = normalizeGatewayOptionalNulls(pathname, JSON.stringify(original));
      const result = JSON.parse(changed);
      expect(Object.hasOwn(result, "tools")).toBe(false);
      expect(Object.hasOwn(result, "metadata")).toBe(false);
      expect(result.messages).toEqual(original.messages);
      expect(result.temperature).toBe(0);
      expect(result.stream).toBe(false);
    },
  );

  test("preserves explicit empty tools, object metadata, and unspecified optional fields", () => {
    const shape = { ...original, tools: [], metadata: {}, tool_choice: null };
    expect(normalizeGatewayOptionalNulls("/v1/chat/completions", JSON.stringify(shape)))
      .toBeUndefined();
    const withNull = { ...shape, tools: null };
    const normalized = JSON.parse(normalizeGatewayOptionalNulls(
      "/v1/chat/completions", JSON.stringify(withNull),
    ));
    expect(normalized.metadata).toEqual({});
    expect(normalized.tool_choice).toBeNull();
  });

  test("other routes, GETs, arrays, and malformed JSON are untouched", () => {
    for (const url of ["/private", "/v1/models", "/v1/embeddings"]) {
      expect(normalizeGatewayOptionalNulls(url, JSON.stringify(original))).toBeUndefined();
    }
    expect(normalizeGatewayOptionalNulls("/v1/chat/completions", "[null]")).toBeUndefined();
    expect(normalizeGatewayOptionalNulls("/v1/chat/completions", "invalid")).toBeUndefined();
    expect(normalizeGatewayOptionalNulls("/v1/chat/completions", "null")).toBeUndefined();
  });

  test("rewritten requests discard stale content-length while retaining auth and method", async () => {
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST", headers: { authorization: "Bearer dummy" },
      body: JSON.stringify(original),
    });
    const changed = withBody(request, normalizeGatewayOptionalNulls(
      "/v1/chat/completions", await request.clone().text(),
    ));
    expect(changed.method).toBe("POST");
    expect(changed.headers.get("authorization")).toBe("Bearer dummy");
    expect(changed.headers.has("content-length")).toBe(false);
    expect((await changed.json()).messages).toEqual(original.messages);
  });

  test("shared inbound rewrite reaches Gateway handler with nulls removed", async () => {
    const handler = withInboundRewrite(
      async (r) => new Response(await r.text()),
      (text) => normalizeGatewayOptionalNulls("/v1/chat/completions", text),
    );
    const response = await handler(new Request("http://localhost/v1/chat/completions", {
      method: "POST", body: JSON.stringify(original),
    }));
    const returned = await response.json();
    expect(returned).not.toHaveProperty("tools");
    expect(returned).not.toHaveProperty("metadata");
  });
});
