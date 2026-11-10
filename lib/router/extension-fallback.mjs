// Stock OMP plugin transport adapter.
//
// The compiled gateway returns "Unknown model" for plugin-owned providers
// because ModelRegistry is not captured. The installed plugin still exposes a
// `streamSimple` transport, so this shim translates the Gateway wire formats
// to the plugin's event stream and back.
//
// Authorization: a Lazy Router attempt carries an Attempt scope for the exact
// provider and model. Some providers accept only that scope; for every other
// provider a direct client call may use the gateway bearer. The per-provider
// rule lives in presets/adapters.json.

import adapters from "../../presets/adapters.json" with { type: "json" };
import { activePin, report } from "../contracts.mjs";
import * as hostBridge from "../host-bridge.mjs";
import { readJson } from "../inbound.mjs";
import { serializeSseFrame } from "../sse.mjs";
import { adminTokenMatches } from "./admin-token.mjs";
import { Attempt, currentAttempt } from "./attempt.mjs";
import { splitModelRef } from "./catalog.mjs";
import { convertChatResponse, requestAsChat } from "./protocol-codec.mjs";

const ROUTES = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages"]);
const encoder = new TextEncoder();
/** The stable code of a terminal SSE failure frame. */
const STREAM_FAILED_CODE = "extension_stream_failed";
/** The stable code of a stream the client abandoned before any output. */
const STREAM_ABORTED_CODE = "extension_stream_aborted";
/** The largest redacted upstream cause kept in an error or a log line. */
const MAX_CAUSE_CHARS = 240;

/** Read one extension provider descriptor, or undefined. */
export function extensionProviderOf(provider) {
  if (typeof provider !== "string" || provider === "") return undefined;
  if (typeof hostBridge.getExtensionProvider === "function") return hostBridge.getExtensionProvider(provider);
  return hostBridge.getExtensionProviderMeta?.(provider);
}

function strictText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError("Unsupported text content");
  return value
    .map((part) => {
      if (part && ["text", "input_text", "output_text"].includes(part.type) && typeof part.text === "string") {
        return part.text;
      }
      throw new TypeError("Unsupported content block");
    })
    .join("");
}

