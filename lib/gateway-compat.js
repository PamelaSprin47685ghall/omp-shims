// Provider-neutral compatibility for incoming OpenAI-style optional values.
//
// Mistral Vibe's official SDK emits absent optional arguments as JSON null,
// e.g. {"tools":null,"metadata":null}. OMP's auth-gateway validates these as
// wrong types instead of treating them as omitted, before provider selection.
// Strip only documented top-level optional nulls; never mutate message bodies,
// explicit empty arrays, or protocol-specific meaningful null values.

const OPTIONAL_NULL_FIELDS = Object.freeze({
  "/v1/chat/completions": new Set(["tools", "metadata"]),
  "/v1/responses": new Set(["tools", "metadata"]),
  "/v1/messages": new Set(["tools", "metadata"]),
});

/**
 * Return rewritten JSON or undefined when no change is necessary.
 * Malformed payloads remain untouched for the Gateway's native validation.
 */
export function normalizeOptionalNulls(pathname, body) {
  const fields = OPTIONAL_NULL_FIELDS[pathname];
  if (!fields || !body || Array.isArray(body) || typeof body !== "object") return false;
  let modified = false;
  for (const field of fields) {
    if (Object.hasOwn(body, field) && body[field] === null) {
      delete body[field];
      modified = true;
    }
  }
  return modified;
}

/** Text-in/text-out form of the same normalization, for callers without a parsed body. */
export function normalizeGatewayOptionalNulls(pathname, text) {
  if (!OPTIONAL_NULL_FIELDS[pathname] || typeof text !== "string") return undefined;
  let body;
  try { body = JSON.parse(text); } catch { return undefined; }
  return normalizeOptionalNulls(pathname, body) ? JSON.stringify(body) : undefined;
}

export const GATEWAY_COMPAT_PATHS = Object.freeze(new Set(Object.keys(OPTIONAL_NULL_FIELDS)));
