// Stock OMP 18.14 plugin transport adapter. The installed plugin owns models,
// transport and upstream auth; the shim only translates Gateway wire formats.
import { activePin } from "../credential-pin.js";
import { adminTokenMatches } from "./mistral-native-fallback.js";
import { extensionProvider, extensionTraits } from "./extension-providers.js";
import { requestAsChat, convertChatResponse } from "./protocol-interoperability.js";

const ROUTES = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages"]);
const encoder = new TextEncoder();

function piContext(chat) {
  const system = [];
  const messages = [];
  const names = new Map();
  for (const msg of chat.messages) {
    if (msg.role === "system" || msg.role === "developer") {
      if (typeof msg.content !== "string") throw new TypeError("Unsupported system content");
      system.push(msg.content);
    } else if (msg.role === "user") {
      if (typeof msg.content !== "string") throw new TypeError("Unsupported user content");
      messages.push({ role: "user", content: [{ type: "text", text: msg.content }],
        timestamp: Date.now() });
    } else if (msg.role === "assistant") {
      const content = [];
      if (typeof msg.reasoning_content === "string" && msg.reasoning_content) {
        content.push({ type: "thinking", thinking: msg.reasoning_content });
      }
      if (typeof msg.content === "string" && msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const call of msg.tool_calls ?? []) {
        if (!call.id || !call.function?.name) throw new TypeError("Invalid tool call");
        let args;
        try { args = JSON.parse(call.function.arguments); }
        catch { throw new TypeError("Invalid tool arguments"); }
        names.set(call.id, call.function.name);
        content.push({ type: "toolCall", id: call.id, name: call.function.name, arguments: args });
      }
      messages.push({ role: "assistant", content, api: "openai-completions",
        provider: chat.model.split("/")[0],
        model: chat.model.split("/").slice(1).join("/"),
        stopReason: "stop", timestamp: Date.now() });
    } else if (msg.role === "tool") {
      if (typeof msg.content !== "string") throw new TypeError("Unsupported tool result");
      messages.push({ role: "toolResult", toolCallId: msg.tool_call_id,
        toolName: names.get(msg.tool_call_id) ?? "unknown",
        content: [{ type: "text", text: msg.content }],
        isError: false, timestamp: Date.now() });
    } else throw new TypeError("Unknown role");
  }
  const tools = (chat.tools ?? []).map(t => {
    if (t.type !== "function" || !t.function?.name) throw new TypeError("Unsupported tool");
    return { name: t.function.name, description: t.function.description ?? "",
      parameters: t.function.parameters ?? { type: "object", properties: {} } };
  });
  return { systemPrompt: system, messages, ...(tools.length ? { tools } : {}) };
}

function usageOf(event) {
  const m = event?.message;
  const u = m?.usage ?? event?.usage;
  if (!u || typeof u !== "object") return undefined;
  const input = u.inputTokens ?? u.input;
  const output = u.outputTokens ?? u.output;
  const cached = u.cachedInputTokens ?? u.cacheRead;
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
  const r = event?.reason ?? event?.message?.stopReason ?? "";
  if (tools.length || /tool/i.test(r)) return "tool_calls";
  if (/length|token/i.test(r)) return "length";
  return "stop";
}

const frame = value => encoder.encode("data: " + JSON.stringify(value) + "\n\n");
const chunk = (model, delta, finish = null) => ({
  id: "shim_plugin", object: "chat.completion.chunk", model,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

async function drainPluginEvents(events, model, send) {
  let content = "";
  let thinking = "";
  const calls = [];
  let finish = "stop";
  let usage;
  send(chunk(model, { role: "assistant" }));
  for await (const event of events) {
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
        const call = { id: tool.id, type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.arguments ?? {}) } };
        send(chunk(model, { tool_calls: [{ index: calls.length, ...call }] }));
        calls.push(call);
        break;
      }
      case "error":
        throw new Error("Extension upstream returned an error event");
      case "done":
        finish = eventFinish(event, calls);
        usage = usageOf(event);
        break;
    }
    if (event?.type === "done") break;
  }
  send(chunk(model, {}, finish));
  if (usage) send({ id: "shim_plugin", object: "chat.completion.chunk",
    model, choices: [], usage });
  return { content, thinking, calls, finish, usage };
}

