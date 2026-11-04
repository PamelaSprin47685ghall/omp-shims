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
  let thought = "";
  let signature;
  for (const item of original?.output ?? []) {
    if (item?.type === "reasoning") {
      const parts = (list) => (list ?? []).map((part) => part?.text).filter((text) => typeof text === "string" && text);
      const text = parts(item.summary).join("\n") || parts(item.content).join("\n");
      if (text) thought += text;
      if (typeof item.encrypted_content === "string" && item.encrypted_content) {
        signature = item.encrypted_content;
      }
    } else if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          content.push(part.text);
        }
      }
    } else if (item?.type === "function_call") {
      calls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments ?? "{}" },
      });
    }
  }
  const message = {
    role: "assistant",
    content: content.join("") || null,
    ...(thought ? { reasoning_content: thought } : {}),
    ...(signature ? { reasoning_signature: signature } : {}),
    ...(calls.length ? { tool_calls: calls } : {}),
  };
  return {
    id: original?.id ?? "shim_resp",
    object: "chat.completion",
    model,
    created: original?.created_at ?? Math.floor(Date.now() / 1000),
    choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }],
    ...(usageOf(original?.usage) ? { usage: usageOf(original.usage) } : {}),
  };
}

/**
 * Preserve Chat content when sending historical messages to Responses.
 * Typed text parts are ordinary Chat API inputs, not invalid content.
 * Unknown modalities must fail explicitly rather than silently disappear.
 */
function responsesContent(content, role) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new TypeError("adapter_unsupported: content");
  const parts = content.map((part) => {
    if (!part || typeof part !== "object") {
      throw new TypeError("adapter_unsupported: content block");
    }
    if (["text", "input_text", "output_text"].includes(part.type) && typeof part.text === "string") {
      return { type: role === "assistant" ? "output_text" : "input_text", text: part.text };
    }
    if (role === "user" && ["image_url", "input_image"].includes(part.type)) {
      const raw = part.type === "image_url" ? part.image_url : part;
      const url =
        typeof raw === "string"
          ? raw
          : typeof raw?.url === "string"
            ? raw.url
            : typeof raw?.image_url === "string"
              ? raw.image_url
              : undefined;
      const detail = typeof raw === "object" && raw ? raw.detail : undefined;
      if (!url) throw new TypeError("adapter_unsupported: image_url");
      return { type: "input_image", image_url: url, ...(detail ? { detail } : {}) };
    }
    throw new TypeError("adapter_unsupported: content modality");
  });
  if (parts.length === 0) throw new TypeError("adapter_unsupported: empty content");
  return parts;
}

function toolOutputContent(content) {
  const translated = responsesContent(content, "tool");
  return typeof translated === "string" ? translated : translated.map((part) => part.text).join("");
}

function chatReasoning(message) {
  for (const key of ["reasoning_content", "reasoning", "reasoning_text"]) {
    if (typeof message?.[key] === "string" && message[key]) return message[key];
  }
  return "";
}

