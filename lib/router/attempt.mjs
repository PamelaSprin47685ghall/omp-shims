// One attempt = one candidate (unit + model) serving one gateway request.
//
// The attempt is the AsyncLocalStorage scope for everything the gateway does
// while serving it. On the outbound side the attempt layer:
//   - refuses to act on any host outside the attempt's explicit allowlist;
//   - injects the pinned account's auth headers only for an exact host match;
//   - reports the provider's status the moment its headers arrive, which is
//     what the router decides on;
//   - stops further provider calls once the attempt has failed, so the
//     gateway's own retries cannot outrun the router's failover;
//   - writes the attempt's effort into provider bodies whose plugin drops it;
//   - re-sanitizes every Antigravity body, including retries and continuation
//     replays, and leaves a clean body byte-identical.
//
// A call to any other host passes through untouched and cannot settle the
// verdict. Credentials never leave the allowlist.

import { AsyncLocalStorage } from "node:async_hooks";
import { STATUS_CODES } from "node:http";
import { matchHttpsHost, report } from "../contracts.mjs";
import { requestBody, requestUrl, withRequestBody } from "../outbound.mjs";
import { classifyThrownFailure, FAILURE } from "./failures.mjs";
import { providerOf, sanitizeAntigravityBody } from "./formats.mjs";
import { withUpstreamEffort } from "./upstream-effort.mjs";

/** Where an attempt's verdict came from. */
export const VERDICT_SOURCE = Object.freeze({
  UPSTREAM: "upstream",
  GATEWAY: "gateway",
  STREAM: "stream",
  NETWORK: "network",
  TIMEOUT: "timeout",
  INJECTED: "injected",
  CREDENTIAL: "credential",
  ADAPTER: "adapter",
});

/** The largest upstream error body kept for the client and the log, in bytes. */
export const ERROR_SNIPPET_BYTES = 8 * 1024;

/**
 * Exhausted-quota wording. This is the only text signal the transport keeps.
 * It is reduced to a category before a verdict leaves this layer.
 */
const QUOTA_WORDING = [
  /错误码\s*1(?:10|13|16|17|18|19|22)\b/,
  /\bcode\s*1(?:10|13|16|17|18|19|22)\b/i,
  /\bctyun coding-plan quota exhausted\b/i,
  /\bGoUsageLimitError\b/,
  /\bGo usage limit exceeded\b/i,
  /\bVibe (?:coding )?budget exhausted\b/i,
  /Coding\s*Plan[\s\S]*额度已用完/i,
  /请等待周期(?:时间)?刷新/,
  /额度(限制|不足|用尽|已用完)/,
  /\bout of (?:credits?|quota|balance)\b/i,
  /\b(?:no|zero|low) (?:credits?|balance)\b/i,
  /\b(?:add|top up|purchase) (?:more )?credits?\b/i,
  /\bbilling[_ -]?error\b/i,
  /\bpayment required\b/i,
  /credits?\s*(exhausted|limit reached)/i,
  /user provided api key rate limit exceeded/i,
  /billing daily count exceeded/i,
  /daily usage limit reached/i,
  /free usage limit .* reached/i,
  /\b(?:monthly|weekly|daily) (?:quota|usage|allowance|budget|limit)(?:\s+(?:limit|exceeded|reached|exhausted))?\b/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota[_ ](exceeded|exhausted)\b/i,
  /\b(exceeded|exhausted) (your|the|its) (current |daily |monthly )?quota\b/i,
  /\b(daily|monthly) (count|limit|quota) exceeded\b/i,
  /\binsufficient[_ ](balance|credits?)\b/i,
];

/** True when text carries exhausted-quota wording. */
export function quotaWording(text) {
  return typeof text === "string" && QUOTA_WORDING.some((pattern) => pattern.test(text));
}

/** A deterministic client-facing message for one upstream status. */
export function genericUpstreamMessage(status) {
  const text = STATUS_CODES[status];
  return `upstream ${status}${text ? ` ${text}` : " error"}`;
}

/**
 * Read a bounded error body and return only a category and a generic message.
 * Raw provider text never enters a verdict.
 */
export async function readErrorVerdict(response) {
  const text = await errorSnippet(response);
  return {
    message: genericUpstreamMessage(response.status),
    category: quotaWording(text) ? "quota" : "error",
  };
}

/** The attempt that owns the current request. */
const attemptStorage = new AsyncLocalStorage();

