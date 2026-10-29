import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  fetchMistralVibeModels,
  installMistralVibeResponseAdapter,
  addMistralPromptCacheKey,
  mistralPromptCacheKey,
  loginMistralVibe,
  MISTRAL_VIBE_API_BASE,
  MISTRAL_VIBE_AUTH_API_BASE,
  MISTRAL_VIBE_MODEL_ID,
  MISTRAL_VIBE_PROVIDER_ID,
  mistralVibeProviderConfig,
  normalizeMistralVibeSse,
} from "../lib/mistral-vibe-provider.js";

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Mistral Vibe native prefix-cache compatibility", () => {
  const first = {
    model: "deepseek-v4-1-flash-1017",
    messages: [
      { role: "system", content: "An unchanged shared system instruction." },
      { role: "user", content: "The first turn in this conversation." },
    ],
    stream: false,
  };

  test("stable across appended turns, opaque, scoped by model and initial turn", () => {
    const firstKey = mistralPromptCacheKey(first);
    const nextKey = mistralPromptCacheKey({
      ...first,
      messages: [...first.messages, { role: "assistant", content: "Answer" },
        { role: "user", content: "A follow-up question" }],
    });
    expect(firstKey).toBe(nextKey);
    expect(firstKey).toStartWith("omp-");
    expect(firstKey).not.toContain("first");
    expect(mistralPromptCacheKey({ ...first, model: "another-model" })).not.toBe(firstKey);
    expect(mistralPromptCacheKey({ ...first, messages: [
      first.messages[0], { role: "user", content: "Another initial turn" },
    ] })).not.toBe(firstKey);
    expect(mistralPromptCacheKey({ messages: [] })).toBeUndefined();
  });

  test("caller-provided key, even null, is retained and malformed input passes through", () => {
    for (const value of ["application-key", null]) {
      const text = JSON.stringify({ ...first, prompt_cache_key: value });
      expect(addMistralPromptCacheKey(text)).toBeUndefined();
    }
    expect(addMistralPromptCacheKey("not json")).toBeUndefined();
    expect(addMistralPromptCacheKey(JSON.stringify({ model: first.model }))).toBeUndefined();
  });

  test("rewrites only Mistral JSON chat request; preserves cached usage and body", async () => {
    const handlers = [];
    installMistralVibeResponseAdapter({
      addFetchHandler: (handler) => handlers.push(handler),
      preserveResponseUrl: (response) => response,
    });
    const seen = [];
    const next = async (target, init) => {
      seen.push({ url: String(target), init, body: JSON.parse(init.body) });
      return reply({
        usage: { prompt_tokens: 512, prompt_tokens_details: { cached_tokens: 448 } },
        choices: [{ message: { role: "assistant", content: "OK" } }],
      });
    };
    const url = "https://api.mistral.ai/v1/chat/completions";
    const init = { method: "POST", headers: {
      "content-type": "application/json", "content-length": "10",
    }, body: JSON.stringify(first) };
    const response = await handlers[0](url, init, next);
    expect(seen).toHaveLength(1);
    expect(seen[0].body.messages).toEqual(first.messages);
    expect(seen[0].body.prompt_cache_key).toBe(mistralPromptCacheKey(first));
    expect(new Headers(seen[0].init.headers).has("content-length")).toBe(false);
    expect((await response.json()).usage.prompt_tokens_details.cached_tokens).toBe(448);
    await handlers[0](url, { ...init, body: JSON.stringify({ ...first, messages: [
      ...first.messages, { role: "user", content: "Next turn" },
    ] }) }, next);
    expect(seen[1].body.prompt_cache_key).toBe(seen[0].body.prompt_cache_key);
    const untrusted = await handlers[0]("https://example.net/v1/chat/completions", init, next);
    expect(seen[2].body.prompt_cache_key).toBeUndefined();
    expect((await untrusted.json()).choices).toHaveLength(1);
  });

  test("supports Request objects without losing method or sending twice on network errors", async () => {
    const handlers = [];
    installMistralVibeResponseAdapter({
      addFetchHandler: (handler) => handlers.push(handler),
      preserveResponseUrl: (response) => response,
    });
    const url = "https://api.mistral.ai/v1/chat/completions";
    const original = new Request(url, {
      method: "POST",
      body: JSON.stringify(first),
      headers: { "content-type": "application/json" },
    });
    let calls = 0;
    const upstream = async (input, init) => {
      calls += 1;
      expect(input).toBeInstanceOf(Request);
      expect(input.method).toBe("POST");
      expect((await input.clone().json()).prompt_cache_key).toBe(mistralPromptCacheKey(first));
      expect(init).toBeUndefined();
      throw new Error("upstream failed");
    };
    await expect(handlers[0](original, undefined, upstream)).rejects.toThrow("upstream failed");
    expect(calls).toBe(1);
  });
});

