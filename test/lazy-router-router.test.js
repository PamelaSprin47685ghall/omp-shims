import { describe, expect, test } from "bun:test";
import { currentPinScope } from "../lib/credential-pin.js";
import { Attempt, attributeToPin, createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { GatewayDispatcher } from "../lib/lazy-router/dispatcher.js";
import { FaultInjector } from "../lib/lazy-router/faults.js";
import { FORMATS } from "../lib/lazy-router/formats.js";
import { HealthRegistry } from "../lib/lazy-router/health.js";
import { RoutePolicy } from "../lib/lazy-router/policy.js";
import { LazyRouter, qoderCapacityProbeOptions, SERVED_BY_HEADERS } from "../lib/lazy-router/router.js";
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
  "ctyun/text": {
    ref: "ctyun/text",
    provider: "ctyun",
    contextWindow: 1_000_000,
    input: ["text"],
    reasoning: false,
    efforts: [],
    canDisable: false,
    baseUrl: "https://ctyun.example/v1",
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
function harness({ upstream, faults = {}, bypass, policy = POLICY }) {
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
            // Like the gateway, read the provider's answer to the end before closing.
            await response.text();
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
      await response.text();
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
    policy: new RoutePolicy(policy),
    units: new UnitDirectory({ tiers: fixedTiers(ACCOUNTS) }),
    schedule: { at: () => ({ period: "peak", localTime: "test", dayKind: "workday" }) },
    catalog: { ready: true, find: (ref) => CATALOG[ref] },
    health,
    dispatcher,
    faults: new FaultInjector(faults),
    emit,
    settings: {
      routing: { temperature: 0 },
      probePrompt: "Reply OK",
      probeMaxTokens: 32,
      probeTimeoutMs: 2_000,
      headerTimeoutMs: 2_000,
      providerHeaderTimeoutMs: {},
      upstreamHosts: {},
    },
  });

  const send = (body, { signal } = {}) => {
    const full = { model: "lazy/default", messages: [{ role: "user", content: "hi" }], ...body };
    const request = new Request("http://gateway.test/v1/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer client" },
      body: JSON.stringify(full),
      signal,
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

  test("a failed background probe stays quiet while remaining scheduled", async () => {
    const h = harness({ upstream: (call) => (call.unit === "p:gold#1" ? quota() : ok()) });
    await h.send({});
    expect(h.health.isAlive("p/1 p/big")).toBe(false);
    const beforeEvents = h.names().length;
    const beforeTimers = h.timers.length;
    await h.timers[0]();
    expect(h.names().slice(beforeEvents)).toEqual([]);
    expect(h.health.isAlive("p/1 p/big")).toBe(false);
    expect(h.timers.length).toBe(beforeTimers + 1);
    expect(h.health.entry("p/1 p/big")?.probes).toBe(1);
  });

  test("a background probe restores the unit and traffic returns to it", async () => {
    let healthy = false;
    const h = harness({ upstream: (call) => (call.unit !== "p:gold#1" || healthy ? ok() : quota()) });
    await h.send({});
    expect(h.health.isAlive("p/1 p/big")).toBe(false);
    healthy = true;
    await h.timers[0]();
    expect(h.names()).toContain("cooldown-exit");
    const response = await h.send({ messages: [{ role: "user", content: "a new conversation" }] });
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

  test("CTYun Coding Plan quota text fails over to the next provider instead of reaching the client", async () => {
    const policy = {
      ...POLICY,
      routes: {
        default: { input: ["text"], periods: { peak: [{ model: "ctyun/text" }, { model: "q/text" }] } },
      },
    };
    const h = harness({
      policy,
      upstream: ok,
      bypass: (body) =>
        body.model === "ctyun/text"
          ? { choices: [{ delta: { content: "您的Coding Plan套餐的额度已用完！\n请等待周期时间刷新" } }] }
          : { choices: [{ delta: { content: "OK" } }] },
    });
    const response = await h.send({ stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.model)).toBe("q/text");
    const text = await response.text();
    expect(text).toContain("OK");
    expect(text).not.toContain("周期时间刷新");
    expect(h.events.find((event) => event.event === "attempt-failed")).toMatchObject({
      model: "ctyun/text",
      failure: "quota",
    });
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

  test("a client that leaves during an attempt ends the request without blaming the unit", async () => {
    const client = new AbortController();
    const h = harness({
      upstream: () => {
        client.abort();
        return quota();
      },
    });
    const response = await h.send({}, { signal: client.signal });
    expect(response.status).toBe(499);
    expect(h.names()).toEqual(["route", "client-gone"]);
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1"]);
    expect(h.health.isAlive("p/1 p/big")).toBe(true);
  });

  test("a gateway 499 is the client's doing: no probe, no cooldown, no next unit", async () => {
    const h = harness({ upstream: () => new Response('{"error":"client closed request"}', { status: 499 }) });
    const response = await h.send({});
    expect(response.status).toBe(499);
    expect(h.names()).not.toContain("cooldown-enter");
    expect(h.names()).not.toContain("probe");
    expect(h.calls).toHaveLength(1);
  });

  test("a client gone before the next candidate stops the failover", async () => {
    const client = new AbortController();
    const h = harness({
      upstream: (call) => {
        if (call.body.max_completion_tokens === 32) client.abort(); // during the probe
        return quota();
      },
    });
    const response = await h.send({}, { signal: client.signal });
    expect(response.status).toBe(499);
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#1"]);
    expect(h.names().at(-1)).toBe("client-gone");
  });

  test("a connection closed before any answer is retried at once on a fresh one, without a probe", async () => {
    const h = harness({
      upstream: (call, nth) => {
        if (call.unit === "p:gold#1" && nth === 1) throw new Error("The connection was closed.");
        return ok();
      },
    });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
    expect(h.names()).toEqual(["route", "attempt-failed", "retry-fresh-connection", "served"]);
    expect(h.events[1]).toMatchObject({ failure: "stale-connection", source: "network" });
  });

  test("a fresh connection that fails too benches the unit and moves on", async () => {
    const h = harness({
      upstream: (call) => {
        if (call.unit === "p:gold#1") throw new Error("ECONNRESET: The socket connection was closed unexpectedly.");
        return ok();
      },
    });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.names()).toEqual([
      "route",
      "attempt-failed",
      "retry-fresh-connection",
      "attempt-failed",
      "cooldown-enter",
      "route",
      "served",
    ]);
  });

  test("Qoder hard capacity rechecks after one minute and backs off to the normal interval", async () => {
    const candidate = { unit: { provider: "qoder-cn" } };
    const options = qoderCapacityProbeOptions(
      candidate,
      { message: "[Qoder CN 无可用容量] serviceAvailable:false（子码 RESOURCE_LIMIT，优先级通道 p3）" },
      1_800_000,
    );
    expect(options).toEqual({
      probeIntervalMs: 60_000,
      probeBackoff: 2,
      maxProbeIntervalMs: 1_800_000,
    });

    const timers = [];
    const health = new HealthRegistry({
      probeIntervalMs: 1_800_000,
      prober: async () => false,
      setTimer: (fn, ms) => {
        const timer = { fn, ms };
        timers.push(timer);
        return timer;
      },
      clearTimer: () => {},
    });
    health.markDead("q", "quota", candidate, options);
    expect(timers.map((timer) => timer.ms)).toEqual([60_000]);
    for (const expected of [120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]) {
      await timers.at(-1).fn();
      expect(timers.at(-1).ms).toBe(expected);
    }
    expect(health.entry("q")?.probes).toBe(6);
  });

  test("Qoder daily quota does not use the transient hard-capacity schedule", () => {
    const candidate = { unit: { provider: "qoder-cn" } };
    expect(
      qoderCapacityProbeOptions(
        candidate,
        { message: "[Qoder CN 额度限制] Billing daily count exceeded, 错误码 110" },
        1_800_000,
      ),
    ).toBeUndefined();
    expect(
      qoderCapacityProbeOptions(
        { unit: { provider: "google-antigravity" } },
        { message: "serviceAvailable:false RESOURCE_LIMIT" },
        1_800_000,
      ),
    ).toBeUndefined();
  });

  test("an exhausted quota benches the unit without a probe and fails over within the request", async () => {
    const exhausted = () =>
      new Response(
        JSON.stringify({
          error: { message: "[Qoder CN 额度限制] 今日调用次数已达上限 (Billing daily count exceeded, 错误码 110)" },
        }),
        { status: 502 },
      );
    const h = harness({ upstream: (call) => (call.unit === "p:gold#1" ? exhausted() : ok()) });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.names()).toEqual(["route", "attempt-failed", "cooldown-enter", "route", "served"]);
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#2"]);
    expect(h.events.find((e) => e.event === "cooldown-enter").reason).toMatch(/^quota: /);
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

  test("Cloud Code empty-contents 400 is a request rejection, not an unhealthy account", async () => {
    const invalidContents = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "* GenerateContentRequest.contents: contents is not specified\n",
            status: "INVALID_ARGUMENT",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const h = harness({ upstream: invalidContents });
    const response = await h.send({});
    expect(response.status).toBe(400);
    expect(h.calls).toHaveLength(1);
    expect(h.names()).toEqual(["route", "rejected"]);
    expect(h.names()).not.toContain("probe");
    expect(h.names()).not.toContain("cooldown-enter");
    expect(h.health.isAlive("p/1 p/big")).toBe(true);
  });

  test("a provider 400 is request-scoped: skip duplicate accounts, do not probe/cool, and try another model", async () => {
    const invalid = () => new Response(
      JSON.stringify({ error: { message: "Invalid input. Please review your request before trying again.", type: "invalid_request_error" } }),
      { status: 400 },
    );
    const h = harness({ upstream: (call) => (call.body.model === "p/big" ? invalid() : ok()) });
    const response = await h.send({});
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("q");
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "q"]);
    expect(h.events.filter((e) => e.event === "attempt-failed").map((e) => e.failure)).toEqual(["request"]);
    expect(h.names()).not.toContain("probe");
    expect(h.names()).not.toContain("cooldown-enter");
    expect(h.health.isAlive("p/1 p/big")).toBe(true);
  });

  test("a context-limit 400 skips models whose advertised window cannot clear the discovered requirement", async () => {
    const tooLong = () => new Response(
      JSON.stringify({ error: { message: "The input token count exceeds the maximum number of tokens allowed (1048576)." } }),
      { status: 400 },
    );
    const h = harness({ upstream: (call) => (call.body.model === "p/big" ? tooLong() : ok()) });
    const response = await h.send({});
    expect(response.status).toBe(400);
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1"]);
    expect(h.names()).toEqual(["route", "attempt-failed", "skip", "exhausted"]);
    expect(h.names()).not.toContain("probe");
    expect(h.names()).not.toContain("cooldown-enter");
    const body = await response.json();
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("1048576");
  });

  test("a stream 502 wrapping upstream invalid_parameter_error is restored to request semantics", async () => {
    const h = harness({
      upstream: ok,
      bypass: (body) =>
        body.model === "p/big"
          ? { error: { message: 'Upstream status 400: {"code":"provider_error","details":"invalid_parameter_error"}' } }
          : { choices: [{ delta: { content: "OK" } }] },
    });
    const response = await h.send({ stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("q");
    expect(h.events.filter((e) => e.event === "route").map((e) => e.unit)).toEqual(["p:gold#1", "q"]);
    expect(h.events.filter((e) => e.event === "attempt-failed").map((e) => [e.failure, e.status, e.source])).toEqual([
      ["request", 502, "stream"],
    ]);
    expect(h.names()).not.toContain("probe");
    expect(h.names()).not.toContain("cooldown-enter");
  });

  test("injected faults fail the attempt without reaching the provider", async () => {
    const h = harness({ upstream: ok, faults: { "p:gold#1": { requests: 1, probes: 1 } } });
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#2");
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#2"]);
    expect(h.events.find((e) => e.event === "attempt-failed").source).toBe("injected");
  });

  test("expired route entries disappear from routing and status at the same instant", async () => {
    const policy = {
      ...POLICY,
      routes: {
        default: {
          input: ["text"],
          periods: {
            peak: [
              { model: "q/text", activeUntil: "2026-11-01T00:00:00+08:00" },
              { model: "p/big", tier: "gold" },
            ],
          },
        },
      },
    };
    const h = harness({ upstream: ok, policy });
    h.router.now = () => new Date("2026-11-01T00:00:00+08:00");
    const response = await h.send({});
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("p:gold#1");
    const view = await h.router.status().json();
    expect(view.routes.default.some((row) => row.model === "q/text")).toBe(false);
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
    expect(view.alternate).toEqual({ period: "offPeak", routes: { default: [], vision: [] } });
    expect(view.nextSwitch).toBeNull();
    // q cannot take images, so it is not part of lazy/vision at all.
    expect(view.routes.vision.map((c) => [c.unit, c.eligible])).toEqual([
      ["p:gold#1", true],
      ["p:gold#2", true],
    ]);
    expect(view.routes.default.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#2", "q"]);
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

/** POLICY with provider p limited to one request in flight per account. */
const LIMITED = { ...POLICY, maxInFlight: { p: 1 } };

/** A conversation long enough for its prefix to be recorded. */
const conversation = (topic, turns = 1) => {
  const messages = [{ role: "system", content: `${topic} `.repeat(800) }];
  for (let i = 0; i < turns; i += 1) {
    if (i > 0) messages.push({ role: "assistant", content: `answer ${i}` });
    messages.push({ role: "user", content: `question ${i}` });
  }
  return { messages };
};

/** An upstream answer whose body stays open until `end()`. */
function heldAnswer() {
  let controller;
  const response = new Response(new ReadableStream({ start: (c) => (controller = c) }), { status: 200 });
  return { response, end: () => controller.close() };
}

describe("prefix affinity and capacity", () => {
  const unitsOf = (h) => h.router.units.select("p");
  const inFlight = (h) => unitsOf(h).map((unit) => h.router.capacity.inFlight(unit));
  const servedBy = (response) => response.headers.get(SERVED_BY_HEADERS.unit);

  test("a conversation stays on the unit that served it, even after a better unit recovers", async () => {
    let healthy = false;
    const h = harness({ upstream: (call) => (call.unit !== "p:gold#1" || healthy ? ok() : quota()) });
    expect(servedBy(await h.send(conversation("alpha", 1)))).toBe("p:gold#2");
    healthy = true;
    await h.timers[0]();
    expect(servedBy(await h.send(conversation("alpha", 2)))).toBe("p:gold#2");
    expect(h.events.filter((e) => e.event === "route").at(-1)).toMatchObject({ unit: "p:gold#2", affinity: true });
    expect(h.events.filter((e) => e.event === "route").at(-1).cachedShare).toBeGreaterThan(0.4);
    // A new conversation takes the table order again.
    expect(servedBy(await h.send(conversation("beta", 1)))).toBe("p:gold#1");
    expect(h.router.affinity.view()).toMatchObject({ entries: 3, lookups: 3, hits: 1 });
  });

  test("a unit at its in-flight limit is skipped until its provider call ends", async () => {
    const held = heldAnswer();
    const h = harness({ policy: LIMITED, upstream: (_call, nth) => (nth === 1 ? held.response : ok()) });
    const first = await h.send({ ...conversation("one"), stream: true });
    expect(servedBy(first)).toBe("p:gold#1");
    expect(inFlight(h)).toEqual([1, 0]);

    const second = await h.send(conversation("two"));
    expect(servedBy(second)).toBe("p:gold#2");
    expect(h.events.find((e) => e.event === "held-back")).toMatchObject({
      unit: "p:gold#1",
      reason: "capacity",
      inFlight: 1,
      maxInFlight: 1,
    });
    expect(inFlight(h)).toEqual([1, 0]);

    held.end();
    expect(await first.text()).toContain('"OK"');
    expect(inFlight(h)).toEqual([0, 0]);
    expect(servedBy(await h.send(conversation("three")))).toBe("p:gold#1");
    expect(inFlight(h)).toEqual([0, 0]);
  });

  test("a client that goes away frees the slot at once", async () => {
    const held = heldAnswer();
    const h = harness({ policy: LIMITED, upstream: () => held.response });
    const client = new AbortController();
    const response = await h.send({ ...conversation("one"), stream: true }, { signal: client.signal });
    expect(servedBy(response)).toBe("p:gold#1");
    expect(inFlight(h)).toEqual([1, 0]);
    client.abort();
    expect(inFlight(h)).toEqual([0, 0]);
  });

  test("failover releases the failed unit's calls, probe included", async () => {
    const h = harness({ policy: LIMITED, upstream: (call) => (call.unit === "p:gold#1" ? quota() : ok()) });
    const response = await h.send(conversation("one"));
    expect(servedBy(response)).toBe("p:gold#2");
    await response.text();
    expect(h.calls.map((c) => c.unit)).toEqual(["p:gold#1", "p:gold#1", "p:gold#2"]);
    expect(inFlight(h)).toEqual([0, 0]);
  });

  test("a rejected request releases its reservation", async () => {
    const h = harness({ policy: LIMITED, upstream: ok });
    expect((await h.send({ messages: "not-a-list" })).status).toBe(400);
    expect(inFlight(h)).toEqual([0, 0]);
  });

  test("admission keeps a limited unit for the requests its cache helps most", async () => {
    const h = harness({ policy: LIMITED, upstream: ok });
    expect(servedBy(await h.send(conversation("alpha", 1)))).toBe("p:gold#1");
    expect(servedBy(await h.send(conversation("alpha", 2)))).toBe("p:gold#1");
    // gold#1 saw x = 0 and x ≈ 0.5 for one slot: a new conversation (x = 0) is below its best share.
    expect(servedBy(await h.send(conversation("beta", 1)))).toBe("p:gold#2");
    expect(h.events.find((e) => e.event === "held-back")).toMatchObject({
      unit: "p:gold#1",
      reason: "admission",
      cachedShare: 0,
      window: 3,
    });
    expect(inFlight(h)).toEqual([0, 0]);
  });

  test("the status view shows load for limited units only, and the affinity counters", async () => {
    const h = harness({ policy: LIMITED, upstream: ok });
    await h.send(conversation("one"));
    const view = await h.router.status().json();
    expect(view.units).toEqual([
      { unit: "p:gold#1", provider: "p", tier: "gold", pinned: true, inFlight: 0, maxInFlight: 1, recentRequests: 1 },
      { unit: "p:gold#2", provider: "p", tier: "gold", pinned: true, inFlight: 0, maxInFlight: 1, recentRequests: 0 },
    ]);
    const q = view.routes.default.find((row) => row.unit === "q");
    expect("inFlight" in q).toBe(false);
    expect(view.routes.default[0]).toMatchObject({ unit: "p:gold#1", inFlight: 0, maxInFlight: 1 });
    expect(view.affinity).toMatchObject({ entries: 1, lookups: 1, hits: 0, hitRate: 0 });
  });

  test("unlimited units are never held back", async () => {
    const held = heldAnswer();
    const h = harness({ upstream: (_call, nth) => (nth === 1 ? held.response : ok()) });
    await h.send({ ...conversation("one"), stream: true });
    expect(servedBy(await h.send(conversation("two")))).toBe("p:gold#1");
    expect(h.names()).not.toContain("held-back");
    held.end();
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
