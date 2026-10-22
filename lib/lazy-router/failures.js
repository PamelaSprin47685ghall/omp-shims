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
  /错误码\s*110\b/, // Qoder: Billing daily count exceeded
  /额度(限制|不足|用尽|已用完)/,
  /\binsufficient[_ ]quota\b/i,
  /\bquota[_ ](exceeded|exhausted)\b/i,
  /\b(exceeded|exhausted) (your|the|its) (current |daily |monthly )?quota\b/i,
  /\b(daily|monthly) (count|limit|quota) exceeded\b/i,
  /\binsufficient[_ ](balance|credits?)\b/i,
];

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
  return FAILURE.UNIT;
}
