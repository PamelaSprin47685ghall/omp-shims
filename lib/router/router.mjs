// The lazy router: ranks alive candidates and fails over on the provider's
// first answer.
//
// Selection is "exhaust one, then the next": candidates are tried in ranked
// order, skipping entries that are cooling or cannot serve the request. Prefix
// affinity moves the unit that last served the conversation to the front.
// A limited unit is skipped while its slots are full, or when admission keeps
// its slots for requests with a warmer prefix.
//
// A failed attempt is handled by whose fault it was (failures.mjs). A client
// that went away ends the request on the spot and never counts against the
// unit. A connection that died before an answer is retried at once on a fresh
// connection. Exhausted quota benches the (unit, model) pair without a probe.
// Any other failure earns the unit one probe: a dead probe benches it, a live
// probe earns one retry, and a busy probe benches nothing.

import { randomBytes } from "node:crypto";
import { STATUS_CODES } from "node:http";
import { hostname } from "node:os";
import { PROBE_STATE, report } from "../contracts.mjs";
import { refreshExtensionProviders } from "../host-bridge.mjs";
import { withBody } from "../inbound.mjs";
import { createSseScanner, isEventStream, parseSseFrame, rebuildResponse } from "../sse.mjs";
import { AdmissionControl } from "./admission.mjs";
import { AFFINITY_WINDOW_MINUTES, PrefixAffinity } from "./affinity.mjs";
import { Attempt, VERDICT_SOURCE } from "./attempt.mjs";
import { canonicalBytes, prefixDigests } from "./canonical.mjs";
import { InFlightTracker } from "./capacity.mjs";
import { CyclicSpeed } from "./cyclic-speed.mjs";
import { GatewayDispatcher } from "./dispatcher.mjs";
import { probeEffort, resolveEffort } from "./effort.mjs";
import { CLIENT_CLOSED_STATUS, classifyFailure, FAILURE, requestContextRequirement } from "./failures.mjs";
import { FAULT_KIND } from "./faults.mjs";
import { containsImage, formatForPath, probeBody, rewriteBody } from "./formats.mjs";
import { ModelPerf, PERF_WINDOW_MINUTES } from "./perf.mjs";
import { rewriteResponseModel } from "./protocol-codec.mjs";
import { buildSnapshot } from "./status-page/snapshot.mjs";
import { buildAccountIndex, releaseWhenSettled, unitFor } from "./units.mjs";

const NO_CANDIDATE_STATUS = 503;
const SHORT_COOLDOWN_MS = 30_000;
const LONG_COOLDOWN_MS = 1_800_000;
const BUSY_PROBE_MS = 60_000;
const MINUTE_MS = 60_000;
const TIER_WAIT_MS = 16_000;
const PROBE_LEASE_MS = 180_000;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
/** A JSON usage tail is bounded; the whole body is never buffered. */
const USAGE_JSON_TAIL_CHARS = 64 * 1024;

/**
 * Cloud Code hosts OMP uses for google-antigravity. models.db may record any
 * one of them, while the plugin transport may call another; the pin and the
 * verdict must match either way.
 */
const ANTIGRAVITY_HOSTS = Object.freeze(["cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com"]);

/** Response headers that tell a client which unit served it. */
export const SERVED_BY_HEADERS = Object.freeze({
  unit: "x-lazy-router-unit",
  model: "x-lazy-router-model",
});

/** "upstream 429 Too Many Requests": what failed, without any upstream text. */
export function sanitizedReason(verdict) {
  const text = STATUS_CODES[verdict.status];
  return `${verdict.source} ${verdict.status}${text ? ` ${text}` : ""}`;
}

/**
 * Statuses that can be the gateway rejecting a malformed candidate request
 * before any provider call. Account-status replies (401, 402, 403, 429) and
 * the gateway's own retryable errors (404, 408) must always fail over.
 */
const CLIENT_REJECTION_STATUS = new Set([400, 413, 422]);

/** True for a client-side rejection that says nothing about account health. */
function isGatewayRequestRejection(outcome) {
  const { status, message = "" } = outcome.verdict;
  if (!CLIENT_REJECTION_STATUS.has(status)) return false;
  if (!outcome.upstreamContacted) return true;
  return /GenerateContentRequest\.contents: contents is not specified/i.test(message);
}

/** Same response, plus the served-by headers. */
function decorate(response, candidate, publicModel) {
  const headers = new Headers(response.headers);
  headers.set(SERVED_BY_HEADERS.unit, candidate.unit.label);
  headers.set(SERVED_BY_HEADERS.model, publicModel);
  return rebuildResponse(response, response.body, { headers });
}

/** A JSON answer. */
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** `snap_` plus 16 hex characters, unique per snapshot render. */
function defaultSnapshotId() {
  return `snap_${randomBytes(8).toString("hex")}`;
}

