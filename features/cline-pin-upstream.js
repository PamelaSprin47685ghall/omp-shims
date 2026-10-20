// ClinePass: pin chat/completions requests to fixed upstream channels, and
// supply the credential and Cline headers.
//
// Cline's gateway has two routing pipelines behind it, and each one accepts a
// different spelling of the pin:
//
//   direct  (OpenRouter)     -> top-level `provider.only`
//   planner (Vercel AI GW)   -> `providerOptions.gateway.only`
//
// Which pipeline a model uses is decided by Cline and can change over time, so
// this feature writes both spellings: Cline keeps the one it understands and
// drops the other. Writing only the nested form leaves direct models
// unpinned, and writing only the top-level form leaves planner models
// unpinned.
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
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);

const DEFAULT_MODEL_ROUTING = {
  "deepseek-v4.1-flash": { only: ["deepseek"] },
  "cline-pass/deepseek-v4.1-flash": { only: ["deepseek"] },
};

/**
 * Read the ClinePass API key from OMP's own credential store.
 *
 * The key never lives in the shim configuration: the shim is published, the
 * credential is not. `omp /login cline-pass` writes it into agent.db, and this
 * reads it back per request, so a re-login takes effect without a restart.
 */
function readKeyFromAgentDb(agentDbPath) {
  if (!existsSync(agentDbPath)) return undefined;
  try {
    const { Database } = require_("bun:sqlite");
    const db = new Database(agentDbPath, { readonly: true });
    try {
      const rows = db
        .query("SELECT data FROM auth_credentials WHERE provider = 'cline-pass' ORDER BY updated_at DESC")
        .all();
      for (const row of rows) {
        const data = JSON.parse(row.data);
        const key = data.key ?? data.apiKey ?? data.access;
        if (typeof key === "string" && key.trim() !== "") return key.trim();
      }
    } finally {
      db.close();
    }
  } catch {}
  return undefined;
}

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const target = process.env.OMP_SHIMS_CLINE_PIN_HOST || config.host || "api.cline.bot";
  const defaultUpstream = process.env.OMP_SHIMS_CLINE_PIN_UPSTREAM || config.upstream || "openai-compatible-private";
  const apiKey = process.env.OMP_SHIMS_CLINE_API_KEY || config.apiKey;
  const agentDbPath = config.agentDbPath ?? join(homedir(), ".omp", "agent", "agent.db");
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

    // Channel list for this model. `only` restricts the gateway to exactly
    // those channels; the gateway picks among them itself.
    const model = parsed.model ?? "";
    const strippedModel = model.startsWith("cline-pass/") ? model.slice("cline-pass/".length) : model;
    const targetRouting =
      modelRouting[model] ??
      modelRouting[strippedModel] ??
      (Array.isArray(defaultUpstream) ? { only: defaultUpstream } : { only: [defaultUpstream] });

    const only = Array.isArray(targetRouting) ? targetRouting : targetRouting.only;
    if (!Array.isArray(only) || only.length === 0) return next(input, init);

    // Cline's gateway has two routing pipelines and each accepts a different
    // spelling of the pin: the direct pipeline (OpenRouter) reads the
    // top-level `provider`, the planner pipeline (Vercel AI Gateway) reads
    // `providerOptions.gateway`. Which pipeline a model uses is decided by
    // Cline, so both spellings are written and the gateway keeps the one it
    // understands.
    // A pin the caller already set is more specific than ours: keep it.
    const callerOnly = parsed.provider?.only ?? parsed.providerOptions?.gateway?.only;
    if (!Array.isArray(callerOnly) || callerOnly.length === 0) {
      parsed.provider = { ...(parsed.provider ?? {}), only };
      parsed.providerOptions = {
        ...(parsed.providerOptions ?? {}),
        gateway: { ...(parsed.providerOptions?.gateway ?? {}), only },
      };
    }

    const rewritten = JSON.stringify(parsed);

    // Ensure headers include Authorization (from OMP's credential store) and
    // standard Cline headers
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) {
      const key = apiKey ?? readKeyFromAgentDb(agentDbPath);
      if (key) headers.set("Authorization", `Bearer ${key}`);
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
