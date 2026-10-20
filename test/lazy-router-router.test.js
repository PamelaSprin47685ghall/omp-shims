import { describe, expect, test } from "bun:test";
import { currentPinScope } from "../lib/credential-pin.js";
import { Attempt, attributeToPin, createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { GatewayDispatcher } from "../lib/lazy-router/dispatcher.js";
import { FaultInjector } from "../lib/lazy-router/faults.js";
import { FORMATS } from "../lib/lazy-router/formats.js";
import { HealthRegistry } from "../lib/lazy-router/health.js";
import { RoutePolicy } from "../lib/lazy-router/policy.js";
import { LazyRouter, SERVED_BY_HEADERS } from "../lib/lazy-router/router.js";
import { UnitDirectory } from "../lib/lazy-router/units.js";

const CHAT = FORMATS["/v1/chat/completions"];

const POLICY = {
  contextWindow: 500000,
  maxOutputTokens: 64000,
  peakWindows: [],
  routes: {
    default: {
      input: ["text"],
      periods: {
        peak: [{ model: "p/big", tier: "gold", effort: "capped" }, { model: "q/text" }],
      },
    },
    vision: { input: ["text", "image"], derive: { from: "default" } },
  },
};

/** Synthetic accounts: two "gold" accounts of provider p; q has none in the store. */
const ACCOUNTS = [
  { id: 1, provider: "p", tier: "gold" },
  { id: 2, provider: "p", tier: "gold" },
];
const fixedTiers = (accounts) => ({ version: 1, ready: Promise.resolve(), accounts: () => accounts });

const CATALOG = {
  "p/big": {
    ref: "p/big",
    provider: "p",
    contextWindow: 1_000_000,
    input: ["text", "image"],
    reasoning: true,
    efforts: ["low", "medium", "high"],
    canDisable: false,
    baseUrl: "https://p.example/v1",
  },
  "q/text": {
    ref: "q/text",
    provider: "q",
    contextWindow: 1_000_000,
    input: ["text"],
    reasoning: false,
    efforts: [],
    canDisable: false,
    baseUrl: "https://q.example/v1",
  },
};

/**
 * A miniature gateway: validates the body, calls the "provider" through the
 * real attempt layer, and answers like the auth-gateway does (502 on upstream
 * errors; a 200 event stream opened before upstream answers when streaming).
 */
function harness({ upstream, faults = {}, bypass }) {
  const events = [];
  const emit = (event, detail = {}) => events.push({ event, ...detail });
  const timers = [];
  const health = new HealthRegistry({
    probeIntervalMs: 1_000,
    onEvent: emit,
    describe: (key, candidate) => (candidate ? `${candidate.unit.label} ${candidate.model}` : key),
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  });
  const credentials = {
    isBrokerUrl: (url) => url.startsWith("http://127.0.0.1:8765/"),
    providerOf: () => "p",
    resolve: async (id) => ({ id, provider: "p", secret: `tok-${id}` }),
  };
  const layer = createAttemptLayer({ credentials });
  const calls = [];
  const callProvider = (body) => {
    const host = `${body.model.split("/")[0]}.example`;
    return layer(
      `https://${host}/v1/chat`,
      { method: "POST", headers: { authorization: "Bearer gateway-choice" }, body: JSON.stringify(body) },
      async (_url, init) => {
        const call = {
          unit: currentPinScope()?.unit.label,
          auth: new Headers(init.headers).get("authorization"),
          body: JSON.parse(init.body),
        };
        calls.push(call);
        return upstream(call, calls.filter((c) => c.unit === call.unit).length);
      },
    );
  };

  const handler = async (request) => {
    const body = await request.json();
    if (!Array.isArray(body.messages)) return Response.json({ error: { message: "bad request" } }, { status: 400 });
    if (body.stream) {
      const stream = new ReadableStream({
        async start(controller) {
          // Like the auth-gateway: the role chunk goes out before the provider answers.
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'));
          if (bypass) {
            // A provider reached outside fetch (e.g. a WebSocket): no verdict, only events.
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(bypass(body))}\n\n`));
            controller.close();
            return;
          }
          try {
            const response = await callProvider(body);
            const payload = response.ok
              ? { choices: [{ delta: { content: "OK" } }] }
              : { error: { message: "upstream" } };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {}
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    try {
      const response = await callProvider(body);
      if (!response.ok)
        return Response.json({ error: { message: "upstream", type: "upstream_error" } }, { status: 502 });
      return Response.json({ served: body.model });
    } catch {
      return Response.json({ error: { message: "aborted" } }, { status: 502 });
    }
  };

  const dispatcher = new GatewayDispatcher({ tokenPath: "/nonexistent", headerTimeoutMs: 2_000 });
  dispatcher.bind(handler, null);
  const router = new LazyRouter({
    policy: new RoutePolicy(POLICY),
    units: new UnitDirectory({ tiers: fixedTiers(ACCOUNTS) }),
    schedule: { at: () => ({ period: "peak", localTime: "test", dayKind: "workday" }) },
    catalog: { ready: true, find: (ref) => CATALOG[ref] },
    health,
    dispatcher,
    faults: new FaultInjector(faults),
    emit,
    settings: {
      probePrompt: "Reply OK",
      probeMaxTokens: 32,
      probeTimeoutMs: 2_000,
      headerTimeoutMs: 2_000,
      providerHeaderTimeoutMs: {},
      upstreamHosts: {},
    },
  });

  const send = (body) => {
    const full = { model: "lazy/default", messages: [{ role: "user", content: "hi" }], ...body };
    const request = new Request("http://gateway.test/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer client" },
      body: JSON.stringify(full),
    });
    return router.serve(CHAT, full, request);
  };
  const names = () => events.map((e) => e.event);
  return { router, send, calls, events, names, timers, health };
}

const ok = () => new Response("{}", { status: 200 });
const quota = () => new Response('{"error":"quota"}', { status: 429 });

describe("LazyRouter", () => {
  test("serves from the first unit, pinned, with capped effort and the fixed output limit", async () => {
    const h = harness({ upstream: ok });
    const response = await h.send({ reasoning_effort: "high", max_tokens: 100 });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].auth).toBe("Bearer tok-1");
    expect(h.calls[0].body).toMatchObject({ model: "p/big", reasoning_effort: "medium", max_completion_tokens: 64000 });
    expect("max_tokens" in h.calls[0].body).toBe(false);
  });

  test("dead probe: cool the unit and fail over at once; the next request skips it", async () => {
    const h = harness({ upstream: (call) => (call.unit === "p:gold#1" ? quota() : ok()) });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.names()).toEqual(["route", "attempt-failed", "probe", "cooldown-enter", "route", "served"]);
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#1", "p:gold#2"]);
    expect(h.calls[1].body).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 32, stream: false });

    const again = await h.send({});
    expect(again.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#1", "p:gold#2", "p:gold#2"]);
  });

  test("live probe: retry the same unit once", async () => {
    const h = harness({ upstream: (call, nth) => (call.unit === "p:gold#1" && nth === 1 ? quota() : ok()) });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
    expect(h.names()).toEqual(["route", "attempt-failed", "probe", "retry-same-unit", "served"]);
  });

  test("live probe but the retry fails too: cool and move on", async () => {
    const h = harness({ upstream: (call, nth) => (call.unit === "p:gold#1" && nth !== 2 ? quota() : ok()) });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.names()).toContain("cooldown-enter");
    expect(h.health.isAlive("p/1 p/big")).toBe(false);
  });

  test("everything dead: the client gets the last upstream error", async () => {
    const h = harness({ upstream: quota });
    const response = await h.send({});
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.type).toBe("upstream_error");
    expect(body.error.message).toContain("q q/text");
    expect(h.names().at(-1)).toBe("exhausted");
  });

  test("a background probe restores the unit and traffic returns to it", async () => {
    let healthy = false;
    const h = harness({ upstream: (call) => (call.unit !== "p:gold#1" || healthy ? ok() : quota()) });
    await h.send({});
    expect(h.health.isAlive("p/1 p/big")).toBe(false);
    healthy = true;
    await h.timers[0]();
    expect(h.names()).toContain("cooldown-exit");
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
  });

  test("a 200 stream opened before the provider answered is judged on the provider's status", async () => {
    const h = harness({ upstream: (call) => (call.unit === "p:gold#1" ? quota() : ok()) });
    const response = await h.send({ stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    const text = await response.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"OK"');
  });

  test("without a provider verdict the first answering event decides, and the pin is reported unverified", async () => {
    const h = harness({ upstream: ok, bypass: () => ({ choices: [{ delta: { content: "OK" } }] }) });
    const response = await h.send({ stream: true });
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
    expect(await response.text()).toContain('"OK"');
    expect(h.names()).toEqual(["route", "served", "pin-unverified"]);
  });

  test("without a provider verdict an in-stream error fails the attempt", async () => {
    const h = harness({
      upstream: ok,
      bypass: (body) =>
        body.model === "p/big" ? { error: { message: "quota" } } : { choices: [{ delta: { content: "OK" } }] },
    });
    const response = await h.send({ stream: true });
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("q");
    // Both p accounts: the stream fails, the (non-streaming) probe answers, the retry fails again.
    expect(h.events.filter((e) => e.event === "attempt-failed").map((e) => `${e.unit}:${e.try}:${e.source}`)).toEqual([
      "p:gold#1:1:stream",
      "p:gold#1:2:stream",
      "p:gold#2:1:stream",
      "p:gold#2:2:stream",
    ]);
  });

  test("image requests skip text-only candidates", async () => {
    const h = harness({ upstream: quota });
    const response = await h.send({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:," } }] }],
    });
    expect(response.status).toBe(429);
    expect(h.calls.every((c) => c.unit !== "q")).toBe(true);
  });

  test("a request the gateway rejects before calling upstream is returned as-is, without cooldown", async () => {
    const h = harness({ upstream: ok });
    const response = await h.send({ messages: "not-a-list" });
    expect(response.status).toBe(400);
    expect(h.calls).toHaveLength(0);
    expect(h.names()).not.toContain("cooldown-enter");
  });

  test("injected faults fail the attempt without reaching the provider", async () => {
    const h = harness({ upstream: ok, faults: { "p:gold#1": { requests: 1, probes: 1 } } });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#2"]);
    expect(h.events.find((e) => e.event === "attempt-failed").source).toBe("injected");
  });

  test("advertised models", () => {
    const h = harness({ upstream: ok });
    const models = h.router.advertisedModels();
    expect(models.map((m) => m.id)).toEqual(["lazy/default", "lazy/vision"]);
    expect(models[1]).toMatchObject({
      context_length: 500000,
      max_output_tokens: 64000,
      input_modalities: ["text", "image"],
    });
  });

  test("the status view is public and names units by tier, never by account", async () => {
    const h = harness({ upstream: (call) => (call.unit === "p:gold#1" ? quota() : ok()) });
    await h.send({});
    const view = await h.router.status().json();
    expect(view.period).toBe("peak");
    expect(view.routes.vision.map((c) => [c.unit, c.eligible])).toEqual([
      ["p:gold#1", true],
      ["p:gold#2", true],
      ["q", false],
    ]);
    const cooling = view.routes.default[0];
    expect(cooling).toMatchObject({ unit: "p:gold#1", health: "cooling", reason: "upstream 429 Too Many Requests" });
    expect(typeof cooling.nextProbeAt).toBe("string");
    expect(view.units).toEqual([
      { unit: "p:gold#1", provider: "p", tier: "gold", pinned: true },
      { unit: "p:gold#2", provider: "p", tier: "gold", pinned: true },
    ]);
    const text = JSON.stringify(view);
    expect(text).not.toContain("quota"); // upstream error text stays out
    expect(text).not.toContain("credentialId");
    expect(text).not.toMatch(/"p\/\d/); // internal unit keys stay out
  });
});

test("broker block reports are re-pointed at the pinned credential of the same provider", () => {
  const attempt = new Attempt({
    unit: { label: "p:gold#2", provider: "p", key: "p/2", credentialId: 2 },
    model: "p/big",
  });
  const credentials = { providerOf: (id) => ({ 1: "p", 9: "other" })[id] };
  expect(attributeToPin("http://127.0.0.1:8765/v1/credential/1/block", attempt, credentials)).toBe(
    "http://127.0.0.1:8765/v1/credential/2/block",
  );
  expect(attributeToPin("http://127.0.0.1:8765/v1/credential/9/block", attempt, credentials)).toBe(
    "http://127.0.0.1:8765/v1/credential/9/block",
  );
  expect(attributeToPin("http://127.0.0.1:8765/v1/credential/1/refresh", attempt, credentials)).toBe(
    "http://127.0.0.1:8765/v1/credential/1/refresh",
  );
});
