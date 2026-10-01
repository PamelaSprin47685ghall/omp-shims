// Antigravity: deliver the system prompt as a leading user turn.
//
// The Cloud Code Assist backend answers requests carrying a top-level
// `request.systemInstruction` with a bogus 429 RESOURCE_EXHAUSTED even when the
// account has quota. The identical prompt sent as a regular `user` turn is
// accepted. Only Antigravity agent envelopes (requestType "agent") are touched,
// so the shim is endpoint and version agnostic.

import {
  addFetchHandler as sharedAddFetchHandler,
  isCloudCodeStream,
  requestUrl,
  rewriteRequestBody,
} from "../lib/fetch-chain.js";

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];

  function moveSystemPromptIntoContents(bodyString) {
    if (!bodyString.includes('"systemInstruction"')) return undefined;

    let parsed;
    try {
      parsed = JSON.parse(bodyString);
    } catch {
      return undefined;
    }

    const request = parsed?.request;
    const system = request?.systemInstruction;
    if (!system || !Array.isArray(system.parts) || system.parts.length === 0) return undefined;
    // Only Antigravity agent envelopes use requestType "agent".
    if (parsed.requestType !== "agent") return undefined;

    request.contents = [{ role: "user", parts: system.parts }, ...(Array.isArray(request.contents) ? request.contents : [])];
    delete request.systemInstruction;
    return JSON.stringify(parsed);
  }

  return addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return next(input, init);

    // rewriteRequestBody returns undefined when there is nothing to rewrite.
    return rewriteRequestBody(next, input, init, moveSystemPromptIntoContents) ?? next(input, init);
  });
}