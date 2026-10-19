// GitHub Copilot: dynamic Auto model routing and session token negotiation.
//
// When using GitHub Copilot with `auto` model selection (or models requiring
// session-level authorization like `mai-code-1.1-flash`), requests cannot be sent
// directly to standard endpoints without a negotiated `Copilot-Session-Token`.
//
// This shim:
// 1. Intercepts outgoing requests to api.individual.githubcopilot.com or api.githubcopilot.com.
// 2. When the model requested is "auto", "copilot-auto", or when calling models requiring session tokens:
//    - Calls /auto?apiVersion=2026-08-01 with the user prompt to negotiate the best model
//      (e.g., gpt-5.6-luna, mai-code-1.1-flash) and acquire a signed Copilot-Session-Token JWT.
//    - Injects `Copilot-Session-Token: <token>` and `X-GitHub-Api-Version: 2026-08-01`.
//    - Rewrites the model in the request body to the selected model.
//    - If the target endpoint is /chat/completions but the selected model only supports /responses,
//      it routes to /responses appropriately.

import { requestBody, requestUrl, addFetchHandler as sharedAddFetchHandler } from "../lib/fetch-chain.js";

const COPILOT_HOSTS = ["api.individual.githubcopilot.com", "api.githubcopilot.com"];
const DEFAULT_API_VERSION = "2026-08-01";

/** Extract prompt string from chat/completions or responses payload. */
export function extractPrompt(parsedBody) {
  if (!parsedBody || typeof parsedBody !== "object") return "";

  if (typeof parsedBody.prompt === "string" && parsedBody.prompt.trim()) {
    return parsedBody.prompt;
  }
  if (typeof parsedBody.input === "string" && parsedBody.input.trim()) {
    return parsedBody.input;
  }
  if (Array.isArray(parsedBody.input)) {
    for (let i = parsedBody.input.length - 1; i >= 0; i--) {
      const item = parsedBody.input[i];
      if (item && typeof item === "object") {
        if (typeof item.content === "string" && item.content.trim()) return item.content;
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part && typeof part.text === "string" && part.text.trim()) return part.text;
          }
        }
      }
    }
  }
  if (Array.isArray(parsedBody.messages)) {
    for (let i = parsedBody.messages.length - 1; i >= 0; i--) {
      const msg = parsedBody.messages[i];
      if (msg && typeof msg === "object") {
        if (typeof msg.content === "string" && msg.content.trim()) return msg.content;
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && typeof part.text === "string" && part.text.trim()) return part.text;
          }
        }
      }
    }
  }
  return "hello";
}

export function isCopilotEndpoint(url) {
  if (typeof url !== "string") return false;
  return COPILOT_HOSTS.some((host) => url.includes(host));
}

export function isAutoModel(modelName) {
  if (typeof modelName !== "string") return false;
  const name = modelName.trim().toLowerCase();
  return (
    name === "auto" ||
    name === "copilot-auto" ||
    name === "github-copilot/auto" ||
    name === "github-copilot/copilot-auto" ||
    name.startsWith("auto/") ||
    name.startsWith("copilot-auto/")
  );
}

export function install(config, context) {
  if (config?.enabled === false) return;
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const apiVersion = process.env.OMP_SHIMS_COPILOT_API_VERSION || config?.apiVersion || DEFAULT_API_VERSION;

  return addFetchHandler(async (input, init, next) => {
    const url = requestUrl(input);
    if (!isCopilotEndpoint(url)) return next(input, init);

    // Skip the negotiation endpoint itself to avoid infinite loops
    if (url.includes("/auto?")) return next(input, init);

    const bodyStr = requestBody(input, init);
    if (!bodyStr) return next(input, init);

    let parsed;
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      return next(input, init);
    }
    if (!parsed || typeof parsed !== "object") return next(input, init);

    const rawModel = parsed.model ?? "";
    const needsAutoNegotiation = isAutoModel(rawModel);

    // If caller didn't ask for auto and already has Copilot-Session-Token, pass through
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!needsAutoNegotiation && headers.has("Copilot-Session-Token")) {
      return next(input, init);
    }

    if (!needsAutoNegotiation) {
      return next(input, init);
    }

    // Perform Auto model negotiation
    const prompt = extractPrompt(parsed);
    const origin = new URL(url).origin;
    const autoUrl = `${origin}/auto?apiVersion=${encodeURIComponent(apiVersion)}`;

    const autoHeaders = new Headers(headers);
    if (!autoHeaders.has("Copilot-Integration-Id")) {
      autoHeaders.set("Copilot-Integration-Id", "vscode-chat");
    }
    if (!autoHeaders.has("X-GitHub-Api-Version")) {
      autoHeaders.set("X-GitHub-Api-Version", apiVersion);
    }
    if (!autoHeaders.has("Content-Type")) {
      autoHeaders.set("Content-Type", "application/json");
    }

    try {
      context.log?.(`copilot-auto: negotiating auto model for prompt "${prompt.slice(0, 40)}..."`);
      const autoRes = await fetch(autoUrl, {
        method: "POST",
        headers: autoHeaders,
        body: JSON.stringify({ prompt }),
      });

      if (!autoRes.ok) {
        context.log?.(`copilot-auto: negotiation failed with HTTP ${autoRes.status}`);
        return next(input, init);
      }

      const autoData = await autoRes.json();
      const sessionToken = autoData?.session_token;
      const selectedModel = autoData?.selected_model;
      const selectedModelId = selectedModel?.id;

      if (!sessionToken || !selectedModelId) {
        return next(input, init);
      }

      context.log?.(`copilot-auto: selected model "${selectedModelId}"`);

      // Update headers with session token
      headers.set("Copilot-Session-Token", sessionToken);
      headers.set("X-GitHub-Api-Version", apiVersion);
      if (!headers.has("Copilot-Integration-Id")) {
        headers.set("Copilot-Integration-Id", "vscode-chat");
      }

      // Update model in request body
      parsed.model = selectedModelId;

      // Check endpoints: if model doesn't support chat/completions but caller is on chat/completions,
      // route to /responses if supported
      let targetUrl = url;
      const supportedEndpoints = selectedModel?.supported_endpoints ?? [];
      if (
        url.includes("/chat/completions") &&
        !supportedEndpoints.includes("/chat/completions") &&
        supportedEndpoints.includes("/responses")
      ) {
        targetUrl = url.replace("/chat/completions", "/responses");
        // Convert chat messages format to input format if needed
        if (parsed.messages && !parsed.input) {
          parsed.input = parsed.messages;
          delete parsed.messages;
        }
      }

      const rewrittenBody = JSON.stringify(parsed);

      if (typeof input === "string" || input instanceof URL) {
        return next(targetUrl, { ...init, headers, body: rewrittenBody });
      }
      return next(targetUrl, {
        method: init?.method ?? input.method,
        headers,
        signal: init?.signal ?? input.signal,
        body: rewrittenBody,
      });
    } catch (err) {
      context.log?.(`copilot-auto: error during negotiation: ${err?.message ?? err}`);
      return next(input, init);
    }
  });
}
