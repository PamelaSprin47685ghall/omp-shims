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

const DEFAULT_MODEL_ROUTING = {
  "deepseek-v4.1-flash": { only: ["deepseek"] },
  "cline-pass/deepseek-v4.1-flash": { only: ["deepseek"] },
  "glm-5.3-flash": {
    order: [
      "makora",
      "digitalocean",
      "wafer",
      "baseten",
      "inference-net",
      "together",
    ],
  },
  "cline-pass/glm-5.3-flash": {
    order: [
      "makora",
      "digitalocean",
      "wafer",
      "baseten",
      "inference-net",
      "together",
    ],
  },
};

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const target = process.env.OMP_SHIMS_CLINE_PIN_HOST || config.host || "api.cline.bot";
  const defaultUpstream = process.env.OMP_SHIMS_CLINE_PIN_UPSTREAM || config.upstream || "openai-compatible-private";
  const apiKey = process.env.OMP_SHIMS_CLINE_API_KEY || config.apiKey;
  const modelRouting = {
    ...DEFAULT_MODEL_ROUTING,
    ...(config.modelRouting ?? {}),
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

    // Determine routing for model
    const model = parsed.model ?? "";
    const strippedModel = model.startsWith("cline-pass/") ? model.slice("cline-pass/".length) : model;
    const targetRouting =
      modelRouting[model] ??
      modelRouting[strippedModel] ??
      (Array.isArray(defaultUpstream) ? { only: defaultUpstream } : typeof defaultUpstream === "object" ? defaultUpstream : { only: [defaultUpstream] });

    // If caller didn't provide specific gateway routing, inject it
    const existingGateway = parsed.providerOptions?.gateway;
    if (!existingGateway || (!existingGateway.only && !existingGateway.order)) {
      const gateway = { ...(parsed.providerOptions?.gateway ?? {}) };
      if (Array.isArray(targetRouting)) {
        gateway.only = targetRouting;
      } else if (typeof targetRouting === "object" && targetRouting !== null) {
        if (Array.isArray(targetRouting.only)) gateway.only = targetRouting.only;
        if (Array.isArray(targetRouting.order)) gateway.order = targetRouting.order;
      }
      parsed.providerOptions = {
        ...(parsed.providerOptions ?? {}),
        gateway,
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
