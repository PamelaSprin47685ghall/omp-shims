// One attempt = one candidate (unit + model) serving one gateway request.
//
// The attempt is the AsyncLocalStorage scope (see lib/credential-pin.js) for
// everything the gateway does while serving it. On the outbound side the
// attempt layer:
//   - injects the pinned account's auth headers into the provider call;
//   - reports the provider's status the moment its headers arrive, which is
//     what the router decides on (the gateway itself answers a stream with
//     200 before it has heard from upstream, and retries errors for a while);
//   - stops further provider calls once the attempt has failed, so the
//     gateway's own retries cannot outrun the router's failover;
//   - re-points broker block reports at the pinned credential, so quota
//     blocks land on the account that actually failed;
//   - writes the attempt's effort into the provider body for providers whose
//     plugin would drop it (see upstream-effort.js).

import { currentPinScope } from "../credential-pin.js";
import { requestBody, requestUrl, withRequestBody } from "../fetch-chain.js";
import { authHeadersFor } from "./credentials.js";
import { withUpstreamEffort } from "./upstream-effort.js";

/** Where an attempt's verdict came from. */
export const VERDICT_SOURCE = Object.freeze({
  UPSTREAM: "upstream",
  GATEWAY: "gateway",
  STREAM: "stream",
  NETWORK: "network",
  TIMEOUT: "timeout",
  INJECTED: "injected",
  CREDENTIAL: "credential",
});

/** Bytes of an upstream error body kept for logs and the client. */
export const ERROR_SNIPPET_CHARS = 2_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const BROKER_BLOCK_PATH = /\/v1\/credential\/(\d+)\/(blocks?)(?=$|[?#])/;

/** Thrown into the gateway when the router has already given up on an attempt. */
export class AttemptAbandoned extends Error {
  constructor(message = "lazy-router: attempt abandoned") {
    super(message);
    this.name = "AttemptAbandoned";
  }
}

/**
 * @typedef {{ok: boolean, status: number, source: string, message?: string}} Verdict
 */

export class Attempt {
  /**
   * @param {{unit: import("./units.js").Unit, model: string, effort?: string,
   *   upstreamHost?: string, fault?: {status: number, message: string}}} options
   *   effort: the level the router chose for this attempt (undefined: none sent)
   */
  constructor({ unit, model, effort, upstreamHost, fault }) {
    this.unit = unit;
    this.provider = unit.provider;
    this.credentialId = unit.credentialId;
    this.model = model;
    this.effort = effort;
    this.upstreamHost = upstreamHost;
    this.fault = fault;
    /** True once the provider call has left (or would have left) the process. */
    this.contacted = false;
    /** @type {Verdict|undefined} */
    this.result = undefined;
    /** @type {Promise<Verdict>} */
    this.verdict = new Promise((resolve) => {
      this.resolveVerdict = resolve;
    });
  }

  /** Record the first verdict; later ones are ignored. */
  settle(verdict) {
    if (this.result) return;
    this.result = verdict;
    this.resolveVerdict(verdict);
  }

  /** Mark the attempt failed (even after an earlier "ok") and return the failing verdict. */
  fail(verdict) {
    if (this.failed) return this.result;
    this.result = verdict;
    this.resolveVerdict(verdict);
    return verdict;
  }

  get failed() {
    return this.result?.ok === false;
  }

  /** True for the provider call (as opposed to broker, loopback or helper traffic). */
  isUpstream(url) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    if (LOOPBACK_HOSTS.has(host)) return false;
    return this.upstreamHost ? host === this.upstreamHost || host.endsWith(`.${this.upstreamHost}`) : true;
  }
}

/** The useful head of an error body. */
export async function errorSnippet(response) {
  try {
    return (await response.clone().text()).slice(0, ERROR_SNIPPET_CHARS);
  } catch {
    return "";
  }
}

/** Re-target a (input, init) pair at a new URL, keeping method, headers and body. */
function withUrl(input, url) {
  return typeof input === "string" || input instanceof URL ? url : new Request(url, input);
}

/** Merge headers into an outbound call without spreading init over a Request. */
function withHeaders(input, init, extra) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  if (typeof input === "string" || input instanceof URL) return { target: input, init: { ...init, headers } };
  return {
    target: requestUrl(input),
    init: {
      method: init?.method ?? input.method,
      headers,
      signal: init?.signal ?? input.signal,
      body: init?.body ?? input.body,
      ...(input.body ? { duplex: "half" } : {}),
    },
  };
}

/**
 * The outbound fetch layer for lazy-router attempts.
 * @param {{credentials: import("./credentials.js").CredentialStore,
 *   onUpstreamRequest?: (attempt: Attempt, url: string, body: string|undefined) => void}} options
 */
export function createAttemptLayer({ credentials, onUpstreamRequest = () => {} }) {
  return async function lazyRouterAttemptLayer(input, init, next) {
    const attempt = currentPinScope();
    if (!(attempt instanceof Attempt)) return next(input, init);

    const url = requestUrl(input);
    if (credentials.isBrokerUrl(url)) return next(withUrl(input, attributeToPin(url, attempt, credentials)), init);
    if (!attempt.isUpstream(url)) return next(input, init);
    if (attempt.failed) throw new AttemptAbandoned();
    attempt.contacted = true;

    if (attempt.fault) {
      attempt.settle({ ok: false, source: VERDICT_SOURCE.INJECTED, ...attempt.fault });
      throw new AttemptAbandoned(attempt.fault.message);
    }

    let call = { target: input, init };
    if (attempt.credentialId !== undefined) {
      const credential = await credentials.resolve(attempt.credentialId);
      if (!credential) {
        const message = `lazy-router: the account of ${attempt.unit.label} is not available`;
        attempt.settle({ ok: false, status: 503, source: VERDICT_SOURCE.CREDENTIAL, message });
        throw new AttemptAbandoned(message);
      }
      call = withHeaders(input, init, authHeadersFor(credential));
    }

    const effortBody = withUpstreamEffort(attempt.provider, requestBody(call.target, call.init), attempt.effort);
    if (effortBody !== undefined) call = withRequestBody(call.target, call.init, effortBody);

    onUpstreamRequest(attempt, url, requestBody(call.target, call.init));

    let response;
    try {
      response = await next(call.target, call.init);
    } catch (error) {
      attempt.settle({
        ok: false,
        status: 502,
        source: VERDICT_SOURCE.NETWORK,
        message: String(error?.message ?? error),
      });
      throw error;
    }
    if (response.ok) attempt.settle({ ok: true, status: response.status, source: VERDICT_SOURCE.UPSTREAM });
    else {
      attempt.settle({
        ok: false,
        status: response.status,
        source: VERDICT_SOURCE.UPSTREAM,
        message: await errorSnippet(response),
      });
    }
    return response;
  };
}

/**
 * Point a broker block call at the pinned credential when the gateway files it
 * against another account of the same provider (the one it would have used).
 */
export function attributeToPin(url, attempt, credentials) {
  if (attempt.credentialId === undefined) return url;
  const match = BROKER_BLOCK_PATH.exec(url);
  if (!match) return url;
  const reported = Number(match[1]);
  if (reported === attempt.credentialId || credentials.providerOf(reported) !== attempt.provider) return url;
  return url.replace(BROKER_BLOCK_PATH, `/v1/credential/${attempt.credentialId}/${match[2]}`);
}
