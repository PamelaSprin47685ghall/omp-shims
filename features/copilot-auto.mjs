// GitHub Copilot: Auto model negotiation and session-token injection.
//
// Two separate problems share one negotiation:
//
//   * "auto" is a virtual model. The gateway cannot validate it, so an inbound
//     middleware rewrites it to a known bootstrap model and remembers the real
//     request in request scope.
//   * modern Copilot models require a negotiated Copilot-Session-Token. The
//     outbound layer asks /auto for a session and adopts the model it selected.
//
// The requested alias never enters the request body. A private field would be
// stripped by the gateway or, worse, forwarded upstream. AsyncLocalStorage
// carries the alias across the gateway instead, keyed by a correlation id.
//
// All hosts are matched exactly, and every body read is replayed when it came
// from a stream, so `next()` always receives a readable body.

import { AsyncLocalStorage } from "node:async_hooks";
import { matchHttpsHost, preserveResponseUrl, report } from "../lib/contracts.mjs";
import { addInboundMiddleware, middlewarePriority, readJson, withBody } from "../lib/inbound.mjs";
import {
  addFetchHandler,
  bypassFetch,
  outboundPriority,
  readOutboundBodyText,
  requestBody,
  requestUrl,
  withRequestBody,
} from "../lib/outbound.mjs";
import { newRequestId } from "../lib/telemetry.mjs";
import copilotPolicy from "../presets/copilot.json" with { type: "json" };
import routePolicy from "../presets/routes.json" with { type: "json" };

export const name = "copilot-auto";
export const phase = "outbound";

/** Exact Copilot API hosts. No substring match is allowed. */
export const COPILOT_HOSTS = Object.freeze(["api.githubcopilot.com", "api.individual.githubcopilot.com"]);

const AUTO_TIMEOUT_MS = 30_000;
const MAX_BODY_CHARS = 16 * 1024 * 1024;

/** The route-id namespace the Lazy Router owns. */
const CLIENT_ONLY_PREFIX = routePolicy.clientOnlyPrefix;

const AUTO_MODEL_ENTRIES = [
  {
    id: "github-copilot/auto",
    object: "model",
    owned_by: "github-copilot",
    api: "openai-completions",
    display_name: "Copilot Auto",
    input_modalities: ["text", "image"],
    context_length: 1050000,
    max_output_tokens: 128000,
  },
];

/** Request-scoped state. The gateway sits between the two layers. */
const autoScope = new AsyncLocalStorage();

/** Extract a prompt string from a chat/completions or responses payload. */
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
      const message = parsedBody.messages[i];
      if (message && typeof message === "object") {
        if (typeof message.content === "string" && message.content.trim()) return message.content;
        if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part && typeof part.text === "string" && part.text.trim()) return part.text;
          }
        }
      }
    }
  }
  return "hello";
}

/** True for one of the two exact Copilot hosts. */
export function isCopilotEndpoint(url) {
  return matchHttpsHost(url, COPILOT_HOSTS).matched;
}

/** True when a model name is an Auto alias. */
export function isAutoModel(modelName) {
  if (typeof modelName !== "string") return false;
  const name = modelName.trim().toLowerCase();
  return (
    name === "auto" ||
    name === "copilot-auto" ||
    name === "copilot/auto" ||
    name === "github-copilot/auto" ||
    name === "github-copilot/copilot-auto" ||
    name.startsWith("auto/") ||
    name.startsWith("copilot-auto/") ||
    name.startsWith("copilot/auto/")
  );
}

/** Read an outbound body and note whether it must be replayed. */
async function readBody(input, init) {
  const inline = requestBody(input, init);
  if (inline !== undefined) return { text: inline, replayed: false };
  const text = await readOutboundBodyText(input, init);
  if (text === undefined) return undefined;
  return { text, replayed: true };
}

/** Re-issue a call with the buffered body. A read body must always be sent. */
function forward(next, input, init, buffered) {
  if (!buffered?.replayed) return next(input, init);
  const { target, init: nextInit } = withRequestBody(input, init, buffered.text);
  return next(target, nextInit);
}

/** Build the inbound response with the extra model entries. */
async function injectAutoModel(request, next) {
  const response = await next(request);
  if (response?.status !== 200) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }
  if (!data || !Array.isArray(data.data)) return response;

  // The Lazy Router already filtered this listing to its public allowlist.
  // Never append concrete Copilot models after that decision.
  if (
    data.data.length > 0 &&
    data.data.every((model) => typeof model?.id === "string" && model.id.startsWith(CLIENT_ONLY_PREFIX))
  ) {
    return response;
  }

  const existing = new Set(data.data.map((model) => model?.id));
  let changed = false;
  for (const entry of AUTO_MODEL_ENTRIES) {
    if (existing.has(entry.id)) continue;
    data.data.push(entry);
    existing.add(entry.id);
    changed = true;
  }
  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return preserveResponseUrl(
    new Response(JSON.stringify(data), { status: 200, statusText: response.statusText, headers }),
    response.url,
  );
}

