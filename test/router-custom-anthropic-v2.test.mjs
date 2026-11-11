// The models.yml Anthropic Messages transport. A Kuaipao-style provider
// declares `api: "anthropic-messages"`; the gateway still receives Chat or
// Messages. Every conversion is bounded and every error body stays sanitized.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lazyRouterHandler } from "../features/lazy-router.mjs";
import { registerCustomProviderMeta } from "../lib/host-bridge.mjs";
import { customProviderConfigs, withCustomProviderFallback } from "../lib/router/custom-provider-fallback.mjs";
import { tempDir } from "./helpers.mjs";

const realFetch = globalThis.fetch;
const cleanups = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const dispose of cleanups.splice(0).reverse()) dispose();
});

function tokenFile() {
  const dir = tempDir("omp-shims-anthropic-");
  const path = join(dir, "gateway.token");
  writeFileSync(path, "test-gateway-token", { mode: 0o600 });
  return path;
}

function descriptor(overrides = {}) {
  return {
    name: "kuaipao",
    baseUrl: "https://kuaipao.test/v1",
    api: "anthropic-messages",
    apiKey: "sk-provider-key",
    headers: {},
    models: [{ id: "claude-sonnet-5-5" }],
    ...overrides,
  };
}

function configuredFor(overrides) {
  const entry = descriptor(overrides);
  return new Map([
    ["kuaipao/claude-sonnet-5-5", { descriptor: entry, model: entry.models[0], base: new URL(entry.baseUrl) }],
  ]);
}

function directRequest(path, body, tokenPath) {
  const token = readFileSync(tokenPath, "utf8").trim();
  return new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/** Parse every data frame of one SSE body. */
function sseData(text) {
  const values = [];
  for (const block of text.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data === "") continue;
    values.push(data === "[DONE]" ? data : JSON.parse(data));
  }
  return values;
}

