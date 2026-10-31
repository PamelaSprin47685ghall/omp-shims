// Virtual-model router: a keyed model or recursive fallback, random and speed-rating compositions.
//
// Wiring only; the parts live in lib/lazy-router/:
//   composition-routes.json / composed-policy.js   recursive keyed-model graph
//   tiers.js / units.js          account tiers at runtime → labelled (provider, account) units
//   holidays-cn.json / calendar.js   Beijing-time peak detection
//   catalog.js                   model traits from the gateway's ModelRegistry
//   effort.js                    effort capping and fitting
//   formats.js / canonical.js    per-dialect body rewriting and canonical transcripts
//   affinity.js                  prefix cache influences selection temperature
//   capacity.js / admission.js   in-flight limits per unit and cache-aware admission
//   cyclic-speed.js               UTC-periodic hourly spline; shared provider/model speed statistics\n//   health.js                    per-(unit, model) cooldown + probe loop
//   credentials.js / attempt.js  account pinning on the outbound fetch
//   dispatcher.js                one attempt through the gateway, judged on first headers
//   router.js                    orchestration, /v1/models entries, status view
//   status-page.js, status-page/ the browser view at GET / (server-rendered, refreshed from the JSON)
//
// Config (~/.omp/shims.json):
//   "lazy-router": {
//     "enabled": true,
//     "routesFile": null,            // replace the bundled routes.json
//     "holidaysFile": null,          // replace the bundled holidays-cn.json
//     "probeIntervalMs": 1800000,    // background probe cadence for cooling units
//     "tierRefreshMs": 21600000,     // re-read a known account tier this often
//     "tierRecheckMs": 60000,        // look for new/removed accounts this often
//     "headerTimeoutMs": 300000,     // max wait for the provider's first headers
//     "providerHeaderTimeoutMs": { "commandcode": 1800000 },
//     "upstreamHosts": {},           // provider → host, when it differs from the model baseUrl
//     "codexHttpTransport": true,    // run Codex over HTTP/SSE so its account can be pinned
//     "logUpstreamBody": false,      // log effort/limit fields of each provider call
//     "maxInFlight": {},             // merged over routes.json: "provider" or "provider:tier" → limit
//     "affinityTtlMs": 300000,       // lifetime of a recorded prefix (refreshed on a hit)
//     "affinityMaxEntries": 50000,   // recorded prefixes kept at most
//     "affinityMinPrefixBytes": 1024,// shorter prefixes are not recorded
//     "admissionWindowMs": 300000,   // rolling window of the admission distribution
//     "routing": {                    // weighted online routing
//       "intelligenceCenter": 50, "intelligenceSlope": 0.06, "costWeight": 0.20,
//       "latencyWeight": 1.0, "historicalLatencyWeight": 0.25,
//       "rdInitial": 1.0, "rdFloor": 0.1, "rdSampleScale": 12, "affinityWeight": 0.5, "temperature": 0.6
//     }
//   }

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { report } from "../lib/bootstrap.js";
import { isGatewayProcess } from "../lib/gateway-process.js";
import { readBody, withBody, withUsageRequest, wrapServe } from "../lib/inbound.js";
import { AdmissionControl } from "../lib/lazy-router/admission.js";
import { PrefixAffinity } from "../lib/lazy-router/affinity.js";
import { createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { HolidayCalendar, loadHolidayData, PeakSchedule } from "../lib/lazy-router/calendar.js";
import { InFlightTracker } from "../lib/lazy-router/capacity.js";
import { ModelCatalog } from "../lib/lazy-router/catalog.js";
import { withMistralFallback, mistralFallbackModelList } from "../lib/lazy-router/mistral-native-fallback.js";
import { withCustomProviderFallback, customModelList } from "../lib/lazy-router/custom-provider-fallback.js";
import { withExtensionFallback } from "../lib/lazy-router/extension-fallback.js";
import { extensionModelList } from "../lib/lazy-router/extension-providers.js";
import { CredentialStore } from "../lib/lazy-router/credentials.js";
import { GatewayDispatcher } from "../lib/lazy-router/dispatcher.js";
import { createEventLog, summarizeUpstreamBody } from "../lib/lazy-router/events.js";
import { FaultInjector } from "../lib/lazy-router/faults.js";
import { formatForPath } from "../lib/lazy-router/formats.js";
import { HealthRegistry } from "../lib/lazy-router/health.js";
import { ModelPerf } from "../lib/lazy-router/perf.js";
import { ProviderConcurrencyProof } from "../lib/lazy-router/provider-concurrency-proof.js";
import { loadPolicyData, RoutePolicy } from "../lib/lazy-router/policy.js";
import { ComposedPolicy, loadCompositionData } from "../lib/lazy-router/composed-policy.js";
import { CyclicSpeed } from "../lib/lazy-router/cyclic-speed.js";
import { TokenTotals } from "../lib/lazy-router/token-totals.js";
import { LazyRouter } from "../lib/lazy-router/router.js";
import { createStatusPage } from "../lib/lazy-router/status-page.js";
import { TierDirectory } from "../lib/lazy-router/tiers.js";
import { UnitDirectory } from "../lib/lazy-router/units.js";

const MODELS_PATH = "/v1/models";
/** Public reads remain unauthenticated; this destructive operation never does. */
export const RESET_TOKEN_TOTALS_PATH = "/v1/lazy/token-totals/reset";

function authorizedTokenReset(request, tokenPath) {
  // A simple cross-origin form cannot provide our custom header or bearer key.
  if (request.headers.get("x-lazy-reset") !== "token-totals") return false;
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? "")) return false;
  const provided = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!provided) return false;
  let trusted;
  try { trusted = readFileSync(tokenPath, "utf8").trim(); } catch { return false; }
  if (!trusted) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(trusted);
  return a.length === b.length && timingSafeEqual(a, b);
}
const DEFAULT_BROKER_URL = "http://127.0.0.1:8765";