/** Run `fn` with `attempt` visible to every outbound call it starts. */
export function runAttempt(attempt, fn) {
  return attemptStorage.run(attempt, fn);
}

/** The attempt of the current request, if any. */
export function currentAttempt() {
  return attemptStorage.getStore();
}

/** Thrown into the gateway when the router has already given up on an attempt. */
export class AttemptAbandoned extends Error {
  constructor(message = "lazy-router: attempt abandoned") {
    super(message);
    this.name = "AttemptAbandoned";
  }
}

/** Outbound headers per provider. A provider whose token needs an account header says so. */
const AUTH_HEADERS = Object.freeze({
  default: (credential) => ({ authorization: `Bearer ${credential.secret}` }),
  "openai-codex": (credential) => ({
    authorization: `Bearer ${credential.secret}`,
    ...(credential.accountId ? { "chatgpt-account-id": credential.accountId } : {}),
  }),
});

/** Headers that present one credential to its provider. */
export function authHeadersFor(credential) {
  const writer = AUTH_HEADERS[credential.provider] ?? AUTH_HEADERS.default;
  return writer(credential);
}

/**
 * True when an account pin for `provider` must be applied at the plugin
 * transport instead of on the wire. The set is configuration, not a constant.
 */
export function pinsAtTransport(provider, pinnedProviders = new Set()) {
  return pinnedProviders instanceof Set ? pinnedProviders.has(provider) : false;
}

/** True when `pathname` sits at or below one allowed base path. */
function pathAllowed(pathname, basePaths) {
  if (basePaths.length === 0) return false;
  for (const base of basePaths) {
    if (base === "" || base === "/") return true;
    if (pathname === base || pathname.startsWith(base.endsWith("/") ? base : `${base}/`)) return true;
  }
  return false;
}

export class Attempt {
  /**
   * @param {{unit: object, model: string, effort?: string,
   *   upstreamHosts?: string[], upstreamPaths?: string[], allowHttp?: boolean,
   *   fault?: {status: number, message: string}}} options
   */
  constructor({ unit, model, effort, upstreamHosts = [], upstreamPaths = [], allowHttp = false, fault }) {
    this.unit = unit;
    this.provider = unit.provider;
    this.credentialId = unit.credentialId;
    this.email = unit.email;
    this.model = model;
    this.effort = effort;
    this.upstreamHosts = [...upstreamHosts];
    // "https://host" and "https://host/" both have the pathname "/". That root
    // path must survive normalization: dropping it would empty the allowlist
    // and make every provider call ordinary traffic. Only non-strings go.
    this.upstreamPaths = (Array.isArray(upstreamPaths) ? upstreamPaths : [])
      .filter((path) => typeof path === "string")
      .map((path) => path.replace(/\/+$/, "") || "/");
    this.allowHttp = allowHttp;
    this.fault = fault;
    /** The pinned account's token for providers pinned at the transport. */
    this.transportSecret = undefined;
    /** True once the provider call has left (or would have left) the process. */
    this.contacted = false;
    /** @type {{ok: boolean, status: number, source: string, message?: string}|undefined} */
    this.result = undefined;
    /** @type {Promise<object>} */
    this.verdict = new Promise((resolve) => {
      this.resolveVerdict = resolve;
    });
  }

  /** Record the first verdict. Later verdicts are ignored. */
  settle(verdict) {
    if (this.result) return;
    this.result = verdict;
    this.resolveVerdict(verdict);
  }

  /** Mark the attempt failed and return the failing verdict. */
  fail(verdict) {
    if (this.failed) return this.result;
    this.result = verdict;
    this.resolveVerdict(verdict);
    return verdict;
  }

  /** True when the attempt has already failed. */
  get failed() {
    return this.result?.ok === false;
  }

  /**
   * True for a provider call this attempt may settle: an exact host match and
   * an allowed base path. Any other call is ordinary traffic.
   */
  isUpstream(url) {
    const { matched, url: parsed } = matchHttpsHost(url, this.upstreamHosts, {
      allowHttp: this.allowHttp,
    });
    if (!matched || !parsed) return false;
    if (!pathAllowed(parsed.pathname, this.upstreamPaths)) return false;
    return true;
  }
}

/** The abort signal of an outbound call, whichever calling shape carries it. */
function callSignal({ target, init }) {
  return init?.signal ?? (target instanceof Request ? target.signal : undefined);
}

