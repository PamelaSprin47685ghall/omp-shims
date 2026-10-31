// Keep the downstream Chat Completions stream in two strict phases.
// Provider-labelled reasoning is forwarded as it arrives; visible output and
// tools are held until the provider is finished. Late reasoning cannot appear
// after the first visible delta. Never infer thinking from prose or <think> tags.
import { isEventStream, streamingHeaders } from "./sse-heartbeat.js";

export const REASONING_ORDER_PATH = "/v1/chat/completions";
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const REASON_KEYS = ["reasoning_content", "reasoning", "reasoning_text"];
const BODY_KEYS = ["content", "tool_calls", "function_call", "refusal", "logprobs"];

function serialized(lines, value) {
  const headers = lines.filter((line) => !line.startsWith("data:"));
  return [...headers, "data: " + JSON.stringify(value)].join("\n") + "\n\n";
}
function wire(block) {
  return block + "\n\n";
}
function classifyChoice(choice) {
  const delta = choice?.delta;
  if (!delta || typeof delta !== "object") return null;
  const thought = {};
  const visible = {};
  let hasThought = false;
  let hasVisible = false;
  for (const [key, value] of Object.entries(delta)) {
    if (REASON_KEYS.includes(key)) {
      if (typeof value === "string" && value.length > 0) {
        thought[key] = value;
        hasThought = true;
      }
    } else if (key === "content" && Array.isArray(value)) {
      // Mistral wire content blocks carry explicit type tags. Do not interpret
      // untyped strings, markdown, or other provider-specific blocks as thought.
      const text = [];
      let thoughtText = "";
      for (const block of value) {
        if (block?.type === "thinking" && Array.isArray(block.thinking)) {
          for (const part of block.thinking) {
            if (part?.type === "text" && typeof part.text === "string") thoughtText += part.text;
          }
        } else text.push(block);
      }
      if (thoughtText && !hasThought) {
        thought.reasoning_content = thoughtText;
        hasThought = true;
      }
      if (text.length) {
        // OpenAI Chat deltas must expose textual content as a string.
        // Preserve non-text vendor blocks rather than guessing their meaning.
        visible.content = text.every((part) => part?.type === "text"
          && typeof part.text === "string")
          ? text.map((part) => part.text).join("")
          : text;
        hasVisible = true;
      }
    } else if (key === "role" && value === "assistant") {
      // Role frames are retained as a preamble, never classified as content.
    } else if (BODY_KEYS.includes(key)) {
      if (value !== null && value !== undefined && !(typeof value === "string" && !value.length)
          && !(Array.isArray(value) && !value.length)) {
        visible[key] = value;
        hasVisible = true;
      }
    } else {
      visible[key] = value;
      hasVisible = true;
    }
  }
  return { thought, visible, hasThought, hasVisible,
    role: delta.role === "assistant" };
}
function eventParts(block) {
  const lines = block.split("\n");
  const data = lines.filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return [{ type: data === "[DONE]" ? "terminal" : "preamble", raw: wire(block) }];
  let value;
  try { value = JSON.parse(data); } catch {
    return [{ type: "other", raw: wire(block) }];
  }
  if (!Array.isArray(value?.choices)) {
    return [{ type: value?.error ? "terminal" : "other", raw: wire(block) }];
  }
  const parts = [];
  let any = false;
  for (const choice of value.choices) {
    const result = classifyChoice(choice);
    if (!result) {
      parts.push({ type: choice?.finish_reason ? "terminal" : "other",
        raw: serialized(lines, { ...value, choices: [choice] }) });
      continue;
    }
    any = true;
    const frame = (delta, finish = null) =>
      serialized(lines, { ...value, choices: [{ ...choice, finish_reason: finish, delta }] });
    if (result.role) parts.push({ type: "preamble", raw: frame({ role: "assistant" }) });
    if (result.hasThought) parts.push({ type: "thinking", raw: frame(result.thought) });
    if (result.hasVisible) parts.push({ type: "body", raw: frame(result.visible) });
    if (choice.finish_reason) parts.push({ type: "terminal", raw: frame({ }, choice.finish_reason) });
  }
  if (!any || !parts.length) {
    return [{ type: value?.usage || value?.choices?.some((c) => c.finish_reason)
      ? "terminal" : "other", raw: wire(block) }];
  }
  return parts;
}

/** Streaming transformation of completed SSE event blocks, with byte limits. */
export function orderChatStream(source, { maxBufferBytes = MAX_BUFFER_BYTES } = {}) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let visible = [];
  let bytes = 0;
  const output = (controller, text) => controller.enqueue(encoder.encode(text));
  const defer = (text) => {
    bytes += encoder.encode(text).byteLength;
    if (bytes > maxBufferBytes) throw new RangeError("reasoning-order visible buffer exceeded limit");
    visible.push(text);
  };
  const release = (controller) => {
    for (const chunk of visible) output(controller, chunk);
    visible = [];
    bytes = 0;
  };
  const processBlock = (block, controller) => {
    // Blank lines and comments do not carry model output.
    for (const part of eventParts(block)) {
      if (part.type === "thinking" || part.type === "preamble") output(controller, part.raw);
      else if (part.type === "body" || part.type === "other") defer(part.raw);
      else {
        release(controller);
        output(controller, part.raw);
      }
    }
  };
  return source.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      // Normalize only after concatenation: CRLF itself may span two chunks.
      pending = pending.replace(/\r\n/g, "\n");
      for (;;) {
        const at = pending.indexOf("\n\n");
        if (at < 0) break;
        const block = pending.slice(0, at);
        pending = pending.slice(at + 2);
        processBlock(block, controller);
      }
      if (pending.length > 1024 * 1024) throw new RangeError("reasoning-order SSE event too large");
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) processBlock(pending, controller);
      release(controller);
    },
  }));
}
export function withReasoningOrder(handler, options = {}) {
  return async (request, server) => {
    const response = await handler(request, server);
    if (request.method !== "POST"
      || new URL(request.url).pathname !== REASONING_ORDER_PATH
      || !isEventStream(response) || response.status !== 200) return response;
    return new Response(orderChatStream(response.body, options), {
      status: response.status,
      statusText: response.statusText,
      headers: streamingHeaders(response.headers),
    });
  };
}
