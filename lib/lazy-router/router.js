// The lazy router: ranks alive candidates online and
// fails over on the provider's first answer.
//
// Selection is "exhaust one, then the next": candidates are tried strictly in
// table order, skipping entries that are cooling or cannot serve the request
// (context below the floor, missing image input). There is no load balancing,
// so a recovered higher-priority unit wins traffic back with the next new
// conversation (an ongoing one stays where its prompt cache is).
//
// A failed attempt is handled by whose fault it was (failures.js). A client
// that went away ends the request on the spot and never counts against the
// unit. A connection that died before any answer is retried at once on a
// fresh one. An exhausted quota benches the (unit, model) pair without a
// probe. Any other failure earns the unit one tiny probe: a dead probe benches
// it and the request moves on at once; a live probe earns the same unit
// exactly one retry, and a second failure benches it after all.
//
// Two things refine the order per request. Prefix affinity (affinity.js) moves
// the unit that last served this conversation to the front, so its prompt
// cache keeps paying off. And a unit whose provider limits concurrency
// (capacity.js) is skipped while its slots are full, or when the request
// benefits less from its cache than the requests it has recently seen
// (admission.js); an unlimited unit is never held back.

import { STATUS_CODES } from "node:http";
import { AdmissionControl } from "./admission.js";
import { PrefixAffinity } from "./affinity.js";
import { measureStream, ModelPerf } from "./perf.js";
import { rankCandidates } from "./ranking.js";
import { Attempt } from "./attempt.js";
import { PERIOD } from "./calendar.js";
import { canonicalBytes } from "./canonical.js";
import { InFlightTracker } from "./capacity.js";
import { pinsAtTransport } from "./credentials.js";
import { probeEffort, resolveEffort } from "./effort.js";
import { CLIENT_CLOSED_STATUS, classifyFailure, FAILURE, requestContextRequirement } from "./failures.js";
import { FAULT_KIND } from "./faults.js";
import { containsImage, formatForPath, probeBody, rewriteBody } from "./formats.js";
import { HEALTH, healthKey } from "./health.js";
import { LAZY_PREFIX } from "./policy.js";

/** Path the probe is sent to: chat completions is understood by every provider behind the gateway. */
const PROBE_PATH = "/v1/chat/completions";

/** Response headers that tell a client which unit served it. */
export const SERVED_BY_HEADERS = Object.freeze({ unit: "x-lazy-router-unit", model: "x-lazy-router-model" });

const NO_CANDIDATE_STATUS = 503;
const FALLBACK_ERROR_STATUS = 502;
const MINUTE_MS = 60_000;
/** How long a request waits for the first account-tier pass after start-up. */
const TIER_WAIT_MS = 10_000;
/** Qoder hard lane capacity can recover at any moment; recheck quickly, then back off. */
const QODER_CAPACITY_INITIAL_PROBE_MS = 60_000;
const QODER_CAPACITY_PROBE_BACKOFF = 2;

/** A narrow recovery policy for Qoder's transient hard-capacity lane response. */
export function qoderCapacityProbeOptions(candidate, verdict, defaultProbeIntervalMs) {
  if (candidate?.unit?.provider !== "qoder" && candidate?.unit?.provider !== "qoder-cn") return undefined;
  const message = verdict?.message ?? "";
  if (!/serviceAvailable\s*:\s*false/i.test(message) || !/\bRESOURCE_LIMIT\b/i.test(message)) return undefined;
  const maxProbeIntervalMs = Math.max(1, defaultProbeIntervalMs);
  return {
    probeIntervalMs: Math.min(QODER_CAPACITY_INITIAL_PROBE_MS, maxProbeIntervalMs),
    probeBackoff: QODER_CAPACITY_PROBE_BACKOFF,
    maxProbeIntervalMs,
  };
}

/** A rejection that belongs to request conversion rather than candidate health. */
function isGatewayRequestRejection(outcome) {
  const { status, message = "" } = outcome.verdict;
  const clientStatus = status >= 400 && status < 500 && status !== 408 && status !== 429;
  if (!clientStatus) return false;
  if (!outcome.upstreamContacted) return true;
  // Preserve the narrow Gemini conversion safeguard: this is our malformed
  // native payload, so trying another model would hide a gateway bug.
  return /GenerateContentRequest\.contents: contents is not specified/i.test(message);
}

