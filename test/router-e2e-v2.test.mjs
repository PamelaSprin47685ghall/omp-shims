// End-to-end tests for the composed lazy router.
//
// These tests build the real LazyRouter, the real ComposedPolicy over
// presets/routes.json, the real StateStore, HealthRegistry, admission,
// affinity, capacity and GatewayDispatcher. Only the provider wire is fake: a
// downstream gateway handler maps one attempt to a local scripted upstream.
//
// The compiled OMP binary does not expose ModelRegistry to the preload hook.
// The catalog here is therefore filled the way the gateway fills it: from its
// own /v1/models snapshot. `hostSnapshot` returns nothing, so a test that only
// passes through the host bridge cannot make these routes routable.

import { afterEach, describe, expect, test } from "bun:test";
import { PROBE_STATE } from "../lib/contracts.mjs";
import { readJson } from "../lib/inbound.mjs";
import { AdmissionControl } from "../lib/router/admission.mjs";
import { PrefixAffinity } from "../lib/router/affinity.mjs";
import { createAttemptLayer } from "../lib/router/attempt.mjs";
import { InFlightTracker } from "../lib/router/capacity.mjs";
import { ModelCatalog } from "../lib/router/catalog.mjs";
import { CyclicSpeed } from "../lib/router/cyclic-speed.mjs";
import { GatewayDispatcher } from "../lib/router/dispatcher.mjs";
import { FaultInjector } from "../lib/router/faults.mjs";
import { formatForPath, providerOf } from "../lib/router/formats.mjs";
import { HealthRegistry } from "../lib/router/health.mjs";
import { ModelPerf } from "../lib/router/perf.mjs";
import { ComposedPolicy, loadPlanData } from "../lib/router/plan.mjs";
import { LazyRouter, SERVED_BY_HEADERS } from "../lib/router/router.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { MAX_BACKOFF_MS, REFRESH_MS, startRefresh, TIMEOUT_MS } from "../lib/router/status-page/app/lib/refresh.js";

const OFF_PEAK_AT = Date.parse("2026-11-09T05:00:00Z"); // Beijing Monday 13:00
const PROBE_PROMPT = "Reply OK";
const PROBE_INTERVAL_MS = 1_800_000;
const BUSY_HINT_MS = 60_000;
const LEAK = "sk-live-SECRET-9f3a user@example.com token=tok_live_abc123";

const CODEX_MODEL = "openai-codex/gpt-6.1-terra";
const API_MODEL = "openai-api/gpt-6.1-terra";
const CHARM_MODEL = "charm-hyper/deepseek-v4.1-flash-1017";
const MISTRAL_MODEL = "mistral/deepseek-v4-1-flash-1017";

const UPSTREAM_HOSTS = Object.freeze({
  "openai-codex": "https://codex.example.test/v1",
  "openai-api": "https://api.example.test/v1",
  mistral: "https://mistral.example.test/v1",
  "charm-hyper": "https://charm.example.test/v1",
  kiro: "https://kiro.example.test/v1",
  "google-antigravity": "https://antigravity.example.test/v1",
});

/** A `/v1/models` row the compiled gateway exposes; it has no ModelRegistry traits. */
function modelRow(id) {
  return {
    id,
    object: "model",
    owned_by: id.slice(0, id.indexOf("/")),
    context_length: 1_000_000,
    max_output_tokens: 128_000,
    input_modalities: ["text"],
  };
}

/** The bundled plan with an explicit config-level override. */
function planWith(overrides = {}) {
  return { ...loadPlanData(), ...overrides };
}

/**
 * The router expands a rating route once before it reads the settings
 * temperature. That first expansion uses the default exploration draw, so a
 * tie between equally-rated groups would be random. A fixed draw makes the
 * default order stable and lets a test attribute a changed order to affinity.
 */
class StableDrawPolicy extends ComposedPolicy {
  candidatesFor(routeId, options = {}) {
    return super.candidatesFor(routeId, { random: () => 0.25, ...options });
  }
}

/** The account view LazyRouter consumes, with no credential storage. */
function fakeDirectory(accounts) {
  const rows = accounts.map((account) => ({
    provider: account.provider,
    id: account.id,
    tier: account.tier ?? null,
  }));
  return {
    version: 1,
    ready: Promise.resolve(),
    all: () => rows,
    tierOf: (provider, account) => rows.find((row) => row.provider === provider && row.id === account)?.tier,
  };
}

function okResponse(call) {
  return Response.json({
    id: `chatcmpl-test-${call.seq}`,
    object: "chat.completion",
    model: call.model,
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  });
}

function errorResponse(status, message) {
  return Response.json({ error: { message } }, { status });
}

/** The body of one outbound call, whichever shape the attempt layer produced. */
async function outgoingText(input, init) {
  if (typeof init?.body === "string") return init.body;
  if (init?.body !== undefined && init?.body !== null) return await new Response(init.body).text();
  if (input instanceof Request) return await input.clone().text();
  return "";
}

/**
 * A scripted provider wire. Each account has its own bearer secret, so the
 * fake downstream sees exactly which unit the attempt layer pinned.
 */
