// Lazy Router feature.
//
// One inbound middleware at priority 70 owns the status page, its assets, the
// status JSON, /v1/models, and the three chat formats. Every other request
// passes through with next(). One outbound fetch handler applies the account
// pin and judges each attempt.
//
// LIFECYCLE: install() returns a disposer. It removes both middleware layers,
// stops every timer, and closes the state store and credential repository.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isGatewayProcess, report } from "../lib/contracts.mjs";
import { CredentialRepository } from "../lib/credentials.mjs";
import {
  getHostModelSnapshot,
  listCustomProviders,
  listExtensionProviders,
  listRegisteredExtensionProviders,
} from "../lib/host-bridge.mjs";
import { addInboundMiddleware, middlewarePriority, readJson } from "../lib/inbound.mjs";
import { addFetchHandler, outboundPriority } from "../lib/outbound.mjs";
import { adminTokenMatches } from "../lib/router/admin-token.mjs";
import { AdmissionControl } from "../lib/router/admission.mjs";
import { PrefixAffinity } from "../lib/router/affinity.mjs";
import { createAttemptLayer } from "../lib/router/attempt.mjs";
import { InFlightTracker } from "../lib/router/capacity.mjs";
import { ModelCatalog, splitModelRef } from "../lib/router/catalog.mjs";
import { disallowedClientModelRequest, forbiddenModelResponse } from "../lib/router/client-model-policy.mjs";
import { withCustomProviderFallback } from "../lib/router/custom-provider-fallback.mjs";
import { CyclicSpeed } from "../lib/router/cyclic-speed.mjs";
import { sanitizeDirectError, sanitizeDirectResponse } from "../lib/router/direct-guard.mjs";
import { GatewayDispatcher } from "../lib/router/dispatcher.mjs";
import { createEventLog, summarizeUpstreamBody } from "../lib/router/events.mjs";
import { withExtensionFallback } from "../lib/router/extension-fallback.mjs";
import { FaultInjector } from "../lib/router/faults.mjs";
import { formatForPath } from "../lib/router/formats.mjs";
import { HealthRegistry } from "../lib/router/health.mjs";
import { ModelPerf } from "../lib/router/perf.mjs";
import { ComposedPolicy, loadPlanData } from "../lib/router/plan.mjs";
import { boundedJson } from "../lib/router/protocol-codec.mjs";
import { ProviderConcurrencyProof } from "../lib/router/provider-concurrency-proof.mjs";
import { LazyRouter } from "../lib/router/router.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { createStatusPage } from "../lib/router/status-page.mjs";
import { AccountDirectory } from "../lib/router/tiers.mjs";

export const name = "lazy-router";
export const phase = "outbound";

export const MODELS_PATH = "/v1/models";
export const RESET_TOKEN_TOTALS_PATH = "/v1/lazy/token-totals/reset";

const DEFAULT_BROKER_URL = "http://127.0.0.1:8765";