/** Read at most `limit` bytes from a cloned response, as text. */
export async function errorSnippet(response, limit = ERROR_SNIPPET_BYTES) {
  if (!response?.body) return "";
  const reader = response.clone().body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        const keep = value.subarray(0, Math.max(0, value.byteLength - (total - limit)));
        text += decoder.decode(keep, { stream: true });
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // A broken body still yields whatever arrived.
  } finally {
    await reader.cancel().catch(() => {});
  }
  text += decoder.decode();
  return text.slice(0, limit);
}

/** True for a body that the fetch layer must read as a stream. */
function isStreamBody(body) {
  return Boolean(body) && typeof body === "object" && typeof body.getReader === "function";
}

/** Merge headers into an outbound call without spreading init over a Request. */
function withHeaders(input, init, extra) {
  const request = input instanceof Request ? input : undefined;
  const headers = new Headers(init?.headers ?? request?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);

  const body = init?.body !== undefined ? init.body : request?.body;
  if (body !== undefined) {
    // The body is byte-identical here: only auth headers change. Dropping
    // content-encoding would hand the provider compressed bytes without their
    // decoder. A later body rewrite goes through withRequestBody, which strips
    // length and encoding because that body is plain text.
    headers.delete("content-length");
    headers.delete("transfer-encoding");
  }

  const next = { ...init, headers };
  for (const key of [
    "redirect",
    "credentials",
    "mode",
    "cache",
    "referrer",
    "referrerPolicy",
    "integrity",
    "keepalive",
  ]) {
    const value = init?.[key] ?? request?.[key];
    if (value !== undefined) next[key] = value;
  }
  const duplex = isStreamBody(body) ? (init?.duplex ?? request?.duplex ?? "half") : undefined;
  if (duplex !== undefined) next.duplex = duplex;
  else delete next.duplex;
  if (body !== undefined) next.body = body;
  else delete next.body;

  if (typeof input === "string" || input instanceof URL) return { target: input, init: next };
  return {
    target: requestUrl(input),
    init: { ...next, method: init?.method ?? request.method, signal: init?.signal ?? request.signal },
  };
}

/**
 * The outbound fetch layer for lazy-router attempts.
 * @param {{credentials: object, pinnedProviders?: Set<string>,
 *   onUpstreamRequest?: (attempt: Attempt, url: string, body: string|undefined) => void}} options
 */
export function createAttemptLayer({ credentials, pinnedProviders = new Set(), onUpstreamRequest = () => {} }) {
  return async function lazyRouterAttemptLayer(input, init, next) {
    const attempt = currentAttempt();
    if (!(attempt instanceof Attempt)) return next(input, init);

    const url = requestUrl(input);
    if (!attempt.isUpstream(url)) return next(input, init);
    if (attempt.failed) throw new AttemptAbandoned();
    attempt.contacted = true;

    if (attempt.fault) {
      attempt.settle({ ok: false, source: VERDICT_SOURCE.INJECTED, ...attempt.fault });
      throw new AttemptAbandoned(attempt.fault.message);
    }

    let call = { target: input, init };
    if (attempt.credentialId !== undefined) {
      if (pinsAtTransport(attempt.provider, pinnedProviders)) {
        if (!attempt.transportSecret) {
          const message = `lazy-router: the account of ${attempt.unit.label} is not available`;
          attempt.settle({ ok: false, status: 503, source: VERDICT_SOURCE.CREDENTIAL, message });
          throw new AttemptAbandoned(message);
        }
      } else {
        let credential = await credentials.resolve(attempt.provider, { id: attempt.credentialId });
        if (
          credential &&
          typeof credentials.refresh === "function" &&
          Number.isFinite(credential.expiresAt) &&
          credential.expiresAt > 0 &&
          Date.now() >= credential.expiresAt - 120_000
        ) {
          const fresh = await credentials.refresh(attempt.credentialId);
          if (fresh?.secret) {
            credential = {
              ...credential,
              secret: fresh.secret,
              expiresAt: fresh.expiresAt ?? credential.expiresAt,
            };
          }
        }
        if (!credential?.secret) {
          const message = `lazy-router: the account of ${attempt.unit.label} is not available`;
          attempt.settle({ ok: false, status: 503, source: VERDICT_SOURCE.CREDENTIAL, message });
          throw new AttemptAbandoned(message);
        }
        call = withHeaders(input, init, authHeadersFor(credential));
      }
    }

    const upstreamBody = requestBody(call.target, call.init);
    let rewritten = withUpstreamEffort(attempt.provider, upstreamBody, attempt.effort);
    if (providerOf(attempt.model) === "google-antigravity" && typeof (rewritten ?? upstreamBody) === "string") {
      const sanitized = sanitizeAndSerialize(rewritten ?? upstreamBody, attempt);
      if (sanitized !== undefined) rewritten = sanitized;
    }
    if (rewritten !== undefined) call = withRequestBody(call.target, call.init, rewritten);

    onUpstreamRequest(attempt, url, requestBody(call.target, call.init));

    let response;
    try {
      response = await next(call.target, call.init);
    } catch (error) {
      const kind = classifyThrownFailure(error);
      attempt.settle(
        kind === FAILURE.QUOTA
          ? {
              ok: false,
              status: 429,
              source: VERDICT_SOURCE.UPSTREAM,
              message: "upstream 429 Too Many Requests",
              category: "quota",
            }
          : kind === FAILURE.CREDENTIAL
            ? {
                ok: false,
                status: 401,
                source: VERDICT_SOURCE.CREDENTIAL,
                message: "upstream 401 Unauthorized",
              }
            : {
                ok: false,
                status: 502,
                source: VERDICT_SOURCE.NETWORK,
                message: "upstream connection failed",
                category: "network",
              },
      );
      throw error;
    }

    if (response.ok) {
      attempt.settle({ ok: true, status: response.status, source: VERDICT_SOURCE.UPSTREAM });
    } else {
      const error = await readErrorVerdict(response);
      attempt.settle({
        ok: false,
        status: response.status,
        source: VERDICT_SOURCE.UPSTREAM,
        message: error.message,
        category: error.category,
      });
    }
    return response;
  };
}

