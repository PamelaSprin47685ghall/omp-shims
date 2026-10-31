// OpenAI Responses to Chat Completions bridge. Preserves output, tool calls,
// cache usage, and real streaming deltas for missing custom OMP providers.

function usageOf(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens;
  const result = {};
  if (Number.isSafeInteger(input) && input >= 0) result.prompt_tokens = input;
  if (Number.isSafeInteger(output) && output >= 0) result.completion_tokens = output;
  if (Number.isSafeInteger(cached) && cached >= 0) {
    result.prompt_tokens_details = { cached_tokens: cached };
  }
  if (Number.isSafeInteger(usage.total_tokens) && usage.total_tokens >= 0) {
    result.total_tokens = usage.total_tokens;
  }
  return Object.keys(result).length ? result : undefined;
}

export function responsesAsChat(original, model) {
  const content = [];
  const calls = [];
  for (const item of original?.output ?? []) {
    if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          content.push(part.text);
        }
      }
    } else if (item?.type === "function_call") {
      calls.push({ id: item.call_id, type: "function",
        function: { name: item.name, arguments: item.arguments ?? "{}" } });
    }
  }
  const message = { role: "assistant", content: content.join("") || null,
    ...(calls.length ? { tool_calls: calls } : {}) };
  return {
    id: original?.id ?? "shim_resp",
    object: "chat.completion", model,
    created: original?.created_at ?? Math.floor(Date.now() / 1000),
    choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }],
    ...(usageOf(original?.usage) ? { usage: usageOf(original.usage) } : {}),
  };
}

export function chatAsResponses(chat, modelId, { flex = false } = {}) {
  const input = [];
  for (const msg of chat.messages) {
    if (msg.role === "tool") {
      input.push({ type: "function_call_output", call_id: msg.tool_call_id,
        output: msg.content });
      continue;
    }
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      if (msg.content) input.push({ role: msg.role, content: msg.content });
      for (const call of msg.tool_calls) {
        input.push({ type: "function_call", call_id: call.id,
          name: call.function.name, arguments: call.function.arguments });
      }
      continue;
    }
    if (typeof msg.content !== "string") throw new TypeError("Unsupported content");
    input.push({ role: msg.role, content: msg.content });
  }
  const result = { model: modelId, input, stream: chat.stream === true,
    max_output_tokens: chat.max_completion_tokens ?? chat.max_tokens ?? 64,
    store: false,
    ...(flex ? { service_tier: "flex" } : {}) };
  if (chat.reasoning_effort) result.reasoning = { effort: chat.reasoning_effort };
  if (Array.isArray(chat.tools)) {
    result.tools = chat.tools.map(({ function: fn }) => ({
      type: "function", name: fn.name, description: fn.description,
      parameters: fn.parameters,
    }));
  }
  return result;
}

const encoder = new TextEncoder();
const frame = value => encoder.encode("data: " + JSON.stringify(value) + "\n\n");
const chunk = (model, delta, end = null) => ({
  id: "shim_response", object: "chat.completion.chunk", model,
  choices: [{ index: 0, delta, finish_reason: end }],
});

/** Transform genuine typed Responses SSE events as they arrive; no buffering. */
export function responsesSseAsChat(response, model) {
  if (!response.body) return response;
  let pending = "";
  const decoder = new TextDecoder();
  const calls = new Map();
  let done = false;
  const stream = new TransformStream({
    start(controller) { controller.enqueue(frame(chunk(model, { role: "assistant" }))); },
    transform(bytes, controller) {
      pending += decoder.decode(bytes, { stream: true });
      for (;;) {
        const sep = /\r?\n\r?\n/.exec(pending);
        if (!sep) break;
        const block = pending.slice(0, sep.index);
        pending = pending.slice(sep.index + sep[0].length);
        const dataLines = block.split(/\r?\n/)
          .filter(s => s.startsWith("data:")).map(s => s.slice(5).trim()).join("\n");
        if (!dataLines || dataLines === "[DONE]") continue;
        let event;
        try { event = JSON.parse(dataLines); } catch { continue; }
        const type = event?.type ?? block.split(/\r?\n/).find(s => s.startsWith("event:"))?.slice(6).trim();
        if (type === "response.output_item.added" && event.item?.type === "function_call") {
          calls.set(event.output_index, { id: event.item.call_id, name: event.item.name });
        }
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          controller.enqueue(frame(chunk(model, { content: event.delta })));
        }
        if (type === "response.function_call_arguments.delta") {
          const call = calls.get(event.output_index);
          if (call) {
            controller.enqueue(frame(chunk(model, { tool_calls: [{
              index: event.output_index, id: call.id, type: "function",
              function: { name: call.name, arguments: event.delta ?? "" },
            }] })));
          }
        }
        if (type === "response.completed" && !done) {
          const original = event.response ?? {};
          controller.enqueue(frame(chunk(model, {},
            calls.size ? "tool_calls" : "stop")));
          const usage = usageOf(original.usage);
          if (usage) controller.enqueue(frame({ id: "shim_response", model,
            choices: [], usage }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          done = true;
        }
        if (type === "response.failed" || type === "error") {
          controller.enqueue(frame({ error: { type: "upstream_error",
            message: "Responses upstream reported a failure" } }));
          done = true;
        }
      }
    },
    flush(controller) {
      // Incomplete upstream streams must not be reported as successful.
      if (!done) controller.enqueue(frame({ error: {
        type: "stream_incomplete", message: "Responses stream ended unexpectedly" } }));
    },
  });
  return new Response(response.body.pipeThrough(stream), { status: response.status,
    headers: { "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store" } });
}