function createUpstream({ accounts, hosts = UPSTREAM_HOSTS }) {
  const secrets = new Map(
    accounts.map((account) => [
      `${account.provider}/${account.id}`,
      `sk-test-${account.provider}-${account.id}-SECRET`,
    ]),
  );
  const unitsBySecret = new Map([...secrets].map(([unitKey, secret]) => [secret, unitKey]));
  const providersByHost = new Map(Object.entries(hosts).map(([provider, url]) => [new URL(url).hostname, provider]));
  const behaviors = new Map();
  const calls = [];
  let tracker;
  let highestHeld = 0;

  async function fetch(input, init) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const provider = providersByHost.get(url.hostname);
    if (!provider) throw new Error(`test upstream has no provider for ${url.hostname}`);

    const text = await outgoingText(input, init);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const authorization = headers.get("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    const unitKey = unitsBySecret.get(secret);
    if (!unitKey) throw new Error(`test upstream received an unknown credential for ${provider}`);

    const probe = body?.messages?.[0]?.content === PROBE_PROMPT;
    const held = tracker?.inFlight(unitKey) ?? 0;
    highestHeld = Math.max(highestHeld, held);
    const call = {
      seq: calls.length + 1,
      provider,
      unitKey,
      model: body?.model,
      probe,
      body,
      held,
      url: url.href,
    };
    calls.push(call);
    const behavior = behaviors.get(unitKey);
    return behavior ? behavior(call) : okResponse(call);
  }

  return {
    credentials: {
      async resolve(provider, { id } = {}) {
        const secret = secrets.get(`${provider}/${id}`);
        return secret ? { provider, secret } : undefined;
      },
    },
    fetch,
    baseFor: (provider) => hosts[provider],
    setTracker: (value) => {
      tracker = value;
    },
    on(unitKey, behavior) {
      behaviors.set(unitKey, behavior);
      return this;
    },
    calls,
    callsFor: (unitKey) => calls.filter((call) => call.unitKey === unitKey),
    regularCallsFor: (unitKey) => calls.filter((call) => call.unitKey === unitKey && !call.probe),
    probeCallsFor: (unitKey) => calls.filter((call) => call.unitKey === unitKey && call.probe),
    highestHeld: () => highestHeld,
    secretFor: (unitKey) => secrets.get(unitKey),
  };
}

const live = [];

