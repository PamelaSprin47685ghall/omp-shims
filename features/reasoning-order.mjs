// Emit all reasoning before any visible output in a streamed response.
//
// Chat Completions uses a two-phase rule. Provider-labelled reasoning goes out
// as it arrives. Visible text, tool calls, and other body frames wait until the
// provider ends, so late reasoning can never appear after the first visible
// delta. Thinking is read from explicit fields only; prose and  thinking tags
// are never guessed.
//
// Messages and Responses use their typed events. A thinking block can stream.
// Text, tool use, and their lifecycle frames wait until all later thinking has
// arrived. Every content index is then reallocated in delivery order, and a
// Responses event stream gets one continuous sequence_number.
//
// Frame parsing and chunk scanning come from lib/sse.mjs. Nothing here splits
// chunks or parses JSON text by hand.

import { isGatewayProcess, report } from "../lib/contracts.mjs";
import { addInboundMiddleware, middlewarePriority } from "../lib/inbound.mjs";
import {
  isEventStream,
  rebuildResponse,
  serializeSseFrame,
  streamingHeaders,
  transformSseStream,
} from "../lib/sse.mjs";

export const name = "reasoning-order";
export const phase = "edge";

const CHAT_PATH = "/v1/chat/completions";
const MESSAGES_PATH = "/v1/messages";
const RESPONSES_PATH = "/v1/responses";
const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();

/** Chat delta keys that carry explicit reasoning. */
const REASON_KEYS = new Set(["reasoning_content", "reasoning", "reasoning_text"]);

/** Chat delta keys that carry visible body output. */
const BODY_KEYS = new Set(["content", "tool_calls", "function_call", "refusal", "logprobs"]);

/** Keep every non-data line, and replace the data lines with one JSON value. */
function render(frame, value) {
  if (value === undefined) return serializeSseFrame({ lines: frame.lines });
  const lines = frame.lines.filter((line) => !line.startsWith("data:"));
  return serializeSseFrame({ lines: [...lines, `data: ${JSON.stringify(value)}`] });
}

/** Split one Chat delta into thought, visible, and role parts. */
function classifyChoice(choice) {
  const delta = choice?.delta;
  if (!delta || typeof delta !== "object") return null;

  const thought = {};
  const visible = {};
  let hasThought = false;
  let hasVisible = false;

  for (const [key, value] of Object.entries(delta)) {
    if (REASON_KEYS.has(key)) {
      if (typeof value === "string" && value.length > 0) {
        thought[key] = value;
        hasThought = true;
      }
    } else if (key === "content" && Array.isArray(value)) {
      // Mistral wire blocks carry explicit type tags. Untyped strings,
      // markdown, and other provider blocks are not thought.
      const text = [];
      let thoughtText = "";
      for (const block of value) {
        if (block?.type === "thinking" && Array.isArray(block.thinking)) {
          for (const part of block.thinking) {
            if (part?.type === "text" && typeof part.text === "string") thoughtText += part.text;
          }
        } else {
          text.push(block);
        }
      }
      if (thoughtText && !hasThought) {
        thought.reasoning_content = thoughtText;
        hasThought = true;
      }
      if (text.length) {
        // OpenAI Chat content is a string when every block is plain text.
        // Other vendor blocks stay intact as an array.
        visible.content = text.every((part) => part?.type === "text" && typeof part.text === "string")
          ? text.map((part) => part.text).join("")
          : text;
        hasVisible = true;
      }
    } else if (key === "role" && value === "assistant") {
      // A role frame is a preamble, never body.
    } else if (BODY_KEYS.has(key)) {
      if (
        value !== null &&
        value !== undefined &&
        !(typeof value === "string" && value.length === 0) &&
        !(Array.isArray(value) && value.length === 0)
      ) {
        visible[key] = value;
        hasVisible = true;
      }
    } else {
      visible[key] = value;
      hasVisible = true;
    }
  }

  return { thought, visible, hasThought, hasVisible, role: delta.role === "assistant" };
}