/** Every provider named by a model leaf in the plan. */
export function providersInPlan(planData) {
  const providers = new Set();
  const visit = (node) => {
    if (!node) return;
    if (node.type === "model") {
      const { provider } = splitModelRef(node.model ?? "");
      if (provider) providers.add(provider);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const route of Object.values(planData?.routes ?? {})) visit(route.graph);
  return providers;
}

/** The whole lazy router and its collaborators. */
export function createLazyRouter(config, { log = report, paths = {} } = {}) {
  const home = homedir();
  const ompDir = join(home, ".omp");
  const loaded = loadPlanData(config.routesFile ?? undefined);
  const planData = {
    ...loaded,
    maxInFlight: { ...(loaded.maxInFlight ?? {}), ...(config.maxInFlight ?? {}) },
  };
  const policy = new ComposedPolicy(planData);
  const emit = createEventLog({
    out: config.out ?? join(paths.logsDir ?? join(ompDir, "logs"), "lazy-router.jsonl"),
    report: log,
  });

  const statePath = config.store === "memory" ? null : (paths.stateDbPath ?? join(ompDir, "omp-shims-state.sqlite"));
  const store = new StateStore({
    path: statePath,
    ...(config.store === "memory" ? { mode: "memory" } : {}),
    ...(config.admissionWindowMs ? { admissionWindowMs: config.admissionWindowMs } : {}),
  });
  store.start?.();

  const health = new HealthRegistry({
    store,
    probeIntervalMs: config.probeIntervalMs,
    onEvent: emit,
  });

  let router;
  const capacity = new InFlightTracker({
    store,
    limitOf: (key) => router?.capacityLimits.get(key) ?? 0,
  });
  const admission = new AdmissionControl({
    store,
    ...(config.admissionWindowMs ? { windowMs: config.admissionWindowMs } : {}),
  });
  const affinity = new PrefixAffinity({
    store,
    ...(config.affinityTtlMs ? { ttlMs: config.affinityTtlMs } : {}),
    ...(config.affinityMaxEntries ? { maxEntries: config.affinityMaxEntries } : {}),
    ...(config.affinityMinPrefixBytes ? { minPrefixBytes: config.affinityMinPrefixBytes } : {}),
  });
  const perf = new ModelPerf({ store });
  const speed = new CyclicSpeed({ store });
  const concurrencyProof = new ProviderConcurrencyProof();

  const credentials = new CredentialRepository({
    agentDbPath: paths.agentDbPath ?? join(ompDir, "agent", "agent.db"),
    brokerUrl: process.env.OMP_AUTH_BROKER_URL ?? DEFAULT_BROKER_URL,
    brokerTokenPath: paths.brokerTokenPath ?? join(ompDir, "auth-broker.token"),
  });

  const providers = providersInPlan(planData);
  let hostSnapshot = [];
  let extensionRows = [];
  try {
    hostSnapshot = getHostModelSnapshot() ?? [];
  } catch {
    hostSnapshot = [];
  }
  try {
    extensionRows = listExtensionProviders() ?? [];
  } catch {
    extensionRows = [];
  }
  for (const model of hostSnapshot) if (model?.provider) providers.add(model.provider);
  for (const row of extensionRows) {
    if (row?.owned_by) providers.add(row.owned_by);
  }
  try {
    for (const descriptor of listRegisteredExtensionProviders?.() ?? []) {
      if (typeof descriptor?.id === "string") providers.add(descriptor.id);
    }
  } catch {
    // Extension descriptors are optional.
  }
  try {
    for (const descriptor of listCustomProviders?.() ?? []) {
      if (typeof descriptor?.name === "string") providers.add(descriptor.name);
    }
  } catch {
    // Custom providers are optional.
  }

  const accountDirectory = new AccountDirectory({
    credentials,
    providers,
    recheckMs: config.tierRecheckMs,
    tierRefreshMs: config.tierRefreshMs,
    report: log,
  });

  const catalog = new ModelCatalog({
    overrides: planData.modelTraits ?? {},
    agentDbPath: paths.agentDbPath,
    hostSnapshot: () => {
      try {
        return getHostModelSnapshot() ?? [];
      } catch {
        return [];
      }
    },
    extensionProviders: () => {
      try {
        return listExtensionProviders() ?? [];
      } catch {
        return [];
      }
    },
    isRouteModel: (id) => policy.routeNames.includes(id),
  });

  const tokenPath = paths.gatewayTokenPath ?? join(ompDir, "auth-gateway.token");
  const dispatcher = new GatewayDispatcher({
    tokenPath,
    headerTimeoutMs: config.headerTimeoutMs,
  });
  const faults = new FaultInjector(config.testFaults ?? {});
  if (faults.active) log("lazy-router: TEST FAULTS ACTIVE — never use this config in production", config.testFaults);

  router = new LazyRouter({
    policy,
    catalog,
    health,
    dispatcher,
    faults,
    affinity,
    capacity,
    admission,
    perf,
    speed,
    store,
    concurrencyProof,
    credentials,
    accountDirectory,
    planData,
    emit,
    settings: {
      routing: config.routing ?? {},
      probePrompt: config.probePrompt,
      probeMaxTokens: config.probeMaxTokens,
      probeTimeoutMs: config.probeTimeoutMs,
      headerTimeoutMs: config.headerTimeoutMs,
      providerHeaderTimeoutMs: config.providerHeaderTimeoutMs ?? {},
      upstreamHosts: config.upstreamHosts ?? {},
      probeIntervalMs: config.probeIntervalMs,
    },
    pinnedProviders: new Set(),
  });

  const attemptLayer = createAttemptLayer({
    credentials,
    pinnedProviders: new Set(),
    onUpstreamRequest: config.logUpstreamBody
      ? (attempt, url, body) =>
          emit("upstream-request", {
            unit: attempt.unit.label,
            pinned: attempt.credentialId !== undefined,
            host: new URL(url).host,
            fields: summarizeUpstreamBody(body) ?? { bodyBytes: 0 },
          })
      : undefined,
  });

  return {
    router,
    dispatcher,
    catalog,
    accountDirectory,
    attemptLayer,
    credentials,
    store,
    health,
    speed,
    statusPage: createStatusPage({
      statusPath: config.statusPath ?? "/v1/lazy/status",
      statusView: () => router.statusView(),
    }),
  };
}

/** The inbound middleware. The gateway handler is reached through next(). */
export function lazyRouterHandler({ router, dispatcher, statusPage, credentials, config, paths = {} }) {
  const statusPath = config.statusPath ?? "/v1/lazy/status";
  const tokenPath = paths.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token");
  const clientOnlyPrefix = config.clientOnlyPrefix ?? "";

  return async function lazyRouterInbound(request, server, next) {
    let pathname;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return next(request);
    }
    const nativeRoutable = (model) => router.catalog.host.has(model) || router.catalog.gateway.has(model);
    const downstream = withExtensionFallback(
      withCustomProviderFallback((rewritten) => next(rewritten), {
        tokenPath,
        nativeRegistered: nativeRoutable,
      }),
      { credentials, tokenPath, nativeRegistered: nativeRoutable },
    );
    dispatcher.bind(downstream, server);

    if (pathname === RESET_TOKEN_TOTALS_PATH) {
      if (request.method !== "POST") {
        return Response.json(
          { error: "method_not_allowed" },
          { status: 405, headers: { allow: "POST", "cache-control": "no-store" } },
        );
      }
      const trusted =
        request.headers.get("x-lazy-reset") === "token-totals" &&
        /^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") ?? "") &&
        adminTokenMatches(request, tokenPath);
      if (!trusted) {
        return Response.json({ error: "unauthorized" }, { status: 401, headers: { "cache-control": "no-store" } });
      }
      const ok = router.resetTokenTotals();
      return Response.json(
        ok ? { ok: true, tokenTotals: router.statusView().tokenTotals } : { error: "counter_unavailable" },
        { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
      );
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const page = statusPage(request.method, pathname);
      if (page) return page;
      if (pathname === statusPath) return router.status();
      if (pathname === MODELS_PATH) {
        const base = await next(request);
        if (base.status !== 200) return base;
        const listing = await boundedJson(base);
        try {
          await base.body?.cancel();
        } catch {
          // The clone already read the listing.
        }
        if (!listing || !Array.isArray(listing.data)) {
          return Response.json(
            { error: { type: "catalog_unavailable", message: "The gateway model listing is unavailable." } },
            { status: 502, headers: { "cache-control": "no-store" } },
          );
        }
        router.catalog.ingestGatewayModels(listing.data);
        if (clientOnlyPrefix !== "") {
          return Response.json(
            { ...listing, data: router.advertisedModels() },
            { status: 200, headers: { "cache-control": "no-store" } },
          );
        }
        const rows = new Map();
        for (const row of listing.data) if (row?.id) rows.set(row.id, row);
        for (const row of router.catalog.rows()) rows.set(row.id, row);
        for (const row of router.advertisedModels()) rows.set(row.id, row);
        return Response.json(
          { ...listing, data: [...rows.values()] },
          { status: 200, headers: { "cache-control": "no-store" } },
        );
      }
    }

    if (request.method !== "POST") return next(request);
    const format = formatForPath(pathname);
    if (!format) return downstream(request, server);

    const body = await readJson(request);
    if (!body) return downstream(request, server);

    if (router.handles(body.model)) {
      return router.serve(format, body, request);
    }
    if (
      disallowedClientModelRequest({
        method: request.method,
        pathname,
        body,
        router,
        clientOnlyPrefix,
        supportedFormat: true,
      })
    ) {
      return forbiddenModelResponse();
    }

    const startedAt = Date.now();
    let response;
    try {
      response = await downstream(request, server);
    } catch (error) {
      const safe = sanitizeDirectError(error, { report });
      if (!safe) throw error;
      return safe;
    }
    const safe = await sanitizeDirectResponse(response, { report });
    return router.catalog.hasNativeModel(body.model)
      ? router.measureDirect(body.model, safe, startedAt, request.signal)
      : safe;
  };
}

/**
 * Codex streams over a pooled WebSocket by default. A socket is opened outside
 * the fetch layer, so an account pin cannot be applied to it. HTTP/SSE is the
 * provider's other supported transport. An explicit environment choice wins.
 */
function preferCodexHttp(config) {
  if (config.codexHttpTransport === false) return undefined;
  if (process.env.PI_CODEX_WEBSOCKET === undefined) {
    process.env.PI_CODEX_WEBSOCKET = "0";
    return () => {
      if (process.env.PI_CODEX_WEBSOCKET === "0") delete process.env.PI_CODEX_WEBSOCKET;
    };
  } else if (process.env.PI_CODEX_WEBSOCKET !== "0") {
    report("lazy-router: PI_CODEX_WEBSOCKET is set; Codex units cannot be pinned over WebSockets");
  }
  return undefined;
}

/** Install the feature. Return a disposer that removes every effect. */
export function install(config, context) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) {
    context?.log?.("lazy-router: not the auth-gateway process; staying off");
    return;
  }
  const restoreCodex = preferCodexHttp(config);

  const dependencies = createLazyRouter(config, { paths: context?.paths ?? {} });
  const { router, attemptLayer, accountDirectory, speed, store } = dependencies;

  try {
    const out = config.out ?? join(context?.paths?.logsDir ?? join(homedir(), ".omp", "logs"), "lazy-router.jsonl");
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  } catch {
    // A missing log directory only loses the event file.
  }

  accountDirectory.start();
  speed.start?.();
  const removeInbound = addInboundMiddleware(
    lazyRouterHandler({ ...dependencies, config, paths: context?.paths ?? {} }),
    { name: "lazy-router", priority: middlewarePriority.lazyRouter },
  );
  const removeOutbound = addFetchHandler(attemptLayer, {
    name: "lazy-router",
    priority: outboundPriority.lazyRouter,
  });

  context?.log?.("lazy-router: enabled", { routes: router.policy.routeNames });

  return () => {
    removeOutbound();
    removeInbound();
    restoreCodex?.();
    router.dispose();
    accountDirectory.stop();
    speed.stop?.();
    store.stop?.();
    store.close?.();
    dependencies.credentials.close?.();
  };
}
