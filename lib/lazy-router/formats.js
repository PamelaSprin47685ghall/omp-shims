// Per-API request rewriting.
//
// The gateway speaks three inbound dialects. Each adapter knows where its
// dialect keeps the model, the reasoning effort and the output-token limit, how
// it spells an error, and how its conversation reads as a canonical transcript
// (canonical.js), so the router itself never touches a field name.
// The gateway then translates the inbound effort into each provider's own
// knob (reasoning_effort, reasoning.effort, thinking levels, model suffixes).

import { chatTranscript, messagesTranscript, responsesTranscript } from "./canonical.js";

/** Content-part types that carry an image, across the three dialects. */
const IMAGE_PART_TYPES = new Set(["image_url", "input_image", "image"]);

/** Effort levels Anthropic's output_config accepts. */
const ANTHROPIC_OUTPUT_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/**
 * How a streamed event bears on an attempt that is still being judged:
 * ERROR fails it, PROGRESS proves the provider is answering, PREAMBLE (the
 * gateway's own opening events, keep-alives) says nothing yet.
 */
export const STREAM_EVENT = Object.freeze({ ERROR: "error", PROGRESS: "progress", PREAMBLE: "preamble" });

/** Responses-API event types that only the provider's answer can produce. */
const RESPONSES_PROGRESS = /^response\.(output|reasoning|content_part|function_call|completed|incomplete)/;

/** Anthropic event types that only the provider's answer can produce. */
const MESSAGES_PROGRESS = new Set(["content_block_start", "content_block_delta", "message_delta", "message_stop"]);

/** True when any message part anywhere in `value` is an image. */
export function containsImage(value) {
  if (Array.isArray(value)) return value.some(containsImage);
  if (!value || typeof value !== "object") return false;
  if (IMAGE_PART_TYPES.has(value.type)) return true;
  return Object.values(value).some((child) => typeof child === "object" && containsImage(child));
}

/** OpenAI Chat Completions: `reasoning_effort`, `max_completion_tokens`. */
const chat = {
  name: "openai-chat",
  conversation: (body) => body.messages,
  transcript: chatTranscript,
  readEffort: (body) => body.reasoning_effort,
  writeEffort(body, level) {
    if (level === undefined) delete body.reasoning_effort;
    else body.reasoning_effort = level;
  },
  writeMaxTokens(body, limit) {
    // The gateway reads max_completion_tokens ?? max_tokens; keep exactly one.
    delete body.max_tokens;
    body.max_completion_tokens = limit;
  },
  requestUsage(body) {
    if (body.stream !== true) return;
    body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  },
  isOutputEvent({ data }) {
    return (data?.choices ?? []).some((choice) =>
      Boolean(
        choice.delta?.content ||
          choice.delta?.reasoning_content ||
          choice.delta?.reasoning ||
          choice.delta?.tool_calls?.length,
      ),
    );
  },
  errorBody: (message, type) => ({ error: { message, type } }),
  classifyEvent({ data }) {
    if (data?.error) return STREAM_EVENT.ERROR;
    const answered = (data?.choices ?? []).some(
      (choice) =>
        choice.finish_reason ||
        choice.delta?.content ||
        choice.delta?.reasoning_content ||
        choice.delta?.reasoning ||
        choice.delta?.tool_calls?.length,
    );
    return answered || data?.usage ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/** OpenAI Responses: `reasoning.effort`, `max_output_tokens`. */
const responses = {
  name: "openai-responses",
  conversation: (body) => body.input,
  transcript: responsesTranscript,
  readEffort: (body) => body.reasoning?.effort,
  writeEffort(body, level) {
    if (level === undefined) {
      if (body.reasoning) delete body.reasoning.effort;
      return;
    }
    body.reasoning = { ...(body.reasoning ?? {}), effort: level };
  },
  writeMaxTokens(body, limit) {
    body.max_output_tokens = limit;
  },
  errorBody: (message, type) => ({ error: { message, type } }),
  isOutputEvent({ name, data }) {
    const type = data?.type ?? name ?? "";
    return /^response\.(output_text|reasoning_summary_text|reasoning_text|function_call_arguments)\.delta$/.test(type);
  },
  classifyEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "error" || type === "response.failed" || data?.error) return STREAM_EVENT.ERROR;
    return RESPONSES_PROGRESS.test(type ?? "") ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/**
 * Anthropic Messages: `output_config.effort` (low…max) or `thinking`.
 * "none" disables thinking; "minimal" has no output_config spelling, so it
 * rides as "low", the nearest level the dialect can express.
 */
const messages = {
  name: "anthropic-messages",
  conversation: (body) => body.messages,
  transcript: messagesTranscript,
  readEffort(body) {
    if (body.output_config?.effort) return body.output_config.effort;
    if (body.thinking?.type === "disabled") return "none";
    // The gateway treats a bare thinking budget as "high".
    if (body.thinking?.type === "enabled") return "high";
    return undefined;
  },
  writeEffort(body, level) {
    const outputConfig = { ...(body.output_config ?? {}) };
    delete outputConfig.effort;
    delete body.thinking;
    if (level === "none") {
      body.thinking = { type: "disabled" };
    } else if (level !== undefined) {
      outputConfig.effort = ANTHROPIC_OUTPUT_EFFORTS.has(level) ? level : "low";
    }
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
    else delete body.output_config;
  },
  writeMaxTokens(body, limit) {
    body.max_tokens = limit;
  },
  errorBody: (message, type) => ({ type: "error", error: { type, message } }),
  isOutputEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "content_block_delta") return true;
    if (type !== "content_block_start") return false;
    const block = data?.content_block;
    return block?.type === "tool_use" || Boolean(block?.text);
  },
  classifyEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "error") return STREAM_EVENT.ERROR;
    return MESSAGES_PROGRESS.has(type) ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/** Inbound path → dialect adapter. */