/** Turn one Chat SSE frame into parts in delivery order. */
function chatParts(frame) {
  const value = frame.json();
  if (value === undefined || value === null) {
    const kind = frame.isDone ? "terminal" : frame.data === "" ? "preamble" : "other";
    return [{ kind, text: render(frame) }];
  }
  if (!Array.isArray(value.choices)) {
    return [{ kind: value.error ? "terminal" : "other", text: render(frame) }];
  }

  const parts = [];
  let any = false;
  for (const choice of value.choices) {
    const result = classifyChoice(choice);
    if (!result) {
      parts.push({
        kind: choice?.finish_reason ? "terminal" : "other",
        text: render(frame, { ...value, choices: [choice] }),
      });
      continue;
    }
    any = true;
    const frameFor = (delta, finish = null) =>
      render(frame, { ...value, choices: [{ ...choice, finish_reason: finish, delta }] });

    if (result.role) parts.push({ kind: "preamble", text: frameFor({ role: "assistant" }) });
    if (result.hasThought) parts.push({ kind: "thinking", text: frameFor(result.thought) });
    if (result.hasVisible) parts.push({ kind: "body", text: frameFor(result.visible) });
    if (choice.finish_reason) parts.push({ kind: "terminal", text: frameFor({}, choice.finish_reason) });
  }

  if (!any || parts.length === 0) {
    const terminal = Boolean(value.usage || value.choices.some((choice) => choice.finish_reason));
    return [{ kind: terminal ? "terminal" : "other", text: render(frame) }];
  }
  return parts;
}

/**
 * The visible-body buffer. It is released on a terminal frame and on flush.
 * The byte limit is checked before a frame joins the buffer.
 */
function createChatBuffer(emit, maxBufferBytes) {
  let pending = [];
  let bytes = 0;
  return {
    defer(text) {
      bytes += encoder.encode(text).byteLength;
      if (bytes > maxBufferBytes) {
        report("reasoning-order visible buffer exceeded its limit", { maxBufferBytes });
        throw new RangeError("reasoning-order visible buffer exceeded limit");
      }
      pending.push(text);
    },
    release() {
      for (const text of pending) emit(text);
      pending = [];
      bytes = 0;
    },
  };
}

/** Keep the two-phase Chat guarantee. */
export function orderChatStream(source, { maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES } = {}) {
  let buffer;
  return transformSseStream(source, {
    maxBufferBytes,
    onFrame(frame, emit) {
      buffer ??= createChatBuffer(emit, maxBufferBytes);
      const terminal = [];
      for (const part of chatParts(frame)) {
        if (part.kind === "thinking" || part.kind === "preamble") {
          emit(part.text);
        } else if (part.kind === "body" || part.kind === "other") {
          buffer.defer(part.text);
        } else {
          terminal.push(part.text);
        }
      }
      if (terminal.length > 0) {
        buffer.release();
        for (const text of terminal) emit(text);
      }
    },
    onFlush() {
      buffer?.release();
    },
  });
}

/** Read a string field, or undefined. */
function textOf(value) {
  return typeof value === "string" ? value : undefined;
}

/** True when a string starts with a prefix. */
function startsWith(text, prefix) {
  return typeof text === "string" && text.startsWith(prefix);
}

/** Classify one typed Messages or Responses frame. */
function typedCategory(frame, value, protocol, origins) {
  if (frame.isDone) return "terminal";
  const type = textOf(value?.type) ?? textOf(frame.event);

  if (protocol === "messages") {
    if (type === "message_delta" || type === "message_stop" || type === "error") return "terminal";
    if (!startsWith(type, "content_block_")) return "preamble";

    const index = value?.index;
    if (type === "content_block_start") {
      const kind =
        value?.content_block?.type === "thinking" || value?.content_block?.type === "redacted_thinking"
          ? "thinking"
          : "body";
      if (Number.isInteger(index)) origins.set(index, kind);
      return kind;
    }
    if (Number.isInteger(index) && origins.has(index)) return origins.get(index);
    const thought = value?.delta?.type === "thinking_delta" || value?.delta?.type === "signature_delta";
    return thought ? "thinking" : "body";
  }

  if (
    type === "response.completed" ||
    type === "response.failed" ||
    type === "response.incomplete" ||
    type === "error"
  ) {
    return "terminal";
  }
  if (!startsWith(type, "response.")) return "preamble";
  if (type === "response.created" || type === "response.in_progress" || type === "response.queued") return "preamble";

  const index = value?.output_index;
  if (startsWith(type, "response.output_item.")) {
    const kind =
      value?.item?.type === "reasoning" ? "thinking" : value?.item?.type ? "body" : (origins.get(index) ?? "body");
    if (Number.isInteger(index)) origins.set(index, kind);
    return kind;
  }
  if (startsWith(type, "response.reasoning") || startsWith(type, "response.reasoning_summary")) {
    if (Number.isInteger(index)) origins.set(index, "thinking");
    return "thinking";
  }
  if (
    startsWith(type, "response.output_text") ||
    startsWith(type, "response.function_call_arguments") ||
    startsWith(type, "response.refusal")
  ) {
    if (Number.isInteger(index)) origins.set(index, "body");
    return "body";
  }
  if (Number.isInteger(index)) {
    if (!origins.has(index)) {
      const partType = textOf(value?.part?.type) ?? "";
      const thinking = /^(reasoning|reasoning_summary_text|summary_text)$/.test(partType);
      origins.set(index, thinking ? "thinking" : "body");
    }
    return origins.get(index);
  }
  return "preamble";
}

