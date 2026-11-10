// Regression tests for the status page and the response wrapper.

import { describe, expect, test } from "bun:test";
import { PROBE_STATE } from "../lib/contracts.mjs";
import { convertChatSse, MAX_RETAINED_CHARS } from "../lib/router/protocol-codec.mjs";
import { createUsageTap, LazyRouter } from "../lib/router/router.mjs";
import { releaseWhenSettled } from "../lib/router/units.mjs";
import { serializeSseFrame } from "../lib/sse.mjs";

describe("releaseWhenSettled", () => {
  test("drops stale body headers and keeps the URL and the full body", async () => {
    const source = new Response("hello", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-length": "999",
        "content-encoding": "gzip",
      },
    });
    Object.defineProperty(source, "url", { value: "https://api.example.test/answer", configurable: true });
    let released = 0;
    const wrapped = releaseWhenSettled(source, { release: () => (released += 1) });
    expect(wrapped.headers.get("content-length")).toBeNull();
    expect(wrapped.headers.get("content-encoding")).toBeNull();
    expect(wrapped.url).toBe("https://api.example.test/answer");
    expect(await wrapped.text()).toBe("hello");
    expect(released).toBe(1);
  });
});

/** A router with one always-failing candidate. */
function failingRouter(verdict) {
  const candidate = {
    routeId: "lazy/pro",
    provider: "fake",
    account: 1,
    unitKey: "fake/1",
    model: "fake/model",
    effort: "high",
    tier: "plus",
    intelligence: 50,
    cost: 1,
    leafKey: "leaf",
    unit: { label: "fake:plus#1", provider: "fake", key: "fake/1", credentialId: 1 },
  };
  const policy = {
    routeNames: ["lazy/pro"],
    modelIdOf: (id) => id,
    displayNameOf: (id) => id,
    candidatesFor: () => [candidate],
    maxInFlight: () => 0,
    periodAt: () => "offPeak",
    contextWindowOf: () => 200_000,
    maxOutputTokensOf: () => 64_000,
  };
  const catalog = {
    ready: true,
    gatewaySnapshotFresh: true,
    find: () => ({ contextWindow: 200_000, input: ["text"], reasoning: false, baseUrl: "https://fake.test/v1" }),
    rows: () => [],
    hasNativeModel: () => false,
    ingestGatewayModels: () => true,
  };
  return new LazyRouter({
    policy,
    catalog,
    health: {
      stateOf: () => PROBE_STATE.ALIVE,
      claimProbe: () => ({ claimed: true, fence: 1 }),
      markDead() {},
      markAlive() {},
    },
    dispatcher: {
      ready: false,
      internalRequest: () => new Request("http://127.0.0.1/v1/models"),
      forward: async () => new Response("{}"),
      run: async () => ({ verdict, response: new Response("x"), upstreamContacted: true }),
    },
    faults: { active: false, take: () => undefined },
    affinity: { order: (keys) => keys, remember() {} },
    capacity: { hasRoom: () => true, inFlight: () => 0, slot: () => ({ granted: true, release() {} }) },
    admission: { record() {}, admits: () => true, windowCount: () => 0 },
    perf: { summary: () => undefined, wrapStream: (response) => response },
    speed: { predict: () => ({}), observe() {} },
    store: { readTokenTotals: () => null, resetTokenTotals: () => true, addTokenTotals() {} },
    planData: {},
    emit: () => {},
    settings: {
      routing: {},
      probePrompt: "OK",
      probeMaxTokens: 8,
      probeTimeoutMs: 100,
      headerTimeoutMs: 100,
      providerHeaderTimeoutMs: {},
      upstreamHosts: {},
      probeIntervalMs: 600_000,
    },
  });
}

describe("client error text", () => {
  test("raw upstream text is not echoed to the client", async () => {
    const router = failingRouter({
      ok: false,
      status: 500,
      source: "upstream",
      message: "secret token sk-123 user@example.com",
    });
    const format = {
      name: "openai-chat",
      transcript: () => [],
      conversation: () => [],
      readEffort: () => undefined,
      writeEffort() {},
      writeMaxTokens() {},
      requestUsage() {},
      errorBody: (message, type) => ({ error: { message, type } }),
    };
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "lazy/pro", messages: [] }),
    });
    const response = await router.serve(format, { model: "lazy/pro", messages: [] }, request);
    const body = await response.text();
    expect(body).not.toContain("sk-123");
    expect(body).not.toContain("user@example.com");
    expect(body).toContain("lazy/pro:");
    router.dispose();
  });
});

describe("retained stream buffers", () => {
  test("visible text is truncated at the retention cap", async () => {
    const chunk = "a".repeat(900_000);
    const frames = Array.from(
      { length: 5 },
      () =>
        `data: ${JSON.stringify({
          id: "x",
          choices: [{ index: 0, delta: { content: chunk } }],
        })}\n\n`,
    );
    const chat = `${frames.join("")}data: ${JSON.stringify({
      id: "x",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`;
    const response = new Response(chat, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const text = await convertChatSse("/v1/responses", response, "lazy/pro").text();
    const completed = text
      .split("\n\n")
      .filter((block) => block.includes("response.completed"))
      .at(-1);
    const data = (completed ?? "")
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    const event = JSON.parse(data);
    const retained = event.response.output.find((item) => item.type === "message").content[0].text;
    expect(retained.length).toBeLessThanOrEqual(MAX_RETAINED_CHARS + "\n[truncated]".length);
    expect(retained.endsWith("[truncated]")).toBe(true);
  });

  test("a broken usage scanner stops reading but forwards every byte", async () => {
    const bad = `data: ${"x".repeat(1024 * 1024 + 1)}\n\n`;
    const good = serializeSseFrame({ data: { usage: { prompt_tokens: 1 } } });
    const source = new Response(bad + good, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    let calls = 0;
    const tapped = createUsageTap(source, { onUsage: () => (calls += 1) });
    const text = await tapped.text();
    expect(text).toBe(bad + good);
    expect(calls).toBe(0);
  });
});

describe("usage tap exactly once", () => {
  test("SSE merges duplicate usage frames into one callback", async () => {
    const frames = [
      { message_delta: { usage: { input_tokens: 10, output_tokens: 5 } } },
      { message_delta: { usage: { input_tokens: 10, cache_read_input_tokens: 2, output_tokens: 7 } } },
    ];
    const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
    const calls = [];
    const tapped = createUsageTap(
      new Response(`${body}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }),
      { mode: "sse", requestId: "req-1", onUsage: (usage) => calls.push(usage) },
    );
    expect(await tapped.text()).toContain("[DONE]");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ uncachedInput: 10, cachedInput: 2, output: 7 });
  });

  test("JSON parses only the bounded tail", async () => {
    const usage = { usage: { prompt_tokens: 4, completion_tokens: 6 } };
    const filler = "x".repeat(70 * 1024);
    const body = `{"filler":"${filler}","usage":${JSON.stringify(usage.usage)}}`;
    const calls = [];
    const tapped = createUsageTap(new Response(body, { headers: { "content-type": "application/json" } }), {
      mode: "json",
      requestId: "req-2",
      onUsage: (value) => calls.push(value),
    });
    expect(await tapped.text()).toBe(body);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ uncachedInput: 4, output: 6 });
  });
});