export const FORMATS = Object.freeze({
  "/v1/chat/completions": chat,
  "/v1/responses": responses,
  "/v1/messages": messages,
});

/** The adapter for a request path, or undefined for paths the router does not serve. */
export function formatForPath(pathname) {
  return FORMATS[pathname];
}

/**
 * A copy of the client body aimed at one candidate.
 * @param {object} format adapter
 * @param {object} body parsed client body (left untouched)
 * @param {{model: string, effort: string|undefined, maxTokens: number}} target
 */
export function rewriteBody(format, body, { model, effort, maxTokens }) {
  const next = structuredClone(body);
  next.model = model;
  format.writeEffort(next, effort);
  format.writeMaxTokens(next, maxTokens);
  format.requestUsage?.(next);
  return next;
}

/**
 * The liveness probe: a minimal, non-streaming chat completion.
 * @param {{model: string, effort: string|undefined, maxTokens: number, prompt: string}} spec
 */
export function probeBody({ model, effort, maxTokens, prompt }) {
  const body = { model, stream: false, messages: [{ role: "user", content: prompt }] };
  chat.writeEffort(body, effort);
  chat.writeMaxTokens(body, maxTokens);
  return body;
}
/** Rewrite only the model identity fields owned by the inbound API dialect. */
function rewriteModelIdentity(format, value, publicModel) {
  if (!value || typeof value !== "object") return false;
  let changed = false;
  if (typeof value.model === "string") {
    value.model = publicModel;
    changed = true;
  }
  if (format?.name === "openai-responses" && value.response && typeof value.response.model === "string") {
    value.response.model = publicModel;
    changed = true;
  }
  if (format?.name === "anthropic-messages" && value.message && typeof value.message.model === "string") {
    value.message.model = publicModel;
    changed = true;
  }
  return changed;
}

function rebuiltResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function rewriteJsonResponseModel(format, response, publicModel) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let text = "";
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk) {
      text += decoder.decode(chunk, { stream: true });
    },
    flush(controller) {
      text += decoder.decode();
      try {
        const value = JSON.parse(text);
        if (rewriteModelIdentity(format, value, publicModel)) text = JSON.stringify(value);
      } catch {}
      controller.enqueue(encoder.encode(text));
    },
  }));
  return rebuiltResponse(response, stream);
}

function rewriteSseBlockModel(format, block, publicModel) {
  const lines = block.split(/\r?\n/);
  const dataIndexes = [];
  const data = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("data:")) continue;
    dataIndexes.push(i);
    data.push(lines[i].slice(5).trimStart());
  }
  if (dataIndexes.length === 0) return block;
  let value;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    return block;
  }
  if (!rewriteModelIdentity(format, value, publicModel)) return block;
  const first = dataIndexes[0];
  const drop = new Set(dataIndexes.slice(1));
  lines[first] = `data: ${JSON.stringify(value)}`;
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

function rewriteSseResponseModel(format, response, publicModel) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const stream = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      for (;;) {
        const match = /\r?\n\r?\n/.exec(pending);
        if (!match) break;
        const block = pending.slice(0, match.index);
        const separator = match[0];
        pending = pending.slice(match.index + separator.length);
        controller.enqueue(encoder.encode(rewriteSseBlockModel(format, block, publicModel) + separator));
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) controller.enqueue(encoder.encode(rewriteSseBlockModel(format, pending, publicModel)));
    },
  }));
  return rebuiltResponse(response, stream);
}

/**
 * Keep a Lazy request's public model identity stable even though its provider
 * attempt was sent to a concrete model. The concrete served model remains in
 * x-lazy-router-model and internal logs; response JSON/SSE exposes lazy/*.
 */
export function rewriteResponseModel(format, response, publicModel) {
  if (!response?.body || typeof publicModel !== "string" || publicModel.length === 0) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) return rewriteSseResponseModel(format, response, publicModel);
  if (contentType.includes("application/json")) return rewriteJsonResponseModel(format, response, publicModel);
  return response;
}
