// Native Mistral model bridge for stock OMP 18.14.0.
// Only the gateway's existing administrator token can use this route.
// A missing ModelRegistry export must not disable known Mistral models.
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { activePin } from "../credential-pin.js";
import { requestAsChat, convertChatResponse } from "./protocol-interoperability.js";

const PROVIDER = "mistral-vibe";
const API = "https://api.mistral.ai/v1/chat/completions";
const MODELS = Object.freeze([
  { id: "deepseek-v4-1-flash-1017", contextWindow: 1_000_000,
    maxTokens: 64_000, input: ["text"], reasoning: false, efforts: [], canDisable: false },
  { id: "mistral-small-latest", contextWindow: 250_000,
    maxTokens: 32_768, input: ["text"], reasoning: true,
    efforts: ["none", "high"], canDisable: true },
  { id: "zai-glm-5-3-flash", contextWindow: 1_000_000,
    maxTokens: 64_000, input: ["text"], reasoning: true,
    efforts: ["low", "high", "max"], canDisable: false },
]);

const TRAITS = new Map(MODELS.map((row) => [
  PROVIDER + "/" + row.id,
  { ...row, ref: PROVIDER + "/" + row.id, provider: PROVIDER },
]));

export function mistralFallbackTraits(ref) {
  const row = TRAITS.get(ref);
  return row ? { ...row, input: [...row.input], efforts: [...row.efforts] } : undefined;
}

export function mistralFallbackModelList() {
  return MODELS.map((row) => ({
    id: PROVIDER + "/" + row.id,
    object: "model", owned_by: PROVIDER, api: "openai-completions",
    input_modalities: [...row.input], context_length: row.contextWindow,
    max_output_tokens: row.maxTokens,
  }));
}

export function adminTokenMatches(request, tokenPath) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  let expected;
  try { expected = readFileSync(tokenPath, "utf8").trim(); } catch { return false; }
  if (!expected) return false;
  const actual = Buffer.from(match[1]);
  const trusted = Buffer.from(expected);
  return actual.length === trusted.length && timingSafeEqual(actual, trusted);
}

function mistralMessage(message) {
  const { reasoning_content: _rc, reasoning: _r, ...fields } = message;
  const role = fields.role === "developer" ? "system" : fields.role;
  const thought = message.reasoning_content ?? message.reasoning;
  if (role !== "assistant" || typeof thought !== "string" || !thought) {
    return { ...fields, role };
  }
  if (typeof fields.content !== "string" && fields.content !== null) {
    return { ...fields, role };
  }
  const content = [{ type: "thinking", thinking: [{ type: "text", text: thought }] }];
  if (fields.content) content.push({ type: "text", text: fields.content });
  return { ...fields, role, content };
}

export function toMistralPayload(body) {
  const {
    model, messages, max_completion_tokens, store: _store,
    service_tier: _serviceTier, stream_options, ...fields
  } = body;
  const outgoing = {
    ...fields,
    model: model.slice(PROVIDER.length + 1),
    messages: messages.map(mistralMessage),
  };
  if (max_completion_tokens !== undefined) outgoing.max_tokens = max_completion_tokens;
  if (fields.stream === true && stream_options?.include_usage) {
    outgoing.stream_options = { include_usage: true };
  }
  return outgoing;
}

export function withMistralFallback(handler, {
  credentials, tokenPath, fetchImpl = globalThis.fetch,
  nativeRegistered = () => false,
}) {
  return async (request, server) => {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || ![
      "/v1/chat/completions", "/v1/responses", "/v1/messages",
    ].includes(path)) return handler(request, server);
    let body;
    try { body = await request.clone().json(); } catch { return handler(request, server); }
    if (!mistralFallbackTraits(body?.model) || !Array.isArray(body.messages)
      || nativeRegistered(body.model) || !adminTokenMatches(request, tokenPath)) {
      return handler(request, server);
    }

    // Fail closed for scoped bearer tokens; the shim cannot inspect client ACLs.
    const pin = activePin(PROVIDER);
    const id = pin?.credentialId ?? credentials.list().find((c) => c.provider === PROVIDER)?.id;
    const credential = id === undefined ? undefined : await credentials.resolve(id);
    if (!credential || credential.provider !== PROVIDER) {
      return Response.json({ error: { type: "provider_unavailable",
        message: "Mistral Vibe account unavailable" } }, { status: 503 });
    }

    let converted;
    try { converted = requestAsChat(path, body); } catch {
      return Response.json({ error: { type: "invalid_request_error",
        message: "Unsupported content in protocol bridge" } }, { status: 422 });
    }
    const upstream = await fetchImpl(API, {
      method: "POST",
      headers: {
        authorization: "Bearer " + credential.secret,
        "content-type": "application/json",
        accept: body.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(toMistralPayload(converted)),
      signal: request.signal,
    });

    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    return convertChatResponse(path,
      new Response(upstream.body, { status: upstream.status, headers }), body.model);
  };
}
