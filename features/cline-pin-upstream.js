// ClinePass: pin every chat/completions request to a fixed upstream channel.
//
// Cline's gateway routes subscription models through Vercel AI Gateway
// ("planner" pipeline). The only pin that survives there is a top-level
// `providerOptions.gateway.only` array; top-level `provider.only` is dropped.
// This feature rewrites the outgoing body so every cline request carries the
// pin. Channel slugs come from the gateway's own routing metadata
// (provider_metadata.gateway.routing.finalProvider / affinity.pinnedProvider).
//
// Env:
//   OMP_SHIMS_CLINE_PIN_HOST      default api.cline.bot
//   OMP_SHIMS_CLINE_PIN_UPSTREAM  default openai-compatible-private
//   OMP_SHIMS_CLINE_PIN_MODELS    optional comma list; empty = all models

import {
  addFetchHandler as sharedAddFetchHandler,
  requestUrl,
  requestBody,
} from "../lib/fetch-chain.js";

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const target = config.host ?? process.env.OMP_SHIMS_CLINE_PIN_HOST ?? "api.cline.bot";
  const upstream = config.upstream ?? process.env.OMP_SHIMS_CLINE_PIN_UPSTREAM ?? "openai-compatible-private";
  const modelFilter = (config.models ?? process.env.OMP_SHIMS_CLINE_PIN_MODELS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!url.includes(target) || !url.includes("/chat/completions")) return next(input, init);

    const body = requestBody(input, init);
    if (body === undefined) return next(input, init);

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return next(input, init);
    }
    if (typeof parsed !== "object" || parsed === null) return next(input, init);

    if (modelFilter.length > 0 && !modelFilter.includes(parsed.model)) return next(input, init);

    // Idempotent: never clobber a more specific existing pin.
    const existing = parsed.providerOptions?.gateway?.only;
    if (Array.isArray(existing) && existing.length > 0) return next(input, init);

    parsed.providerOptions = { gateway: { only: [upstream] } };
    const rewritten = JSON.stringify(parsed);

    if (typeof input === "string" || input instanceof URL) {
      return next(input, { ...init, body: rewritten });
    }
    return next(requestUrl(input), {
      method: init?.method ?? input.method,
      headers: init?.headers ?? input.headers,
      signal: init?.signal ?? input.signal,
      body: rewritten,
    });
  });
}