export function chatAsResponses(chat, modelId, { flex = false, include } = {}) {
  if (!Array.isArray(chat.messages)) throw new TypeError("adapter_unsupported: messages");
  const input = [];
  for (const msg of chat.messages) {
    if (!msg || typeof msg !== "object") throw new TypeError("adapter_unsupported: message");
    if (msg.role === "tool") {
      if (typeof msg.tool_call_id !== "string" || !msg.tool_call_id) {
        throw new TypeError("adapter_unsupported: tool id");
      }
      input.push({ type: "function_call_output", call_id: msg.tool_call_id, output: toolOutputContent(msg.content) });
      continue;
    }
    if (!["system", "developer", "user", "assistant"].includes(msg.role)) {
      throw new TypeError("adapter_unsupported: role");
    }
    const calls = msg.tool_calls;
    if (calls !== undefined && !Array.isArray(calls)) {
      throw new TypeError("adapter_unsupported: tool calls");
    }
    const thought = msg.role === "assistant" ? chatReasoning(msg) : "";
    const signature =
      msg.role === "assistant" && typeof msg.reasoning_signature === "string" ? msg.reasoning_signature : undefined;
    if (thought || signature) {
      input.push({
        type: "reasoning",
        ...(thought ? { summary: [{ type: "summary_text", text: thought }] } : { summary: [] }),
        ...(signature ? { encrypted_content: signature } : {}),
      });
    }
    if (msg.content !== null && msg.content !== undefined) {
      input.push({ role: msg.role, content: responsesContent(msg.content, msg.role) });
    } else if (!calls?.length && !thought) {
      throw new TypeError("adapter_unsupported: missing content");
    }
    for (const call of calls ?? []) {
      if (
        (call?.type !== undefined && call.type !== "function") ||
        typeof call.id !== "string" ||
        typeof call.function?.name !== "string" ||
        typeof call.function?.arguments !== "string"
      ) {
        throw new TypeError("adapter_unsupported: tool call");
      }
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      });
    }
  }
  const result = {
    model: modelId,
    input,
    stream: chat.stream === true,
    max_output_tokens: chat.max_completion_tokens ?? chat.max_tokens ?? 64,
    store: false,
    ...(flex ? { service_tier: "flex" } : {}),
  };
  if (Array.isArray(include)) result.include = include.filter((value) => typeof value === "string");
  if (chat.reasoning_effort) result.reasoning = { effort: chat.reasoning_effort };
  if (Array.isArray(chat.tools)) {
    result.tools = chat.tools.map((tool) => {
      const fn = tool?.function;
      if (tool?.type !== "function" || typeof fn?.name !== "string") {
        throw new TypeError("adapter_unsupported: tool declaration");
      }
      return {
        type: "function",
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        parameters: fn.parameters ?? { type: "object", properties: {} },
      };
    });
  }
  return result;
}

const encoder = new TextEncoder();
const frame = (value) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
const chunk = (model, delta, end = null) => ({
  id: "shim_response",
  object: "chat.completion.chunk",
  model,
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
    start(controller) {
      controller.enqueue(frame(chunk(model, { role: "assistant" })));
    },
    transform(bytes, controller) {
      pending += decoder.decode(bytes, { stream: true });
      for (;;) {
        const sep = /\r?\n\r?\n/.exec(pending);
        if (!sep) break;
        const block = pending.slice(0, sep.index);
        pending = pending.slice(sep.index + sep[0].length);
        const dataLines = block
          .split(/\r?\n/)
          .filter((s) => s.startsWith("data:"))
          .map((s) => s.slice(5).trim())
          .join("\n");
        if (!dataLines || dataLines === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(dataLines);
        } catch {
          continue;
        }
        const type =
          event?.type ??
          block
            .split(/\r?\n/)
            .find((s) => s.startsWith("event:"))
            ?.slice(6)
            .trim();
        if (type === "response.output_item.added" && event.item?.type === "function_call") {
          calls.set(event.output_index, { id: event.item.call_id, name: event.item.name });
        }
        if (type === "response.output_text.delta" && typeof event.delta === "string") {
          controller.enqueue(frame(chunk(model, { content: event.delta })));
        }
        if (
          (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") &&
          typeof event.delta === "string"
        ) {
          controller.enqueue(frame(chunk(model, { reasoning_content: event.delta })));
        }
        if (type === "response.function_call_arguments.delta") {
          const call = calls.get(event.output_index);
          if (call) {
            controller.enqueue(
              frame(
                chunk(model, {
                  tool_calls: [
                    {
                      index: event.output_index,
                      id: call.id,
                      type: "function",
                      function: { name: call.name, arguments: event.delta ?? "" },
                    },
                  ],
                }),
              ),
            );
          }
        }
        if (type === "response.completed" && !done) {
          const original = event.response ?? {};
          controller.enqueue(frame(chunk(model, {}, calls.size ? "tool_calls" : "stop")));
          const usage = usageOf(original.usage);
          if (usage) controller.enqueue(frame({ id: "shim_response", model, choices: [], usage }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          done = true;
        }
        if (type === "response.failed" || type === "error") {
          controller.enqueue(
            frame({ error: { type: "upstream_error", message: "Responses upstream reported a failure" } }),
          );
          done = true;
        }
      }
    },
    flush(controller) {
      // Incomplete upstream streams must not be reported as successful.
      if (!done)
        controller.enqueue(
          frame({
            error: {
              type: "stream_incomplete",
              message: "Responses stream ended unexpectedly",
            },
          }),
        );
    },
  });
  return new Response(response.body.pipeThrough(stream), {
    status: response.status,
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}