function piContext(chat) {
  const system = [];
  const messages = [];
  const names = new Map();
  for (const message of chat.messages) {
    if (message.role === "system" || message.role === "developer") {
      system.push(strictText(message.content));
    } else if (message.role === "user") {
      messages.push({
        role: "user",
        content: [{ type: "text", text: strictText(message.content) }],
        timestamp: Date.now(),
      });
    } else if (message.role === "assistant") {
      const content = [];
      if (typeof message.reasoning_content === "string" && message.reasoning_content) {
        content.push({ type: "thinking", thinking: message.reasoning_content });
      }
      if (message.content !== null && message.content !== undefined) {
        const text = strictText(message.content);
        if (text) content.push({ type: "text", text });
      }
      for (const call of message.tool_calls ?? []) {
        if (!call.id || !call.function?.name) throw new TypeError("Invalid tool call");
        let args;
        try {
          args = JSON.parse(call.function.arguments);
        } catch {
          throw new TypeError("Invalid tool arguments");
        }
        names.set(call.id, call.function.name);
        content.push({ type: "toolCall", id: call.id, name: call.function.name, arguments: args });
      }
      messages.push({
        role: "assistant",
        content,
        api: "openai-completions",
        provider: String(chat.model).split("/")[0],
        model: String(chat.model).split("/").slice(1).join("/"),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    } else if (message.role === "tool") {
      messages.push({
        role: "toolResult",
        toolCallId: message.tool_call_id,
        toolName: names.get(message.tool_call_id) ?? "unknown",
        content: [{ type: "text", text: strictText(message.content) }],
        isError: false,
        timestamp: Date.now(),
      });
    } else {
      throw new TypeError("Unknown role");
    }
  }
  const tools = (chat.tools ?? []).map((tool) => {
    if (tool.type !== "function" || !tool.function?.name) throw new TypeError("Unsupported tool");
    return {
      name: tool.function.name,
      description: tool.function.description ?? "",
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
    };
  });
  return { systemPrompt: system, messages, ...(tools.length ? { tools } : {}) };
}

function usageOf(event) {
  const message = event?.message;
  const usage = message?.usage ?? event?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.inputTokens ?? usage.input;
  const output = usage.outputTokens ?? usage.output;
  const cached = usage.cachedInputTokens ?? usage.cacheRead;
  const value = {};
  if (Number.isSafeInteger(input) && input >= 0) value.prompt_tokens = input;
  if (Number.isSafeInteger(output) && output >= 0) value.completion_tokens = output;
  if (Number.isSafeInteger(cached) && cached >= 0) {
    value.prompt_tokens_details = { cached_tokens: cached };
  }
  if (value.prompt_tokens !== undefined && value.completion_tokens !== undefined) {
    value.total_tokens = value.prompt_tokens + value.completion_tokens;
  }
  return Object.keys(value).length ? value : undefined;
}

function eventFinish(event, tools) {
  const reason = event?.reason ?? event?.message?.stopReason ?? "";
  if (tools.length || /tool/i.test(reason)) return "tool_calls";
  if (/length|token/i.test(reason)) return "length";
  return "stop";
}

const frame = (value) => encoder.encode(serializeSseFrame({ data: value }));
const chunk = (model, delta, finish = null) => ({
  id: "shim_plugin",
  object: "chat.completion.chunk",
  model,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** Mask credentials and addresses, then bound one upstream message. */
function redactCause(value) {
  if (typeof value !== "string" || value === "") return "";
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 <redacted>")
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\b\s*[:=]\s*\S+/gi, "<redacted>")
    .replace(/\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}\b/g, "<redacted>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CAUSE_CHARS);
}

/** A leading HTTP status in a bare error message. */
const HTTP_STATUS = /\b(?:HTTP\s*)?([45]\d\d)\b/;

/** A stable reason code and status for one plugin error. */
function reasonOf(error) {
  const message = error?.message;
  const mentioned = typeof message === "string" ? HTTP_STATUS.exec(message)?.[1] : undefined;
  const status = Number.isInteger(error?.status)
    ? error.status
    : mentioned === undefined
      ? undefined
      : Number(mentioned);
  const raw = error?.code ?? error?.type ?? (error?.name === "Error" ? undefined : error?.name);
  if (typeof raw === "string" && raw.trim() !== "") {
    return {
      code:
        raw
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.-]+/g, "_")
          .slice(0, 48) || "error",
      status,
    };
  }
  return { code: status === undefined ? "error" : `status_${status}`, status };
}

/**
 * Build the failure for one plugin error and report it once.
 *
 * The message keeps the upstream cause after redaction. The log line names the
 * provider, the model and the reason code, and never carries prompt text.
 */
function pluginStreamFailure(error, { provider, model }) {
  const reason = reasonOf(error?.error ?? error);
  const detail = redactCause(error?.error?.message ?? error?.message);
  const failure = new Error(detail || `Extension provider ${reason.code}`);
  failure.code = STREAM_FAILED_CODE;
  failure.reason = reason.code;
  failure.status = reason.status;
  failure.detail = detail;
  failure.shimReported = true;
  // The log names the failure class only. Upstream text may echo request
  // content, so it stays out of the journal.
  report("lazy-router: extension provider stream failed", {
    provider,
    model,
    code: reason.code,
    ...(reason.status === undefined ? {} : { status: reason.status }),
  });
  return failure;
}

/**
 * Read the first plugin event before a response is built.
 *
 * A plugin that fails before its first event still gets a real HTTP failure,
 * so the Lazy Router can fail over to another candidate instead of handing the
 * client a 200 event stream that dies immediately.
 */
async function openPluginEvents(events, { provider, model, signal }) {
  const iterator = typeof events?.[Symbol.asyncIterator] === "function" ? events[Symbol.asyncIterator]() : undefined;
  let step;
  try {
    step = await iterator?.next();
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return { iterator, aborted: true };
    throw pluginStreamFailure(error, { provider, model });
  }
  if (!iterator) throw pluginStreamFailure(new Error("no event stream"), { provider, model });
  if (step.done) return { iterator };
  if (step.value?.type === "error") throw pluginStreamFailure(step.value, { provider, model });
  return { iterator, first: step.value };
}

async function drainPluginEvents({ iterator, first }, model, send, provider) {
  let content = "";
  let thinking = "";
  const calls = [];
  let finish = "stop";
  let usage;
  send(chunk(model, { role: "assistant" }));
  let event = first;
  for (;;) {
    if (event === undefined) {
      const step = await iterator.next();
      if (step.done) break;
      event = step.value;
    }
    switch (event?.type) {
      case "text_delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        content += delta;
        if (delta) send(chunk(model, { content: delta }));
        break;
      }
      case "thinking_delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        thinking += delta;
        if (delta) send(chunk(model, { reasoning_content: delta }));
        break;
      }
      case "toolcall_end": {
        const tool = event.toolCall;
        if (!tool?.id || typeof tool.name !== "string") break;
        const call = {
          id: tool.id,
          type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.arguments ?? {}) },
        };
        send(chunk(model, { tool_calls: [{ index: calls.length, ...call }] }));
        calls.push(call);
        break;
      }
      case "error":
        throw pluginStreamFailure(event, { provider, model });
      case "done":
        finish = eventFinish(event, calls);
        usage = usageOf(event);
        break;
    }
    if (event?.type === "done") break;
    event = undefined;
  }
  send(chunk(model, {}, finish));
  if (usage) send({ id: "shim_plugin", object: "chat.completion.chunk", model, choices: [], usage });
  return { content, thinking, calls, finish, usage };
}

