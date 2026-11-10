// Drop optional JSON null fields before the gateway validates a request.
//
// Mistral Vibe's official SDK writes absent optional arguments as JSON null,
// e.g. {"tools":null,"metadata":null}. The gateway rejects those values as
// wrong types. This layer removes only the two documented top-level fields, on
// the three known POST paths. Nested message content, explicit empty arrays,
// and every other null value stay byte-identical for the gateway.
//
// The request is parsed once through the shared body cache. A malformed body
// is never touched: the gateway's own validation must see it unchanged.

import { isGatewayProcess, report } from "../lib/contracts.mjs";
import { addInboundMiddleware, middlewarePriority, readJson, withBody } from "../lib/inbound.mjs";

export const name = "gateway-compat";
export const phase = "edge";

/** Paths whose clients send the optional-null shape. */
const PATHS = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages"]);

/** The complete allow-list. Do not grow it without a provider reason. */
const FIELDS = ["tools", "metadata"];

/**
 * Delete a null optional field from a parsed body.
 * Return true only when the object changed.
 */
function normalize(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  let changed = false;
  for (const field of FIELDS) {
    if (Object.hasOwn(body, field) && body[field] === null) {
      delete body[field];
      changed = true;
    }
  }
  return changed;
}

/** Public pure form of the same rule, for tests and direct callers. */
export function normalizeOptionalNulls(pathname, body) {
  return PATHS.has(pathname) && normalize(body);
}

/** One installed layer per process. */
let active;

export async function install(config, context = {}) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) return;
  if (active) return active;

  const add = context.addInboundMiddleware ?? addInboundMiddleware;
  const log = context.log ?? (() => {});

  const dispose = add(
    async (request, _server, next) => {
      if (request.method !== "POST") return next();
      let pathname;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        return next();
      }
      if (!PATHS.has(pathname)) return next();

      try {
        const body = await readJson(request);
        if (!normalizeOptionalNulls(pathname, body)) return next();
        return next(withBody(request, JSON.stringify(body), body));
      } catch (error) {
        report("gateway-compat rewrite failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return next();
      }
    },
    { name, priority: middlewarePriority.gatewayCompat },
  );

  active = () => {
    active = undefined;
    dispose();
  };
  log("gateway-compat: optional-null normalization enabled");
  return active;
}
