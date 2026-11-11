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
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { normalizeStatusBasePath } from "../lib/config.mjs";
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
import {
  ASSET_PREFIX,
  createStatusPage,
  DEFAULT_RESET_PATH,
  DEFAULT_STATUS_PATH,
  STATUS_BUILD_VERSION,
  STATUS_PAGE_PATH,
} from "../lib/router/status-page.mjs";
import { AccountDirectory } from "../lib/router/tiers.mjs";

export const name = "lazy-router";
export const phase = "outbound";

export const MODELS_PATH = "/v1/models";
export const RESET_TOKEN_TOTALS_PATH = DEFAULT_RESET_PATH;

/** One worker row is upserted this often. */
export const WORKER_HEARTBEAT_MS = 2_000;

const DEFAULT_BROKER_URL = "http://127.0.0.1:8765";

/** Remove one external mount prefix before route matching. */
export function stripStatusBasePath(pathname, basePath) {
  if (!basePath) return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length);
  return pathname;
}

/** Hand the gateway a request URL without the page's external mount prefix. */
function withStrippedPath(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const value = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  if (value === "::1") return true;
  const parts = value.split(".");
  return (
    parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * The proxy prefix is trusted only when the TCP peer is loopback. A direct
 * client cannot choose the page's mount prefix.
 */
function requestPeerIsLoopback(request, server) {
  try {
    return isLoopbackAddress(server?.requestIP?.(request)?.address);
  } catch {
    return false;
  }
}

function trustedForwardedPrefix(request, server, peerLoopback = requestPeerIsLoopback(request, server)) {
  if (!peerLoopback) return "";
  const raw = request.headers.get("x-forwarded-prefix");
  if (typeof raw !== "string" || raw === "") return "";
  try {
    return normalizeStatusBasePath(raw);
  } catch {
    return "";
  }
}

function requestIsHttps(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reset transport gate.
 *
 * A loopback peer is the documented local-operator path and may use plain
 * HTTP. Every other peer needs real TLS; `X-Forwarded-Proto` is never trusted
 * for a non-loopback peer, so a client-supplied header cannot pass the gate.
 */
function resetTransportAllowed(request, peerLoopback) {
  if (peerLoopback) return true;
  return requestIsHttps(request);
}

const NOT_FOUND_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
});

function notFoundResponse(method) {
  return new Response(method === "HEAD" ? null : "Not Found", { status: 404, headers: NOT_FOUND_HEADERS });
}

/** The endpoints that move under `statusBasePath` when it is configured. */
function isStatusSurfacePath(pathname, statusPath) {
  return (
    pathname === STATUS_PAGE_PATH ||
    pathname === ASSET_PREFIX ||
    pathname.startsWith(`${ASSET_PREFIX}/`) ||
    pathname === statusPath ||
    pathname === RESET_TOKEN_TOTALS_PATH
  );
}

function currentTokenEpoch(store) {
  try {
    const epoch = store?.captureTokenEpoch?.();
    return typeof epoch === "string" && epoch !== "" ? epoch : null;
  } catch {
    return null;
  }
}

/**
 * Upsert this worker's heartbeat immediately, then every two seconds.
 * The timer cannot keep the process alive. The disposer removes the row so a
 * stopped worker disappears before the five-minute stale window.
 */
export function startWorkerHeartbeat({
  store,
  router,
  buildVersion = STATUS_BUILD_VERSION,
  inFlight = () => 0,
  intervalMs = WORKER_HEARTBEAT_MS,
} = {}) {
  if (typeof store?.writeWorkerLoad !== "function") return () => {};
  const tick = () => {
    try {
      store.writeWorkerLoad({
        worker: store.worker,
        host: hostname(),
        pid: process.pid,
        build_version: buildVersion,
        view_schema: 3,
        in_flight: inFlight(),
        catalog_ready: Boolean(router?.catalog?.ready),
        epoch: currentTokenEpoch(store),
        updated_at: Date.now(),
      });
    } catch {
      // A heartbeat failure must not stop request handling.
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    try {
      store.deleteWorkerLoad?.(store.worker);
    } catch {
      // The store may already be closed.
    }
  };
}

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
  const concurrencyProof = new ProviderConcurrencyProof({ store });
  const directInFlight = { open: 0 };

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
    buildVersion: STATUS_BUILD_VERSION,
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

  let stopHeartbeat = null;
  const heartbeat = {
    start() {
      stopHeartbeat ??= startWorkerHeartbeat({
        store,
        router,
        buildVersion: STATUS_BUILD_VERSION,
        inFlight: () => (router.concurrencyProof?.inFlight?.() ?? 0) + directInFlight.open,
      });
    },
    stop() {
      stopHeartbeat?.();
      stopHeartbeat = null;
    },
  };

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
    directInFlight,
    heartbeat,
    statusPage: createStatusPage({
      statusPath: config.statusPath ?? DEFAULT_STATUS_PATH,
      resetPath: DEFAULT_RESET_PATH,
      assetDir: config.statusAssetDir ?? null,
      statusView: () => router.statusView(),
    }),
  };
}