/** Append the lazy entries to a /v1/models answer. */
async function withLazyModels(response, entries) {
  if (response?.status !== 200) return response;
  try {
    const listing = await response.clone().json();
    if (!Array.isArray(listing?.data)) return response;
    const present = new Set(listing.data.map((model) => model.id));
    listing.data.push(...entries.filter((entry) => !present.has(entry.id)));
    return new Response(JSON.stringify(listing), { status: 200, headers: response.headers });
  } catch {
    return response;
  }
}

/** Build the router and its collaborators from the resolved feature config. */
export function createLazyRouter(config, { log = report } = {}) {
  const ompDir = join(homedir(), ".omp");
  const calendar = new HolidayCalendar(loadHolidayData(config.holidaysFile ?? undefined));
  const policyData = config.routesFile ? loadPolicyData(config.routesFile) : loadCompositionData();
  policyData.maxInFlight = { ...(policyData.maxInFlight ?? {}), ...(config.maxInFlight ?? {}) };
  const policy = config.routesFile ? new RoutePolicy(policyData) : new ComposedPolicy(policyData, { calendar });
  const schedule = new PeakSchedule({ calendar, windows: policy.peakWindows ?? loadPolicyData().peakWindows });
  const emit = createEventLog({ out: config.out ?? process.env.OMP_SHIMS_LAZY_EVENT_LOG_PATH ?? join(ompDir, "logs", "lazy-router.jsonl"), report: log });
  const concurrencyProof = new ProviderConcurrencyProof({
    statePath: config.concurrencyProofStatePath ?? process.env.OMP_SHIMS_LAZY_CONCURRENCY_PROOF_STATE_PATH ?? join(ompDir, "lazy-router-concurrency-proof.json"),
    onProof: (evidence) => emit("provider-concurrency-proof", evidence),
  });
  const tokenPath = config.gatewayTokenPath ?? join(ompDir, "auth-gateway.token");

  const credentials = new CredentialStore({
    dbPath: config.agentDbPath ?? join(ompDir, "agent", "agent.db"),
    brokerUrl: process.env.OMP_AUTH_BROKER_URL ?? DEFAULT_BROKER_URL,
    brokerTokenPath: config.brokerTokenPath ?? join(ompDir, "auth-broker.token"),
  });
  const tiers = new TierDirectory({
    credentials,
    emit,
    ...(config.tierRefreshMs ? { refreshMs: config.tierRefreshMs } : {}),
    ...(config.tierRecheckMs ? { recheckMs: config.tierRecheckMs } : {}),
  });
  const units = new UnitDirectory({ tiers });
  const catalog = new ModelCatalog({ overrides: policy.modelTraits });
  const health = new HealthRegistry({
    probeIntervalMs: config.probeIntervalMs,
    onEvent: emit,
    describe: (key, candidate) => (candidate ? `${candidate.unit.label} ${candidate.model}` : key),
  });
  const dispatcher = new GatewayDispatcher({ tokenPath, headerTimeoutMs: config.headerTimeoutMs });
  const faults = new FaultInjector(config.testFaults ?? {});
  if (faults.active) log("lazy-router: TEST FAULTS ACTIVE — never use this config in production", config.testFaults);
  const perf = new ModelPerf({
    statePath: config.perfStatePath ?? process.env.OMP_SHIMS_LAZY_PERF_STATE_PATH ?? join(ompDir, "lazy-router-perf.json"),
    ...(config.perfHistoryHalfLifeMs ? { historyHalfLifeMs: config.perfHistoryHalfLifeMs } : {}),
    ...(config.perfHistoryWeightCap ? { historyWeightCap: config.perfHistoryWeightCap } : {}),
  });

  const speed = new CyclicSpeed({
    statePath: config.speedStatePath ?? process.env.OMP_SHIMS_LAZY_CYCLIC_SPEED_STATE_PATH ?? join(ompDir, "lazy-router-cyclic-speed.json"),
  });
  const tokenTotals = new TokenTotals({ path: config.tokenTotalsPath ??
    process.env.OMP_SHIMS_LAZY_TOKEN_TOTALS_PATH ?? join(ompDir, "lazy-router-token-totals.sqlite") });
  const router = new LazyRouter({
    policy,
    units,
    schedule,
    catalog,
    health,
    dispatcher,
    faults,
    affinity: new PrefixAffinity({
      ttlMs: config.affinityTtlMs,
      maxEntries: config.affinityMaxEntries,
      minPrefixBytes: config.affinityMinPrefixBytes,
    }),
    capacity: new InFlightTracker({ limitOf: (unit) => policy.maxInFlight(unit) }),
    admission: new AdmissionControl({ windowMs: config.admissionWindowMs }),
    perf,
    speed,
    tokenTotals,
    concurrencyProof,
    credentials,
    emit,
    settings: {
      routing: config.routing ?? {},
      probePrompt: config.probePrompt,
      probeMaxTokens: config.probeMaxTokens,
      probeTimeoutMs: config.probeTimeoutMs,
      headerTimeoutMs: config.headerTimeoutMs,
      providerHeaderTimeoutMs: config.providerHeaderTimeoutMs ?? {},
      upstreamHosts: config.upstreamHosts ?? {},
    },
  });

  const attemptLayer = createAttemptLayer({
    credentials,
    onUpstreamRequest: config.logUpstreamBody
      ? (attempt, url, body) =>
          emit("upstream-request", {
            unit: attempt.unit.label,
            pinned: attempt.credentialId !== undefined,
            host: new URL(url).host,
            fields: summarizeUpstreamBody(body) ?? "<non-JSON body>",
          })
      : undefined,
  });

  return { router, dispatcher, catalog, tiers, attemptLayer, credentials };
}