describe("anthropic models.yml descriptors", () => {
  test("customProviderConfigs accepts anthropic-messages and keeps strict origins", () => {
    const configs = customProviderConfigs([
      descriptor(),
      descriptor({ name: "query", baseUrl: "https://kuaipao.test/v1?x=1" }),
      descriptor({ name: "plain", baseUrl: "http://kuaipao.test/v1" }),
      descriptor({ name: "other", api: "grpc" }),
    ]);
    expect([...configs.keys()]).toEqual(["kuaipao/claude-sonnet-5-5"]);
    expect(configs.get("kuaipao/claude-sonnet-5-5").descriptor.api).toBe("anthropic-messages");
  });

  test("a Chat request becomes a Messages request with tools and the provider key", async () => {
    const tokenPath = tokenFile();
    let seen;
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor(),
      fetchImpl: async (url, init) => {
        seen = { url, init, body: JSON.parse(init.body) };
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [
            { type: "text", text: "hello" },
            { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "x" } },
          ],
          stop_reason: "tool_use",
          usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
        });
      },
    });
    const response = await fallback(
      directRequest(
        "/v1/chat/completions",
        {
          model: "kuaipao/claude-sonnet-5-5",
          messages: [
            { role: "system", content: "be brief" },
            { role: "user", content: "hi" },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "lookup",
                description: "find one row",
                parameters: { type: "object", properties: { q: { type: "string" } } },
              },
            },
          ],
          max_tokens: 32,
        },
        tokenPath,
      ),
      {},
    );
    expect(response.status).toBe(200);
    expect(seen.url).toBe("https://kuaipao.test/v1/messages");
    expect(seen.init.headers.get("x-api-key")).toBe("sk-provider-key");
    expect(seen.init.headers.get("authorization")).toBeNull();
    expect(seen.init.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(seen.body.model).toBe("claude-sonnet-5-5");
    expect(seen.body.max_tokens).toBe(32);
    expect(seen.body.system).toBe("be brief");
    expect(seen.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
    expect(seen.body.tools).toEqual([
      {
        name: "lookup",
        description: "find one row",
        input_schema: { type: "object", properties: { q: { type: "string" } } },
      },
    ]);

    const answer = await response.json();
    expect(answer.choices[0].message.content).toBe("hello");
    expect(answer.choices[0].message.tool_calls[0]).toEqual({
      id: "toolu_1",
      type: "function",
      function: { name: "lookup", arguments: '{"q":"x"}' },
    });
    expect(answer.choices[0].finish_reason).toBe("tool_calls");
    expect(answer.usage).toEqual({
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
      prompt_tokens_details: { cached_tokens: 2 },
    });
  });

  test("a Messages request passes through with its Anthropic-only fields", async () => {
    const tokenPath = tokenFile();
    let seen;
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor(),
      fetchImpl: async (url, init) => {
        seen = { url, init, body: JSON.parse(init.body) };
        return Response.json({
          id: "msg_2",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5-5",
          content: [{ type: "text", text: "reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 2, output_tokens: 1 },
        });
      },
    });
    const response = await fallback(
      directRequest(
        "/v1/messages",
        {
          model: "kuaipao/claude-sonnet-5-5",
          max_tokens: 24,
          messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }],
          thinking: { type: "enabled", budget_tokens: 1024 },
          output_config: { effort: "medium" },
          metadata: { user_id: "u1" },
        },
        tokenPath,
      ),
      {},
    );
    expect(seen.url).toBe("https://kuaipao.test/v1/messages");
    expect(seen.body.model).toBe("claude-sonnet-5-5");
    expect(seen.body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(seen.body.output_config).toEqual({ effort: "medium" });
    expect(seen.body.metadata).toEqual({ user_id: "u1" });
    expect(seen.body.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(seen.init.headers.get("x-api-key")).toBe("sk-provider-key");

    const answer = await response.json();
    expect(answer.model).toBe("kuaipao/claude-sonnet-5-5");
    expect(answer.content[0].text).toBe("reply");
  });

  test("an Anthropic stream becomes Chat chunks, usage, and DONE", async () => {
    const tokenPath = tokenFile();
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","model":"claude-sonnet-5-5","usage":{"input_tokens":9,"output_tokens":1,"cache_read_input_tokens":4}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"lookup","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"x\\"}"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor(),
      fetchImpl: async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
    });
    const response = await fallback(
      directRequest(
        "/v1/chat/completions",
        { model: "kuaipao/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], stream: true },
        tokenPath,
      ),
      {},
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const frames = sseData(await response.text());
    expect(frames[0].choices[0].delta).toEqual({ role: "assistant" });
    expect(frames[1].choices[0].delta).toEqual({ content: "Hi" });
    const tool = frames[2].choices[0].delta.tool_calls[0];
    expect(tool).toEqual({ index: 0, id: "toolu_9", type: "function", function: { name: "lookup", arguments: "" } });
    expect(frames[3].choices[0].delta.tool_calls[0].function.arguments).toBe('{"q":');
    expect(frames[4].choices[0].delta.tool_calls[0].function.arguments).toBe('"x"}');
    expect(frames[5].choices[0].finish_reason).toBe("tool_calls");
    expect(frames[6].usage).toEqual({
      prompt_tokens: 9,
      completion_tokens: 5,
      total_tokens: 14,
      prompt_tokens_details: { cached_tokens: 4 },
    });
    expect(frames[7]).toBe("[DONE]");
  });

  test("the Responses dialect is refused before any provider call", async () => {
    const tokenPath = tokenFile();
    let fetched = false;
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor(),
      fetchImpl: async () => {
        fetched = true;
        return new Response("unexpected");
      },
    });
    const response = await fallback(
      directRequest("/v1/responses", { model: "kuaipao/claude-sonnet-5-5", input: "hi" }, tokenPath),
      {},
    );
    expect(fetched).toBe(false);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        type: "adapter_unsupported",
        message: "adapter_unsupported: this model adapter cannot represent the request",
      },
    });
  });

  test("a provider 404 stays one sanitized failure", async () => {
    const tokenPath = tokenFile();
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor(),
      fetchImpl: async () =>
        Response.json(
          {
            type: "error",
            error: {
              type: "not_found_error",
              message: "Unknown model claude-sonnet-5-5 at https://kuaipao.test; key sk-provider-key rejected",
            },
          },
          { status: 404 },
        ),
    });
    const response = await fallback(
      directRequest(
        "/v1/chat/completions",
        { model: "kuaipao/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] },
        tokenPath,
      ),
      {},
    );
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(JSON.parse(text)).toEqual({
      error: { type: "upstream_error", message: "Custom provider request failed" },
    });
    for (const leaked of ["kuaipao.test", "sk-provider-key", "unknown model", "not_found"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
  });

  test("an auth-less descriptor sends no key header", async () => {
    const tokenPath = tokenFile();
    let seen;
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath,
      configured: configuredFor({ apiKey: "N/A", auth: "none" }),
      fetchImpl: async (_url, init) => {
        seen = init;
        return Response.json({
          id: "msg_4",
          type: "message",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });
    await fallback(
      directRequest(
        "/v1/chat/completions",
        { model: "kuaipao/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] },
        tokenPath,
      ),
      {},
    );
    expect(seen.headers.get("x-api-key")).toBeNull();
    expect(seen.headers.get("authorization")).toBeNull();
  });
});

describe("native provider selection", () => {
  test("a models.yml provider without a credential row reaches the custom transport", async () => {
    const tokenPath = tokenFile();
    const dispose = registerCustomProviderMeta("kuaipao", {
      baseUrl: "https://kuaipao.test/v1",
      api: "anthropic-messages",
      apiKey: "sk-provider-key",
      models: [{ id: "claude-sonnet-5-5" }],
    });
    cleanups.push(dispose);
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return Response.json({
        id: "msg_5",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    let gatewayCalls = 0;
    const router = {
      handles: () => false,
      catalog: {
        host: new Map([["kuaipao/claude-sonnet-5-5", { provider: "kuaipao", id: "claude-sonnet-5-5" }]]),
        gateway: new Map(),
        hasNativeModel: () => true,
      },
      measureDirect: (_model, response) => response,
    };
    const handler = lazyRouterHandler({
      router,
      dispatcher: { bind() {} },
      statusPage: () => undefined,
      credentials: { listProviders: async () => ["openai"] },
      config: {},
      paths: { gatewayTokenPath: tokenPath },
    });
    const response = await handler(
      directRequest(
        "/v1/chat/completions",
        { model: "kuaipao/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] },
        tokenPath,
      ),
      {},
      async () => {
        gatewayCalls += 1;
        return new Response("gateway", { status: 404 });
      },
    );
    expect(response.status).toBe(200);
    expect(fetched).toBe(true);
    expect(gatewayCalls).toBe(0);
    expect((await response.json()).choices[0].message.content).toBe("ok");
  });

  test("a provider with a credential row stays on the gateway path", async () => {
    const tokenPath = tokenFile();
    const dispose = registerCustomProviderMeta("kuaipao", {
      baseUrl: "https://kuaipao.test/v1",
      api: "anthropic-messages",
      apiKey: "sk-provider-key",
      models: [{ id: "claude-sonnet-5-5" }],
    });
    cleanups.push(dispose);
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return Response.json({});
    };
    const router = {
      handles: () => false,
      catalog: {
        host: new Map([["kuaipao/claude-sonnet-5-5", { provider: "kuaipao", id: "claude-sonnet-5-5" }]]),
        gateway: new Map(),
        hasNativeModel: () => true,
      },
      measureDirect: (_model, response) => response,
    };
    const handler = lazyRouterHandler({
      router,
      dispatcher: { bind() {} },
      statusPage: () => undefined,
      credentials: { listProviders: async () => ["kuaipao"] },
      config: {},
      paths: { gatewayTokenPath: tokenPath },
    });
    let gatewayCalls = 0;
    await handler(
      directRequest(
        "/v1/chat/completions",
        { model: "kuaipao/claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }] },
        tokenPath,
      ),
      {},
      async () => {
        gatewayCalls += 1;
        return new Response("gateway", { status: 404 });
      },
    );
    expect(fetched).toBe(false);
    expect(gatewayCalls).toBe(1);
  });
});
