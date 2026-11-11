// Broker-independent models.yml providers.
//
// Never send a credential to a different origin and never proxy an arbitrary
// endpoint. A provider is usable only when it declares HTTPS, no URL
// credentials/query/hash, a supported API, and a key resolver.

import { NO_AUTH_SENTINEL } from "../contracts.mjs";
import * as hostBridge from "../host-bridge.mjs";
import { readJson } from "../inbound.mjs";
import { adminTokenMatches } from "./admin-token.mjs";
import { chatAsMessages, messagesAsChat, messagesSseAsChat } from "./anthropic-codec.mjs";
import { Attempt, currentAttempt } from "./attempt.mjs";
import { splitModelRef } from "./catalog.mjs";
import { FORMATS } from "./formats.mjs";
import {
  boundedJson,
  chatAsResponses,
  convertChatResponse,
  requestAsChat,
  responsesSseAsChat,
  rewriteResponseModel,
  responsesAsChat as typedResponsesAsChat,
} from "./protocol-codec.mjs";

const ALLOWED_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);
const ROUTES = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages"]);
/** The only day-stamped Anthropic protocol version this module forwards. */
const ANTHROPIC_VERSION = /^\d{4}-\d{2}-\d{2}$/;
/** Default Anthropic protocol version when the client names none. */
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

/**
 * A deterministic client failure for one upstream status. The provider body
 * never leaves this function: it can carry billing text, a provider URL, or an
 * account identifier. The real status goes to the internal log only.
 */
function upstreamFailure(status) {
  const unavailable = status === 401 || status === 402 || status === 403 || status === 429 || status === 503;
  return Response.json(
    {
      error: {
        type: unavailable ? "lazy_router_unavailable" : "upstream_error",
        message: unavailable ? "no healthy candidate could serve this request" : "Custom provider request failed",
      },
    },
    { status: unavailable ? 503 : 502, headers: { "cache-control": "no-store" } },
  );
}

/** One deterministic adapter failure. The request never reaches the provider. */
function adapterFailure() {
  return Response.json(
    {
      error: {
        type: "adapter_unsupported",
        message: "adapter_unsupported: this model adapter cannot represent the request",
      },
    },
    { status: 502, headers: { "cache-control": "no-store" } },
  );
}

