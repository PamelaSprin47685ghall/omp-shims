// Normalize optional-null request fields before OMP Gateway parses them.
// Enabled only in the gateway process, safe for all providers and route families.
import { isGatewayProcess } from "../lib/gateway-process.js";
import { readBody, withBody, wrapServe } from "../lib/inbound.js";
import { GATEWAY_COMPAT_PATHS, normalizeGatewayOptionalNulls } from "../lib/gateway-compat.js";

export function install(_config, context) {
  if (!isGatewayProcess()) return;
  wrapServe((handler) => async (request, server) => {
    if (request.method !== "POST") return handler(request, server);
    const pathname = new URL(request.url).pathname;
    if (!GATEWAY_COMPAT_PATHS.has(pathname)) return handler(request, server);
    const original = await readBody(request);
    const rewritten = normalizeGatewayOptionalNulls(pathname, original);
    if (rewritten === undefined) return handler(request, server);
    return handler(withBody(request, rewritten), server);
  });
  context.log?.("gateway-compat: optional-null normalization enabled");
}
