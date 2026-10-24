import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  fetchMistralVibeModels,
  loginMistralVibe,
  MISTRAL_VIBE_API_BASE,
  MISTRAL_VIBE_AUTH_API_BASE,
  MISTRAL_VIBE_MODEL_ID,
  MISTRAL_VIBE_PROVIDER_ID,
  mistralVibeProviderConfig,
} from "../lib/mistral-vibe-provider.js";

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

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