/** Build one config map from descriptors. */
export function customProviderConfigs(descriptors) {
  let list = descriptors;
  if (list === undefined) {
    try {
      list = hostBridge.listCustomProviders?.() ?? [];
    } catch {
      list = [];
    }
  }
  const configs = new Map();
  for (const descriptor of Array.isArray(list) ? list : []) {
    if (!descriptor || typeof descriptor.name !== "string" || !Array.isArray(descriptor.models)) continue;
    if (!ALLOWED_APIS.has(descriptor.api)) continue;
    let url;
    try {
      url = new URL(descriptor.baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) continue;
    for (const model of descriptor.models) {
      if (!model || typeof model.id !== "string" || model.id === "") continue;
      const ref = `${descriptor.name}/${model.id}`;
      configs.set(ref, { descriptor, model, base: url });
    }
  }
  return configs;
}

/** True when the current scope is the Lazy Router attempt for this exact model. */
function trustedAttempt(provider, model) {
  const scope = currentAttempt();
  return scope instanceof Attempt && scope.provider === provider && scope.model === model;
}

/** Build the auth headers for one custom provider. */
async function authHeaders(descriptor, api, request) {
  const headers = new Headers(descriptor.headers ?? {});
  headers.set("content-type", "application/json");
  const key = (await descriptor.resolveApiKey?.()) ?? descriptor.apiKey;
  if (typeof key === "string" && key !== "" && key !== NO_AUTH_SENTINEL) {
    const name = String(descriptor.authHeader ?? (api === "anthropic-messages" ? "x-api-key" : "authorization"));
    if (name.toLowerCase() === "x-api-key") headers.set("x-api-key", key);
    else headers.set("authorization", `Bearer ${key}`);
  }
  if (api === "anthropic-messages" && !headers.has("anthropic-version")) {
    const version = request?.headers?.get("anthropic-version");
    headers.set(
      "anthropic-version",
      typeof version === "string" && ANTHROPIC_VERSION.test(version) ? version : DEFAULT_ANTHROPIC_VERSION,
    );
  }
  return headers;
}

/**
 * One Anthropic JSON or SSE answer as a Chat answer.
 * The JSON path reads at most the codec's byte cap.
 */
async function anthropicAnswer(upstream, model) {
  if ((upstream.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return messagesSseAsChat(upstream, model);
  }
  const value = await boundedJson(upstream);
  try {
    await upstream.body?.cancel();
  } catch {
    // The cloned read already closed the source.
  }
  if (value === undefined) return adapterFailure();
  try {
    return Response.json(messagesAsChat(value, model), {
      status: upstream.status,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return adapterFailure();
  }
}

/**
 * Wrap the gateway handler with models.yml provider transports.
 * @param {Function} handler
 * @param {{tokenPath: string, fetchImpl?: typeof fetch,
 *   nativeRegistered?: (model: string) => boolean,
 *   configured?: Map<string, object>}} options
 */
export function withCustomProviderFallback(
  handler,
  { tokenPath, fetchImpl = (...args) => globalThis.fetch(...args), nativeRegistered = () => false, configured } = {},
) {
  const configs = configured ?? customProviderConfigs();

  return async function customProviderFallback(request, server) {
    if (request.method !== "POST") return handler(request, server);
    let path;
    try {
      path = new URL(request.url).pathname;
    } catch {
      return handler(request, server);
    }
    if (!ROUTES.has(path)) return handler(request, server);

    const body = await readJson(request);
    if (!body || typeof body.model !== "string") return handler(request, server);
    const found = configs.get(body.model);
    if (!found) return handler(request, server);
    const { provider } = splitModelRef(body.model);
    const trusted = trustedAttempt(provider, body.model);
    if (!trusted && (nativeRegistered(body.model) || !adminTokenMatches(request, tokenPath))) {
      return handler(request, server);
    }

    const anthropic = found.descriptor.api === "anthropic-messages";
    // The Responses dialect has no Anthropic request or answer mapping here.
    // Refuse it before the provider call so no silent misroute happens.
    if (anthropic && path === "/v1/responses") return adapterFailure();

    let upstreamBody;
    let passthrough = false;
    if (anthropic && path === "/v1/messages") {
      // The client already speaks Messages. Forward its body untouched except
      // for the provider's own model id, so every Anthropic-only field survives.
      if (!Array.isArray(body.messages)) return adapterFailure();
      upstreamBody = { ...body, model: found.model.id };
      passthrough = true;
    } else {
      try {
        const chat = requestAsChat(path, body);
        upstreamBody = anthropic
          ? chatAsMessages(chat, found.model.id)
          : found.descriptor.api === "openai-responses"
            ? chatAsResponses(chat, found.model.id, {
                flex: found.descriptor.name === "openai-api",
                include: path === "/v1/responses" ? body.include : undefined,
              })
            : { ...chat, model: found.model.id };
      } catch {
        return adapterFailure();
      }
    }

    const base = new URL(found.base);
    base.pathname =
      base.pathname.replace(/\/+$/, "") +
      (anthropic ? "/messages" : found.descriptor.api === "openai-responses" ? "/responses" : "/chat/completions");
    let upstream;
    try {
      upstream = await fetchImpl(base.toString(), {
        method: "POST",
        headers: await authHeaders(found.descriptor, found.descriptor.api, request),
        body: JSON.stringify(upstreamBody),
        signal: request.signal,
      });
    } catch {
      return Response.json(
        { error: { type: "upstream_error", message: "Custom provider request failed" } },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
    if (!upstream.ok) {
      upstream.body?.cancel().catch(() => {});
      return upstreamFailure(upstream.status);
    }
    if (anthropic) {
      if (passthrough) return rewriteResponseModel(FORMATS["/v1/messages"], upstream, body.model);
      return anthropicAnswer(upstream, body.model);
    }
    if (found.descriptor.api === "openai-completions") {
      return convertChatResponse(path, upstream, body.model);
    }
    if (path === "/v1/responses") return upstream;
    const streamed = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
    const response = streamed
      ? responsesSseAsChat(upstream, body.model)
      : Response.json(typedResponsesAsChat(await upstream.json(), body.model));
    return convertChatResponse(path, response, body.model);
  };
}