/** Rewrite an Auto body to the bootstrap model and remember the alias. */
async function rewriteAutoRequest(request, next, bootstrapModel) {
  const parsed = await readJson(request);
  if (!parsed || typeof parsed !== "object") return next(request);
  if (!isAutoModel(parsed.model)) return next(request);

  const rewritten = { ...parsed, model: bootstrapModel };
  const scope = { requestId: newRequestId(), requestedModel: parsed.model };
  const nextRequest = withBody(request, JSON.stringify(rewritten), rewritten);
  return autoScope.run(scope, () => next(nextRequest));
}

/** Build the session signal: caller abort plus a negotiation deadline. */
function negotiationSignal(callerSignal) {
  const deadline = AbortSignal.timeout(AUTO_TIMEOUT_MS);
  if (!callerSignal) return deadline;
  try {
    return AbortSignal.any([callerSignal, deadline]);
  } catch {
    return deadline;
  }
}

/** Move a chat/completions body to /responses form when the model needs it. */
function moveBodyToResponses(parsed) {
  if (parsed.messages && !parsed.input) {
    parsed.input = parsed.messages;
    delete parsed.messages;
  }
}

/** Move a responses body to /chat/completions form when the model needs it. */
function moveBodyToChat(parsed) {
  if (!parsed.input || parsed.messages) return;
  parsed.messages = Array.isArray(parsed.input)
    ? parsed.input.map((item) => ({
        role: item?.role ?? "user",
        content: Array.isArray(item?.content)
          ? item.content.map((part) => (part?.type === "input_text" ? { type: "text", text: part.text } : part))
          : (item?.content ?? ""),
      }))
    : [{ role: "user", content: String(parsed.input) }];
  delete parsed.input;
}

/** Choose the endpoint that serves the negotiated model. */
function targetEndpoint(url, supportedEndpoints) {
  const target = new URL(url);
  const supported = Array.isArray(supportedEndpoints) ? supportedEndpoints : [];

  if (
    target.pathname.endsWith("/chat/completions") &&
    !supported.includes("/chat/completions") &&
    supported.includes("/responses")
  ) {
    target.pathname = target.pathname.replace(/\/chat\/completions$/, "/responses");
    return { target: target.toString(), movedToResponses: true };
  }
  if (
    target.pathname.endsWith("/responses") &&
    !target.pathname.endsWith("/chat/completions") &&
    !supported.includes("/responses") &&
    supported.includes("/chat/completions")
  ) {
    target.pathname = target.pathname.replace(/\/responses$/, "/chat/completions");
    return { target: target.toString(), movedToChat: true };
  }
  return { target: url };
}

/**
 * Ask /auto for a session and rewrite the request for the selected model.
 * @returns {Promise<Response | undefined>} undefined when negotiation fails
 */
async function negotiate(context, apiVersion, url, headers, parsed) {
  const prompt = extractPrompt(parsed);
  const origin = new URL(url).origin;
  const autoUrl = `${origin}/auto?apiVersion=${encodeURIComponent(apiVersion)}`;
  const tag = context.requestId ? `copilot-auto[${context.requestId}]` : "copilot-auto";

  const autoHeaders = new Headers(headers);
  if (!autoHeaders.has("Copilot-Integration-Id")) autoHeaders.set("Copilot-Integration-Id", "vscode-chat");
  if (!autoHeaders.has("X-GitHub-Api-Version")) autoHeaders.set("X-GitHub-Api-Version", apiVersion);
  if (!autoHeaders.has("Content-Type")) autoHeaders.set("Content-Type", "application/json");

  context.log(`${tag}: negotiating auto model`);
  const response = await bypassFetch(autoUrl, {
    method: "POST",
    headers: autoHeaders,
    body: JSON.stringify({ prompt }),
    signal: negotiationSignal(context.signal),
  });

  if (!response.ok) {
    context.log(`${tag}: negotiation failed with HTTP ${response.status}`);
    return undefined;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    context.log(`${tag}: negotiation returned invalid JSON`);
    return undefined;
  }

  const sessionToken = data?.session_token;
  const selectedModel = data?.selected_model;
  const selectedModelId = selectedModel?.id;
  if (typeof sessionToken !== "string" || sessionToken === "" || typeof selectedModelId !== "string") {
    context.log(`${tag}: negotiation returned no session token or model`);
    return undefined;
  }

  context.log(`${tag}: selected model "${selectedModelId}"`);
  headers.set("Copilot-Session-Token", sessionToken);
  headers.set("X-GitHub-Api-Version", apiVersion);
  if (!headers.has("Copilot-Integration-Id")) headers.set("Copilot-Integration-Id", "vscode-chat");
  headers.delete("Content-Encoding");
  headers.delete("content-encoding");
  headers.set("Content-Type", "application/json");

  parsed.model = selectedModelId;
  const endpoint = targetEndpoint(url, selectedModel?.supported_endpoints);
  if (endpoint.movedToResponses) moveBodyToResponses(parsed);
  if (endpoint.movedToChat) moveBodyToChat(parsed);

  const body = JSON.stringify(parsed);
  const baseInit = {
    ...context.init,
    method: context.init?.method ?? (context.input instanceof Request ? context.input.method : "POST"),
    signal: context.init?.signal ?? (context.input instanceof Request ? context.input.signal : undefined),
    headers,
  };
  const { target, init } = withRequestBody(endpoint.target, baseInit, body);
  return context.next(target, init);
}