/** Build the value to emit for one typed frame. */
function typedValue(frame, value, kind, state, protocol) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const next = { ...value };

  const property = protocol === "messages" ? "index" : "output_index";
  const index = next[property];
  if (Number.isInteger(index)) {
    const mapped = kind === "thinking" ? state.thought.get(index) : state.thought.size + visibleIndex(state, index);
    if (Number.isInteger(mapped)) next[property] = mapped;
  }

  if (protocol === "responses" && Number.isInteger(next.sequence_number)) {
    next.sequence_number = state.sequence++;
  }

  if (
    protocol === "responses" &&
    (next.type ?? frame.event) === "response.completed" &&
    Array.isArray(next.response?.output)
  ) {
    const output = next.response.output;
    next.response = {
      ...next.response,
      output: [
        ...output.filter((item) => item?.type === "reasoning"),
        ...output.filter((item) => item?.type !== "reasoning"),
      ],
    };
  }
  return next;
}

/** Numeric visible index, or NaN to leave an unknown index alone. */
function visibleIndex(state, index) {
  return state.visible.get(index) ?? Number.NaN;
}

/** Keep typed ordering, index remapping, and one continuous sequence. */
export function orderTypedStream(source, protocol, { maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES } = {}) {
  if (protocol !== "messages" && protocol !== "responses") {
    throw new TypeError("Unsupported typed SSE protocol");
  }

  const state = {
    origins: new Map(),
    thought: new Map(),
    visible: new Map(),
    sequence: 0,
    nextThought: 0,
  };
  const deferred = [];
  let bytes = 0;

  const release = (emit) => {
    for (const record of deferred) {
      emit(render(record.frame, typedValue(record.frame, record.value, "body", state, protocol)));
    }
    deferred.length = 0;
    bytes = 0;
  };

  return transformSseStream(source, {
    maxBufferBytes,
    onFrame(frame, emit) {
      const value = frame.json();
      const kind = typedCategory(frame, value, protocol, state.origins);
      const index = protocol === "messages" ? value?.index : value?.output_index;

      if (kind === "thinking") {
        if (Number.isInteger(index) && !state.thought.has(index)) {
          state.thought.set(index, state.nextThought++);
        }
        emit(render(frame, typedValue(frame, value, "thinking", state, protocol)));
      } else if (kind === "body") {
        if (Number.isInteger(index) && !state.visible.has(index)) {
          state.visible.set(index, state.visible.size);
        }
        bytes += encoder.encode(render(frame, value)).byteLength;
        if (bytes > maxBufferBytes) {
          report("reasoning-order visible buffer exceeded its limit", { maxBufferBytes });
          throw new RangeError("reasoning-order visible buffer exceeded limit");
        }
        deferred.push({ frame, value });
      } else if (kind === "terminal") {
        release(emit);
        emit(render(frame, typedValue(frame, value, "terminal", state, protocol)));
      } else {
        emit(render(frame, typedValue(frame, value, "preamble", state, protocol)));
      }
    },
    onFlush(emit) {
      release(emit);
    },
  });
}

/** One installed layer per process. */
let active;

export async function install(config, context = {}) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) return;
  if (active) return active;

  const add = context.addInboundMiddleware ?? addInboundMiddleware;
  const log = context.log ?? (() => {});
  const maxBufferBytes = Number(config?.maxBufferBytes) > 0 ? Number(config.maxBufferBytes) : DEFAULT_MAX_BUFFER_BYTES;

  const dispose = add(
    async (request, _server, next) => {
      if (request.method !== "POST") return next();

      let pathname;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        return next();
      }
      const protocol =
        pathname === MESSAGES_PATH
          ? "messages"
          : pathname === RESPONSES_PATH
            ? "responses"
            : pathname === CHAT_PATH
              ? "chat"
              : null;
      if (protocol === null) return next();

      const response = await next();
      if (!isEventStream(response) || response.status !== 200) return response;

      try {
        const body =
          protocol === "chat"
            ? orderChatStream(response.body, { maxBufferBytes })
            : orderTypedStream(response.body, protocol, { maxBufferBytes });
        return rebuildResponse(response, body, { headers: streamingHeaders(response.headers) });
      } catch (error) {
        report("reasoning-order rewrite failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return response;
      }
    },
    { name, priority: middlewarePriority.reasoningOrder },
  );

  active = () => {
    active = undefined;
    dispose();
  };
  log("reasoning-order: reasoning-before-body ordering enabled", { maxBufferBytes });
  return active;
}