/**
 * Parse, sanitize, and serialize one Antigravity body.
 *
 * Return the rewritten body only when an enum changed; otherwise return
 * undefined so the caller sends the original bytes untouched. A body that
 * cannot be parsed or serialized is never sent unchanged: the attempt fails as
 * a local adapter error instead. A rejected call is better than a silent
 * sanitizer bypass.
 */
function sanitizeAndSerialize(body, attempt) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    report("lazy-router: Antigravity body is not JSON; attempt rejected", { model: attempt.model });
    const message = "Antigravity request body is not valid JSON";
    attempt.settle({ ok: false, status: 502, source: VERDICT_SOURCE.ADAPTER, message });
    throw new AttemptAbandoned(message);
  }
  if (!parsed || typeof parsed !== "object") {
    report("lazy-router: Antigravity body is not a JSON object; attempt rejected", { model: attempt.model });
    const message = "Antigravity request body is not an object";
    attempt.settle({ ok: false, status: 502, source: VERDICT_SOURCE.ADAPTER, message });
    throw new AttemptAbandoned(message);
  }

  if (!sanitizeAntigravityBody(parsed)) return undefined;
  try {
    return JSON.stringify(parsed);
  } catch {
    // A hostile schema can still make serialization fail. Drop the schema
    // fields inside tool declarations and retry once; never send the original
    // body, and never touch conversation history.
    dropSchemaFields(parsed);
    try {
      return JSON.stringify(parsed);
    } catch {
      report("lazy-router: Antigravity body cannot be serialized; attempt rejected", { model: attempt.model });
      const message = "Antigravity request body cannot be serialized";
      attempt.settle({ ok: false, status: 502, source: VERDICT_SOURCE.ADAPTER, message });
      throw new AttemptAbandoned(message);
    }
  }
}

/** Remove every parameter schema from the tool declarations of a parsed body. */
function dropSchemaFields(body) {
  for (const tools of [body?.request?.tools, body?.tools]) {
    if (!Array.isArray(tools)) continue;
    for (const tool of tools) {
      if (!tool || typeof tool !== "object") continue;
      for (const key of ["functionDeclarations", "function_declarations"]) {
        const declarations = tool[key];
        if (!Array.isArray(declarations)) continue;
        for (const declaration of declarations) {
          if (!declaration || typeof declaration !== "object") continue;
          for (const schemaKey of ["parameters", "parametersJsonSchema", "parameters_json_schema"]) {
            delete declaration[schemaKey];
          }
        }
      }
    }
  }
}

/** Read the abort signal of a call pair, for callers that need it. */
export { callSignal };
