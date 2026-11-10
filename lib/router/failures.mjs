// What a failed attempt says about its unit.
//
// Classification is status first. A status code is a fact the provider
// reported. Quota wording is reduced to a category by the transport layer,
// because providers wrap an exhausted account in many statuses (400, 402, 403,
// 429, even 500) and the wording is the only reliable marker that the account
// is spent rather than the request being wrong. This layer never reads text.
//
//   CLIENT_GONE       the client closed the request. Nothing is wrong with the
//                     unit: no cooldown, no probe, no further attempt.
//   STALE_CONNECTION  the provider call died before any answer. A fresh
//                     connection cures it; a probe only adds latency.
//   QUOTA             the account is out of quota or credit.
//   THROTTLE          a short-lived rate limit.
//   CREDENTIAL        the provider rejected the account's credential.
//   TRANSIENT         a temporary provider or network fault.
//   REQUEST           the request cannot be served by this model.
//   UNIT              anything else: the unit may be down.
//   ADAPTER           a local conversion or transport bug. Never account quota.

/** The failure kinds. */
export const FAILURE = Object.freeze({
  CLIENT_GONE: "client-gone",
  STALE_CONNECTION: "stale-connection",
  QUOTA: "quota",
  THROTTLE: "throttle",
  CREDENTIAL: "credential",
  TRANSIENT: "transient",
  REQUEST: "request",
  UNIT: "unit",
  ADAPTER: "adapter",
});

/** nginx's "client closed request", which the gateway also answers with. */
export const CLIENT_CLOSED_STATUS = 499;

const PAYMENT_REQUIRED_STATUS = 402;
const CREDENTIAL_STATUS = new Set([401, 403]);
// A 404 that reached the provider says this model does not exist there; the
// router treats it as a request failure for that model. A 413 or 422 can also
// be a provider-side limit, so neither may stop failover.
const REQUEST_STATUS = new Set([400, 404]);
const TRANSIENT_STATUS = new Set([408, 500, 502, 503, 504]);

/**
 * Minimum context window implied by an upstream context-length rejection.
 * Returns 0 when the error carries no usable context-size evidence.
 */
export function requestContextRequirement(message = "") {
  const actual = message.match(/messages resulted in\s*(\d+)\s*tokens/i)?.[1];
  if (actual) return Number(actual) || 0;
  const maximum =
    message.match(/maximum number of tokens allowed\s*\((\d+)\)/i)?.[1] ??
    message.match(/maximum context length is\s*(\d+)\s*tokens/i)?.[1];
  return maximum ? (Number(maximum) || 0) + 1 : 0;
}

/**
 * Classify a failed attempt.
 * @param {{verdict: object, upstreamContacted: boolean}} outcome
 * @param {AbortSignal} [clientSignal] the client's request signal
 * @returns {string} one of FAILURE
 */
export function classifyFailure({ verdict, upstreamContacted }, clientSignal) {
  if (clientSignal?.aborted || verdict.status === CLIENT_CLOSED_STATUS) return FAILURE.CLIENT_GONE;

  const status = Number(verdict.status) || 0;
  const source = verdict.source;

  // A conversion or transport bug in this process is not account health.
  if (source === "adapter") return FAILURE.ADAPTER;

  // The inner gateway answered 404 before contacting any provider: the
  // rewritten candidate model is unknown there. That is a routing miss for
  // this model, not a client request error, so the router fails over.
  if (!upstreamContacted && status === 404) return FAILURE.ADAPTER;

  // A network rejection before any provider answer means the pooled
  // connection was already dead. A fresh connection is the cure.
  if (source === "network" && upstreamContacted) return FAILURE.STALE_CONNECTION;

  // Account-status replies are never a client request error, whether or not
  // the provider call was observed. A provider can answer 401/402/403/429
  // before our transport sees the connection as contacted.
  if (CREDENTIAL_STATUS.has(status)) return FAILURE.CREDENTIAL;
  if (status === PAYMENT_REQUIRED_STATUS) return FAILURE.QUOTA;

  // The transport reduced quota wording to a category before the verdict.
  if (verdict.category === "quota") return FAILURE.QUOTA;

  // A 429 is an exhausted account or a rate limit. Either way it must fail
  // over; it must never tell the client that its request was malformed.
  if (status === 429) return FAILURE.QUOTA;
  if (REQUEST_STATUS.has(status)) return FAILURE.REQUEST;

  if (TRANSIENT_STATUS.has(status)) {
    if (!upstreamContacted) return FAILURE.UNIT;
    return status === 408 ? FAILURE.TRANSIENT : FAILURE.TRANSIENT;
  }

  if (source === "timeout") return FAILURE.UNIT;
  if (source === "credential") return FAILURE.CREDENTIAL;
  if (source === "network") return FAILURE.UNIT;

  return FAILURE.UNIT;
}

const THROWN_QUOTA = /quota|resource[_\s-]?exhausted|billing|payment required|retry[_\s-]?delay|maxdelayms/i;
const THROWN_CREDENTIAL = /unauthorized|forbidden|invalid_grant|credential|api key/i;

/** The provider status named by a thrown error, or 0. */
function thrownStatus(error) {
  for (const value of [error?.status, error?.statusCode, error?.code]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 400) return status;
  }
  const match = /\b(401|402|403|429)\b/.exec(String(error?.message ?? error));
  return match ? Number(match[1]) : 0;
}

/**
 * Classify a provider call that threw before returning a Response.
 *
 * A transport may throw for an exhausted account (for example a gateway retry
 * layer that rejects a many-hour retryDelay). That is account health, not a
 * network fault: the router must bench the candidate and fail over instead of
 * surfacing the provider text.
 *
 * @param {unknown} error
 * @returns {string} one of FAILURE
 */
export function classifyThrownFailure(error) {
  const status = thrownStatus(error);
  const text = String(error?.message ?? error);
  if (status === 429 || status === PAYMENT_REQUIRED_STATUS || THROWN_QUOTA.test(text)) return FAILURE.QUOTA;
  if (status === 401 || status === 403 || THROWN_CREDENTIAL.test(text)) return FAILURE.CREDENTIAL;
  return FAILURE.UNIT;
}