afterEach(() => {
  for (const harness of live.splice(0).reverse()) {
    try {
      harness.dispose();
    } catch {
      // A half-built harness is still disposable.
    }
  }
});

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function jsonBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Build one complete router over a scripted upstream. */
function makeHarness({
  plan = loadPlanData(),
  policyClass = ComposedPolicy,
  accounts,
  rows,
  upstream,
  gatewayFault,
  settings = {},
}) {
  const clock = { now: OFF_PEAK_AT };
  const events = [];
  const healthEvents = [];
  const store = StateStore.memory({ now: () => clock.now });
  const health = new HealthRegistry({
    store,
    probeIntervalMs: PROBE_INTERVAL_MS,
    now: () => clock.now,
    onEvent: (event, detail = {}) => healthEvents.push({ event, ...detail }),
  });
  const policy = new policyClass(plan);
  const catalog = new ModelCatalog({
    overrides: plan.modelTraits ?? {},
    // A missing sibling models.db keeps the compiled gateway's official cache
    // out of these tests; only the /v1/models snapshot is authoritative here.
    agentDbPath: "/nonexistent/omp-shims-router-e2e/agent.db",
    now: () => clock.now,
    hostSnapshot: () => [],
    extensionProviders: () => [],
    customProviders: () => [],
    isRouteModel: (id) => policy.routeNames.includes(id),
  });
  catalog.ingestGatewayModels(rows);

  const admission = new AdmissionControl({ store, now: () => clock.now });
  const affinity = new PrefixAffinity({ store, now: () => clock.now });
  const perf = new ModelPerf({ store, now: () => clock.now });
  const speed = new CyclicSpeed({ store, now: () => clock.now });

  const holder = {};
  const capacity = new InFlightTracker({
    store,
    limitOf: (key) => holder.router?.capacityLimits.get(key) ?? 0,
  });
  upstream.setTracker(capacity);

  const credentials = upstream.credentials;
  const attemptLayer = createAttemptLayer({ credentials });
  const dispatcher = new GatewayDispatcher({
    tokenPath: "/nonexistent/omp-gateway.token",
    headerTimeoutMs: 2_000,
    readToken: () => "gateway-test-token",
  });
  dispatcher.bind(async (request) => {
    const payload = await readJson(request);
    const probe = payload?.messages?.[0]?.content === PROBE_PROMPT;
    const injected = gatewayFault?.({ payload, probe, request });
    if (injected) return injected;
    const provider = providerOf(payload?.model);
    const base = upstream.baseFor(provider);
    if (!base) throw new Error(`test gateway has no upstream for ${provider}`);
    const outbound = new Request(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    return attemptLayer(outbound, undefined, (input, init) => upstream.fetch(input, init));
  });

  const router = new LazyRouter({
    policy,
    catalog,
    health,
    dispatcher,
    faults: new FaultInjector({}),
    affinity,
    capacity,
    admission,
    perf,
    speed,
    store,
    now: () => new Date(clock.now),
    credentials,
    accountDirectory: fakeDirectory(accounts),
    planData: plan,
    emit: (event, detail = {}) => events.push({ event, ...detail }),
    settings: {
      routing: { temperature: 0 },
      probePrompt: PROBE_PROMPT,
      probeMaxTokens: 8,
      probeTimeoutMs: 2_000,
      headerTimeoutMs: 2_000,
      providerHeaderTimeoutMs: {},
      upstreamHosts: { ...UPSTREAM_HOSTS },
      probeIntervalMs: PROBE_INTERVAL_MS,
      ...settings,
      ...(settings.routing ? { routing: { temperature: 0, ...settings.routing } } : {}),
    },
  });
  holder.router = router;

  async function serve({ route = "lazy/default", body = {} } = {}) {
    const payload = {
      model: route,
      stream: false,
      messages: [{ role: "user", content: "hello" }],
      ...body,
    };
    const format = formatForPath("/v1/chat/completions");
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { response: await router.serve(format, payload, request), payload };
  }

  const harness = {
    router,
    store,
    health,
    capacity,
    admission,
    affinity,
    catalog,
    dispatcher,
    events,
    healthEvents,
    clock,
    upstream,
    serve,
    advance(ms) {
      clock.now += ms;
    },
    stateOf(unitKey, model) {
      return health.stateOf(unitKey, model);
    },
    healthRow(unitKey, model) {
      return store.readHealth(health.keyOf(unitKey, model));
    },
    dispose() {
      router.dispose();
      speed.stop?.();
      store.close();
    },
  };
  live.push(harness);
  return harness;
}

/* ------------------------------------------------------------------ */
/* 1. Quota failover and cooldown skipping on lazy/default             */
/* ------------------------------------------------------------------ */

describe("lazy/default quota failover (Plus -> Pro -> API Flex)", () => {
  const accounts = [
    { provider: "openai-codex", id: 11, tier: "plus" },
    { provider: "openai-codex", id: 12, tier: "pro" },
    { provider: "openai-api", id: 21, tier: null },
  ];
  const rows = [modelRow(CODEX_MODEL), modelRow(API_MODEL)];

  test("429 quota benches the first unit and fails over inside one request", async () => {
    const upstream = createUpstream({ accounts });
    upstream.on("openai-codex/11", () => errorResponse(429, `quota exhausted for ${LEAK}`));
    const harness = makeHarness({ accounts, rows, upstream });

    const { response } = await harness.serve({
      route: "lazy/default",
      body: { messages: [{ role: "user", content: "fail over now" }], max_tokens: 64 },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:pro#1");
    expect(response.headers.get(SERVED_BY_HEADERS.model)).toBe("lazy/default");
    expect(body?.model).toBe("lazy/default");

    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-api/21")).toHaveLength(0);
    // Quota benches without a probe.
    expect(upstream.probeCallsFor("openai-codex/11")).toHaveLength(0);

    expect(harness.stateOf("openai-codex/11", CODEX_MODEL)).toBe(PROBE_STATE.DEAD);
    expect(harness.health.isCooling("openai-codex/11", CODEX_MODEL)).toBe(true);
    const row = harness.healthRow("openai-codex/11", CODEX_MODEL);
    expect(row.reason).toContain("quota");
    // A 429 keeps the quota label but uses the short rate-limit cooldown.
    expect(row.until - harness.clock.now).toBe(30_000);

    expect(harness.events.some((event) => event.event === "attempt-failed" && event.failure === "quota")).toBe(true);
    expect(harness.events.some((event) => event.event === "served" && event.unit === "openai-codex:pro#1")).toBe(true);
  });

  test("the next request skips the cooled unit with no upstream round-trip", async () => {
    const upstream = createUpstream({ accounts });
    upstream.on("openai-codex/11", () => errorResponse(429, "quota exhausted: you exceeded your current quota"));
    const harness = makeHarness({ accounts, rows, upstream });
    const request = { messages: [{ role: "user", content: "same conversation" }] };

    await jsonBody((await harness.serve({ route: "lazy/default", body: request })).response);
    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(1);

    const second = await harness.serve({ route: "lazy/default", body: request });
    const body = await jsonBody(second.response);

    expect(second.response.status).toBe(200);
    expect(second.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:pro#1");
    expect(body?.model).toBe("lazy/default");
    // The cooled unit was not contacted again, not even by a probe.
    expect(upstream.callsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(2);
    expect(upstream.regularCallsFor("openai-api/21")).toHaveLength(0);
    expect(harness.stateOf("openai-codex/11", CODEX_MODEL)).toBe(PROBE_STATE.DEAD);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Three-state probe and capacity                                   */
/* ------------------------------------------------------------------ */

describe("three-state recovery probe", () => {
  const accounts = [
    { provider: "openai-codex", id: 11, tier: "plus" },
    { provider: "openai-codex", id: 12, tier: "pro" },
    { provider: "openai-api", id: 21, tier: null },
  ];
  const rows = [modelRow(CODEX_MODEL), modelRow(API_MODEL)];

  test("a transient 502 probes Reply OK; an ALIVE probe retries the same unit once", async () => {
    const upstream = createUpstream({ accounts });
    upstream.on("openai-codex/11", (call) => okResponse(call));
    // A 502 that the gateway produces without reaching a provider classifies
    // as FAILURE.UNIT, which is the one failure that earns an inline probe.
    let injected = false;
    const gatewayFault = ({ probe }) => {
      if (probe || injected) return undefined;
      injected = true;
      return errorResponse(502, "gateway-side transient failure");
    };
    const harness = makeHarness({
      plan: planWith({ maxInFlight: { "openai-codex/11": 1 } }),
      accounts,
      rows,
      upstream,
      gatewayFault,
    });

    const { response } = await harness.serve({
      route: "lazy/default",
      body: { messages: [{ role: "user", content: "retry the same unit" }] },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:plus#1");
    expect(body?.model).toBe("lazy/default");
    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.probeCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(0);
    expect(upstream.regularCallsFor("openai-api/21")).toHaveLength(0);

    const probeCall = upstream.probeCallsFor("openai-codex/11")[0];
    expect(probeCall.body.messages).toEqual([{ role: "user", content: PROBE_PROMPT }]);
    expect(probeCall.held).toBe(1);
    expect(upstream.highestHeld()).toBe(1);
    expect(harness.capacity.inFlight("openai-codex/11")).toBe(0);

    expect(harness.stateOf("openai-codex/11", CODEX_MODEL)).toBe(PROBE_STATE.ALIVE);
    expect(harness.events.some((event) => event.event === "probe" && event.state === PROBE_STATE.ALIVE)).toBe(true);
    expect(harness.events.some((event) => event.event === "retry-same-unit")).toBe(true);
    expect(harness.events.some((event) => event.event === "attempt-failed" && event.failure === "unit")).toBe(true);
  });

  test("a DEAD probe benches the unit and moves to the next candidate", async () => {
    const upstream = createUpstream({ accounts });
    upstream.on("openai-codex/11", () => errorResponse(403, `probe rejected ${LEAK}`));
    let injected = false;
    const gatewayFault = ({ probe }) => {
      if (probe || injected) return undefined;
      injected = true;
      return errorResponse(502, "gateway-side transient failure");
    };
    const harness = makeHarness({ accounts, rows, upstream, gatewayFault });

    const { response } = await harness.serve({
      route: "lazy/default",
      body: { messages: [{ role: "user", content: "probe says dead" }] },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:pro#1");
    expect(body?.model).toBe("lazy/default");
    // The first 502 never reached the provider.
    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(0);
    expect(upstream.probeCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(1);

    expect(harness.stateOf("openai-codex/11", CODEX_MODEL)).toBe(PROBE_STATE.DEAD);
    const row = harness.healthRow("openai-codex/11", CODEX_MODEL);
    expect(row.until - harness.clock.now).toBe(PROBE_INTERVAL_MS);
    expect(harness.events.some((event) => event.event === "probe" && event.state === PROBE_STATE.DEAD)).toBe(true);
    expect(harness.events.some((event) => event.event === "retry-same-unit")).toBe(false);
  });

  test("a BUSY probe does not bench the healthy unit for the long interval", async () => {
    const upstream = createUpstream({ accounts });
    upstream.on("openai-codex/11", (call) =>
      call.probe ? errorResponse(429, "provider capacity is full") : okResponse(call),
    );
    let injected = false;
    const gatewayFault = ({ probe }) => {
      if (probe || injected) return undefined;
      injected = true;
      return errorResponse(502, "gateway-side transient failure");
    };
    const harness = makeHarness({ accounts, rows, upstream, gatewayFault });

    const first = await harness.serve({
      route: "lazy/default",
      body: { messages: [{ role: "user", content: "probe says busy" }] },
    });
    await jsonBody(first.response);

    expect(first.response.status).toBe(200);
    expect(first.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:pro#1");
    expect(upstream.probeCallsFor("openai-codex/11")).toHaveLength(1);
    expect(harness.stateOf("openai-codex/11", CODEX_MODEL)).toBe(PROBE_STATE.BUSY);
    expect(harness.health.isCooling("openai-codex/11", CODEX_MODEL)).toBe(false);

    const row = harness.healthRow("openai-codex/11", CODEX_MODEL);
    expect(row.state).toBe(PROBE_STATE.BUSY);
    expect(row.until - harness.clock.now).toBe(BUSY_HINT_MS);
    // The long cooldown is 30 minutes; BUSY must stay far below it.
    expect(row.until - harness.clock.now).toBeLessThan(PROBE_INTERVAL_MS);

    // After the short busy hint expires, the unbenched unit is tried first.
    harness.advance(BUSY_HINT_MS + 1_000);
    const second = await harness.serve({
      route: "lazy/default",
      body: { messages: [{ role: "user", content: "probe says busy" }] },
    });
    const body = await jsonBody(second.response);

    expect(second.response.status).toBe(200);
    expect(second.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:plus#1");
    expect(body?.model).toBe("lazy/default");
    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.probeCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(1);
  });

  test("a second concurrent request never exceeds the global maxInFlight cap", async () => {
    const upstream = createUpstream({ accounts });
    let releasePlus;
    const plusGate = new Promise((resolve) => {
      releasePlus = resolve;
    });
    let plusCalls = 0;
    upstream.on("openai-codex/11", async (call) => {
      if (call.probe) return okResponse(call);
      plusCalls += 1;
      if (plusCalls === 1) {
        await plusGate;
      }
      return okResponse(call);
    });
    const harness = makeHarness({
      plan: planWith({ maxInFlight: { "openai-codex/11": 1 } }),
      accounts,
      rows,
      upstream,
    });
    const request = { messages: [{ role: "user", content: "hold the only slot" }] };

    const firstPromise = harness.serve({ route: "lazy/default", body: request });
    await waitFor(() => upstream.regularCallsFor("openai-codex/11").length === 1, "the first upstream call");

    const second = await harness.serve({ route: "lazy/default", body: request });
    const secondBody = await jsonBody(second.response);

    expect(second.response.status).toBe(200);
    expect(second.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:pro#1");
    expect(secondBody?.model).toBe("lazy/default");
    // The capped unit had no room, so the second request skipped it entirely.
    expect(upstream.regularCallsFor("openai-codex/11")).toHaveLength(1);
    expect(upstream.regularCallsFor("openai-codex/12")).toHaveLength(1);
    expect(harness.capacity.inFlight("openai-codex/11")).toBe(1);

    releasePlus();
    const first = await firstPromise;
    const firstBody = await jsonBody(first.response);

    expect(first.response.status).toBe(200);
    expect(first.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("openai-codex:plus#1");
    expect(firstBody?.model).toBe("lazy/default");
    expect(upstream.highestHeld()).toBe(1);
    expect(harness.capacity.inFlight("openai-codex/11")).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Affinity stickiness and admission rescue on lazy/task            */
/* ------------------------------------------------------------------ */

describe("lazy/task prefix affinity and admission", () => {
  test("a warm conversation sticks to the unit that served its prefix", async () => {
    const accounts = [
      { provider: "mistral", id: 51, tier: null },
      { provider: "charm-hyper", id: 61, tier: null },
    ];
    const upstream = createUpstream({ accounts });
    // First the catalog only knows the warm unit, so it must serve request one.
    const harness = makeHarness({
      policyClass: StableDrawPolicy,
      accounts,
      rows: [modelRow(CHARM_MODEL)],
      upstream,
      settings: { routing: { temperature: 0 } },
    });
    const longPrompt = "keep this prefix warm. ".repeat(400);
    const body = {
      messages: [
        { role: "system", content: "You are a careful assistant. ".repeat(20) },
        { role: "user", content: longPrompt },
      ],
    };

    const first = await harness.serve({ route: "lazy/task", body });
    await jsonBody(first.response);
    expect(first.response.status).toBe(200);
    expect(first.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("charm-hyper");
    expect(first.response.headers.get(SERVED_BY_HEADERS.model)).toBe("lazy/task");
    expect(harness.affinity.size).toBeGreaterThan(0);

    // Add the normally-first unit to the gateway catalog. The warm prefix must
    // still send the continuation back to charm-hyper.
    harness.catalog.ingestGatewayModels([modelRow(CHARM_MODEL), modelRow(MISTRAL_MODEL)]);
    const second = await harness.serve({ route: "lazy/task", body });
    const secondBody = await jsonBody(second.response);

    expect(second.response.status).toBe(200);
    expect(second.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("charm-hyper");
    expect(secondBody?.model).toBe("lazy/task");
    expect(upstream.regularCallsFor("mistral/51")).toHaveLength(0);
    expect(upstream.regularCallsFor("charm-hyper/61")).toHaveLength(2);
    expect(
      harness.events.some(
        (event) => event.event === "route" && event.unit === "charm-hyper" && event.affinity === true,
      ),
    ).toBe(true);

    // A cold conversation has no prefix to protect, so the default order wins.
    const cold = await harness.serve({
      route: "lazy/task",
      body: { messages: [{ role: "user", content: "a completely unrelated first turn" }] },
    });
    await jsonBody(cold.response);
    expect(cold.response.headers.get(SERVED_BY_HEADERS.unit)).toBe("mistral");
    expect(upstream.regularCallsFor("mistral/51")).toHaveLength(1);
  });

  test("a cache-poor request denied by admission is rescued when hard slots are free", async () => {
    const accounts = [{ provider: "charm-hyper", id: 1, tier: null }];
    const upstream = createUpstream({ accounts });
    // A unit-scoped limit is what makes admission apply at all: a provider- or
    // model-keyed limit is enforced as a model-scoped capacity scope.
    const harness = makeHarness({
      plan: planWith({ maxInFlight: { "charm-hyper/1": 2 } }),
      accounts,
      rows: [modelRow(CHARM_MODEL)],
      upstream,
    });
    // Two recent requests held a fully warm prefix; the cold request is below
    // the second-best share and loses quantile admission.
    harness.admission.record("charm-hyper/1", 1);
    harness.admission.record("charm-hyper/1", 1);
    expect(harness.admission.windowCount("charm-hyper/1")).toBe(2);
    expect(harness.capacity.hasRoom("charm-hyper/1")).toBe(true);

    const { response } = await harness.serve({
      route: "lazy/task",
      body: { messages: [{ role: "user", content: "cold start, no cached prefix at all" }] },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("charm-hyper");
    expect(response.headers.get(SERVED_BY_HEADERS.model)).toBe("lazy/task");
    expect(body?.model).toBe("lazy/task");

    const held = harness.events.find((event) => event.event === "held-back" && event.reason === "admission");
    expect(held).toBeDefined();
    expect(held.cachedShare).toBe(0);
    expect(held.window).toBe(3);
    expect(harness.events.some((event) => event.event === "admission-rescue" && event.unit === "charm-hyper")).toBe(
      true,
    );
    expect(upstream.regularCallsFor("charm-hyper/1")).toHaveLength(1);
    expect(harness.capacity.inFlight("charm-hyper/1")).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Client error hygiene and opaque route ids                        */
/* ------------------------------------------------------------------ */

describe("exhausted route errors", () => {
  test("lazy/pro keeps its opaque id and never echoes upstream secrets", async () => {
    const accounts = [
      { provider: "kiro", id: 31, tier: null },
      { provider: "google-antigravity", id: 41, tier: "ultra" },
      { provider: "google-antigravity", id: 42, tier: "pro" },
    ];
    const rows = [
      modelRow("kiro/claude-opus-5-5"),
      modelRow("google-antigravity/claude-opus-5-5"),
      modelRow("google-antigravity/gemini-4-argon"),
    ];
    const upstream = createUpstream({ accounts });
    for (const unitKey of ["kiro/31", "google-antigravity/41", "google-antigravity/42"]) {
      upstream.on(unitKey, (call) =>
        call.probe ? errorResponse(403, `probe denied ${LEAK}`) : errorResponse(500, `upstream body ${LEAK}`),
      );
    }
    const harness = makeHarness({ accounts, rows, upstream });

    const { response } = await harness.serve({
      route: "lazy/pro",
      body: { messages: [{ role: "user", content: "exhaust every candidate" }] },
    });
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(503);
    expect(body.error.type).toBe("lazy_router_unavailable");
    expect(body.error.message).toBe("lazy/pro: no healthy candidate could serve this request");
    expect(body.error.message).not.toContain("lazy/lazy");
    for (const leaked of ["charm", "credits", "billing", "hyper.charm.land", "kiro", "google-antigravity"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBeNull();
    for (const secret of ["sk-live", "SECRET-9f3a", "user@example.com", "tok_live_abc123"]) {
      expect(text).not.toContain(secret);
    }

    // Every candidate failed once: the 500 is a provider-answered transient,
    // so it is benched directly without an inline probe.
    expect(upstream.regularCallsFor("kiro/31")).toHaveLength(1);
    expect(upstream.regularCallsFor("google-antigravity/41")).toHaveLength(2);
    expect(upstream.regularCallsFor("google-antigravity/42")).toHaveLength(1);
    expect(upstream.calls.filter((call) => call.probe)).toHaveLength(0);
    for (const [unitKey, model] of [
      ["kiro/31", "kiro/claude-opus-5-5"],
      ["google-antigravity/41", "google-antigravity/claude-opus-5-5"],
      ["google-antigravity/41", "google-antigravity/gemini-4-argon"],
      ["google-antigravity/42", "google-antigravity/gemini-4-argon"],
    ]) {
      expect(harness.stateOf(unitKey, model)).toBe(PROBE_STATE.DEAD);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. Quota failures fail over and never reach the client raw         */
/* ------------------------------------------------------------------ */

describe("quota failure policy", () => {
  const QUOTA_BODY = "402 You're out of credits. Add more at https://hyper.charm.land (type=billing_error)";

  function quotaPlan() {
    return planWith({
      routes: {
        "lazy/weak": {
          displayName: "Quota failover",
          contextWindow: 250_000,
          maxOutputTokens: 32_768,
          graph: {
            type: "fallback",
            children: [
              { type: "model", model: CHARM_MODEL, effort: "max" },
              { type: "model", model: MISTRAL_MODEL, effort: "max" },
            ],
          },
        },
      },
    });
  }

  test("a 402 candidate is benched and the next candidate serves", async () => {
    const accounts = [
      { provider: "charm-hyper", id: 21, tier: null },
      { provider: "mistral", id: 51, tier: null },
    ];
    const rows = [modelRow(CHARM_MODEL), modelRow(MISTRAL_MODEL)];
    const upstream = createUpstream({ accounts });
    upstream.on("charm-hyper/21", () => errorResponse(402, QUOTA_BODY));
    const harness = makeHarness({ plan: quotaPlan(), accounts, rows, upstream });

    const { response } = await harness.serve({
      route: "lazy/weak",
      body: { messages: [{ role: "user", content: "quota failover" }] },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("mistral");
    for (const leaked of ["charm", "credits", "billing", "hyper.charm.land"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
    expect(harness.stateOf("charm-hyper/21", CHARM_MODEL)).toBe(PROBE_STATE.DEAD);
    expect(upstream.regularCallsFor("charm-hyper/21")).toHaveLength(1);
    expect(upstream.regularCallsFor("mistral/51")).toHaveLength(1);
  });

  test("a gateway-observed 402 without provider contact still fails over", async () => {
    const accounts = [
      { provider: "charm-hyper", id: 21, tier: null },
      { provider: "mistral", id: 51, tier: null },
    ];
    const rows = [modelRow(CHARM_MODEL), modelRow(MISTRAL_MODEL)];
    const upstream = createUpstream({ accounts });
    const harness = makeHarness({
      plan: quotaPlan(),
      accounts,
      rows,
      upstream,
      gatewayFault: ({ payload }) => (payload?.model === CHARM_MODEL ? errorResponse(402, QUOTA_BODY) : undefined),
    });

    const { response } = await harness.serve({
      route: "lazy/weak",
      body: { messages: [{ role: "user", content: "gateway saw the 402" }] },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("mistral");
    expect(harness.events.filter((event) => event.event === "rejected")).toHaveLength(0);
    expect(harness.stateOf("charm-hyper/21", CHARM_MODEL)).toBe(PROBE_STATE.DEAD);
  });

  test("all candidates 402 answer one generic 503", async () => {
    const accounts = [
      { provider: "charm-hyper", id: 21, tier: null },
      { provider: "mistral", id: 51, tier: null },
    ];
    const rows = [modelRow(CHARM_MODEL), modelRow(MISTRAL_MODEL)];
    const upstream = createUpstream({ accounts });
    upstream.on("charm-hyper/21", () => errorResponse(402, QUOTA_BODY));
    upstream.on("mistral/51", () => errorResponse(402, QUOTA_BODY));
    const harness = makeHarness({ plan: quotaPlan(), accounts, rows, upstream });

    const { response } = await harness.serve({
      route: "lazy/weak",
      body: { messages: [{ role: "user", content: "every candidate is out of credit" }] },
    });
    const text = await response.text();
    const body = JSON.parse(text);

    expect(response.status).toBe(503);
    expect(body.error.type).toBe("lazy_router_unavailable");
    expect(body.error.message).toBe("lazy/weak: no healthy candidate could serve this request");
    for (const leaked of ["charm", "credits", "billing", "hyper.charm.land", "402", "mistral"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
  });

  test("a 429 is benched for the short cooldown, not the long one", async () => {
    const accounts = [
      { provider: "charm-hyper", id: 21, tier: null },
      { provider: "mistral", id: 51, tier: null },
    ];
    const rows = [modelRow(CHARM_MODEL), modelRow(MISTRAL_MODEL)];
    const upstream = createUpstream({ accounts });
    upstream.on("charm-hyper/21", () => errorResponse(429, "Too Many Requests"));
    const harness = makeHarness({ plan: quotaPlan(), accounts, rows, upstream });

    const { response } = await harness.serve({
      route: "lazy/weak",
      body: { messages: [{ role: "user", content: "rate limited" }] },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("mistral");
    const entered = harness.healthEvents.find(
      (event) => event.event === "cooldown-enter" && event.unitKey === "charm-hyper/21",
    );
    expect(entered).toBeDefined();
    expect(entered.until - OFF_PEAK_AT).toBe(30_000);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Root-path base URLs and inner-gateway 404 failover               */
/* ------------------------------------------------------------------ */

describe("root-path provider base URL", () => {
  test("a root baseUrl keeps the pinned credential on the provider call", async () => {
    const accounts = [{ provider: "google-antigravity", id: 41, tier: "ultra" }];
    const upstream = createUpstream({
      accounts,
      hosts: { ...UPSTREAM_HOSTS, "google-antigravity": "https://antigravity.example.test" },
    });
    const harness = makeHarness({
      accounts,
      rows: [modelRow("google-antigravity/gemini-4-argon")],
      upstream,
      settings: {
        upstreamHosts: { ...UPSTREAM_HOSTS, "google-antigravity": "https://antigravity.example.test" },
      },
    });

    const { response } = await harness.serve({
      route: "lazy/pro",
      body: { messages: [{ role: "user", content: "use a root base URL" }] },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("google-antigravity");
    expect(body?.model).toBe("lazy/pro");

    const calls = harness.upstream.regularCallsFor("google-antigravity/41");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("google-antigravity/gemini-4-argon");
    expect(calls[0].url).toBe("https://antigravity.example.test/chat/completions");
  });
});

describe("inner gateway 404 failover", () => {
  test("an unknown rewritten model fails over instead of rejecting the client", async () => {
    // A strict two-step route keeps the regression independent of rating ties.
    const plan = planWith({
      routes: {
        "lazy/pro": {
          displayName: "Lazy Pro",
          graph: {
            type: "fallback",
            children: [
              { type: "model", model: "kiro/claude-opus-5-5", effort: "medium" },
              { type: "model", model: "google-antigravity/gemini-4-argon", effort: "medium" },
            ],
          },
        },
      },
    });
    const accounts = [
      { provider: "kiro", id: 31, tier: null },
      { provider: "google-antigravity", id: 41, tier: "ultra" },
    ];
    const rows = [modelRow("kiro/claude-opus-5-5"), modelRow("google-antigravity/gemini-4-argon")];
    const upstream = createUpstream({ accounts });
    const harness = makeHarness({
      plan,
      accounts,
      rows,
      upstream,
      gatewayFault: ({ payload }) =>
        payload?.model === "kiro/claude-opus-5-5" ? errorResponse(404, "Unknown model") : undefined,
    });

    const { response } = await harness.serve({
      route: "lazy/pro",
      body: { messages: [{ role: "user", content: "fail over an unknown model" }] },
    });
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.unit)).toBe("google-antigravity");
    expect(body?.model).toBe("lazy/pro");

    // The 404 never reached a provider: that candidate was skipped and the
    // next one served the request.
    expect(harness.upstream.regularCallsFor("kiro/31")).toHaveLength(0);
    expect(harness.upstream.regularCallsFor("google-antigravity/41")).toHaveLength(1);
    expect(harness.upstream.calls).toHaveLength(1);
    expect(harness.upstream.calls[0].model).toBe("google-antigravity/gemini-4-argon");
    expect(harness.events.filter((event) => event.event === "rejected")).toHaveLength(0);
    expect(
      harness.events.filter((event) => event.event === "attempt-failed" && event.failure === "adapter"),
    ).toHaveLength(1);
  });
});

describe("lazy/paid route", () => {
  const accounts = [{ provider: "kuaipao", id: 71, tier: null }];
  const rows = [modelRow("kuaipao/claude-sonnet-5-5")];

  test("is advertised under the client-only prefix and serves only the kuaipao Sonnet leaf", async () => {
    const upstream = createUpstream({
      accounts,
      hosts: { ...UPSTREAM_HOSTS, kuaipao: "https://kuaipao.example.test/v1" },
    });
    const harness = makeHarness({
      accounts,
      rows,
      upstream,
      settings: { upstreamHosts: { ...UPSTREAM_HOSTS, kuaipao: "https://kuaipao.example.test/v1" } },
    });
    const prefix = loadPlanData().clientOnlyPrefix;
    const paid = harness.router.advertisedModels().find((row) => row.id === "lazy/paid");

    expect(paid).toMatchObject({
      object: "model",
      owned_by: "lazy-router",
      display_name: "Lazy Paid · Claude Sonnet 5.5",
    });
    expect(paid.id.startsWith(prefix)).toBe(true);

    const { response } = await harness.serve({ route: "lazy/paid" });
    expect(response.status).toBe(200);
    expect(response.headers.get(SERVED_BY_HEADERS.model)).toBe("lazy/paid");
    const calls = upstream.regularCallsFor("kuaipao/71");
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("kuaipao/claude-sonnet-5-5");
  });
});

describe("status snapshot and refresh shape", () => {
  const accounts = [{ provider: "openai-codex", id: 11, tier: "plus" }];
  const rows = [modelRow(CODEX_MODEL)];

  test("statusView returns one v3 envelope with an unavailable memory store", () => {
    const upstream = createUpstream({ accounts });
    const harness = makeHarness({ accounts, rows, upstream });
    const view = harness.router.statusView();

    expect(view.schemaVersion).toBe(3);
    expect(view.snapshotId).toMatch(/^snap_[0-9a-f]{16}$/);
    expect(Number.isFinite(Date.parse(view.generatedAt))).toBe(true);
    expect(typeof view.buildVersion).toBe("string");
    expect(view.store).toMatchObject({ mode: "memory", available: false });
    expect(view.metrics.M25.available).toBe(false);
    expect(view.metrics.M03.available).toBe(false);
    expect(view.tokenTotals.available).toBe(false);
    expect(Array.isArray(view.routes)).toBe(true);
    expect(Array.isArray(view.workers)).toBe(true);
    expect(Array.isArray(view.notices)).toBe(true);
    expect(view.notices.some((notice) => notice.code === "memory_store")).toBe(true);
    // Nothing in the envelope is undefined at the first level.
    for (const [key, value] of Object.entries(view))
      expect({ key, undefined: value === undefined }).toEqual({ key, undefined: false });
  });

  test("the JSON endpoint returns the same envelope and no-store", async () => {
    const upstream = createUpstream({ accounts });
    const harness = makeHarness({ accounts, rows, upstream });
    const response = harness.router.status();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.schemaVersion).toBe(3);
    expect(body.snapshotId).toMatch(/^snap_[0-9a-f]{16}$/);
    expect(body.metrics.M27).toBeTruthy();
  });

  test("refresh constants and lifecycle follow S3 §3.9.1", () => {
    expect(REFRESH_MS).toBe(10_000);
    expect(TIMEOUT_MS).toBe(8_000);
    expect(MAX_BACKOFF_MS).toBe(120_000);
    expect(() => startRefresh({ initialSnapshot: null, statusPath: "/v1/lazy/status" })).toThrow();
    const initialSnapshot = {
      schemaVersion: 3,
      snapshotId: "snap_0123456789abcdef",
      generatedAt: new Date(OFF_PEAK_AT).toISOString(),
      buildVersion: "sha256-0123456789ab",
      routes: [],
      metrics: { M03: { id: "M03" } },
      store: { mode: "sqlite", available: true },
      tokenTotals: { available: true },
    };
    const handle = startRefresh({ initialSnapshot, statusPath: "/v1/lazy/status" });
    expect(typeof handle.retryNow).toBe("function");
    expect(typeof handle.stop).toBe("function");
    handle.stop();
  });
});
