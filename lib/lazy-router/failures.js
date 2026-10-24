// What a failed attempt says about its unit.
//
// The router reacts to a failure according to whose fault it was:
//
//   CLIENT_GONE       the client closed the request. Nothing is wrong with the
//                     unit: no cooldown, no probe, and no further attempt,
//                     because nobody is waiting for the answer any more.
//   STALE_CONNECTION  the provider call died on the socket before a single
//                     byte came back (a pooled keep-alive connection the far
//                     end had already closed). Retrying at once opens a fresh
//                     connection; a probe would only add latency.
//   QUOTA             the account has run out of quota or credit. A probe
//                     would hit the same wall, so the unit cools at once and
//                     the request moves on.
//   UNIT              anything else: the unit may be down. Probe it, then
//                     retry once or cool it.

import { VERDICT_SOURCE } from "./attempt.js";

export const FAILURE = Object.freeze({
  CLIENT_GONE: "client-gone",
  STALE_CONNECTION: "stale-connection",
  QUOTA: "quota",
  REQUEST: "request",
  UNIT: "unit",
});

/** nginx's "client closed request", which the gateway also answers with. */
export const CLIENT_CLOSED_STATUS = 499;
const PAYMENT_REQUIRED_STATUS = 402;

/** Socket-level errors a fresh connection cures (Bun and Node wordings). */
const STALE_CONNECTION_ERRORS = [
  /\bconnection was closed\b/i,
  /\bsocket connection was closed unexpectedly\b/i,
  /\bECONNRESET\b/,
  /\bEPIPE\b/,
  /\bsocket hang up\b/i,
];

/**
 * Exhausted-quota answers. Providers word them freely and often wrap them in a
 * 429 or even a 5xx, so the text decides, not the status alone.
 */
const QUOTA_ERRORS = [
  /错误码\s*1(?:10|13|16|17|18|19|22)\b/, // Qoder CN, raw or reformatted
  /\bcode\s*1(?:10|13|16|17|18|19|22)\b/i, // Qoder global plugin wording
  /serviceAvailable:false[\s\S]*\bRESOURCE_LIMIT\b/i, // Qoder account/lane hard capacity, often wrapped as stream 502
  /额度(限制|不足|用尽|已用完)/,
  /credits?\s*(exhausted|limit reached)/i,
  /user provided api key rate limit exceeded/i,
  /billing daily count exceeded/i,
  /daily usage limit reached/i,
  /free usage limit .* reached/i,
  /\binsufficient[_ ]quota\b/i,
  /\bquota[_ ](exceeded|exhausted)\b/i,
  /\b(exceeded|exhausted) (your|the|its) (current |daily |monthly )?quota\b/i,
  /\b(daily|monthly) (count|limit|quota) exceeded\b/i,
  /\binsufficient[_ ](balance|credits?)\b/i,
];

/**
 * The provider plugin crashed before it could talk upstream (a missing host
 * transport, a null content block). Probing the same unit repeats the crash,
 * so the request must move on.
 */
const PROVIDER_BUGS = [
  /is not an object \(evaluating ['\"][^'\"]*content\.length['\"]\)/i,
  /No transport registered for api\b/i,
];


/** Request/model incompatibilities that say nothing about account health. */
const REQUEST_ERRORS = [
  /invalid_parameter_error/i,
  /invalid_request_error/i,
  /Invalid input\. Please review your request/i,
  /input token count exceeds the maximum number of tokens allowed/i,
  /maximum context length is \d+ tokens/i,
  /GenerateContentRequest\.contents: contents is not specified/i,
];

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

const matchesAny = (patterns, text) => patterns.some((pattern) => pattern.test(text));

/**
 * Classify a failed attempt.
 * @param {import("./dispatcher.js").Outcome} outcome
 * @param {AbortSignal} [clientSignal] the client's request signal
 * @returns {string} one of FAILURE
 */
export function classifyFailure({ verdict, upstreamContacted }, clientSignal) {
  if (clientSignal?.aborted || verdict.status === CLIENT_CLOSED_STATUS) return FAILURE.CLIENT_GONE;
  const message = verdict.message ?? "";
  if (verdict.source === VERDICT_SOURCE.NETWORK && upstreamContacted && matchesAny(STALE_CONNECTION_ERRORS, message)) {
    return FAILURE.STALE_CONNECTION;
  }
  if (verdict.status === PAYMENT_REQUIRED_STATUS || matchesAny(QUOTA_ERRORS, message)) return FAILURE.QUOTA;
  if (verdict.status === 400 || matchesAny(REQUEST_ERRORS, message)) return FAILURE.REQUEST;
  if (matchesAny(PROVIDER_BUGS, message)) return FAILURE.QUOTA;
  return FAILURE.UNIT;
}
