// OpenAI API Flex tier for the separately configured openai-api/Terra model.
// OpenAI Codex ChatGPT subscriptions and other providers are never rewritten.
import { requestBody, requestUrl } from "./fetch-chain.js";

export const OPENAI_FLEX_TERRA = "gpt-6.1-terra";

function target(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "api.openai.com"
      && (u.port === "" || u.port === "443")
      && /^\/v1\/responses\/?$/.test(u.pathname);
  } catch { return false; }
}

/** Preserve all upstream options except for explicitly requiring the Flex tier. */
export function enforceOfficialTerraFlex(body) {
  let payload;
  try { payload = JSON.parse(body); } catch { return undefined; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
      || payload.model !== OPENAI_FLEX_TERRA) return undefined;
  if (payload.service_tier === "flex") return undefined;
  return JSON.stringify({ ...payload, service_tier: "flex" });
}

export function installOpenAiApiFlex(context) {
  if (typeof context?.addFetchHandler !== "function") return;
  context.addFetchHandler(async (input, init, next) => {
    if (!target(requestUrl(input))) return next(input, init);
    let raw = requestBody(input, init);
    if (raw === undefined && input instanceof Request && init?.body == null && !input.bodyUsed) {
      try { raw = await input.clone().text(); } catch { return next(input, init); }
    }
    if (raw === undefined) return next(input, init);
    const body = enforceOfficialTerraFlex(raw);
    if (body === undefined) return next(input, init);
    // Preserve Request form because the OpenAI SDK may use fetch(Request).
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
    headers.delete("content-length");
    if (input instanceof Request) {
      return next(new Request(input, { ...init, headers, body }));
    }
    return next(input, { ...init, headers, body });
  });
}
