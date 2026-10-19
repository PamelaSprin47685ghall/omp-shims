// ClinePass: pin chat/completions requests to fixed upstream channels (providerOptions.gateway.only)
// and ensure proper headers / API keys for Cline.
//
// Cline's gateway routes subscription models through Vercel AI Gateway
// ("planner" pipeline). The only pin that survives there is a top-level
// `providerOptions.gateway.only` array; top-level `provider.only` is dropped.
//
// Default per-model channels:
//   deepseek-v4.1-flash -> deepseek
//   others -> openai-compatible-private (or fallback)
//
// Env (each overrides the matching setting in ~/.omp/shims.json):
//   OMP_SHIMS_CLINE_PIN_HOST      default api.cline.bot
//   OMP_SHIMS_CLINE_PIN_UPSTREAM  default openai-compatible-private
//   OMP_SHIMS_CLINE_PIN_MODELS    optional comma list; empty = all models
//   OMP_SHIMS_CLINE_API_KEY       ClinePass API key, used only when the request
//                                 carries no Authorization header (no default)

import { requestBody, requestUrl, addFetchHandler as sharedAddFetchHandler } from "../lib/fetch-chain.js";

const DEFAULT_MODEL_CHANNELS = {
  "deepseek-v4.1-flash": ["deepseek"],
  "cline-pass/deepseek-v4.1-flash": ["deepseek"],
};

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const target = process.env.OMP_SHIMS_CLINE_PIN_HOST || config.host || "api.cline.bot";
  const defaultUpstream = process.env.OMP_SHIMS_CLINE_PIN_UPSTREAM || config.upstream || "openai-compatible-private";
  const apiKey = process.env.OMP_SHIMS_CLINE_API_KEY || config.apiKey;
  const modelChannels = {
    ...DEFAULT_MODEL_CHANNELS,
    ...(config.modelChannels ?? {}),
  };
  const modelFilter = (process.env.OMP_SHIMS_CLINE_PIN_MODELS || config.models || "")
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

    // Determine channel for model
    const model = parsed.model ?? "";
    const strippedModel = model.startsWith("cline-pass/") ? model.slice("cline-pass/".length) : model;
    const targetChannels =
      modelChannels[model] ??
      modelChannels[strippedModel] ??
      (Array.isArray(defaultUpstream) ? defaultUpstream : [defaultUpstream]);

    // If caller didn't provide specific pin, inject it
    const existing = parsed.providerOptions?.gateway?.only;
    if (!Array.isArray(existing) || existing.length === 0) {
      parsed.providerOptions = {
        ...(parsed.providerOptions ?? {}),
        gateway: {
          ...(parsed.providerOptions?.gateway ?? {}),
          only: targetChannels,
        },
      };
    }

    const rewritten = JSON.stringify(parsed);

    // Ensure headers include Authorization (if configured) and standard Cline headers
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (apiKey && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }
    if (!headers.has("HTTP-Referer")) {
      headers.set("HTTP-Referer", "https://cline.bot");
    }
    if (!headers.has("X-Title")) {
      headers.set("X-Title", "Cline");
    }

    if (typeof input === "string" || input instanceof URL) {
      return next(input, { ...init, headers, body: rewritten });
    }
    return next(requestUrl(input), {
      method: init?.method ?? input.method,
      headers,
      signal: init?.signal ?? input.signal,
      body: rewritten,
    });
  });
}