/** The old 200-and-close answer for a client that left before any output. */
function abortedStreamResponse(model) {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(frame(chunk(model, { role: "assistant" })));
      controller.enqueue(
        frame({
          error: {
            type: "upstream_error",
            code: STREAM_ABORTED_CODE,
            message: "Extension provider stream aborted",
          },
        }),
      );
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

async function consume(events, model, { stream, provider, signal }) {
  const opened = await openPluginEvents(events, { provider, model, signal });
  if (opened.aborted) {
    if (!stream) {
      const error = new Error("Extension provider request aborted");
      error.shimAborted = true;
      throw error;
    }
    return abortedStreamResponse(model);
  }
  if (stream) {
    const body = new ReadableStream({
      async start(controller) {
        try {
          await drainPluginEvents(opened, model, (item) => controller.enqueue(frame(item)), provider);
          controller.enqueue(frame("[DONE]"));
          controller.close();
        } catch (caught) {
          const aborted = caught?.name === "AbortError";
          if (!aborted && caught?.shimReported !== true) pluginStreamFailure(caught, { provider, model });
          controller.enqueue(
            frame({
              error: {
                type: "upstream_error",
                code: aborted ? STREAM_ABORTED_CODE : STREAM_FAILED_CODE,
                message: aborted ? "Extension provider stream aborted" : "Extension provider stream failed",
              },
            }),
          );
          controller.close();
        }
      },
      cancel() {
        opened.iterator?.return?.();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const result = await drainPluginEvents(opened, model, () => {}, provider);
  return Response.json({
    id: "shim_plugin",
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        finish_reason: result.finish,
        message: {
          role: "assistant",
          content: result.content || null,
          ...(result.thinking ? { reasoning_content: result.thinking } : {}),
          ...(result.calls.length ? { tool_calls: result.calls } : {}),
        },
      },
    ],
    ...(result.usage ? { usage: result.usage } : {}),
  });
}

/** True when the current scope is the Lazy Router attempt for this exact model. */
function trustedAttempt(provider, model) {
  const scope = currentAttempt();
  return scope instanceof Attempt && scope.provider === provider && scope.model === model;
}

/**
 * Wrap the gateway handler with the installed plugin transport.
 * @param {Function} handler
 * @param {{credentials: object, tokenPath: string,
 *   nativeRegistered?: (model: string) => boolean,
 *   providers?: Map<string, object>}} options
 */
export function withExtensionFallback(
  handler,
  { credentials, tokenPath, nativeRegistered = () => false, providers } = {},
) {
  const providerOf = (id) =>
    providers instanceof Map ? providers.get(id) : (providers?.[id] ?? extensionProviderOf(id));

  return async function extensionFallback(request, server) {
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
    const { provider } = splitModelRef(body.model);
    if (!provider) return handler(request, server);
    const config = providerOf(provider);
    if (!config || typeof config.streamSimple !== "function") return handler(request, server);

    const trusted = trustedAttempt(provider, body.model);
    const requiresAttemptTrust = adapters[provider]?.requiresAttemptTrust === true;
    const authorized = trusted || (!requiresAttemptTrust && adminTokenMatches(request, tokenPath));
    if (!authorized || (!trusted && nativeRegistered(body.model))) return handler(request, server);

    let chat;
    let context;
    try {
      chat = requestAsChat(path, body);
      context = piContext(chat);
    } catch {
      return Response.json(
        { error: { type: "adapter_unsupported", message: "This plugin cannot represent the requested content" } },
        { status: 502 },
      );
    }

    const modelId = body.model.slice(provider.length + 1);
    const model = (config.models ?? []).find((row) => row.id === modelId);
    if (!model) return handler(request, server);

    const pin = activePin(provider);
    let accountId = pin?.credentialId;
    if (accountId === undefined && typeof credentials?.listAccounts === "function") {
      const accounts = await credentials.listAccounts(provider).catch(() => []);
      accountId = accounts.find((row) => !row.disabled)?.id;
    }
    const credential = accountId === undefined ? undefined : await credentials.resolve(provider, { id: accountId });
    const key = credential?.secret ?? (await config.resolveApiKey?.());
    if (!key) {
      return Response.json(
        { error: { type: "provider_unavailable", message: "No active provider credential" } },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    const options = {
      apiKey: key,
      signal: request.signal,
      maxTokens: chat.max_tokens ?? chat.max_completion_tokens ?? 64,
      reasoning: chat.reasoning_effort ?? "high",
      maxRetries: 0,
    };
    try {
      const events = await config.streamSimple(
        {
          ...model,
          provider,
          api: model.api ?? config.api,
          baseUrl: model.baseUrl ?? config.baseUrl,
        },
        context,
        options,
      );
      const response = await consume(events, body.model, {
        stream: chat.stream === true,
        provider,
        signal: request.signal,
      });
      return await convertChatResponse(path, response, body.model);
    } catch (error) {
      if (error?.shimReported !== true && error?.shimAborted !== true) {
        report("lazy-router: extension provider request failed", {
          provider,
          model: body.model,
          code: reasonOf(error).code,
        });
      }
      return Response.json(
        { error: { type: "upstream_error", message: "Extension provider request failed" } },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }
  };
}
