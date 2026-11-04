// Native Mistral model bridge for stock OMP 18.14.0.
// Only the gateway's existing administrator token can use this route.
// A missing ModelRegistry export must not disable known Mistral models.
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { activePin } from "../credential-pin.js";
import { readJson } from "../inbound.js";
import { streamMistralVibe } from "../mistral-vibe-transport.js";

const PROVIDER = "mistral-vibe";
const API = "https://api.mistral.ai/v1/chat/completions";

/** OMP's protocol modules. Every dialect parses into the same context and encodes that context back. */
const HOST_FORMAT_PATHS = Object.freeze({
  chat: "/$bunfs/root/chunks/openai-chat-server-g00xpyrx.js",
  responses: "/$bunfs/root/chunks/openai-responses-server-8aysc0gh.js",
  messages: "/$bunfs/root/chunks/anthropic-messages-server-pfprj8hn.js",
});
const CHAT_BASE = "https://api.mistral.ai/v1";

let hostFormatsPromise;

export function loadHostFormats(importer = (path) => import(path)) {
  if (!hostFormatsPromise) {
    hostFormatsPromise = Promise.all(Object.entries(HOST_FORMAT_PATHS).map(async ([name, path]) => {
      return [name, await importer(path)];
    })).then((entries) => Object.fromEntries(entries));
  }
  return hostFormatsPromise;
}

function dialectOf(formats, path) {
  if (path === "/v1/responses") return formats.responses;
  if (path === "/v1/messages") return formats.messages;
  return formats.chat;
}

function thinkingOnly(message) {
  return message?.role === "assistant" && Array.isArray(message.content)
    && message.content.length > 0
    && message.content.every((part) => part?.type === "thinking" && typeof part.thinking === "string");
}

/**
 * OMP splits a reasoning item and the following assistant text into two
 * messages. The official Mistral transport only rewrites thinking when both
 * sit on one assistant message, as { type: "thinking", thinking, thinkingSignature }.
 */
export function toOfficialMistralContext(context) {
  const messages = [];
  let held = [];
  const flush = () => {
    if (!held.length) return;
    messages.push({ role: "assistant", content: held });
    held = [];
  };
  for (const message of context?.messages ?? []) {
    if (thinkingOnly(message)) {
      held.push(...message.content);
      continue;
    }
    if (message?.role === "assistant" && held.length) {
      const rest = Array.isArray(message.content)
        ? message.content
        : (typeof message.content === "string" && message.content
          ? [{ type: "text", text: message.content }]
          : []);
      messages.push({ ...message, content: [...held, ...rest] });
      held = [];
      continue;
    }
    flush();
    messages.push(message);
  }
  flush();
  return { ...(context ?? {}), messages };
}

function mistralModel(ref, credential) {
  const endpoint = typeof credential?.apiEndpoint === "string" && credential.apiEndpoint
    ? credential.apiEndpoint.replace(/\/+$/, "")
    : CHAT_BASE;
  const traits = mistralFallbackTraits(ref);
  return {
    id: ref.slice(PROVIDER.length + 1),
    provider: PROVIDER,
    api: "mistral-vibe-native",
    baseUrl: endpoint,
    reasoning: true,
    input: traits?.input ?? ["text"],
    contextWindow: traits?.contextWindow,
    maxTokens: traits?.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {},
  };
}

function streamOptions(parsed, credential, signal) {
  const options = parsed?.options ?? {};
  const effort = options.reasoning?.effort ?? options.reasoningEffort;
  return {
    ...options,
    apiKey: credential.secret,
    signal,
    ...(options.maxOutputTokens !== undefined ? { maxTokens: options.maxOutputTokens } : {}),
    ...(effort ? { reasoningEffort: effort } : {}),
  };
}

/**
 * Responses and Messages are parsed and encoded by OMP. The shared value is
 * that parsed context, which the existing Mistral chat transport already
 * accepts. Nothing here rewrites Responses or Messages items itself.
 */
export async function serveMistralContext({
  path, body, headers, signal, credential, formats, streamImpl = streamMistralVibe,
}) {
  const dialect = dialectOf(formats, path);
  let parsed;
  try {
    parsed = dialect.parseRequest(body, headers ?? new Headers());
  } catch (error) {
    return dialect.formatError(400, "invalid_request_error", error?.message ?? "invalid request");
  }
  const stream = streamImpl(
    mistralModel(body.model, credential),
    toOfficialMistralContext(parsed.context),
    streamOptions(parsed, credential, signal),
  );
  if (!parsed.stream) {
    const message = await stream.result();
    if (message instanceof Error) return dialect.formatError(502, "upstream_error", message.message);
    return Response.json(dialect.encodeResponse(message, parsed.modelId), {
      headers: { "cache-control": "no-store" },
    });
  }
  return new Response(dialect.encodeStream(stream, parsed.modelId, parsed.options, { signal }), {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}
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
    service_tier: _serviceTier, stream_options, user: _user,
    prompt_cache_key: _cacheKey, ...fields
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
  formats,
  streamImpl,
}) {
  return async (request, server) => {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || ![
      "/v1/chat/completions", "/v1/responses", "/v1/messages",
    ].includes(path)) return handler(request, server);
    const body = await readJson(request);
    if (body === undefined) return handler(request, server);
    const bridged = path === "/v1/responses" || path === "/v1/messages";
    if (!mistralFallbackTraits(body?.model) || (!bridged && (
      !Array.isArray(body.messages) || nativeRegistered(body.model)
      || !adminTokenMatches(request, tokenPath)))) {
      return handler(request, server);
    }

    const pin = activePin(PROVIDER);
    const id = pin?.credentialId ?? credentials.list().find((c) => c.provider === PROVIDER)?.id;
    const credential = id === undefined ? undefined : await credentials.resolve(id);
    if (!credential || credential.provider !== PROVIDER) {
      return Response.json({ error: { type: "provider_unavailable",
        message: "Mistral Vibe account unavailable" } }, { status: 503 });
    }

    if (bridged) {
      const loaded = formats ?? await loadHostFormats();
      return serveMistralContext({
        path, body, headers: request.headers, signal: request.signal, credential,
        formats: loaded, ...(streamImpl ? { streamImpl } : {}),
      });
    }

    const upstream = await fetchImpl(API, {
      method: "POST",
      headers: {
        authorization: "Bearer " + credential.secret,
        "content-type": "application/json",
        accept: body.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(toMistralPayload(body)),
      signal: request.signal,
    });

    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    return new Response(upstream.body, { status: upstream.status, headers });
  };
}
