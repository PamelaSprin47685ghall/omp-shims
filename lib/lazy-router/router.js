// The lazy router: picks the first alive candidate for a lazy/* request and
// fails over on the provider's first answer.
//
// Selection is "exhaust one, then the next": candidates are tried strictly in
// table order, skipping entries that are cooling or cannot serve the request
// (context below the floor, missing image input). There is no load balancing,
// so a recovered higher-priority unit wins traffic back on the next request.
//
// On a failed attempt the unit gets one tiny probe. A dead probe benches the
// (unit, model) pair and the request moves on at once; a live probe earns the
// same unit exactly one retry, and a second failure benches it after all.

import { STATUS_CODES } from "node:http";
import { Attempt } from "./attempt.js";
import { probeEffort, resolveEffort } from "./effort.js";
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
/** How long a request waits for the first account-tier pass after start-up. */
const TIER_WAIT_MS = 10_000;

/** A gateway rejection that says nothing about the unit (bad request, bad token). */
function isRequestRejection(outcome) {
  const { status } = outcome.verdict;
  return !outcome.upstreamContacted && status >= 400 && status < 500 && status !== 408 && status !== 429;
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
    emit,
    settings,
    now = () => new Date(),
  }) {
    Object.assign(this, { policy, units, schedule, catalog, health, dispatcher, faults, emit, settings, now });
    /** @type {Map<string, Promise<boolean>>} */
    this.probesInFlight = new Map();
    this.skipsReported = new Set();
    health.setProber((candidate) => this.probe(candidate));
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
      context_length: this.policy.contextWindow,
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

    let lastFailure;
    for (const candidate of candidates) {
      const traits = this.#eligibleTraits(candidate, needs);
      if (!traits || !this.health.isAlive(candidateKey(candidate))) continue;

      const effort = resolveEffort({ policy: candidate.effort, requested, traits });
      const payload = rewriteBody(format, body, {
        model: candidate.model,
        effort,
        maxTokens: this.policy.maxOutputTokens,
      });
      const where = { route, period: clock.period, unit: candidate.unit.label, model: candidate.model };
      this.emit("route", {
        ...where,
        format: format.name,
        requestedEffort: requested ?? null,
        effort: effort ?? null,
        maxTokens: this.policy.maxOutputTokens,
        stream: body.stream === true,
      });

      const first = await this.#attempt(candidate, traits, format, request, payload);
      if (first.verdict.ok) return this.#served(where, first, candidate);
      if (isRequestRejection(first)) return this.#rejected(where, first);
      lastFailure = { candidate, verdict: first.verdict };
      this.emit("attempt-failed", { ...where, try: 1, ...this.#describe(first.verdict) });

      if (await this.probe(candidate, traits)) {
        this.emit("retry-same-unit", where);
        const retry = await this.#attempt(candidate, traits, format, request, payload);
        if (retry.verdict.ok) return this.#served(where, retry, candidate);
        lastFailure = { candidate, verdict: retry.verdict };
        this.emit("attempt-failed", { ...where, try: 2, ...this.#describe(retry.verdict) });
      }
      this.health.markDead(candidateKey(candidate), sanitizedReason(lastFailure.verdict), candidate);
    }
    return this.#exhausted(format, route, clock.period, lastFailure);
  }

  /**
   * Send the liveness probe to a candidate. Concurrent probes of the same
   * (unit, model) share one request.
   * @returns {Promise<boolean>} true when the unit answered 200
   */
  probe(candidate, traits = this.catalog.find(candidate.model)) {
    const key = candidateKey(candidate);
    const running = this.probesInFlight.get(key);
    if (running) return running;
    const probe = this.#runProbe(candidate, traits).finally(() => this.probesInFlight.delete(key));
    this.probesInFlight.set(key, probe);
    return probe;
  }

  /**
   * The public status view. It names units by label (provider, tier, ordinal)
   * and failures by status code only: no account ids, e-mails, keys or
   * upstream error text, so it is safe to serve without the gateway token.
   */
  status() {
    const clock = this.schedule.at(this.now());
    const routes = {};
    for (const name of this.policy.routeNames) {
      const { candidates, require } = this.policy.candidates(name, clock.period, this.units);
      routes[name] = candidates.map((candidate) => {
        const traits = this.catalog.find(candidate.model);
        return {
          unit: candidate.unit.label,
          model: candidate.model,
          effortPolicy: candidate.effort,
          eligible: Boolean(traits && this.#fits(traits, new Set(require))),
          ...this.#healthView(candidate),
        };
      });
    }
    return jsonResponse(200, {
      now: this.now().toISOString(),
      period: clock.period,
      clock,
      catalogReady: this.catalog.ready,
      units: this.units.all().map((unit) => ({
        unit: unit.label,
        provider: unit.provider,
        tier: unit.tier ?? null,
        pinned: unit.credentialId !== undefined,
      })),
      routes,
      ...(this.faults.active ? { testFaults: true } : {}),
    });
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

  async #runProbe(candidate, traits) {
    const body = probeBody({
      model: candidate.model,
      effort: probeEffort(traits),
      maxTokens: this.settings.probeMaxTokens,
      prompt: this.settings.probePrompt,
    });
    const attempt = this.#newAttempt(candidate, traits, FAULT_KIND.PROBE);
    const started = Date.now();
    const outcome = await this.dispatcher.run(attempt, this.dispatcher.internalRequest(PROBE_PATH, body), {
      format: formatForPath(PROBE_PATH),
      headerTimeoutMs: this.settings.probeTimeoutMs,
    });
    // Drain the probe's answer so the gateway finishes the call cleanly.
    await outcome.response?.text().catch(() => "");
    const alive = outcome.verdict.ok;
    this.emit("probe", {
      unit: candidate.unit.label,
      model: candidate.model,
      alive,
      effort: body.reasoning_effort ?? null,
      ms: Date.now() - started,
      ...(alive ? {} : this.#describe(outcome.verdict)),
    });
    return alive;
  }

  #attempt(candidate, traits, format, request, payload) {
    const attempt = this.#newAttempt(candidate, traits, FAULT_KIND.REQUEST);
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    const replay = new Request(request.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    return this.dispatcher.run(attempt, replay, { format, headerTimeoutMs: this.#headerTimeout(candidate) });
  }

  #newAttempt(candidate, traits, faultKind) {
    return new Attempt({
      unit: candidate.unit,
      model: candidate.model,
      upstreamHost: this.#upstreamHost(candidate.unit.provider, traits),
      fault: this.faults.take(candidate.unit.label, faultKind),
    });
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
  #eligibleTraits(candidate, needs) {
    const traits = this.catalog.find(candidate.model);
    if (traits && this.#fits(traits, needs)) return traits;
    if (!traits) this.#reportSkip(candidate, "model not routable on this gateway");
    else if (traits.contextWindow < this.policy.contextWindow) {
      this.#reportSkip(candidate, `context ${traits.contextWindow} < ${this.policy.contextWindow}`);
    }
    return undefined;
  }

  #fits(traits, needs) {
    if (traits.contextWindow < this.policy.contextWindow) return false;
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

  #served(where, outcome, candidate) {
    this.emit("served", { ...where, status: outcome.response.status, via: outcome.verdict.source });
    if (candidate.unit.credentialId !== undefined && !outcome.upstreamContacted) {
      // The provider call bypassed the fetch layer, so the account pin could not be applied.
      this.emit("pin-unverified", where);
    }
    return decorate(outcome.response, candidate);
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
    const { candidate, verdict } = lastFailure;
    this.emit("exhausted", { route, period, lastUnit: candidate.unit.label, ...this.#describe(verdict) });
    const status = verdict.status >= 400 ? verdict.status : FALLBACK_ERROR_STATUS;
    const message = `lazy/${route}: all candidates failed; last was ${candidate.unit.label} ${candidate.model} (${verdict.status}): ${verdict.message ?? ""}`;
    return jsonResponse(status, format.errorBody(message, "upstream_error"));
  }

  #describe(verdict) {
    return { status: verdict.status, source: verdict.source, error: (verdict.message ?? "").slice(0, 300) };
  }
}