async function consume(events, model, { stream }) {
  if (stream) {
    const body = new ReadableStream({
      async start(controller) {
        try {
          await drainPluginEvents(events, model, item => controller.enqueue(frame(item)));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          controller.enqueue(frame({ error: { type: "upstream_error",
            message: "Extension provider stream failed" } }));
          controller.close();
        }
      },
      cancel() { events?.return?.(); },
    });
    return new Response(body, {
      status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
  }
  const result = await drainPluginEvents(events, model, () => {});
  return Response.json({
    id: "shim_plugin", object: "chat.completion", model,
    choices: [{ index: 0, finish_reason: result.finish,
      message: { role: "assistant", content: result.content || null,
        ...(result.thinking ? { reasoning_content: result.thinking } : {}),
        ...(result.calls.length ? { tool_calls: result.calls } : {}) } }],
    ...(result.usage ? { usage: result.usage } : {}),
  });
}

export function withExtensionFallback(handler, {
  credentials, tokenPath, nativeRegistered = () => false,
}) {
  return async (request, server) => {
    if (request.method !== "POST") return handler(request, server);
    const path = new URL(request.url).pathname;
    if (!ROUTES.has(path)) return handler(request, server);
    let body;
    try { body = await request.clone().json(); } catch { return handler(request, server); }
    const traits = extensionTraits(body?.model);
    const provider = traits?.provider;
    if (provider !== "kiro" && provider !== "commandcode") return handler(request, server);
    const config = provider ? extensionProvider(provider) : undefined;
    // The stock OMP built-in Command Code provider is not the installed plugin.
    // Only the pinned Lazy Router may override its native transport.
    const pin = activePin(provider);
    // Lazy Router carries a trusted AsyncLocalStorage credential pin even
    // when the external client has a scoped (non-admin) Gateway token.
    // Command Code plugin handling requires that pin, not the admin bearer.
    // Unpinned requests never bypass the stock Gateway or its auth checks.
    const authorized = provider === "commandcode"
      ? pin !== undefined
      : adminTokenMatches(request, tokenPath);
    if (!traits || !config?.streamSimple ||
      (provider !== "commandcode" && nativeRegistered(body.model)) ||
      !authorized) return handler(request, server);

    const accountId = pin?.credentialId ??
      credentials.list().find(row => row.provider === provider)?.id;
    const account = accountId === undefined ? undefined : await credentials.resolve(accountId);
    // Command Code credentials are resolved exclusively from the active OMP DB
    // record; never fall back to removed environment credentials.
    const key = account?.secret;
    if (!key) {
      return Response.json({ error: { type: "provider_unavailable",
        message: "No active provider credential" } }, { status: 503 });
    }
    let chat, context;
    try {
      chat = requestAsChat(path, body);
      context = piContext(chat);
    } catch {
      return Response.json({ error: { type: "invalid_request_error",
        message: "Unsupported request content" } }, { status: 422 });
    }
    const modelId = body.model.slice(provider.length + 1);
    const model = config.models.find(row => row.id === modelId);
    if (!model) return handler(request, server);
    const options = { apiKey: key, signal: request.signal,
      maxTokens: chat.max_tokens ?? chat.max_completion_tokens ?? 64,
      reasoning: chat.reasoning_effort ?? "high", maxRetries: 0 };
    try {
      const events = await config.streamSimple({ ...model, provider,
        api: model.api ?? config.api,
        baseUrl: model.baseUrl ?? config.baseUrl,
      }, context, options);
      const response = await consume(events, body.model, { stream: chat.stream === true });
      return convertChatResponse(path, response, body.model);
    } catch {
      return Response.json({ error: { type: "upstream_error",
        message: "Extension provider request failed" } }, { status: 502 });
    }
  };
}
