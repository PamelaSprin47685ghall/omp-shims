// Normalize optional-null request fields before OMP Gateway parses them.
// Enabled only in the gateway process, safe for all providers and route families.
import { isGatewayProcess } from "../lib/gateway-process.js";
import { readJson, withBody, wrapServe } from "../lib/inbound.js";
import { GATEWAY_COMPAT_PATHS, normalizeOptionalNulls } from "../lib/gateway-compat.js";

export function install(_config, context) {
  if (!isGatewayProcess()) return;
  wrapServe((handler) => async (request, server) => {
    if (request.method !== "POST") return handler(request, server);
    const pathname = new URL(request.url).pathname;
    if (!GATEWAY_COMPAT_PATHS.has(pathname)) return handler(request, server);
    // Parsed once for the whole inbound stack; a malformed body stays untouched
    // for the gateway's own validation.
    const body = await readJson(request);
    if (!normalizeOptionalNulls(pathname, body)) return handler(request, server);
    return handler(withBody(request, JSON.stringify(body), body), server);
  });
  context.log?.("gateway-compat: optional-null normalization enabled");
}