/**
 * Install the inbound middleware and the outbound handler.
 * @param {Record<string, any>} config the feature settings
 * @param {{ addInboundMiddleware?: Function, addFetchHandler?: Function, log?: Function }} context
 * @returns {() => void} a disposer
 */
export async function install(config, context = {}) {
  if (config?.enabled === false) return () => {};
  const addInbound = context.addInboundMiddleware ?? addInboundMiddleware;
  const addFetch = context.addFetchHandler ?? addFetchHandler;
  const log = context.log ?? (() => {});
  const apiVersion = config.apiVersion || copilotPolicy.apiVersion;
  const bootstrapModel = config.autoBootstrapModel || copilotPolicy.autoBootstrapModel;
  const disposers = [];

  const inbound = async (request, _server, next) => {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/v1/models") {
        return injectAutoModel(request, next);
      }
      if (
        request.method === "POST" &&
        (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/messages" || url.pathname === "/v1/responses")
      ) {
        return rewriteAutoRequest(request, next, bootstrapModel);
      }
    } catch (error) {
      report("copilot-auto: inbound middleware failed", { error: error?.message ?? String(error) });
    }
    return next(request);
  };

  const outbound = async (input, init, next) => {
    const url = requestUrl(input);
    if (!isCopilotEndpoint(url)) return next(input, init);

    // Never negotiate the negotiation endpoint itself.
    try {
      if (new URL(url).pathname === "/auto") return next(input, init);
    } catch {
      return next(input, init);
    }

    // A declared oversized body is never decompressed or parsed here.
    try {
      const declared = Number(
        new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get("content-length"),
      );
      if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return next(input, init);
    } catch {}

    const buffered = await readBody(input, init);
    if (buffered === undefined) return next(input, init);
    if (buffered.text.length > MAX_BODY_CHARS) return forward(next, input, init, buffered);

    let parsed;
    try {
      parsed = JSON.parse(buffered.text);
    } catch {
      return forward(next, input, init, buffered);
    }
    if (!parsed || typeof parsed !== "object") return forward(next, input, init, buffered);

    const scope = autoScope.getStore();
    const requestedModel = scope?.requestedModel ?? parsed.model ?? "";
    const needsAutoNegotiation = isAutoModel(requestedModel);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    if (!needsAutoNegotiation && headers.has("Copilot-Session-Token")) {
      return forward(next, input, init, buffered);
    }

    // A modern model can reject the first pass with model_not_supported.
    // Legacy models succeed here and never pay for negotiation.
    let fallbackError = null;
    if (!needsAutoNegotiation) {
      const response = await forward(next, input, init, buffered);
      if (response.status !== 400) return response;
      let errorText = "";
      try {
        errorText = await response.clone().text();
      } catch {}
      if (!errorText.includes("model_not_supported")) return response;
      fallbackError = new Response(errorText, {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      try {
        await response.body?.cancel();
      } catch {}
    }

    try {
      const response = await negotiate(
        {
          log,
          input,
          init,
          next,
          signal: init?.signal ?? (input instanceof Request ? input.signal : undefined),
          requestId: scope?.requestId,
        },
        apiVersion,
        url,
        headers,
        parsed,
      );
      return response ?? fallbackError ?? forward(next, input, init, buffered);
    } catch (error) {
      log(`copilot-auto: error during negotiation: ${error?.message ?? error}`);
      return fallbackError ?? forward(next, input, init, buffered);
    }
  };

  const disposeInbound = addInbound(inbound, { name: "copilot-auto", priority: middlewarePriority.copilotAuto });
  if (typeof disposeInbound === "function") disposers.push(disposeInbound);
  const disposeOutbound = addFetch(outbound, { name: "copilot-auto", priority: outboundPriority.copilotAuto });
  if (typeof disposeOutbound === "function") disposers.push(disposeOutbound);

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {}
    }
  };
}
