// Lazy router: `lazy/default`, `lazy/task` and `lazy/vision` models that route
// each request to the first alive (provider, account) unit for the current
// DeepSeek tariff period, with probe-driven failover and recovery.
//
// Wiring only; the parts live in lib/lazy-router/:
//   routes.json / policy.js      declarative route tables → candidate lists
//   tiers.js / units.js          account tiers at runtime → labelled (provider, account) units
//   holidays-cn.json / calendar.js   Beijing-time peak detection
//   catalog.js                   model traits from the gateway's ModelRegistry
//   effort.js                    effort capping and fitting
//   formats.js                   per-dialect body rewriting
//   health.js                    per-(unit, model) cooldown + probe loop
//   credentials.js / attempt.js  account pinning on the outbound fetch
//   dispatcher.js                one attempt through the gateway, judged on first headers
//   router.js                    orchestration, /v1/models entries, status view
//   status-page.{js,html}        the browser view at GET /, fed by the status JSON
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
//     "logUpstreamBody": false       // log effort/limit fields of each provider call
//   }

import { homedir } from "node:os";
import { join } from "node:path";
import { report } from "../lib/bootstrap.js";
import { readBody, wrapServe } from "../lib/inbound.js";
import { createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { HolidayCalendar, loadHolidayData, PeakSchedule } from "../lib/lazy-router/calendar.js";
import { ModelCatalog } from "../lib/lazy-router/catalog.js";
import { CredentialStore } from "../lib/lazy-router/credentials.js";
import { GatewayDispatcher } from "../lib/lazy-router/dispatcher.js";
import { createEventLog, summarizeUpstreamBody } from "../lib/lazy-router/events.js";
import { FaultInjector } from "../lib/lazy-router/faults.js";
import { formatForPath } from "../lib/lazy-router/formats.js";
import { HealthRegistry } from "../lib/lazy-router/health.js";
import { loadPolicyData, RoutePolicy } from "../lib/lazy-router/policy.js";
import { LazyRouter } from "../lib/lazy-router/router.js";
import { createStatusPage, STATUS_PAGE_PATH } from "../lib/lazy-router/status-page.js";
import { TierDirectory } from "../lib/lazy-router/tiers.js";
import { UnitDirectory } from "../lib/lazy-router/units.js";

const MODELS_PATH = "/v1/models";
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
  const policy = new RoutePolicy(loadPolicyData(config.routesFile ?? undefined));
  const calendar = new HolidayCalendar(loadHolidayData(config.holidaysFile ?? undefined));
  const schedule = new PeakSchedule({ calendar, windows: policy.peakWindows });
  const emit = createEventLog({ out: config.out ?? join(ompDir, "logs", "lazy-router.jsonl"), report: log });
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

  const router = new LazyRouter({
    policy,
    units,
    schedule,
    catalog,
    health,
    dispatcher,
    faults,
    emit,
    settings: {
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

  return { router, dispatcher, catalog, tiers, attemptLayer };
}

/**
 * The inbound handler: lazy models, the status JSON, the status page and
 * /v1/models; everything else passes through. Exactly two things are answered
 * without the gateway token, both free of account-identifying data: GET (and
 * HEAD) of the status page at "/", and GET of the status JSON. /v1/models and
 * lazy requests still go through the gateway's own authentication.
 */
export function lazyRouterHandler(
  handler,
  { router, dispatcher, statusPath, statusPage = createStatusPage({ statusPath }) },
) {
  return async function lazyRouterInbound(request, server) {
    dispatcher.bind(handler, server);
    const { pathname } = new URL(request.url);

    if (pathname === STATUS_PAGE_PATH && (request.method === "GET" || request.method === "HEAD")) {
      return statusPage(request.method);
    }
    if (request.method === "GET") {
      if (pathname === MODELS_PATH) return withLazyModels(await handler(request, server), router.advertisedModels());
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
    if (!body || !router.handles(body.model)) return handler(request, server);
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

/** The subcommand that serves the gateway; the router belongs in that process only. */
const GATEWAY_COMMAND = "auth-gateway";

/**
 * True in the auth-gateway process. shims.json is shared with the auth-broker
 * and interactive sessions, which must not answer lazy models, publish the
 * status path, switch Codex transport or look up account tiers.
 */
export function isGatewayProcess(argv = process.argv) {
  return argv.includes(GATEWAY_COMMAND);
}

export function install(config, context) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) {
    context.log?.("lazy-router: not the auth-gateway process; staying off");
    return;
  }
  preferCodexHttp(config);
  const { router, dispatcher, catalog, tiers, attemptLayer } = createLazyRouter(config);

  if (!catalog.observe(globalThis.__OMP_SHIMS_HOST__)) {
    report("lazy-router: host capture unavailable (is registry-capture.js preloaded first?); routes will be empty");
  }
  context.addFetchHandler(attemptLayer);
  tiers.start();
  wrapServe((handler) => lazyRouterHandler(handler, { router, dispatcher, statusPath: config.statusPath }));
  context.log?.("lazy-router: enabled", { routes: router.policy.routeNames });
}
