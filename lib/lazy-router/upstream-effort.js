// Effort on the provider call itself, for providers whose plugin drops it.
//
// The router hands the gateway an effort in the client dialect, and the gateway
// translates it for the provider. Some provider plugins only forward an effort
// for models their own catalog marks as reasoning-capable, even though the
// endpoint reasons for others too and honours the field. For those providers
// the attempt layer writes the attempt's effort into the outgoing provider
// body directly. A writer returns false when the body is not the shape it
// knows, and the call then goes out unchanged.

/** provider → (parsed provider body, level) → whether the body was changed. */
export const UPSTREAM_EFFORT_WRITERS = Object.freeze({
  // Command Code /alpha/generate: {config, ..., params: {model, messages, ..., reasoning_effort}}.
  // pi-commandcode-provider omits reasoning_effort unless its catalog flags the model as reasoning.
  commandcode(body, level) {
    if (!body?.params || typeof body.params !== "object") return false;
    if (body.params.reasoning_effort === level) return false;
    body.params.reasoning_effort = level;
    return true;
  },
});

/**
 * The provider body with `level` written in, or undefined to leave it as is.
 * @param {string} provider
 * @param {string|undefined} body  the outgoing body, when it is an in-memory string
 * @param {string|undefined} level
 * @returns {string|undefined}
 */
export function withUpstreamEffort(provider, body, level) {
  const write = UPSTREAM_EFFORT_WRITERS[provider];
  if (!write || !level || level === "none" || typeof body !== "string") return undefined;
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  return write(parsed, level) ? JSON.stringify(parsed) : undefined;
}
