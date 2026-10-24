// Antigravity envelope rewrites, applied to every outbound Cloud Code stream request:
//
// The Cloud Code Assist backend answers requests carrying a top-level
// `request.systemInstruction` with a bogus 429 RESOURCE_EXHAUSTED even when the
// account has quota. The identical prompt sent as a regular `user` turn is
// accepted. Only Antigravity agent envelopes (requestType "agent") are touched,
// so the shim is endpoint and version agnostic.
//
// The same layer also raises a floor on `maxOutputTokens`. Small clients
// (title generators, some agents) send 4096; on long turns a function call
// whose JSON arguments cross that cap is truncated mid-stream, and the Cloud
// Code backend answers the truncated call with MALFORMED_FUNCTION_CALL. Giving
// the first request the same headroom the continuation retries already get
// removes that trigger instead of recovering from it after the fact.

import {
  isCloudCodeStream,
  requestUrl,
  rewriteRequestBody,
  addFetchHandler as sharedAddFetchHandler,
} from "../lib/fetch-chain.js";

const MIN_OUTPUT_BUDGET = 8192;
const EMPTY_AGENT_PROMPT = "Continue.";

export function install(_config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];

  function rewriteEnvelope(bodyString) {
    let parsed;
    try {
      parsed = JSON.parse(bodyString);
    } catch {
      return undefined;
    }

    const request = parsed?.request;
    if (!request) return undefined;

    // Only Antigravity agent envelopes use requestType "agent".
    const isAgent = parsed.requestType === "agent";
    let changed = false;

    const system = isAgent ? request.systemInstruction : undefined;
    if (system && Array.isArray(system.parts) && system.parts.length > 0) {
      request.contents = [
        { role: "user", parts: system.parts },
        ...(Array.isArray(request.contents) ? request.contents : []),
      ];
      delete request.systemInstruction;
      changed = true;
    }

    if (isAgent) {
      // The host schema permits an empty OpenAI messages array, but Cloud Code
      // rejects an empty native `contents` with INVALID_ARGUMENT. Treat an
      // empty agent turn as the same continuation nudge we already use when a
      // repaired history ends on the model, rather than sending an invalid
      // provider payload and then blaming/cooling a healthy account.
      if (!Array.isArray(request.contents) || request.contents.length === 0) {
        request.contents = [{ role: "user", parts: [{ text: EMPTY_AGENT_PROMPT }] }];
        changed = true;
      }

      const generation = request.generationConfig;
      if (generation && typeof generation.maxOutputTokens === "number" && generation.maxOutputTokens > 0 && generation.maxOutputTokens < MIN_OUTPUT_BUDGET) {
        generation.maxOutputTokens = MIN_OUTPUT_BUDGET;
        changed = true;
      }
    }

    return changed ? JSON.stringify(parsed) : undefined;
  }

  return addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return next(input, init);

    // rewriteRequestBody returns undefined when there is nothing to rewrite.
    return rewriteRequestBody(next, input, init, rewriteEnvelope) ?? next(input, init);
  });
}