/** Wait for a promise at most `ms`, then continue. */
async function waitBounded(promise, ms) {
  if (!promise) return;
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A non-negative safe integer, or null. */
function tokenValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Every provider named by a model leaf in the plan. */
function planProvidersOf(planData) {
  const providers = new Set();
  const visit = (node) => {
    if (!node) return;
    if (node.type === "model") {
      const slash = typeof node.model === "string" ? node.model.indexOf("/") : -1;
      if (slash > 0) providers.add(node.model.slice(0, slash));
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const route of Object.values(planData?.routes ?? {})) visit(route.graph);
  return providers;
}

/** Read the first present token counter from one object. */
function pickToken(object, names) {
  for (const name of names) {
    const value = tokenValue(object?.[name]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Normalize provider-reported usage into the three counters the store keeps.
 * Missing fields stay absent; the function never estimates a token count.
 */
function tokenAccounting(value) {
  if (!value || typeof value !== "object") return undefined;
  const sources = [];
  const visit = (node, depth = 0) => {
    if (depth > 7 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    for (const name of ["usage", "usageMetadata", "token_usage"]) {
      if (node[name] && typeof node[name] === "object") sources.push(node[name]);
    }
    for (const [key, child] of Object.entries(node)) {
      if (["usage", "usageMetadata", "token_usage", "messages", "choices", "content", "parts"].includes(key)) continue;
      if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(value);
  if (sources.length === 0 && ("prompt_tokens" in value || "input_tokens" in value || "promptTokenCount" in value)) {
    sources.push(value);
  }

  const result = {};
  for (const source of sources) {
    const output = pickToken(source, [
      "output_tokens",
      "completion_tokens",
      "outputTokens",
      "completionTokens",
      "candidatesTokenCount",
      "candidates_token_count",
    ]);
    const input = pickToken(source, [
      "input_tokens",
      "prompt_tokens",
      "inputTokens",
      "promptTokens",
      "promptTokenCount",
      "prompt_token_count",
    ]);
    const details =
      source.input_tokens_details ??
      source.prompt_tokens_details ??
      source.promptTokensDetails ??
      source.inputTokensDetails ??
      {};
    const cached =
      pickToken(details, ["cached_tokens", "cachedTokens"]) ??
      pickToken(source, ["cachedContentTokenCount", "cache_read_input_tokens", "cacheReadInputTokens"]);
    const anthropic = "cache_read_input_tokens" in source || "cache_creation_input_tokens" in source;
    const creation = pickToken(source, ["cache_creation_input_tokens", "cacheCreationInputTokens"]) ?? 0;
    const uncached = input === null ? null : anthropic ? input + creation : Math.max(0, input - (cached ?? 0));
    for (const [key, number] of Object.entries({ output, uncachedInput: uncached, cachedInput: cached })) {
      if (number !== null) result[key] = Math.max(result[key] ?? 0, number);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Merge usage objects by field, keeping the largest value. */
function mergeUsage(target, next) {
  for (const [key, value] of Object.entries(next)) {
    if (!Number.isFinite(value)) continue;
    target[key] = Math.max(Number(target[key]) || 0, value);
  }
  return target;
}

/** Usage from a bounded JSON tail, without ever parsing a partial prefix. */
function usageFromJsonTail(tail) {
  const text = tail.trim();
  if (text === "") return undefined;
  try {
    return tokenAccounting(JSON.parse(text));
  } catch {
    // A tail may start mid-document. The usage object itself is complete.
  }
  const index = text.lastIndexOf('"usage"');
  if (index < 0) return undefined;
  try {
    return tokenAccounting(JSON.parse(`{${text.slice(index)}`));
  } catch {
    return undefined;
  }
}

/**
 * Forward every chunk unchanged while collecting provider usage exactly once.
 *
 * SSE: the last (largest) usage frame wins; per-frame calls never happen.
 * JSON: a 64 KiB tail is parsed at clean end; the body is never buffered.
 * Aborted or errored bodies do not report. A malformed SSE event (including
 * one above the byte limit) stops the scanner but leaves every byte intact.
 */
export function createUsageTap(response, { onUsage, maxEventBytes, mode, requestId } = {}) {
  if (typeof onUsage !== "function" || !response?.body) return response;
  const streaming = mode === "sse" || (mode === undefined && isEventStream(response));
  const json =
    mode === "json" ||
    (mode === undefined && !streaming && /application\/json/i.test(response.headers.get("content-type") ?? ""));
  if (!streaming && !json) return response;

  let merged;
  let reported = false;
  const report = () => {
    if (reported || !merged) return;
    reported = true;
    try {
      onUsage(merged, requestId);
    } catch {
      // Usage accounting must never fail the response.
    }
  };

  let body;
  if (streaming) {
    const decoder = new TextDecoder();
    const scanner = createSseScanner(maxEventBytes ? { maxEventBytes } : undefined);
    let broken = false;
    const inspect = (block) => {
      if (!block.includes("usage")) return;
      try {
        const usage = tokenAccounting(parseSseFrame(block).json());
        if (usage) merged = mergeUsage(merged ?? {}, usage);
      } catch {
        // A malformed frame is ignored; the stream itself is untouched.
      }
    };
    body = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if (!broken) {
            try {
              for (const block of scanner.push(decoder.decode(chunk, { stream: true }))) inspect(block);
            } catch {
              broken = true;
            }
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (!broken) {
            try {
              for (const block of scanner.flush()) inspect(block);
            } catch {
              broken = true;
            }
          }
          report();
        },
      }),
    );
  } else {
    const decoder = new TextDecoder();
    let tail = "";
    body = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          tail = (tail + decoder.decode(chunk, { stream: true })).slice(-USAGE_JSON_TAIL_CHARS);
          controller.enqueue(chunk);
        },
        flush() {
          tail += decoder.decode();
          const usage = usageFromJsonTail(tail);
          if (usage) merged = mergeUsage(merged ?? {}, usage);
          report();
        },
      }),
    );
  }
  return rebuildResponse(response, body);
}

export class LazyRouter {
  /**
   * @param {{policy: object, catalog: object, health: object, dispatcher: object,
   *   faults: object, affinity?: object, capacity?: object, admission?: object,
   *   perf?: object, speed?: object, store?: object, credentials?: object,
   *   accountDirectory?: object, planData?: object, emit: Function,
   *   settings: object, now?: () => Date, pinnedProviders?: Set<string>,
   *   buildVersion?: string|null, idFactory?: () => string}} deps
   */
  constructor({
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
    store = null,
    concurrencyProof = null,
    credentials = null,
    accountDirectory = null,
    planData = {},
    emit,
    settings,
    now = () => new Date(),
    pinnedProviders = new Set(),
    buildVersion = null,
    idFactory = defaultSnapshotId,
  }) {
    this.policy = policy;
    this.catalog = catalog;
    this.health = health;
    this.dispatcher = dispatcher;
    this.faults = faults;
    this.affinity = affinity;
    this.perf = perf;
    this.speed = speed;
    this.store = store;
    this.concurrencyProof = concurrencyProof;
    this.buildVersion = typeof buildVersion === "string" && buildVersion !== "" ? buildVersion : null;
    this.idFactory = typeof idFactory === "function" ? idFactory : defaultSnapshotId;
    this.credentials = credentials;
    this.accountDirectory = accountDirectory;
    this.planData = planData;
    this.emit = emit;
    this.settings = settings;
    this.now = now;
    this.pinnedProviders = pinnedProviders;
    this.routeSet = new Set(Array.isArray(policy.routeNames) ? policy.routeNames : []);
    this.planProviders = planProvidersOf(planData);
    this.probesInFlight = new Map();
    this.probeTimers = new Map();
    this.cooling = new Map();
    this.skipsReported = new Set();
    this.accountIndex = new Map();
    this.accountIndexVersion = -1;
    this.switchCache = null;
    this.catalogRefresh = undefined;
    this.capacityLimits = new Map();

    // Capacity limits are looked up by key, and a model-scoped limit uses a
    // key that combines the unit and the model.
    this.capacity =
      capacity ??
      new InFlightTracker({
        limitOf: (key) => this.capacityLimits.get(key) ?? 0,
      });
    this.admission = admission ?? new AdmissionControl({});
    this.affinity = affinity ?? new PrefixAffinity({});
    this.perf = perf ?? new ModelPerf({});
    this.speed = speed ?? new CyclicSpeed({});
  }

  /** True when `model` names one of the router's routes. */
  handles(model) {
    return typeof model === "string" && this.routeSet.has(model);
  }

  /* ---------------------------------------------------------------- */
  /* Route metadata                                                    */
  /* ---------------------------------------------------------------- */

  /** The exact client-facing id of one route. */
  modelIdOf(routeId) {
    return this.policy.modelIdOf(routeId);
  }

  /** The display name of one route. It never gets a second prefix. */
  displayNameOf(routeId) {
    const value = this.policy.displayNameOf?.(routeId);
    return typeof value === "string" && value !== "" ? value : routeId;
  }

  /** Route settings from the plan, with the policy as the first source. */
  routeInfo(routeId) {
    const route = this.planData?.routes?.[routeId] ?? {};
    return {
      id: routeId,
      displayName: this.displayNameOf(routeId),
      contextWindow:
        this.policy.contextWindowOf?.(routeId) ??
        route.contextWindow ??
        this.planData.contextWindow ??
        DEFAULT_CONTEXT_WINDOW,
      maxOutputTokens:
        this.policy.maxOutputTokensOf?.(routeId) ??
        route.maxOutputTokens ??
        this.planData.maxOutputTokens ??
        DEFAULT_MAX_OUTPUT_TOKENS,
      input: Array.isArray(route.input) ? route.input : ["text"],
      require: Array.isArray(route.require) ? route.require : [],
      rescue: route.rescue === true,
    };
  }

  /** /v1/models entries for the lazy routes. */
  advertisedModels() {
    return [...this.routeSet].map((routeId) => {
      const info = this.routeInfo(routeId);
      return {
        id: this.modelIdOf(routeId),
        object: "model",
        owned_by: "lazy-router",
        api: "openai-completions",
        display_name: info.displayName,
        input_modalities: info.input,
        context_length: info.contextWindow,
        max_output_tokens: info.maxOutputTokens,
      };
    });
  }

  /** The account label index, rebuilt when the account list changes. */
  #accountLabels() {
    const version = this.accountDirectory?.version ?? -1;
    if (this.accountIndexVersion !== version) {
      this.accountIndex = buildAccountIndex(this.accountDirectory?.all() ?? []);
      this.accountIndexVersion = version;
    }
    return this.accountIndex;
  }

  /** Accounts in the shape ComposedPolicy expects. */
  #policyAccounts() {
    const rows = this.accountDirectory?.all() ?? [];
    const accounts = rows.map((row) => ({
      provider: row.provider,
      account: row.id,
      tier: row.tier,
    }));
    // A provider with no credential row can still serve through an environment
    // key or a plugin token. Give it one account-level placeholder so its
    // untiered leaves remain reachable.
    const known = new Set(rows.map((row) => row.provider));
    for (const provider of this.planProviders) {
      if (!known.has(provider)) accounts.push({ provider, account: "default", tier: null });
    }
    return accounts;
  }

  /** Every candidate of one route in one period, with its unit. */
  #candidates(routeId, period, at = this.now(), options = {}) {
    const accounts = this.#policyAccounts();
    const tierOf = (provider, account) => this.accountDirectory?.tierOf(provider, account);
    const raw = this.policy.candidatesFor(routeId, {
      ...options,
      period,
      tierOf,
      accounts,
      at,
    });
    const list = Array.isArray(raw) ? raw : (raw?.candidates ?? []);
    const labels = this.#accountLabels();
    return list.map((candidate) => ({ ...candidate, unit: unitFor(candidate, labels) }));
  }

  /** The period of one instant. */
  #periodAt(date) {
    const value = this.policy.periodAt?.(date);
    return value === "peak" || value === "offPeak" ? value : "offPeak";
  }

  /** The next period switch, computed at most once a minute. */
  #nextSwitch(now) {
    const minute = Math.floor(now.getTime() / MINUTE_MS);
    if (this.switchCache?.minute === minute) return this.switchCache.next;
    const current = this.#periodAt(now);
    const start = minute * MINUTE_MS;
    const coarse = 15 * MINUTE_MS;
    let next;
    for (let at = start + coarse; at <= start + 21 * 24 * 60 * MINUTE_MS; at += coarse) {
      if (this.#periodAt(new Date(at)) === current) continue;
      for (let exact = at - coarse + MINUTE_MS; exact <= at; exact += MINUTE_MS) {
        const period = this.#periodAt(new Date(exact));
        if (period !== current) {
          next = { at: new Date(exact).toISOString(), period };
          break;
        }
      }
      if (next) break;
    }
    this.switchCache = { minute, next: next ?? null };
    return this.switchCache.next;
  }

  /* ---------------------------------------------------------------- */
  /* Capacity and health                                               */
  /* ---------------------------------------------------------------- */

  /** The capacity key and limit for one candidate. */
  #capacityScope(candidate) {
    const unitLimit = Number(this.policy.maxInFlight(candidate.unitKey)) || 0;
    const modelLimit = candidate.model ? Number(this.policy.maxInFlight(candidate.model)) || 0 : 0;
    if (modelLimit > 0) {
      const key = `${candidate.unitKey} ${candidate.model}`;
      this.capacityLimits.set(key, modelLimit);
      return { key, limit: modelLimit, modelScoped: true };
    }
    if (unitLimit > 0) {
      this.capacityLimits.set(candidate.unitKey, unitLimit);
      return { key: candidate.unitKey, limit: unitLimit, modelScoped: false };
    }
    return { key: candidate.unitKey, limit: 0, modelScoped: false };
  }

  /** The health state of one candidate. */
  #healthState(candidate) {
    return this.health.stateOf(candidate.unitKey, candidate.model) ?? PROBE_STATE.ALIVE;
  }

  /** True when the candidate can take traffic now. */
  #isAlive(candidate) {
    return this.#healthState(candidate) === PROBE_STATE.ALIVE;
  }

  /** Local cooldown metadata for probe scheduling; never a status source. */
  #rememberCooling(candidate, reason, until) {
    this.cooling.set(this.#candidateKey(candidate), {
      reason,
      since: this.now().getTime(),
      nextProbeAt: until,
      candidate,
    });
  }

  /** Internal cooldown map key. */
  #candidateKey(candidate) {
    return `${candidate.unitKey}\n${candidate.model}`;
  }

  /** Drop local cooldown metadata. */
  #forgetCooling(candidate) {
    this.cooling.delete(this.#candidateKey(candidate));
  }

  /** Bench a (unit, model) pair and schedule its recovery probe. */
  #bench(candidate, kind, verdict) {
    const reason = sanitizedReason(verdict);
    // A 429 is classified with the other account-status replies, but its
    // cooldown stays short: a rate limit lifts in seconds, not in 30 minutes.
    const temporary =
      kind === FAILURE.THROTTLE ||
      kind === FAILURE.TRANSIENT ||
      kind === FAILURE.STALE_CONNECTION ||
      (kind === FAILURE.QUOTA && verdict.status === 429);
    const probeIntervalMs = temporary ? SHORT_COOLDOWN_MS : LONG_COOLDOWN_MS;
    const until = this.now().getTime() + probeIntervalMs;
    const applied = this.health.markDead(candidate.unitKey, candidate.model, {
      reason:
        kind === FAILURE.QUOTA
          ? `quota: ${reason}`
          : kind === FAILURE.CREDENTIAL
            ? `credential: ${reason}`
            : kind === FAILURE.THROTTLE
              ? `throttle: ${reason}`
              : temporary
                ? `transient: ${reason}`
                : reason,
      until,
    });
    // A rejected write is authoritative: the shared row keeps its stronger
    // cooldown, and no local status metadata may contradict it.
    if (applied === false) return;
    this.#rememberCooling(candidate, reason, until);
    this.#scheduleProbe(candidate, probeIntervalMs);
  }

  /** Schedule one recovery probe for a candidate. */
  #scheduleProbe(candidate, delayMs) {
    const key = this.#candidateKey(candidate);
    if (this.probeTimers.has(key)) return;
    const timer = setTimeout(
      () => {
        this.probeTimers.delete(key);
        void this.probe(candidate, { background: true })
          .then((state) => {
            if (state === PROBE_STATE.ALIVE) {
              this.#forgetCooling(candidate);
              return;
            }
            const next = state === PROBE_STATE.BUSY ? BUSY_PROBE_MS : this.settings.probeIntervalMs;
            this.#scheduleProbe(candidate, next);
          })
          .catch((error) => {
            report("lazy-router: background probe failed", {
              error: error instanceof Error ? error.message : String(error),
            });
            this.#scheduleProbe(candidate, this.settings.probeIntervalMs);
          });
      },
      Math.max(1_000, delayMs),
    );
    timer.unref?.();
    this.probeTimers.set(key, timer);
  }

  /** Ensure a cooling candidate has a local probe timer. */
  #ensureProbe(candidate) {
    const key = this.#candidateKey(candidate);
    if (this.probeTimers.has(key)) return;
    const entry = this.cooling.get(key);
    const delay = entry ? Math.max(1_000, entry.nextProbeAt - this.now().getTime()) : SHORT_COOLDOWN_MS;
    this.#scheduleProbe(candidate, delay);
  }

  /**
   * Send one liveness probe. Concurrent probes of the same pair share a call.
   * @returns {Promise<string>} one of PROBE_STATE
   */
  probe(candidate, { background = false } = {}) {
    const key = this.#candidateKey(candidate);
    const running = this.probesInFlight.get(key);
    if (running) return running;
    const probe = this.#runProbe(candidate, { background }).finally(() => this.probesInFlight.delete(key));
    this.probesInFlight.set(key, probe);
    return probe;
  }

  async #runProbe(candidate, { background }) {
    const lease = this.health.claimProbe(candidate.unitKey, candidate.model, PROBE_LEASE_MS);
    if (!lease?.claimed) return PROBE_STATE.BUSY;

    const scope = this.#capacityScope(candidate);
    if (scope.limit > 0 && !this.capacity.hasRoom(scope.key)) {
      this.#releaseProbeLease(candidate, lease, PROBE_STATE.BUSY, "provider capacity is full");
      return PROBE_STATE.BUSY;
    }
    const slot = this.capacity.slot(scope.key);
    if (!slot.granted) {
      this.#releaseProbeLease(candidate, lease, PROBE_STATE.BUSY, "provider capacity is full");
      return PROBE_STATE.BUSY;
    }

    const started = Date.now();
    let state = PROBE_STATE.DEAD;
    try {
      const traits = this.catalog.find(candidate.model);
      const body = probeBody({
        model: candidate.model,
        effort: probeEffort(traits),
        maxTokens: this.settings.probeMaxTokens,
        prompt: this.settings.probePrompt,
      });
      const attempt = await this.#newAttempt(candidate, traits, FAULT_KIND.PROBE, body.reasoning_effort);
      const outcome = await this.dispatcher.run(
        attempt,
        this.dispatcher.internalRequest("/v1/chat/completions", body),
        {
          format: formatForPath("/v1/chat/completions"),
          headerTimeoutMs: this.settings.probeTimeoutMs,
        },
      );
      try {
        await outcome.response?.body?.cancel();
      } catch {
        // A probe body that is already gone needs no drain.
      }
      state = this.#probeState(outcome.verdict);
      this.#releaseProbeLease(candidate, lease, state, sanitizedReason(outcome.verdict));
    } catch (error) {
      this.#releaseProbeLease(candidate, lease, PROBE_STATE.DEAD, String(error?.message ?? error));
    } finally {
      slot.release();
    }

    if (!background) {
      this.emit("probe", {
        unit: candidate.unit.label,
        model: candidate.model,
        state,
        ms: Date.now() - started,
      });
    }
    return state;
  }

  /** Record a probe result under its lease. */
  #releaseProbeLease(candidate, lease, state, reason) {
    const now = this.now().getTime();
    if (state === PROBE_STATE.ALIVE) {
      this.health.markAlive(candidate.unitKey, candidate.model, { fence: lease.fence });
      this.#forgetCooling(candidate);
      return;
    }
    if (state === PROBE_STATE.BUSY) {
      const until = now + BUSY_PROBE_MS;
      const applied = this.health.markDead(candidate.unitKey, candidate.model, {
        state: PROBE_STATE.BUSY,
        reason: `busy: ${reason}`,
        until,
        fence: lease.fence,
      });
      if (applied === false) return;
      this.#rememberCooling(candidate, `busy: ${reason}`, until);
      return;
    }
    const until = now + this.settings.probeIntervalMs;
    const applied = this.health.markDead(candidate.unitKey, candidate.model, {
      reason,
      until,
      fence: lease.fence,
    });
    if (applied === false) return;
    this.#rememberCooling(candidate, reason, until);
  }

  /** Map a probe verdict onto the three states. */
  #probeState(verdict) {
    if (verdict.ok) return PROBE_STATE.ALIVE;
    if (
      verdict.source === VERDICT_SOURCE.NETWORK ||
      verdict.source === VERDICT_SOURCE.TIMEOUT ||
      verdict.source === VERDICT_SOURCE.CREDENTIAL
    ) {
      return PROBE_STATE.DEAD;
    }
    const status = Number(verdict.status) || 0;
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
      return PROBE_STATE.BUSY;
    }
    return PROBE_STATE.DEAD;
  }

  /* ---------------------------------------------------------------- */
  /* Serving                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Serve one lazy request.
   * @param {object} format adapter from formats.mjs
   * @param {object} body parsed client body
   * @param {Request} request the client's request
   */
  async serve(format, body, request) {
    // The epoch belongs to the request, not to the moment a provider answers:
    // a reset that lands mid-flight must not split one request across epochs.
    const epoch = this.store?.captureTokenEpoch?.() ?? null;
    // The first request must not race an empty catalog. Catalog refresh is
    // local (models.db / host snapshot); a bounded await covers a slow disk.
    if (!this.catalog.gatewaySnapshotFresh && this.catalog.host.size === 0) {
      await waitBounded(this.ensureCatalog(), 5_000);
    }
    await waitBounded(this.accountDirectory?.ready, TIER_WAIT_MS);

    const route = body.model;
    const now = this.now();
    const period = this.#periodAt(now);
    const info = this.routeInfo(route);
    // Expand once to learn the unit keys, then expand again with affinity and
    // performance evidence so the policy's rating nodes can rank their groups.
    const unranked = this.#candidates(route, period, now);
    const transcript = canonicalBytes(format.transcript(body));
    const image = containsImage(format.conversation(body));
    const needs = new Set([...info.require, ...(image ? ["image"] : [])]);
    const requested = format.readEffort(body);
    const digests = prefixDigests(transcript);
    const unitKeys = [...new Set(unranked.map((candidate) => candidate.unitKey))];
    let affinityShare = 0;
    let affinityUnit = null;
    if (typeof this.affinity.lookup === "function") {
      const found = this.affinity.lookup(unitKeys, { digests, transcriptLength: transcript.length });
      affinityShare = found.share;
      affinityUnit = found.matchedUnit;
    }
    const shareFor = (candidate) => (affinityUnit && candidate.unitKey === affinityUnit ? affinityShare : 0);
    const cachedBytesFor = (candidate) => shareFor(candidate) * transcript.length;

    const perf = this.#perfMap(period);
    const candidates = this.#candidates(route, period, now, {
      perfOf: (candidate) => perf[candidate.model],
      affinityOf: (candidate) => ({
        share: shareFor(candidate),
        bytes: cachedBytesFor(candidate),
      }),
      temperature: this.settings.routing?.temperature,
    });

    const context = {
      route,
      info,
      period,
      format,
      body,
      request,
      requested,
      transcript,
      digests,
      epoch,
      shareFor,
      cachedBytesFor,
      startedAt: Date.now(),
    };

    const ranked = this.#availableCandidates(candidates, needs, info.contextWindow).map((candidate) => ({
      candidate,
      routing: {
        score: candidate.ratingScore ?? 0,
        affinityStickiness: shareFor(candidate) > 0 ? 1 : 0,
        temperature: this.settings.routing?.temperature ?? 0,
        effectiveTemperature: this.settings.routing?.temperature ?? 0,
      },
    }));
    let lastFailure;
    const held = [];
    const rejectedModels = new Set();
    let minimumContext = info.contextWindow;

    for (const { candidate, routing } of ranked) {
      context.routing = routing;
      if (request.signal?.aborted) return this.#clientGone(format, { route, period });
      if (rejectedModels.has(candidate.model)) continue;
      if (!this.#fitsCandidate(candidate, needs, minimumContext)) continue;
      const state = this.#healthState(candidate);
      if (state !== PROBE_STATE.ALIVE) {
        this.#ensureProbe(candidate);
        continue;
      }

      const claim = this.#claimSlot(candidate, context, {
        onAdmissionDenied: () => held.push({ candidate, routing }),
      });
      if (!claim) continue;
      const result = await this.#serveWith(candidate, claim.slot, context);
      if (result.response) return result.response;
      lastFailure = result.failure;
      if (result.failure?.kind === FAILURE.ADAPTER) rejectedModels.add(candidate.model);
      if (result.failure?.kind === FAILURE.REQUEST) {
        rejectedModels.add(candidate.model);
        minimumContext = Math.max(minimumContext, requestContextRequirement(result.failure.verdict.message));
      }
    }

    // A cache-poor request can be denied by admission on every limited unit
    // while those units still have free hard slots. Give it one last pass,
    // without bypassing capacity, health, or modality checks.
    for (const { candidate, routing } of held) {
      if (request.signal?.aborted) return this.#clientGone(format, { route, period });
      if (rejectedModels.has(candidate.model) || !this.#isAlive(candidate)) continue;
      if (!this.#fitsCandidate(candidate, needs, minimumContext)) continue;
      context.routing = routing;
      const claim = this.#claimSlot(candidate, context, { bypassAdmission: true });
      if (!claim) continue;
      this.emit("admission-rescue", {
        route,
        period,
        unit: candidate.unit.label,
        model: candidate.model,
      });
      const result = await this.#serveWith(candidate, claim.slot, context);
      if (result.response) return result.response;
      lastFailure = result.failure;
      if (result.failure?.kind === FAILURE.ADAPTER || result.failure?.kind === FAILURE.REQUEST) {
        rejectedModels.add(candidate.model);
      }
      if (result.failure?.kind === FAILURE.REQUEST) {
        minimumContext = Math.max(minimumContext, requestContextRequirement(result.failure.verdict.message));
      }
    }

    return this.#exhausted(format, route, period, lastFailure);
  }

  /** True when the catalog says this candidate can serve the request. */
  #fitsCandidate(candidate, needs, minimumContext) {
    const traits = this.catalog.find(candidate.model);
    if (!traits) {
      this.#reportSkip(candidate, "model not routable on this gateway");
      return false;
    }
    if (traits.contextWindow < minimumContext) {
      this.#reportSkip(candidate, `context ${traits.contextWindow} < required ${minimumContext}`);
      return false;
    }
    if (![...needs].every((modality) => traits.input.includes(modality))) {
      this.#reportSkip(candidate, `missing input modality: ${[...needs].join(", ")}`);
      return false;
    }
    return true;
  }

  /** Report one skip reason per candidate. */
  #reportSkip(candidate, reason) {
    const key = `${candidate.unit.label} ${candidate.model} ${reason}`;
    if (this.skipsReported.has(key)) return;
    this.skipsReported.add(key);
    this.emit("skip", { unit: candidate.unit.label, model: candidate.model, reason });
  }

  /** Candidates that can take traffic now, in the policy's order. */
  #availableCandidates(candidates, needs, minimumContext) {
    return candidates.filter((candidate) => {
      if (!this.#isAlive(candidate)) {
        this.#ensureProbe(candidate);
        return false;
      }
      if (!this.#fitsCandidate(candidate, needs, minimumContext)) return false;
      const scope = this.#capacityScope(candidate);
      return scope.limit === 0 || this.capacity.hasRoom(scope.key);
    });
  }

  /** A perf map keyed by model, from the store's summaries. */
  #perfMap(period) {
    const models = this.#uniqueModels();
    if (typeof this.perf.summaries === "function") return this.perf.summaries(models, period);
    const map = {};
    for (const model of models) {
      const summary = this.perf.summary?.(model, period);
      if (summary) map[model] = summary;
    }
    return map;
  }

  /** Every model named by one route in either period. */
  #uniqueModels() {
    const models = new Set();
    for (const routeId of this.routeSet) {
      for (const period of ["peak", "offPeak"]) {
        for (const candidate of this.#candidates(routeId, period, this.now())) models.add(candidate.model);
      }
    }
    return models;
  }

  /**
   * The slot for one candidate, or undefined when admission or capacity holds
   * the request back.
   */
  #claimSlot(candidate, context, { bypassAdmission = false, onAdmissionDenied } = {}) {
    const scope = this.#capacityScope(candidate);
    const share = context.shareFor(candidate);
    const where = { route: context.route, unit: candidate.unit.label, model: candidate.model, cachedShare: share };

    if (scope.limit > 0 && !scope.modelScoped && !bypassAdmission) {
      this.admission.record(candidate.unitKey, share);
      const windowCount = this.admission.windowCount?.(candidate.unitKey) ?? 0;
      if (!this.admission.admits(candidate.unitKey, share, scope.limit, windowCount)) {
        this.emit("held-back", { ...where, reason: "admission", window: windowCount });
        onAdmissionDenied?.();
        return undefined;
      }
    }
    if (scope.limit > 0 && !this.capacity.hasRoom(scope.key)) {
      this.emit("held-back", {
        ...where,
        reason: "capacity",
        inFlight: this.capacity.inFlight(scope.key),
        maxInFlight: scope.limit,
      });
      return undefined;
    }
    const slot = this.capacity.slot(scope.key);
    if (!slot.granted) {
      this.emit("held-back", { ...where, reason: "capacity", maxInFlight: scope.limit });
      return undefined;
    }
    return { slot, scope };
  }

  /**
   * One candidate's turn: the attempt and, depending on how it failed, at most
   * one recovery. Every slot that does not carry the served response is
   * released here.
   */
  async #serveWith(candidate, slot, context) {
    const { route, info, period, format, body, request, requested } = context;
    const traits = this.catalog.find(candidate.model);
    const effort = resolveEffort({
      policy: candidate.effort,
      requested,
      traits,
    });
    const where = { route, period, unit: candidate.unit.label, model: candidate.model };
    this.emit("route", {
      ...where,
      format: format.name,
      requestedEffort: requested ?? null,
      effort: effort ?? null,
      maxTokens: info.maxOutputTokens,
      stream: body.stream === true,
      affinity: context.shareFor(candidate) > 0,
      cachedShare: context.shareFor(candidate),
      cachedBytes: context.cachedBytesFor(candidate),
      affinityStickiness: context.routing?.affinityStickiness ?? 0,
      affinityLockStickiness: context.routing?.affinityLockStickiness ?? 0,
      routingScore: context.routing?.score ?? null,
      selectionScore: context.routing?.selectionScore ?? null,
      posteriorDraw: context.routing?.posteriorDraw ?? null,
      temperature: context.routing?.temperature ?? 0,
      effectiveTemperature: context.routing?.effectiveTemperature ?? 0,
      intelligence: candidate.intelligence ?? 50,
      cost: candidate.cost ?? 1,
      costRating: context.routing?.costRating ?? 0,
      rating: context.routing?.rating ?? null,
      rd: context.routing?.rd ?? null,
    });

    let attemptSlot = slot;
    let attemptStartedAt = Date.now();
    let outcome;
    for (let tries = 1; ; tries += 1) {
      const payload = rewriteBody(format, body, {
        model: candidate.model,
        effort,
        maxTokens: info.maxOutputTokens,
      });
      try {
        outcome = await this.#attempt(candidate, traits, format, request, payload, attemptSlot);
      } catch (error) {
        attemptSlot.release();
        this.emit("attempt-error", {
          ...where,
          try: tries,
          error: String(error?.message ?? error),
        });
        const verdict = {
          ok: false,
          status: 502,
          source: VERDICT_SOURCE.NETWORK,
          message: "attempt failed before a response",
          category: "network",
        };
        this.emit("attempt-failed", { ...where, try: tries, failure: FAILURE.UNIT, ...this.#describe(verdict) });
        return { failure: { candidate, verdict, kind: FAILURE.UNIT } };
      }

      if (outcome.verdict.ok) {
        return { response: this.#served(where, outcome, candidate, attemptSlot, context, attemptStartedAt) };
      }

      attemptSlot.release();
      const kind = classifyFailure(outcome, request.signal);
      if (kind === FAILURE.CLIENT_GONE) {
        this.speed?.observe(candidate.model, {
          elapsedMs: Date.now() - attemptStartedAt,
          at: attemptStartedAt,
          censored: true,
        });
        return { response: this.#clientGone(format, where) };
      }
      if (tries === 1 && isGatewayRequestRejection(outcome)) {
        return { response: this.#rejected(where, outcome, format) };
      }
      this.emit("attempt-failed", { ...where, try: tries, failure: kind, ...this.#describe(outcome.verdict) });
      if (kind === FAILURE.REQUEST || kind === FAILURE.ADAPTER) {
        return { failure: { candidate, verdict: outcome.verdict, kind } };
      }

      const recovery = tries === 1 ? await this.#recovery(kind, candidate) : undefined;
      if (!recovery?.retry) {
        if (recovery?.bench !== false) this.#bench(candidate, kind, outcome.verdict);
        return { failure: { candidate, verdict: outcome.verdict, kind } };
      }
      if (request.signal?.aborted) return { response: this.#clientGone(format, where) };
      this.emit(recovery.event, where);

      const scope = this.#capacityScope(candidate);
      const nextSlot = this.capacity.slot(scope.key);
      if (!nextSlot.granted) {
        // The retry is owed, but the global limit still wins.
        return { failure: { candidate, verdict: outcome.verdict, kind } };
      }
      attemptSlot = nextSlot;
      attemptStartedAt = Date.now();
    }
  }

  /**
   * How to recover from a first failure.
   * @returns {Promise<{retry: boolean, bench?: boolean, event?: string}>}
   */
  async #recovery(kind, candidate) {
    switch (kind) {
      case FAILURE.STALE_CONNECTION:
        return { retry: true, event: "retry-fresh-connection" };
      case FAILURE.QUOTA:
      case FAILURE.THROTTLE:
      case FAILURE.CREDENTIAL:
      case FAILURE.TRANSIENT:
        return { retry: false };
      default: {
        const state = await this.probe(candidate, { background: false });
        if (state === PROBE_STATE.ALIVE) return { retry: true, event: "retry-same-unit" };
        if (state === PROBE_STATE.BUSY) return { retry: false, bench: false };
        return { retry: false };
      }
    }
  }

  /** Build one attempt and run it through the gateway. */
  async #attempt(candidate, traits, format, request, payload, slot) {
    const proof = this.concurrencyProof?.begin?.(candidate.model);
    try {
      const { hosts, paths, allowHttp } = this.#upstreamSpec(candidate, traits);
      const attempt = await this.#newAttempt(candidate, traits, FAULT_KIND.REQUEST, format.readEffort(payload), {
        hosts,
        paths,
        allowHttp,
      });
      if (candidate.unit.credentialId !== undefined && this.pinnedProviders.has(candidate.provider)) {
        const credential = await this.credentials?.resolve(candidate.provider, { id: candidate.unit.credentialId });
        attempt.transportSecret = credential?.secret;
      }

      const payloadText = JSON.stringify(payload);
      // withBody drops both stale body headers and shares the parsed body.
      const replay = withBody(request, payloadText, payload);

      const outcome = await this.dispatcher.run(attempt, replay, {
        format,
        headerTimeoutMs: this.#headerTimeout(candidate),
        onOutput: () => proof?.firstToken?.(),
      });
      if (!outcome.verdict.ok) proof?.finish?.(false);
      else outcome.proof = proof;
      return outcome;
    } catch (error) {
      proof?.finish?.(false);
      slot.release();
      throw error;
    }
  }

  /** The explicit host and path allowlist for one attempt. */
  #upstreamSpec(candidate, traits) {
    const configured = this.settings.upstreamHosts?.[candidate.provider];
    const raw = configured || traits?.baseUrl;
    if (typeof raw !== "string" || raw === "") {
      if (!this.skipsReported.has(`upstream:${candidate.provider}`)) {
        this.skipsReported.add(`upstream:${candidate.provider}`);
        this.emit("skip", {
          unit: candidate.unit.label,
          model: candidate.model,
          reason: "no upstream base URL; account pin cannot be applied",
        });
      }
      return { hosts: [], paths: [], allowHttp: false };
    }
    const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(text);
      const hosts = new Set([url.hostname]);
      if (candidate.provider === "google-antigravity") {
        for (const host of ANTIGRAVITY_HOSTS) hosts.add(host);
      }
      return { hosts: [...hosts], paths: [url.pathname], allowHttp: url.protocol === "http:" };
    } catch {
      return { hosts: [], paths: [], allowHttp: false };
    }
  }

  /** The header timeout of one provider. */
  #headerTimeout(candidate) {
    return this.settings.providerHeaderTimeoutMs?.[candidate.provider] ?? this.settings.headerTimeoutMs;
  }

  /** Build one Attempt. */
  async #newAttempt(candidate, traits, faultKind, effort, upstream = null) {
    const spec = upstream ?? this.#upstreamSpec(candidate, traits);
    return new Attempt({
      unit: candidate.unit,
      model: candidate.model,
      effort,
      upstreamHosts: spec.hosts,
      upstreamPaths: spec.paths,
      allowHttp: spec.allowHttp,
      fault: this.faults.take(candidate.unit.label, faultKind),
    });
  }

  /** Hand a good response to the client and record what it proved. */
  #served(where, outcome, candidate, slot, context, startedAt) {
    const { request, digests, period } = context;
    this.emit("served", { ...where, status: outcome.response.status, via: outcome.verdict.source });
    if (candidate.unit.credentialId !== undefined && !outcome.upstreamContacted) {
      this.emit("pin-unverified", where);
    }
    this.affinity.remember(candidate.unit.key, digests);

    let measured = outcome.response;
    if (typeof this.perf.wrapStream === "function") {
      measured = this.perf.wrapStream(measured, {
        model: candidate.model,
        period,
        startedAt,
        signal: request.signal,
      });
    }
    measured = this.#usageTap(measured, candidate, context.epoch);
    const settled = releaseWhenSettled(measured, {
      release: () => slot.release(),
      onEnd: (ok) => {
        outcome.proof?.finish?.(ok);
        // A clean end is a complete sample; an abort or stream error is
        // censored. Both update the model's speed posterior.
        const elapsedMs = Math.max(0, Date.now() - startedAt);
        try {
          this.speed?.observe?.(candidate.model, {
            elapsedMs,
            at: startedAt,
            ...(ok ? {} : { censored: true }),
          });
        } catch {
          // Measurement must never fail the response.
        }
      },
      signal: request.signal,
    });
    const publicResponse = rewriteResponseModel(context.format, settled, context.body.model);
    return decorate(publicResponse, candidate, context.body.model);
  }

  /** Copy token usage from a stream into the shared store. */
  #usageTap(response, candidate, epoch = null) {
    if (!this.store?.addTokenTotals) return response;
    return createUsageTap(response, {
      onUsage: (usage) => this.store.addTokenTotals(epoch, candidate.provider, candidate.model, usage),
    });
  }

  #clientGone(format, where) {
    this.emit("client-gone", where);
    return jsonResponse(CLIENT_CLOSED_STATUS, format.errorBody("client closed request", "request_aborted"));
  }

  /** A request-level rejection that belongs to conversion, not health. */
  #rejected(where, outcome, format) {
    this.emit("rejected", { ...where, ...this.#describe(outcome.verdict) });
    // The upstream status and body stay internal. A provider rejection must
    // never reach the client as a provider-authored error.
    const id = this.modelIdOf(where.route);
    return jsonResponse(
      NO_CANDIDATE_STATUS,
      format.errorBody(`${id}: request rejected before any provider could serve it`, "lazy_router_unavailable"),
    );
  }

  /** No candidate could serve the request. The id is the client-facing id. */
  #exhausted(format, routeId, period, lastFailure) {
    const id = this.modelIdOf(routeId);
    if (!lastFailure) {
      this.emit("exhausted", { route: routeId, period, reason: "no alive candidate" });
      const message = `${id}: every candidate is cooling or unavailable; see the status page for the next probe times`;
      return jsonResponse(NO_CANDIDATE_STATUS, format.errorBody(message, "lazy_router_unavailable"));
    }
    const { candidate, verdict, kind } = lastFailure;
    this.emit("exhausted", {
      route: routeId,
      period,
      lastUnit: candidate.unit.label,
      failure: kind,
      ...this.#describe(verdict),
    });
    if (kind === FAILURE.REQUEST) {
      const message = `${id}: request is incompatible with available models`;
      return jsonResponse(400, format.errorBody(message, "invalid_request_error"));
    }
    // Quota, credential and every other exhausted path answer with one
    // deterministic status and message. No provider status, URL, account, or
    // billing text may reach the client.
    return jsonResponse(
      NO_CANDIDATE_STATUS,
      format.errorBody(`${id}: no healthy candidate could serve this request`, "lazy_router_unavailable"),
    );
  }

  /** Internal event detail. Never rendered on the public status page. */
  #describe(verdict) {
    return {
      status: verdict.status,
      source: verdict.source,
      error: (verdict.message ?? "").slice(0, 300),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Catalog and status                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Refresh the gateway model snapshot in the background. A status GET never
   * waits for the host. Errors are reported and swallowed.
   */
  ensureCatalog() {
    if (!this.catalogRefresh) {
      this.catalogRefresh = Promise.resolve()
        .then(() => refreshExtensionProviders({ credentials: this.credentials }))
        .then(() => this.catalog.refresh())
        .catch((error) => {
          report("lazy-router: catalog refresh failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.catalogRefresh = undefined;
        });
    }
    return this.catalogRefresh;
  }

  /** The status JSON. It never carries an account id, e-mail, key, or upstream text. */
  status() {
    const snapshot = this.statusView();
    if (snapshot.store.mode === "sqlite" && snapshot.store.available === false) {
      return jsonResponse(503, {
        error: "store_unavailable",
        snapshotId: snapshot.snapshotId,
        generatedAt: snapshot.generatedAt,
        buildVersion: snapshot.buildVersion,
      });
    }
    return jsonResponse(200, snapshot);
  }

  /**
   * The status data itself, shared by the JSON endpoint and the page.
   * One `readStatusData()` transaction and one `buildSnapshot()`; no
   * per-candidate store query and no alternate-period computation.
   */
  statusView() {
    const at = this.now();
    const now = at.getTime();
    const periodId = this.#periodAt(at);
    const data = this.#statusData(now, periodId);
    const mode = data.mode === "sqlite" || data.mode === "memory" ? data.mode : "unavailable";
    const global = mode === "sqlite" && data.available === true;
    const store = {
      mode,
      available: global,
      reason: data.reason ?? (global ? null : "共享状态不可用"),
    };
    const routes = this.#statusRoutes(periodId, at, this.#speedSnapshot(data.speedRows, now), global);
    return buildSnapshot({
      now,
      nowMinute: Math.floor(now / MINUTE_MS),
      idFactory: this.idFactory,
      answeredBy: this.store?.worker ?? `${hostname()}:${process.pid}`,
      buildVersion: this.buildVersion ?? "—",
      epoch: data.epoch ?? null,
      store,
      period: {
        id: periodId,
        label: periodId === "peak" ? "高峰时段" : "闲时时段",
        nextSwitch: this.#nextSwitch(at),
      },
      catalog: Boolean(this.catalog?.ready),
      routes,
      perfRows: data.perfRows ?? [],
      workerRows: data.workerRows ?? [],
      capacityRows: global ? this.#statusCapacityRows(data.capacityRows ?? [], routes, now) : [],
      healthRows: global ? this.#statusHealthRows(data.healthRows ?? []) : [],
      proofRows: data.proofRows ?? [],
      affinityStats: data.affinityStats ?? null,
      tokenTotals: data.tokenTotals ?? null,
    });
  }

  /** The S2 §3.5 read. One transaction; no store means an unavailable view. */
  #statusData(now, period) {
    const minute = Math.floor(now / MINUTE_MS);
    const request = {
      now,
      period,
      perfSinceMinute: minute - (PERF_WINDOW_MINUTES - 1),
      perfUntilMinute: minute,
      affinitySinceMinute: minute - (AFFINITY_WINDOW_MINUTES - 1),
      workerSince: now - 5 * MINUTE_MS,
      healthSince: now - 7 * 24 * 60 * MINUTE_MS,
    };
    if (typeof this.store?.readStatusData === "function") return this.store.readStatusData(request);
    return this.#emptyStatusData();
  }

  /** A worker without a shared store must not imply any global value. */
  #emptyStatusData() {
    return {
      available: false,
      mode: this.store?.mode === "memory" ? "memory" : "unavailable",
      reason: "共享状态不可用",
      epoch: null,
      tokenTotals: null,
      perfRows: [],
      speedRows: [],
      workerRows: [],
      capacityRows: [],
      healthRows: [],
      proofRows: [],
      affinityStats: null,
    };
  }

  /** Every model's posterior from the rows of the status read. */
  #speedSnapshot(rows, at) {
    if (typeof this.speed?.snapshotFromRows === "function") {
      try {
        return this.speed.snapshotFromRows(rows ?? [], at);
      } catch {
        return {};
      }
    }
    return {};
  }

  /** Route/channel/unit inputs from the plan; no store call per candidate. */
  #statusRoutes(period, at, speed, global) {
    const topology = this.#topology();
    const routes = [];
    for (const routeId of this.routeSet) {
      const info = this.routeInfo(routeId);
      const channels = [];
      const byModel = new Map();
      for (const candidate of this.#candidates(routeId, period, at, { temperature: 0 })) {
        const traits = this.catalog.find?.(candidate.model);
        const eligible = Boolean(
          traits &&
            traits.contextWindow >= info.contextWindow &&
            [...info.require].every((modality) => traits.input?.includes(modality)),
        );
        if (!eligible && this.catalog.ready) continue;
        let channel = byModel.get(candidate.model);
        if (!channel) {
          channel = {
            model: candidate.model,
            effort: candidate.effort ?? null,
            posterior: speed[candidate.model] ?? null,
            units: [],
          };
          byModel.set(candidate.model, channel);
          channels.push(channel);
        }
        const unit = {
          unitKey: candidate.unitKey,
          displayName: candidate.unit.label,
          provider: candidate.provider,
          model: candidate.model,
        };
        if (!global) {
          const row = this.health?.localRow?.(candidate.unitKey, candidate.model) ?? null;
          const scope = this.#capacityScope(candidate);
          unit.health = row?.state ?? "alive";
          unit.reason = row?.reason ?? null;
          unit.nextProbeAt = row?.state === "alive" ? row?.probeLeaseUntil || null : row?.until || null;
          unit.capacityHeld = typeof this.capacity?.localHeld === "function" ? this.capacity.localHeld(scope.key) : 0;
          unit.capacityMax = scope.limit;
          unit.capacityScope = scope.modelScoped ? "unit_model" : "unit";
          unit.stale = false;
        }
        channel.units.push(unit);
      }
      routes.push({
        id: routeId,
        title: this.displayNameOf(routeId),
        graph: topology[routeId]?.graph ?? null,
        channels,
      });
    }
    return routes;
  }

  /**
   * One capacity row per policy identity. A model-specific limit gets an exact
   * (unitKey, model, unit_model) record; a model without one falls back to its
   * unit's record when the unit has a limit. With no limit at all, the unit
   * gets one max:0 fallback record; it can never mask a sibling's exact limit
   * because every positive model limit is emitted as an exact record even at
   * idle. Held slots are summed across workers; the record is fresh while any
   * worker row is fresh, stale only when every row is. Missing identities are
   * policy rows with held 0, so an idle limited model reads 0/max instead of
   * 无数据.
   */
  #statusCapacityRows(rows, routes, now) {
    const labels = this.#accountLabels();
    const groups = new Map();
    const seed = (identity, base) => {
      let group = groups.get(identity);
      if (!group) {
        group = {
          ...base,
          held: 0,
          updatedAt: 0,
          worker: null,
          synthetic: true,
        };
        groups.set(identity, group);
      }
      return group;
    };

    // Policy identities first: every route unit/model gets a record even at idle.
    for (const route of routes) {
      for (const channel of route.channels) {
        for (const unit of channel.units) {
          const unitKey = unit.unitKey;
          if (typeof unitKey !== "string" || unitKey === "") continue;
          const model = channel.model;
          const modelLimit = this.#statusLimitOf(model);
          const unitLimit = this.#statusLimitOf(unitKey);
          // A positive model limit is an exact record even at idle. A unit
          // limit (or no limit at all) is unit-scoped; an unlimited unit row
          // is a fallback only and cannot mask a sibling's exact limit.
          const modelScoped = modelLimit > 0;
          const identity = `${unitKey}\0${modelScoped ? model : ""}`;
          seed(identity, {
            unitKey,
            model: modelScoped ? model : null,
            scope: modelScoped ? "unit_model" : "unit",
            max: modelLimit > 0 ? modelLimit : unitLimit,
            displayName: labels.get(unitKey)?.label ?? unit.displayName,
          });
        }
      }
    }

    for (const row of rows) {
      const text = String(row.unit ?? "");
      if (text === "") continue;
      const space = text.lastIndexOf(" ");
      const unitKey = space > 0 ? text.slice(0, space) : text;
      if (unitKey === "") continue;
      const keyModel = row.model ?? (space > 0 ? text.slice(space + 1) : null);
      const modelLimit = keyModel ? this.#statusLimitOf(keyModel) : 0;
      const unitLimit = this.#statusLimitOf(unitKey);
      const modelScoped = modelLimit > 0;
      const identity = `${unitKey}\0${modelScoped ? keyModel : ""}`;
      const group = seed(identity, {
        unitKey,
        model: modelScoped ? keyModel : null,
        scope: modelScoped ? "unit_model" : "unit",
        max: modelLimit > 0 ? modelLimit : unitLimit,
        displayName: labels.get(unitKey)?.label,
      });
      group.synthetic = false;
      group.held += Math.max(0, Number(row.held) || 0);
      const rawAt = row.updatedAt ?? row.updated_at;
      const numeric = Number(rawAt);
      const at = Number.isFinite(numeric) ? numeric : Date.parse(rawAt) || 0;
      if (at >= group.updatedAt) {
        group.updatedAt = at;
        group.worker = row.worker;
      }
    }

    return [...groups.values()].map((group) => ({
      unit: group.scope === "unit_model" ? `${group.unitKey} ${group.model}` : group.unitKey,
      model: group.model,
      worker: group.worker ?? "*",
      held: group.held,
      max: group.max,
      scope: group.scope,
      // A policy-only or unlimited record is current by definition; a limited
      // aggregate is fresh while any worker row is fresh.
      updatedAt: group.synthetic || group.max === 0 ? now : group.updatedAt || now,
      ...(group.displayName ? { displayName: group.displayName } : {}),
      ...(group.synthetic ? { synthetic: true } : {}),
    }));
  }

  /** Display aliases for shared health rows; the key never reaches the page. */
  #statusHealthRows(rows) {
    const labels = this.#accountLabels();
    return rows.map((row) => {
      const key = typeof row.key === "string" ? row.key : "";
      const space = key.indexOf(" ");
      const unitKey = space > 0 ? key.slice(0, space) : key;
      const label = labels.get(unitKey)?.label;
      return label ? { ...row, displayName: label } : row;
    });
  }

  /** A positive policy limit, or 0 for unlimited. */
  #statusLimitOf(key) {
    const value = Number(this.policy.maxInFlight?.(key));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  /** The route graph, without credentials or ranking state. */
  #topology() {
    const visit = (node) => {
      if (!node) return null;
      if (node.type === "model") {
        return {
          type: "model",
          model: node.model,
          tier: node.tier ?? null,
          effort: node.effort ?? null,
          offPeakOnly: node.offPeakOnly ?? null,
        };
      }
      return {
        type: node.type,
        children: (node.children ?? []).map(visit).filter(Boolean),
      };
    };
    const out = {};
    for (const [routeId, route] of Object.entries(this.planData?.routes ?? {})) {
      if (!this.routeSet.has(routeId)) continue;
      out[routeId] = { graph: visit(route.graph) };
    }
    return out;
  }

  /**
   * Measure a request the router does not serve: a direct model still feeds
   * perf, speed, and token totals, under the epoch captured at request start.
   * The body stays byte-identical.
   */
  measureDirect(model, response, startedAt, signal, epoch = null) {
    if (typeof model !== "string" || model.length === 0) return response;
    if (typeof this.perf.wrapStream !== "function") return response;
    const started =
      startedAt instanceof Date ? startedAt.getTime() : Number.isFinite(startedAt) ? startedAt : Date.now();
    const period = this.#periodAt(new Date(started));
    let measured = this.perf.wrapStream(response, {
      model,
      period,
      startedAt: started,
      signal,
      onObservation: (sample) => {
        try {
          this.speed?.observe?.(model, {
            elapsedMs: sample.totalMs,
            at: started,
            ...(sample.imputed ? { censored: true } : {}),
          });
        } catch {
          // Measurement must never fail the response.
        }
      },
    });
    if (typeof this.store?.addTokenTotals === "function") {
      const slash = model.indexOf("/");
      const provider = slash > 0 ? model.slice(0, slash) : model;
      const requestEpoch = epoch ?? this.store.captureTokenEpoch?.() ?? null;
      measured = createUsageTap(measured, {
        onUsage: (usage) => this.store.addTokenTotals(requestEpoch, provider, model, usage),
        mode: isEventStream(measured) ? "sse" : "json",
      });
    }
    return measured;
  }

  /** Stop every timer this router owns. */
  dispose() {
    for (const timer of this.probeTimers.values()) clearTimeout(timer);
    this.probeTimers.clear();
    this.probesInFlight.clear();
    this.cooling.clear();
  }
}

/** Re-export the imports a feature or test needs without a second import path. */
export { GatewayDispatcher };