/**
 * The inbound handler: lazy models, the status JSON, the status page and
 * /v1/models; everything else passes through. Answered without the gateway
 * token, all free of account-identifying data: GET/HEAD of the status page at
 * "/" and of its own files under /assets/lazy-status/, and GET of the status
 * JSON. /v1/models and lazy requests still go through the gateway's own
 * authentication.
 */
export function lazyRouterHandler(
  handler,
  {
    router,
    dispatcher,
    statusPath,
    gatewayTokenPath = join(homedir(), ".omp", "auth-gateway.token"),
    statusPage = createStatusPage({ statusPath, statusView: () => router.statusView() }),
    extraModels = [],
  },
) {
  return async function lazyRouterInbound(request, server) {
    dispatcher.bind(handler, server);
    const { pathname } = new URL(request.url);

    if (pathname === RESET_TOKEN_TOTALS_PATH) {
      if (request.method !== "POST") {
        return Response.json({ error: "method_not_allowed" }, {
          status: 405, headers: { allow: "POST", "cache-control": "no-store" },
        });
      }
      if (!authorizedTokenReset(request, gatewayTokenPath)) {
        return Response.json({ error: "unauthorized" }, {
          status: 401, headers: { "cache-control": "no-store" },
        });
      }
      const ok = router.resetTokenTotals();
      return Response.json(ok
        ? { ok: true, tokenTotals: router.statusView().tokenTotals }
        : { error: "counter_unavailable" }, {
        status: ok ? 200 : 503, headers: { "cache-control": "no-store" },
      });
    }

    // Even a read-only status page must reflect the stock host catalog.
    if (request.method === "GET" && (pathname === statusPath || pathname === "/")) {
      if (typeof router.ensureCatalog === "function") await router.ensureCatalog();
    }
    const page = statusPage(request.method, pathname);
    if (page) return page;
    if (request.method === "GET") {
      if (pathname === MODELS_PATH) return withLazyModels(await handler(request, server),
        [...router.advertisedModels(), ...(typeof extraModels === "function" ? extraModels() : extraModels)]);
      if (pathname === statusPath) return router.status();
      return handler(request, server);
    }

    const format = request.method === "POST" ? formatForPath(pathname) : undefined;
    if (!format) return handler(request, server);

    const text = await readBody(request);
    let body;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    if (!body || !router.handles(body.model)) {
      // A direct model id: the gateway serves it, but its latency and speed
      // belong in the same per-model window as the routed ones. Ask for the
      // usage frame the speed is computed from, which the gateway only emits
      // when the client requests it.
      const startedAt = Date.now();
      const usage = text ? withUsageRequest(pathname, text) : undefined;
      const forwarded = usage === undefined ? request : withBody(request, usage);
      const proof = router.beginDirectProof(body?.model);
      try {
        const answer = await handler(forwarded, server);
        return router.measureDirect(body?.model, answer, startedAt, format, request.signal, proof);
      } catch (error) {
        proof?.finish(false);
        throw error;
      }
    }
    return router.serve(format, body, request);
  };
}

