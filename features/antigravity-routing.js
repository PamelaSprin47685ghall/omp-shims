// Antigravity: Gemini Flash tiered routing.
//
// Upstream only serves the Gemini 3.6/3.7/3.8 Flash families under their
// `-tiered` model ids with a thinking level instead of a thinking budget. This
// rewrites the outgoing envelope so those models reach a working route, and
// leaves every other model untouched.
//
// Env:
//   OMP_SHIMS_AG_EFFORT    default thinking level when the caller asks for none
//                          (extra-low | minimal | low | medium | high)

import {
  addFetchHandler as sharedAddFetchHandler,
  isCloudCodeStream,
  requestUrl,
  rewriteRequestBody,
} from "../lib/fetch-chain.js";

const TIERED_PATTERN = /^(gemini-3\.[678]-flash)(?:-(?:minimal|low|medium|high|tiered))?$/;
const EFFORT_LEVELS = {
  "extra-low": "LOW",
  minimal: "MINIMAL",
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

function resolveRoute(model, request, defaultLevel) {
  const match = TIERED_PATTERN.exec(model);
  if (!match) return undefined;

  let level;
  if (/-(?:minimal|low)$/.test(model)) level = "LOW";
  else if (/-medium$/.test(model)) level = "MEDIUM";
  else if (/-high$/.test(model)) level = "HIGH";

  if (level === undefined) {
    const requested = request?.generationConfig?.thinkingConfig?.thinkingLevel;
    if (requested === "LOW" || requested === "MINIMAL") level = "LOW";
    else if (requested === "MEDIUM") level = "MEDIUM";
    else if (requested === "HIGH") level = "HIGH";
  }

  return { model: `${match[1]}-tiered`, level: level ?? defaultLevel };
}

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];
  const defaultLevel = EFFORT_LEVELS[String(config.effort ?? "high").toLowerCase()] ?? "HIGH";

  function route(bodyString) {
    let parsed;
    try {
      parsed = JSON.parse(bodyString);
    } catch {
      return undefined;
    }
    if (parsed?.requestType !== "agent" || typeof parsed.model !== "string") return undefined;

    const request = (parsed.request ??= {});
    const target = resolveRoute(parsed.model, request, defaultLevel);
    if (target === undefined) return undefined;

    const generation = (request.generationConfig ??= {});
    const maxTokens = typeof generation.maxOutputTokens === "number" ? generation.maxOutputTokens : 0;
    // Forcing thinking on a tiny output budget makes thoughts eat the whole
    // budget and truncates before any answer; leave those requests alone.
    if (maxTokens > 0 && maxTokens < 256) return undefined;

    parsed.model = target.model;
    const thinking = (generation.thinkingConfig ??= {});
    delete thinking.thinkingBudget;
    thinking.thinkingLevel = target.level;
    return JSON.stringify(parsed);
  }

  return addFetchHandler((input, init, originalFetch) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return undefined;

    return rewriteRequestBody(originalFetch, this, input, init, route);
  });
}