/** Same response, plus the served-by headers. */
function decorate(response, candidate) {
  const headers = new Headers(response.headers);
  headers.set(SERVED_BY_HEADERS.unit, candidate.unit.label);
  headers.set(SERVED_BY_HEADERS.model, candidate.model);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** The dialect's event classifier, or undefined for a caller that has none. */
function classifierOf(format) {
  return typeof format?.classifyEvent === "function" ? (event) => format.classifyEvent(event) : undefined;
}

/** Whether an SSE event carries generated output, distinct from liveness-only usage/final frames. */
function outputClassifierOf(format) {
  return typeof format?.isOutputEvent === "function" ? (event) => format.isOutputEvent(event) : undefined;
}

/** Health key of a candidate: internal unit key plus model, never shown. */
function candidateKey(candidate) {
  return healthKey(candidate.unit.key, candidate.model);
}

/** "upstream 429 Too Many Requests": what failed, without any upstream text. */
export function sanitizedReason(verdict) {
  const text = STATUS_CODES[verdict.status];
  return `${verdict.source} ${verdict.status}${text ? ` ${text}` : ""}`;
}

export class LazyRouter {
  /**
   * @param {{
   *   policy: import("./policy.js").RoutePolicy,
   *   units: import("./units.js").UnitDirectory,
   *   schedule: import("./calendar.js").PeakSchedule,
   *   catalog: import("./catalog.js").ModelCatalog,
   *   health: import("./health.js").HealthRegistry,
   *   dispatcher: import("./dispatcher.js").GatewayDispatcher,
   *   faults: import("./faults.js").FaultInjector,
   *   affinity?: import("./affinity.js").PrefixAffinity,
   *   capacity?: import("./capacity.js").InFlightTracker,
   *   admission?: import("./admission.js").AdmissionControl,
   *   credentials?: {resolve: (id: number) => Promise<{secret: string}|undefined>},
   *   emit: (event: string, detail?: object) => void,
   *   settings: {probePrompt: string, probeMaxTokens: number, probeTimeoutMs: number,
   *     headerTimeoutMs: number, providerHeaderTimeoutMs: Record<string, number>,
   *     upstreamHosts: Record<string, string>},
   *   now?: () => Date,
   * }} deps
   */
  constructor({
    policy,
    units,
    schedule,
    catalog,
    health,
    dispatcher,
    faults,
    affinity = new PrefixAffinity(),
    perf = new ModelPerf({ now: () => Date.now() }),
    capacity = new InFlightTracker({ limitOf: (unit) => policy.maxInFlight(unit) }),
    admission = new AdmissionControl(),
    credentials,
    emit,
    settings,
    now = () => new Date(),
  }) {
    Object.assign(this, { policy, units, schedule, catalog, health, dispatcher, faults, emit, settings, now });
    Object.assign(this, { affinity, capacity, admission, credentials, perf });
    /** @type {Map<string, Promise<boolean>>} */
    this.probesInFlight = new Map();
    this.skipsReported = new Set();
    health.setProber((candidate) => this.probe(candidate, undefined, { background: true }));
  }

  /** True when `model` names a lazy route. */
  handles(model) {
    return this.policy.routeFor(model) !== undefined;
  }

  /** /v1/models entries for the lazy routes. */
  advertisedModels() {
    return this.policy.routeNames.map((name) => ({
      id: `${LAZY_PREFIX}${name}`,
      object: "model",
      owned_by: "lazy-router",
      api: "openai-completions",
      display_name: this.policy.routes[name]?.displayName ?? `Lazy ${name}`,
      input_modalities: this.policy.inputOf(name),
      context_length: this.policy.contextWindowOf(name),
      max_output_tokens: this.policy.maxOutputTokens,
    }));
  }

  /**
   * Serve one lazy request.
   * @param {object} format adapter from formats.js
   * @param {object} body parsed client body
   * @param {Request} request the client's request (headers, URL, abort signal)
   */
  async serve(format, body, request) {
    await Promise.all([this.#ensureCatalog(), this.units.ready(TIER_WAIT_MS)]);
    const route = this.policy.routeFor(body.model);
    const clock = this.schedule.at(this.now());
    const { candidates, require } = this.policy.candidates(route, clock.period, this.units);
    const needs = new Set([...require, ...(containsImage(format.conversation(body)) ? ["image"] : [])]);
    const requested = format.readEffort(body);
    const transcript = canonicalBytes(format.transcript(body));
    const match = this.affinity.lookup(transcript);
    const context = { route, period: clock.period, format, body, request, requested, transcript, match, startedAt: Date.now() };
    const ranked = rankCandidates(candidates, {
      perf: this.perf.routingView(clock.period),
      cachedShare: (candidate) => this.#cachedShare(candidate, match),
      cachedBytes: (candidate) => this.#cachedBytes(candidate, match),
      // A warm unit that is already unavailable should not suppress exploration
      // among the alternatives. Capacity is safe to inspect here; admission is
      // intentionally left for #claimSlot because evaluating it records traffic.
      affinityAvailable: (candidate) => {
        if (!this.health.isAlive(candidateKey(candidate))) return false;
        const limit = this.policy.maxInFlight(candidate.unit);
        return limit === 0 || this.capacity.hasRoom(candidate.unit);
      },
      settings: this.settings.routing,
    });

    let lastFailure;
    const rejectedModels = new Set();
    let minimumContext = this.policy.contextWindowOf(route);
    for (const { candidate, routing } of ranked) {
      context.routing = routing;
      if (request.signal?.aborted) return this.#clientGone(format, { route, period: clock.period });
      if (rejectedModels.has(candidate.model)) continue;
      const traits = this.#eligibleTraits(candidate, needs, minimumContext);
      if (!traits || !this.health.isAlive(candidateKey(candidate))) continue;
      const slot = this.#claimSlot(candidate, context);
      if (!slot) continue;
      const result = await this.#serveWith(candidate, traits, slot, context);
      if (result.response) return result.response;
      lastFailure = result.failure;
      if (result.failure?.kind === FAILURE.REQUEST) {
        rejectedModels.add(candidate.model);
        minimumContext = Math.max(
          minimumContext,
          requestContextRequirement(result.failure.verdict.message),
        );
      }
    }
    return this.#exhausted(format, route, clock.period, lastFailure);
  }

  /**
   * One candidate's turn: the attempt and, depending on how it failed, at most
   * one recovery (an immediate retry on a fresh connection, or a probe and one
   * retry). Every slot that does not end up carrying the served response is
   * released here.
   * @returns {Promise<{response?: Response, failure?: {candidate: object, verdict: object}}>}
   */
  async #serveWith(candidate, traits, slot, context) {
    const { route, period, format, body, request, requested, match } = context;
    const effort = resolveEffort({ policy: candidate.effort, requested, traits });
    const payload = rewriteBody(format, body, {
      model: candidate.model,
      effort,
      maxTokens: this.policy.maxOutputTokens,
    });
    const where = { route, period, unit: candidate.unit.label, model: candidate.model };
    this.emit("route", {
      ...where,
      format: format.name,
      requestedEffort: requested ?? null,
      effort: effort ?? null,
      maxTokens: this.policy.maxOutputTokens,
      stream: body.stream === true,
      affinity: match.best?.unitKey === candidate.unit.key,
      cachedShare: this.#cachedShare(candidate, match),
      cachedBytes: this.#cachedBytes(candidate, match),
      affinityStickiness: context.routing?.affinityStickiness ?? 0,
      affinityLockStickiness: context.routing?.affinityLockStickiness ?? 0,
      routingScore: context.routing?.score ?? null,
      selectionScore: context.routing?.selectionScore ?? null,
      posteriorDraw: context.routing?.posteriorDraw ?? null,
      temperature: context.routing?.temperature ?? 0,
      effectiveTemperature: context.routing?.effectiveTemperature ?? 0,
      intelligence: candidate.intelligence ?? "medium",
      rating: context.routing?.rating ?? null, rd: context.routing?.rd ?? null,
    });

    const attempt = (attemptSlot) => this.#attempt(candidate, traits, format, request, payload, attemptSlot);
    let attemptSlot = slot;
    let attemptStartedAt = Date.now();
    let outcome = await attempt(attemptSlot);
    for (let tries = 1; ; tries += 1) {
      if (outcome.verdict.ok) {
        return { response: this.#served(where, outcome, candidate, attemptSlot, context, attemptStartedAt) };
      }
      attemptSlot.releaseAll();
      const kind = classifyFailure(outcome, request.signal);
      if (kind === FAILURE.CLIENT_GONE) return { response: this.#clientGone(format, where, tries) };
      if (tries === 1 && isGatewayRequestRejection(outcome)) return { response: this.#rejected(where, outcome) };
      this.emit("attempt-failed", { ...where, try: tries, failure: kind, ...this.#describe(outcome.verdict) });
      if (kind === FAILURE.REQUEST) {
        return { failure: { candidate, verdict: outcome.verdict, kind } };
      }

      const recovery = tries === 1 ? await this.#recovery(kind, candidate, traits) : undefined;
      if (!recovery) {
        this.#bench(candidate, kind, outcome.verdict);
        return { failure: { candidate, verdict: outcome.verdict, kind } };
      }
      // A probe takes time; the client may have left meanwhile.
      if (request.signal?.aborted) return { response: this.#clientGone(format, where, tries) };
      this.emit(recovery, where);
      // The retry is owed to this unit, so it reserves past the gates.
      attemptSlot = this.capacity.slot(candidate.unit);
      attemptStartedAt = Date.now();
      outcome = await attempt(attemptSlot);
    }
  }

  /**
   * How to recover from a first failure: the event naming the retry, or
   * undefined when the unit should be benched at once.
   */
  async #recovery(kind, candidate, traits) {
    switch (kind) {
      case FAILURE.STALE_CONNECTION:
        return "retry-fresh-connection";
      case FAILURE.QUOTA:
        return undefined;
      default:
        return (await this.probe(candidate, traits)) ? "retry-same-unit" : undefined;
    }
  }

  /** Cool a (unit, model) pair; an exhausted quota says so in the reason. */
  #bench(candidate, kind, verdict) {
    const reason = sanitizedReason(verdict);
    const probeOptions =
      kind === FAILURE.QUOTA
        ? qoderCapacityProbeOptions(candidate, verdict, this.health.probeIntervalMs)
        : undefined;
    this.health.markDead(
      candidateKey(candidate),
      kind === FAILURE.QUOTA ? `quota: ${reason}` : reason,
      candidate,
      probeOptions,
    );
  }

  /**
   * The slot a candidate serves this request in, or undefined when a limited
   * unit holds the request back: admission first (every evaluated request
   * counts towards the unit's window), then the hard in-flight limit.
   */
  #claimSlot(candidate, { route, match }) {
    const { unit } = candidate;
    const limit = this.policy.maxInFlight(unit);
    if (limit === 0) return this.capacity.slot(unit);
    const share = this.#cachedShare(candidate, match);
    const where = { route, unit: unit.label, model: candidate.model, cachedShare: share };
    const admission = this.admission.evaluate(unit.key, share, limit);
    if (!admission.admitted) {
      this.emit("held-back", {
        ...where,
        reason: "admission",
        threshold: admission.threshold,
        window: admission.window,
      });
      return undefined;
    }
    if (!this.capacity.hasRoom(unit)) {
      this.emit("held-back", {
        ...where,
        reason: "capacity",
        inFlight: this.capacity.inFlight(unit),
        maxInFlight: limit,
      });
      return undefined;
    }
    return this.capacity.slot(unit);
  }

  /** Share of this request the candidate's unit has recently seen as a prefix (0 … <1). */
  #cachedShare(candidate, match) {
    return match.size ? (match.byUnit.get(candidate.unit.key) ?? 0) / match.size : 0;
  }

  /** Absolute matched warm-prefix bytes for the candidate's unit. */
  #cachedBytes(candidate, match) {
    return match.byUnit.get(candidate.unit.key) ?? 0;
  }

  /**
   * Send the liveness probe to a candidate. Concurrent probes of the same
   * (unit, model) share one request.
   * @returns {Promise<boolean>} true when the unit answered 200
   */
  probe(candidate, traits = this.catalog.find(candidate.model), { background = false } = {}) {
    const key = candidateKey(candidate);
    const running = this.probesInFlight.get(key);
    if (running) return running;
    const probe = this.#runProbe(candidate, traits, { background }).finally(() => this.probesInFlight.delete(key));
    this.probesInFlight.set(key, probe);
    return probe;
  }

  /**
   * The public status view. It names units by label (provider, tier, ordinal)
   * and failures by status code only: no account ids, e-mails, keys or
   * upstream error text, so it is safe to serve without the gateway token.
   */
  status() {
    return jsonResponse(200, this.statusView());
  }

  /**
   * Measure a request the router does not serve itself: a direct model id still
   * contributes its latency and speed to the model's window, so the page covers
   * every model in use, not only the routed ones.
   * @param {string} model provider-qualified model id from the request body
   * @param {Response} response the gateway's answer
   * @param {number} startedAt when the request reached the shim
   */
  measureDirect(model, response, startedAt, format, signal) {
    if (typeof model !== "string" || model.length === 0) return response;
    const period = this.schedule.at(new Date(startedAt)).period;
    return measureStream({
      model,
      startedAt,
      period,
      perf: this.perf,
      classify: classifierOf(format),
      isOutput: outputClassifierOf(format),
      signal,
    })(response);
  }

  /** The status data itself (shared by the JSON endpoint and the page). */
  statusView() {
    const now = this.now();
    const clock = this.schedule.at(now);
    const next = this.#nextSwitch(now);
    const alternate = clock.period === PERIOD.PEAK ? PERIOD.OFF_PEAK : PERIOD.PEAK;
    return {
      now: now.toISOString(),
      period: clock.period,
      clock,
      nextSwitch: next ? { at: next.at.toISOString(), period: next.period } : null,
      catalogReady: this.catalog.ready,
      units: this.units.all().map((unit) => ({
        unit: unit.label,
        provider: unit.provider,
        tier: unit.tier ?? null,
        pinned: unit.credentialId !== undefined,
        ...this.#loadView(unit),
      })),
      affinity: this.affinity.view(),
      perf: this.#perfView(clock.period),
      routes: this.#routeViews(clock.period),
      alternate: { period: alternate, routes: this.#routeViews(alternate) },
      ...(this.faults.active ? { testFaults: true } : {}),
    };
  }

  /** The rolling performance view used by routing and the status page. */
  #perfView(period) { return this.perf.view(period); }

  /** Candidate views of every route for one period. */
  #routeViews(period) {
    const routes = {};
    const perf = this.perf.routingView(period);
    for (const name of this.policy.routeNames) {
      const { candidates, require } = this.policy.candidates(name, period, this.units);
      const needs = new Set(require);
      const minimumContext = this.policy.contextWindowOf(name);
      const views = [];
      const ranked = rankCandidates(candidates, { perf, settings: { ...this.settings.routing, temperature: 0 } });
      for (const { candidate, routing } of ranked) {
        const traits = this.catalog.find(candidate.model);
        const eligible = Boolean(traits && this.#fits(traits, needs, minimumContext));
        // A unit that cannot serve this route (no image input, context too
        // small, not routable) is not part of it; list it only while the
        // catalog is still unknown and eligibility cannot be judged.
        if (!eligible && this.catalog.ready) continue;
        views.push({
          unit: candidate.unit.label,
          model: candidate.model,
          effortPolicy: candidate.effort,
          eligible,
          intelligence: candidate.intelligence ?? "medium",
          routingScore: routing.score,
          rating: routing.rating,
          rd: routing.rd,
          ...this.#healthView(candidate),
          ...this.#loadView(candidate.unit),
        });
      }
      routes[name] = views;
    }
    return routes;
  }

  /** The next period switch, computed at most once a minute. */
  #nextSwitch(now) {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (this.switchCache?.minute !== minute) {
      this.switchCache = { minute, next: this.schedule.nextSwitch?.(now) };
    }
    return this.switchCache.next;
  }

  /** In-flight load of a limited unit; nothing for an unlimited one. */
  #loadView(unit) {
    const maxInFlight = this.policy.maxInFlight(unit);
    if (maxInFlight === 0) return {};
    return {
      inFlight: this.capacity.inFlight(unit),
      maxInFlight,
      recentRequests: this.admission.windowCount(unit.key),
    };
  }

  #healthView(candidate) {
    const entry = this.health.entry(candidateKey(candidate));
    if (!entry || entry.state !== HEALTH.COOLING) return { health: HEALTH.ALIVE };
    return {
      health: HEALTH.COOLING,
      coolingSince: new Date(entry.since).toISOString(),
      reason: entry.reason,
      nextProbeAt: entry.nextProbeAt ? new Date(entry.nextProbeAt).toISOString() : null,
    };
  }

  async #runProbe(candidate, traits, { background = false } = {}) {
    const body = probeBody({
      model: candidate.model,
      effort: probeEffort(traits),
      maxTokens: this.settings.probeMaxTokens,
      prompt: this.settings.probePrompt,
    });
    // A probe is provider traffic too: counted against the unit, never gated.
    const slot = this.capacity.slot(candidate.unit, { reserve: false });
    const attempt = await this.#newAttempt(candidate, traits, FAULT_KIND.PROBE, body.reasoning_effort, slot);
    const started = Date.now();
    const outcome = await this.dispatcher.run(attempt, this.dispatcher.internalRequest(PROBE_PATH, body), {
      format: formatForPath(PROBE_PATH),
      headerTimeoutMs: this.settings.probeTimeoutMs,
    });
    // Drain the probe's answer so the gateway finishes the call cleanly.
    await outcome.response?.text().catch(() => "");
    slot.releaseAll();
    const alive = outcome.verdict.ok;
    if (!background) {
      this.emit("probe", {
        unit: candidate.unit.label,
        model: candidate.model,
        alive,
        effort: body.reasoning_effort ?? null,
        ms: Date.now() - started,
        ...(alive ? {} : this.#describe(outcome.verdict)),
      });
    }
    return alive;
  }

  async #attempt(candidate, traits, format, request, payload, slot) {
    try {
      const attempt = await this.#newAttempt(candidate, traits, FAULT_KIND.REQUEST, format.readEffort(payload), slot);
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const replay = new Request(request.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: request.signal,
      });
      return await this.dispatcher.run(attempt, replay, { format, headerTimeoutMs: this.#headerTimeout(candidate) });
    } catch (error) {
      slot.releaseAll();
      throw error;
    }
  }

  async #newAttempt(candidate, traits, faultKind, effort, slot) {
    const attempt = new Attempt({
      unit: candidate.unit,
      model: candidate.model,
      effort,
      slot,
      upstreamHost: this.#upstreamHost(candidate.unit.provider, traits),
      fault: this.faults.take(candidate.unit.label, faultKind),
    });
    const { credentialId, provider } = candidate.unit;
    if (credentialId !== undefined && pinsAtTransport(provider)) {
      attempt.transportSecret = (await this.credentials?.resolve(credentialId))?.secret;
    }
    return attempt;
  }

  #upstreamHost(provider, traits) {
    const configured = this.settings.upstreamHosts[provider];
    if (configured) return configured;
    try {
      return traits?.baseUrl ? new URL(traits.baseUrl).hostname : undefined;
    } catch {
      return undefined;
    }
  }

  #headerTimeout(candidate) {
    return this.settings.providerHeaderTimeoutMs[candidate.unit.provider] ?? this.settings.headerTimeoutMs;
  }

  /** Traits for a candidate that can serve this request, or undefined (reported once per reason). */
  #eligibleTraits(candidate, needs, minimumContext = this.policy.contextWindow) {
    const traits = this.catalog.find(candidate.model);
    if (traits && traits.contextWindow >= minimumContext && this.#fits(traits, needs, minimumContext)) return traits;
    if (!traits) this.#reportSkip(candidate, "model not routable on this gateway");
    else if (traits.contextWindow < minimumContext) {
      this.#reportSkip(candidate, `context ${traits.contextWindow} < required ${minimumContext}`);
    }
    return undefined;
  }

  #fits(traits, needs, minimumContext = this.policy.contextWindow) {
    if (traits.contextWindow < minimumContext) return false;
    return [...needs].every((modality) => traits.input.includes(modality));
  }

  #reportSkip(candidate, reason) {
    const key = `${candidate.unit.label} ${candidate.model} ${reason}`;
    if (this.skipsReported.has(key)) return;
    this.skipsReported.add(key);
    this.emit("skip", { unit: candidate.unit.label, model: candidate.model, reason });
  }

  /** The gateway only reveals its registry once it has used it; ask for the model list once if needed. */
  async #ensureCatalog() {
    if (this.catalog.ready || !this.dispatcher.ready) return;
    const response = await this.dispatcher.forward(this.dispatcher.internalRequest("/v1/models"));
    await response?.body?.cancel().catch(() => {});
  }

  #served(where, outcome, candidate, slot, context, startedAt) {
    const { request, transcript } = context;
    this.emit("served", { ...where, status: outcome.response.status, via: outcome.verdict.source });
    if (candidate.unit.credentialId !== undefined && !outcome.upstreamContacted) {
      // The provider call bypassed the fetch layer, so the account pin could not be applied.
      this.emit("pin-unverified", where);
    }
    this.affinity.record(transcript, candidate.unit.key);
    const measured = measureStream({
      model: candidate.model,
      startedAt,
      period: context.period,
      perf: this.perf,
      classify: classifierOf(context.format),
      isOutput: outputClassifierOf(context.format),
      signal: request.signal,
    })(outcome.response);
    return slot.settleWith(decorate(measured, candidate), request.signal);
  }

  /** The client closed the request: stop here, blame nobody. */
  #clientGone(format, where, tries) {
    this.emit("client-gone", { ...where, ...(tries ? { afterTry: tries } : {}) });
    return jsonResponse(CLIENT_CLOSED_STATUS, format.errorBody("client closed request", "request_aborted"));
  }

  #rejected(where, outcome) {
    this.emit("rejected", { ...where, ...this.#describe(outcome.verdict) });
    return new Response(outcome.verdict.message ?? "", {
      status: outcome.verdict.status,
      headers: { "content-type": "application/json" },
    });
  }

  #exhausted(format, route, period, lastFailure) {
    if (!lastFailure) {
      this.emit("exhausted", { route, period, reason: "no alive candidate" });
      const message = `lazy/${route}: every candidate is cooling or unavailable; see /v1/lazy/status for the next probe times`;
      return jsonResponse(NO_CANDIDATE_STATUS, format.errorBody(message, "lazy_router_unavailable"));
    }
    const { candidate, verdict, kind } = lastFailure;
    this.emit("exhausted", { route, period, lastUnit: candidate.unit.label, failure: kind, ...this.#describe(verdict) });
    if (kind === FAILURE.REQUEST) {
      const message = `lazy/${route}: request is incompatible with available models; last rejection was ${candidate.model}: ${verdict.message ?? ""}`;
      return jsonResponse(400, format.errorBody(message, "invalid_request_error"));
    }
    const status = verdict.status >= 400 ? verdict.status : FALLBACK_ERROR_STATUS;
    const message = `lazy/${route}: all candidates failed; last was ${candidate.unit.label} ${candidate.model} (${verdict.status}): ${verdict.message ?? ""}`;
    return jsonResponse(status, format.errorBody(message, "upstream_error"));
  }

  #describe(verdict) {
    return { status: verdict.status, source: verdict.source, error: (verdict.message ?? "").slice(0, 300) };
  }
}