describe("Mistral Vibe reasoning stream adapter", () => {
  test("maps structured thinking blocks to reasoning_content without changing text", () => {
    const input = [
      'data: {"choices":[{"index":0,"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":"first "},{"type":"text","text":"second"}]}]},"finish_reason":null}]}',
      'data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}',
      "data: [DONE]",
      "",
    ].join("\n");
    const output = normalizeMistralVibeSse(input);
    const lines = output.split("\n");
    expect(JSON.parse(lines[0].slice(6)).choices[0].delta).toEqual({
      content: "",
      reasoning_content: "first second",
    });
    expect(lines[1]).toBe('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}');
    expect(lines[2]).toBe("data: [DONE]");
    const usage = 'data: {"usage":{"prompt_tokens":3364,"prompt_tokens_details":{"cached_tokens":3344}}}';
    expect(normalizeMistralVibeSse(usage)).toBe(usage);
  });

  test("flattens text content blocks and leaves unknown structured blocks untouched", () => {
    const textBlocks = 'data: {"choices":[{"delta":{"role":"assistant","content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}]}}]}';
    expect(JSON.parse(normalizeMistralVibeSse(textBlocks).slice(6)).choices[0].delta).toEqual({
      role: "assistant",
      content: "hello world",
    });
    const unknown = 'data: {"choices":[{"delta":{"content":[{"type":"citation","url":"x"}]}}]}';
    expect(normalizeMistralVibeSse(unknown)).toBe(unknown);
  });

  test("does not duplicate a canonical reasoning field", () => {
    const input = 'data: {"choices":[{"delta":{"reasoning_content":"canonical","content":[{"type":"thinking","thinking":[{"type":"text","text":"duplicate"}]}]}}]}';
    const delta = JSON.parse(normalizeMistralVibeSse(input).slice(6)).choices[0].delta;
    expect(delta).toEqual({ reasoning_content: "canonical", content: "" });
  });

  test("rewrites only Mistral chat-completion event streams", async () => {
    const handlers = [];
    installMistralVibeResponseAdapter({
      addFetchHandler: (handler) => handlers.push(handler),
      preserveResponseUrl: (response) => response,
    });
    expect(handlers).toHaveLength(1);
    const upstream = async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":"visible thought"}]}]}}]}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    const response = await handlers[0]("https://api.mistral.ai/v1/chat/completions", {}, upstream);
    expect(await response.text()).toContain('"reasoning_content":"visible thought"');

    const other = await handlers[0](
      "https://example.com/v1/chat/completions",
      {},
      async () => new Response("untouched"),
    );
    expect(await other.text()).toBe("untouched");
  });

  test("rewrites a reasoning SSE event split across network chunks", async () => {
    const handlers = [];
    installMistralVibeResponseAdapter({
      addFetchHandler: (handler) => handlers.push(handler),
      preserveResponseUrl: (response) => response,
    });
    const event =
      'data: {"choices":[{"delta":{"content":[{"type":"thinking","thinking":[{"type":"text","text":"split thought"}]}]}}]}\n\n';
    const bytes = new TextEncoder().encode(event);
    const upstream = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 37));
            controller.enqueue(bytes.slice(37));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const response = await handlers[0]("https://api.mistral.ai/v1/chat/completions", {}, upstream);
    expect(await response.text()).toContain('"reasoning_content":"split thought"');
  });

  test("maps structured thinking in non-streaming JSON responses", async () => {
    const handlers = [];
    installMistralVibeResponseAdapter({
      addFetchHandler: (handler) => handlers.push(handler),
      preserveResponseUrl: (response) => response,
    });
    const upstream = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: [
                  { type: "thinking", thinking: [{ type: "text", text: "json thought" }] },
                  { type: "text", text: "json answer" },
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json", "content-length": "9999" } },
      );
    const response = await handlers[0]("https://api.mistral.ai/v1/chat/completions", {}, upstream);
    expect(response.headers.get("content-length")).toBeNull();
    expect((await response.json()).choices[0].message).toEqual({
      role: "assistant",
      content: "json answer",
      reasoning_content: "json thought",
    });
  });

});