/**
 * OpenAI Codex streams over a pooled WebSocket by default. A socket is opened
 * outside the fetch layer and reused across requests, so an account pin could
 * neither be applied to it nor kept from leaking into later requests. Pinned
 * routing therefore needs Codex on its HTTP/SSE transport, which the provider
 * supports equally; an explicit PI_CODEX_WEBSOCKET from the environment wins.
 */
function preferCodexHttp(config) {
  if (config.codexHttpTransport === false) return;
  if (process.env.PI_CODEX_WEBSOCKET === undefined) process.env.PI_CODEX_WEBSOCKET = "0";
  else if (process.env.PI_CODEX_WEBSOCKET !== "0") {
    report("lazy-router: PI_CODEX_WEBSOCKET is set; Codex units cannot be pinned to an account over WebSockets");
  }
}

/** Kept for callers that import it from here; the check lives in lib/gateway-process.js. */
export { isGatewayProcess };

export function install(config, context) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) {
    context.log?.("lazy-router: not the auth-gateway process; staying off");
    return;
  }
  preferCodexHttp(config);
  const { router, dispatcher, catalog, tiers, attemptLayer, credentials } = createLazyRouter(config);

  if (!catalog.observe(globalThis.__OMP_SHIMS_HOST__)) {
    report("lazy-router: host capture unavailable (is registry-capture.js preloaded first?); routes will be empty");
  }
  context.addFetchHandler(attemptLayer);
  tiers.start();
  wrapServe((handler) => lazyRouterHandler(
    withExtensionFallback(
      withCustomProviderFallback(
        withMistralFallback(handler, {
          credentials,
          nativeRegistered: (model) => catalog.hasNativeModel(model),
          tokenPath: config.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token"),
        }), {
          nativeRegistered: (model) => catalog.hasNativeModel(model),
          tokenPath: config.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token"),
        },
      ), {
        credentials,
        nativeRegistered: (model) => catalog.hasNativeModel(model),
        tokenPath: config.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token"),
      },
    ),
    {
      router, dispatcher, statusPath: config.statusPath,
      gatewayTokenPath: config.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token"),
      extraModels: () => [...mistralFallbackModelList(), ...customModelList(), ...extensionModelList()],
    },
  ));
  context.log?.("lazy-router: enabled", { routes: router.policy.routeNames });
}
