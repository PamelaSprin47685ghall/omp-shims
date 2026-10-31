import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mistralFallbackTraits, mistralFallbackModelList, toMistralPayload,
  withMistralFallback,
} from "../lib/lazy-router/mistral-native-fallback.js";

const REF = "mistral-vibe/deepseek-v4-1-flash-1017";

describe("stock OMP 18.14 native Mistral shim fallback", () => {
  test("advertises only declared Mistral models and retains exact traits", () => {
    expect(mistralFallbackTraits(REF)?.contextWindow).toBe(1_000_000);
    expect(mistralFallbackTraits(REF)?.input).toEqual(["text"]);
    expect(mistralFallbackTraits("opencode-go/deepseek-v4.1-flash")).toBeUndefined();
    expect(mistralFallbackModelList().map((m) => m.id)).toContain(REF);
    expect(mistralFallbackModelList().every((m) => m.owned_by === "mistral-vibe")).toBe(true);
  });

  test("converts developer instructions and historical assistant thinking, preserves tools", () => {
    const outgoing = toMistralPayload({
      model: REF,
      messages: [
        { role: "developer", content: "private system instruction" },
        { role: "assistant", reasoning_content: "past reasoning", content: "answer",
          tool_calls: [{ id: "a", type: "function", function: { name: "inspect", arguments: "{}" } }] },
      ],
      max_completion_tokens: 64, stream: true,
      stream_options: { include_usage: true }, store: false, service_tier: "flex",
    });
    expect(outgoing.model).toBe("deepseek-v4-1-flash-1017");
    expect(outgoing.messages[0].role).toBe("system");
    expect(outgoing.messages[1].content[0]).toEqual({
      type: "thinking", thinking: [{ type: "text", text: "past reasoning" }],
    });
    expect(outgoing.messages[1].tool_calls[0].id).toBe("a");
    expect(outgoing.max_tokens).toBe(64);
    expect(outgoing.stream_options.include_usage).toBe(true);
    expect("store" in outgoing).toBe(false);
    expect("service_tier" in outgoing).toBe(false);
    expect("max_completion_tokens" in outgoing).toBe(false);
  });

  test("rejects missing or non-admin bearer without contacting Mistral", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mistral-fallback-test-"));
    try {
      const tokenPath = join(dir, "token");
      writeFileSync(tokenPath, "admin-bridge-token", { mode: 0o600 });
      let upstreamCalls = 0;
      let hostCalls = 0;
      const handler = withMistralFallback(() => {
        hostCalls++;
        return Response.json({ error: "host rejected" }, { status: 401 });
      }, {
        tokenPath, credentials: { list: () => [], resolve: async () => undefined },
        fetchImpl: async () => { upstreamCalls++; return Response.json({}); },
      });
      for (const authorization of [undefined, "Bearer wrong", "Bearer scoped-client-token"]) {
        const req = new Request("http://127.0.0.1:4000/v1/chat/completions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify({ model: REF, messages: [{ role: "user", content: "Hi" }] }),
        });
        expect((await handler(req)).status).toBe(401);
      }
      expect(hostCalls).toBe(3);
      expect(upstreamCalls).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("retains the OMP host handler when the model is natively registered", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mistral-fallback-test-"));
    try {
      const tokenPath = join(dir, "token");
      writeFileSync(tokenPath, "admin-bridge-token", { mode: 0o600 });
      let upstreamCalls = 0;
      const fallback = withMistralFallback(
        () => Response.json({ servedBy: "native" }),
        {
          tokenPath, nativeRegistered: (ref) => ref === REF,
          credentials: { list: () => [], resolve: async () => undefined },
          fetchImpl: async () => { upstreamCalls++; return Response.json({}); },
        },
      );
      const req = new Request("http://127.0.0.1:4000/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer admin-bridge-token" },
        body: JSON.stringify({ model: REF, messages: [{ role: "user", content: "OK" }] }),
      });
      expect(await (await fallback(req)).json()).toEqual({ servedBy: "native" });
      expect(upstreamCalls).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("admin caller uses only enabled Mistral credential and streams unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mistral-fallback-test-"));
    try {
      const tokenPath = join(dir, "token");
      writeFileSync(tokenPath, "admin-bridge-token", { mode: 0o600 });
      let got;
      const fallback = withMistralFallback(
        () => Response.json({ error: "host was wrongly called" }, { status: 404 }),
        {
          tokenPath,
          credentials: {
            list: () => [{ provider: "mistral-vibe", id: 42 }],
            resolve: async (id) => id === 42
              ? { id, provider: "mistral-vibe", secret: "test-token" }
              : undefined,
          },
          fetchImpl: async (url, init) => {
            got = { url, headers: init.headers, body: JSON.parse(init.body) };
            return new Response("data: test-stream\n\n", {
              status: 200, headers: { "content-type": "text/event-stream" },
            });
          },
        },
      );
      const req = new Request("http://127.0.0.1:4000/v1/chat/completions", {
        method: "POST",
        headers: { authorization: "Bearer admin-bridge-token", "content-type": "application/json" },
        body: JSON.stringify({ model: REF, messages: [{ role: "user", content: "OK" }],
          max_tokens: 32, stream: true, stream_options: { include_usage: true } }),
      });
      const response = await fallback(req);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(await response.text()).toBe("data: test-stream\n\n");
      expect(got.url).toBe("https://api.mistral.ai/v1/chat/completions");
      expect(got.headers.authorization).toBe("Bearer test-token");
      expect(got.body.model).toBe("deepseek-v4-1-flash-1017");
      expect(got.body.stream_options.include_usage).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