describe("Mistral Vibe provider", () => {
  test("registers Vibe's current model on the standard Mistral chat transport", () => {
    const provider = mistralVibeProviderConfig();
    expect(provider.baseUrl).toBe(MISTRAL_VIBE_API_BASE);
    expect(provider.api).toBe("openai-completions");
    expect(provider.models).toHaveLength(1);
    expect(provider.models[0]).toMatchObject({
      id: MISTRAL_VIBE_MODEL_ID,
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 64000,
      input: ["text", "image"],
    });
    expect(provider.oauth.name).toContain("Mistral Vibe");
    expect(provider.fetchDynamicModels).toBe(fetchMistralVibeModels);
  });

  test("discovers every chat model available to the signed-in account", async () => {
    const calls = [];
    const models = await fetchMistralVibeModels("sk-account", {
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization") });
        if (String(url).endsWith("/api/vibe/whoami")) return reply({ api_base: "https://tenant.example.com" });
        if (String(url) === "https://tenant.example.com/v1/models") return reply({ data: [
          { id: "mistral-medium-latest", archived: false, max_context_length: 262144, capabilities: { completion_chat: true, vision: true } },
          { id: "zai-glm-5-3", archived: false, max_context_length: 1000000, capabilities: { completion_chat: true, vision: false } },
          { id: "embed-only", archived: false, max_context_length: 8192, capabilities: { completion_chat: false, vision: false } },
          { id: "old-chat", archived: true, max_context_length: 32768, capabilities: { completion_chat: true, vision: false } },
        ] });
        throw new Error("unexpected fetch: " + url);
      },
    });
    expect(models.map((model) => model.id)).toEqual([MISTRAL_VIBE_MODEL_ID, "mistral-medium-latest", "zai-glm-5-3"]);
    expect(models[1]).toMatchObject({ input: ["text", "image"], contextWindow: 262144, reasoning: true });
    expect(models[2]).toMatchObject({ input: ["text"], contextWindow: 1000000, reasoning: true });
    expect(models[2].thinking.efforts).toEqual(["low", "high", "max"]);
    expect(calls[1]).toEqual({ url: "https://tenant.example.com/v1/models", auth: "Bearer sk-account" });
  });

  test("model discovery fails closed to the Vibe preset when the catalog is unavailable", async () => {
    const models = await fetchMistralVibeModels("sk-account", { fetch: async (url) => {
      if (String(url).endsWith("/api/vibe/whoami")) return new Response("no", { status: 500 });
      return new Response("down", { status: 503 });
    } });
    expect(models.map((model) => model.id)).toEqual([MISTRAL_VIBE_MODEL_ID]);
  });

  test("browser sign-in mirrors Vibe PKCE start, poll and exchange", async () => {
    const verifier = "fixed-verifier-for-test";
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    let polls = 0;
    const calls = [];
    const fetch = async (url, init = {}) => {
      const text = String(url);
      calls.push({ url: text, init });
      if (text === MISTRAL_VIBE_AUTH_API_BASE + "/vibe/sign-in") {
        expect(JSON.parse(init.body)).toEqual({ code_challenge: challenge, code_challenge_method: "S256" });
        return reply({
          process_id: "proc-1",
          sign_in_url: "https://console.mistral.ai/codestral/cli/authenticate#state=test",
          poll_url: "https://console.mistral.ai/api/vibe/sign-in/poll/poll-1",
          expires_at: "2030-01-01T00:05:00Z",
        });
      }
      if (text.endsWith("/poll/poll-1")) {
        polls += 1;
        return reply(polls === 1 ? { status: "pending" } : { status: "completed", exchange_token: "exchange-1" });
      }
      if (text.endsWith("/vibe/sign-in/proc-1/exchange")) {
        expect(JSON.parse(init.body)).toEqual({ exchange_token: "exchange-1", code_verifier: verifier });
        return reply({ api_key: "sk-vibe-secret" });
      }
      if (text.endsWith("/api/vibe/whoami")) {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-vibe-secret");
        return reply({ plan_type: "chat", plan_name: "INDIVIDUAL", customer_id: "cust-123", api_base: "https://tenant.example.com" });
      }
      throw new Error("unexpected fetch: " + text);
    };
    let auth;
    const credential = await loginMistralVibe(
      { onAuth: (value) => { auth = value; } },
      { fetch, verifier, now: () => Date.parse("2030-01-01T00:00:00Z"), sleep: async () => {} },
    );
    expect(auth.url).toStartWith("https://console.mistral.ai/codestral/cli/authenticate");
    expect(polls).toBe(2);
    expect(credential).toMatchObject({
      access: "sk-vibe-secret",
      refresh: "static-api-key",
      accountId: MISTRAL_VIBE_PROVIDER_ID + ":customer-cust-123",
      apiEndpoint: "https://tenant.example.com/v1",
    });
    expect(credential.accountId).not.toContain("sk-vibe-secret");
    expect(Object.keys(credential).sort()).toEqual(["access", "accountId", "apiEndpoint", "expires", "refresh"].sort());
    expect(calls).toHaveLength(5);
  });

  test("poll 429s back off without consuming the generic failure budget", async () => {
    let polls = 0;
    const sleeps = [];
    const fetch = async (url) => {
      const text = String(url);
      if (text.endsWith("/vibe/sign-in")) return reply({
        process_id: "proc-429",
        sign_in_url: "https://console.mistral.ai/codestral/cli/authenticate#x",
        poll_url: "https://console.mistral.ai/api/vibe/sign-in/poll/poll-429",
        expires_at: "2030-01-01T00:05:00Z",
      });
      if (text.endsWith("/poll/poll-429")) {
        polls += 1;
        if (polls === 1) return new Response("limited", { status: 429, headers: { "retry-after": "0" } });
        if (polls === 2) return new Response("limited", { status: 429, headers: { "retry-after": "7" } });
        if (polls === 3) return new Response("limited", { status: 429 });
        return reply({ status: "completed", exchange_token: "exchange-429" });
      }
      if (text.endsWith("/vibe/sign-in/proc-429/exchange")) return reply({ api_key: "sk-vibe-429" });
      if (text.endsWith("/api/vibe/whoami")) return reply({ customer_id: "cust-429" });
      throw new Error("unexpected fetch: " + text);
    };
    const credential = await loginMistralVibe({}, {
      fetch,
      verifier: "verifier-429",
      now: () => Date.parse("2030-01-01T00:00:00Z"),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(polls).toBe(4);
    expect(sleeps).toEqual([6_000, 12_000, 24_000]);
    expect(credential.accountId).toBe(MISTRAL_VIBE_PROVIDER_ID + ":customer-cust-429");
  });

  test("rejects an untrusted poll URL before following it", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return reply({
        process_id: "proc-1",
        sign_in_url: "https://console.mistral.ai/codestral/cli/authenticate#x",
        poll_url: "https://evil.example/api/vibe/sign-in/poll/stolen",
        expires_at: "2030-01-01T00:05:00Z",
      });
    };
    await expect(loginMistralVibe({}, {
      fetch,
      verifier: "v",
      now: () => Date.parse("2030-01-01T00:00:00Z"),
    })).rejects.toThrow(/untrusted URL/);
    expect(calls).toBe(1);
  });

  test("maps workspace API-key denial without exposing exchange secrets", async () => {
    const fetch = async (url) => {
      const text = String(url);
      if (text.endsWith("/vibe/sign-in")) return reply({
        process_id: "proc-1",
        sign_in_url: "https://console.mistral.ai/codestral/cli/authenticate#x",
        poll_url: "https://console.mistral.ai/api/vibe/sign-in/poll/poll-1",
        expires_at: "2030-01-01T00:05:00Z",
      });
      if (text.endsWith("/poll/poll-1")) return reply({ status: "completed", exchange_token: "exchange-secret" });
      if (text.endsWith("/exchange")) return reply({ error_code: 9004, detail: "forbidden" }, 403);
      throw new Error("unexpected fetch: " + text);
    };
    let message = "";
    try {
      await loginMistralVibe({}, {
        fetch,
        verifier: "verifier-secret",
        now: () => Date.parse("2030-01-01T00:00:00Z"),
        sleep: async () => {},
      });
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain("select another workspace");
    expect(message).not.toContain("exchange-secret");
    expect(message).not.toContain("verifier-secret");
  });
});