async function resetTokenTotals(request, { store, router, tokenPath, peerLoopback }) {
  const headers = { "cache-control": "no-store" };
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { ...headers, allow: "POST" } });
  }
  if (!resetTransportAllowed(request, peerLoopback)) {
    return Response.json({ error: "https_required" }, { status: 403, headers });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (
    request.headers.get("x-lazy-reset") !== "token-totals" ||
    !/^application\/json(?:\s*;.*)?$/i.test(contentType) ||
    !adminTokenMatches(request, tokenPath)
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }

  let resetId = "";
  try {
    const body = await readJson(request);
    resetId = typeof body?.resetId === "string" ? body.resetId.trim() : "";
  } catch {
    resetId = "";
  }
  if (resetId === "") return Response.json({ error: "bad_request" }, { status: 400, headers });

  let result;
  try {
    result = store?.resetTokenTotals?.({ resetId }) ?? null;
  } catch {
    result = null;
  }
  if (!result || typeof result !== "object") {
    return Response.json({ error: "counter_unavailable" }, { status: 503, headers });
  }
  if (result.conflict) {
    return Response.json({ error: "reset_conflict", epoch: result.epoch ?? null }, { status: 409, headers });
  }
  let tokenTotals = null;
  try {
    tokenTotals = router?.statusView?.().tokenTotals ?? null;
  } catch {
    tokenTotals = null;
  }
  return Response.json({ ok: true, epoch: result.epoch ?? null, tokenTotals }, { status: 200, headers });
}

/** The inbound middleware. The gateway handler is reached through next(). */
export function lazyRouterHandler({
  router,
  dispatcher,
  statusPage,
  credentials,
  config = {},
  paths = {},
  store,
  directInFlight,
}) {
  const statusPath = config.statusPath ?? DEFAULT_STATUS_PATH;
  const tokenPath = paths.gatewayTokenPath ?? join(homedir(), ".omp", "auth-gateway.token");
  const clientOnlyPrefix = config.clientOnlyPrefix ?? "";
  const configuredBasePath = normalizeStatusBasePath(config.statusBasePath);
  const openDirect = directInFlight ?? { open: 0 };
  // The gateway serves a provider only when its credential store has a row for
  // it (`credentials.snapshot()`). A models.yml provider is in the host model
  // registry but has no such row, so the custom-provider transport must own it
  // even though `nativeRegistered` sees the host entry. Read the provider set
  // once per minute; while the first read is pending the host catalog decides.
  const credentialProviders = { names: null, at: 0, pending: null };
  const credentialProviderNames = () => {
    if (credentialProviders.names && Date.now() - credentialProviders.at < 60_000) {
      return Promise.resolve(credentialProviders.names);
    }
    if (credentialProviders.pending) return credentialProviders.pending;
    const read = typeof credentials?.listProviders === "function" ? credentials.listProviders() : Promise.resolve([]);
    credentialProviders.pending = read
      .then((names) => {
        credentialProviders.names = new Set(Array.isArray(names) ? names : []);
        credentialProviders.at = Date.now();
        return credentialProviders.names;
      })
      .catch(() => {
        credentialProviders.names ??= new Set();
        credentialProviders.at = Date.now();
        return credentialProviders.names;
      })
      .finally(() => {
        credentialProviders.pending = null;
      });
    return credentialProviders.pending;
  };

  return async function lazyRouterInbound(request, server, next) {
    let pathname;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return next(request);
    }
    // Capture the peer from the socket-bearing request before any URL rewrite.
    // `server.requestIP()` returns null for a synthesized Request, which would
    // make a loopback reset look remote.
    const peerLoopback = requestPeerIsLoopback(request, server);
    const basePath = configuredBasePath || trustedForwardedPrefix(request, server, peerLoopback);
    const routePath = stripStatusBasePath(pathname, basePath);
    const inbound = routePath === pathname ? request : withStrippedPath(request, routePath);
    if (configuredBasePath !== "" && routePath === pathname && isStatusSurfacePath(routePath, statusPath)) {
      return notFoundResponse(request.method);
    }
    const nativeRoutable = (model) => {
      const { provider } = splitModelRef(model);
      if (credentialProviders.names && provider && !credentialProviders.names.has(provider)) return false;
      return router.catalog.host.has(model) || router.catalog.gateway.has(model);
    };
    const downstream = withExtensionFallback(
      withCustomProviderFallback((rewritten) => next(rewritten), {
        tokenPath,
        nativeRegistered: nativeRoutable,
      }),
      { credentials, tokenPath, nativeRegistered: nativeRoutable },
    );
    dispatcher.bind(downstream, server);

    if (routePath === RESET_TOKEN_TOTALS_PATH) {
      return resetTokenTotals(inbound, { store, router, tokenPath, peerLoopback });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const page = statusPage?.(request.method, routePath, { basePath });
      if (page) return page;
      if (routePath === statusPath) {
        const response = router.status();
        try {
          if (!response.headers.has("cache-control")) response.headers.set("cache-control", "no-store");
        } catch {
          // A response with immutable headers still carries the router's own cache policy.
        }
        return response;
      }
      if (routePath === MODELS_PATH) {
        const base = await next(inbound);
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

    if (inbound.method !== "POST") return next(inbound);
    await credentialProviderNames();
    const format = formatForPath(routePath);
    if (!format) return downstream(inbound, server);

    const body = await readJson(inbound);
    if (!body) return downstream(inbound, server);

    if (router.handles(body.model)) {
      return router.serve(format, body, inbound);
    }
    if (
      disallowedClientModelRequest({
        method: inbound.method,
        pathname: routePath,
        body,
        router,
        clientOnlyPrefix,
        supportedFormat: true,
      })
    ) {
      return forbiddenModelResponse();
    }

    const startedAt = Date.now();
    const epoch = currentTokenEpoch(store);
    openDirect.open += 1;
    let response;
    try {
      response = await downstream(inbound, server);
    } catch (error) {
      const safe = sanitizeDirectError(error, { report });
      if (!safe) throw error;
      return safe;
    } finally {
      openDirect.open = Math.max(0, openDirect.open - 1);
    }
    const safe = await sanitizeDirectResponse(response, { report });
    return router.catalog.hasNativeModel(body.model)
      ? router.measureDirect(body.model, safe, startedAt, inbound.signal, epoch)
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
  const { router, attemptLayer, accountDirectory, speed, store, heartbeat } = dependencies;

  try {
    const out = config.out ?? join(context?.paths?.logsDir ?? join(homedir(), ".omp", "logs"), "lazy-router.jsonl");
    mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  } catch {
    // A missing log directory only loses the event file.
  }

  accountDirectory.start();
  speed.start?.();
  heartbeat.start();
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
    heartbeat.stop();
    router.dispose();
    accountDirectory.stop();
    speed.stop?.();
    store.stop?.();
    store.close?.();
    dependencies.credentials.close?.();
  };
}
