// Anthropic Messages transport for models.yml providers.
//
// A provider that declares `api: "anthropic-messages"` speaks the Messages
// dialect. The inbound gateway may speak Chat Completions, so this module
// converts one request, one JSON answer, and one event stream. Every stream
// passes through lib/sse.mjs; a JSON answer is read with a byte cap by the
// caller. No answer text is retained after it reaches a frame.

import { randomUUID } from "node:crypto";
import { rebuildResponse, serializeSseFrame, transformSseStream } from "../sse.mjs";

const ERROR = "adapter_unsupported: anthropic messages";
/** Largest number of tool blocks one stream maps. */
const MAX_TOOL_STATES = 1_024;
/** Anthropic requires max_tokens; the gateway usually rewrites it first. */
const DEFAULT_MAX_TOKENS = 4_096;

/** Anthropic stop reasons in Chat spelling. */
const FINISH_REASON = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

const mintedId = (prefix) => prefix + randomUUID().replace(/-/g, "");

/** Read plain text from a Chat content value, refusing an unknown part. */
function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(`${ERROR}: content`);
  let text = "";
  for (const part of value) {
    if (!part || typeof part !== "object") throw new TypeError(`${ERROR}: content part`);
    if (["text", "input_text", "output_text", "summary_text"].includes(part.type)) {
      if (typeof part.text !== "string") throw new TypeError(`${ERROR}: text part`);
      text += part.text;
    } else if (part.type === "refusal" && typeof part.refusal === "string") {
      text += part.refusal;
    } else throw new TypeError(`${ERROR}: content modality`);
  }
  return text;
}

/** One Chat image part as an Anthropic image block. Only data and HTTPS URLs. */
function imageBlock(part) {
  const raw = part.image_url;
  const url = typeof raw === "string" ? raw : raw?.url;
  if (typeof url !== "string" || url === "") throw new TypeError(`${ERROR}: image url`);
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (data?.[2]) {
    return { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } };
  }
  if (/^https:\/\//i.test(url)) return { type: "image", source: { type: "url", url } };
  throw new TypeError(`${ERROR}: image source`);
}

/** One user or assistant content value as Anthropic content blocks. */
function userBlocks(value) {
  if (typeof value === "string") {
    if (value === "") throw new TypeError(`${ERROR}: empty user content`);
    return [{ type: "text", text: value }];
  }
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${ERROR}: user content`);
  const blocks = [];
  for (const part of value) {
    if (!part || typeof part !== "object") throw new TypeError(`${ERROR}: content part`);
    if (["text", "input_text", "output_text"].includes(part.type)) {
      if (typeof part.text !== "string") throw new TypeError(`${ERROR}: text part`);
      if (part.text !== "") blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      blocks.push(imageBlock(part));
    } else throw new TypeError(`${ERROR}: content modality`);
  }
  if (blocks.length === 0) throw new TypeError(`${ERROR}: empty user content`);
  return blocks;
}

/** One assistant turn as Anthropic content blocks. */
function assistantBlocks(message) {
  const blocks = [];
  const text = textOf(message.content);
  if (text) blocks.push({ type: "text", text });
  const thought = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  const signature = typeof message.reasoning_signature === "string" ? message.reasoning_signature : "";
  // Anthropic rejects a thinking block that has no signature, so an unsigned
  // reasoning trace is dropped rather than replayed.
  if (thought && signature) blocks.push({ type: "thinking", thinking: thought, signature });
  for (const call of message.tool_calls ?? []) {
    if (call?.type !== undefined && call.type !== "function") throw new TypeError(`${ERROR}: tool call`);
    if (typeof call?.id !== "string" || call.id === "") throw new TypeError(`${ERROR}: tool call id`);
    if (typeof call?.function?.name !== "string" || call.function.name === "") {
      throw new TypeError(`${ERROR}: tool name`);
    }
    let input = {};
    try {
      const parsed = JSON.parse(call.function.arguments ?? "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
    } catch {
      throw new TypeError(`${ERROR}: tool arguments`);
    }
    blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  return blocks;
}

/** Append a turn to the Anthropic list, merging a same-role neighbour. */
function appendTurn(messages, role, blocks) {
  if (blocks.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    last.content.push(...blocks);
    return;
  }
  messages.push({ role, content: blocks });
}

/** The output-token limit Anthropic requires. */
function maxTokensOf(chat, fallback) {
  for (const value of [chat.max_tokens, chat.max_completion_tokens, fallback]) {
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return DEFAULT_MAX_TOKENS;
}

/** Map a Chat tool choice onto the Anthropic spelling. */
function toolChoiceOf(choice) {
  if (choice === undefined || choice === null) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (choice === "none") return { type: "none" };
  if (choice?.type === "function" && typeof choice.function?.name === "string") {
    return { type: "tool", name: choice.function.name };
  }
  throw new TypeError(`${ERROR}: tool choice`);
}

/**
 * A Chat Completions request body as an Anthropic Messages body.
 * @param {object} chat inbound body in the Chat dialect
 * @param {string} modelId the provider's own model id
 * @param {{maxTokens?: number}} [options]
 */
export function chatAsMessages(chat, modelId, { maxTokens } = {}) {
  if (!chat || typeof chat !== "object" || !Array.isArray(chat.messages)) {
    throw new TypeError(`${ERROR}: messages`);
  }
  const messages = [];
  const system = [];
  let atToolResult = false;
  for (const message of chat.messages) {
    if (!message || typeof message !== "object") throw new TypeError(`${ERROR}: message`);
    if (message.role === "system" || message.role === "developer") {
      const text = textOf(message.content);
      if (text) system.push(text);
      continue;
    }
    if (message.role === "tool") {
      if (typeof message.tool_call_id !== "string" || message.tool_call_id === "") {
        throw new TypeError(`${ERROR}: tool result id`);
      }
      const result = {
        type: "tool_result",
        tool_use_id: message.tool_call_id,
        content: textOf(message.content),
      };
      const last = messages[messages.length - 1];
      if (atToolResult && last?.role === "user") last.content.push(result);
      else messages.push({ role: "user", content: [result] });
      atToolResult = true;
      continue;
    }
    atToolResult = false;
    if (message.role === "user") {
      appendTurn(messages, "user", userBlocks(message.content));
      continue;
    }
    if (message.role === "assistant") {
      appendTurn(messages, "assistant", assistantBlocks(message));
      continue;
    }
    throw new TypeError(`${ERROR}: role`);
  }
  if (messages.length === 0) throw new TypeError(`${ERROR}: empty conversation`);

  const body = {
    model: modelId,
    messages,
    max_tokens: maxTokensOf(chat, maxTokens),
    stream: chat.stream === true,
  };
  if (system.length > 0) body.system = system.join("\n\n");
  for (const key of ["temperature", "top_p", "top_k"]) {
    if (Number.isFinite(chat[key])) body[key] = chat[key];
  }
  if (typeof chat.stop === "string" && chat.stop !== "") body.stop_sequences = [chat.stop];
  else if (Array.isArray(chat.stop)) {
    const sequences = chat.stop.filter((value) => typeof value === "string" && value !== "");
    if (sequences.length > 0) body.stop_sequences = sequences;
  }
  if (Array.isArray(chat.tools) && chat.tools.length > 0) {
    body.tools = chat.tools.map((tool) => {
      if (tool?.type !== "function" || typeof tool.function?.name !== "string") {
        throw new TypeError(`${ERROR}: tool declaration`);
      }
      const fn = tool.function;
      const schema =
        fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object", properties: {} };
      return {
        name: fn.name,
        ...(typeof fn.description === "string" && fn.description ? { description: fn.description } : {}),
        input_schema: schema,
      };
    });
  }
  const choice = toolChoiceOf(chat.tool_choice);
  if (choice) body.tool_choice = choice;
  return body;
}

/** Anthropic usage counters in Chat spelling. */
function usageOf(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const cached =
    Number.isSafeInteger(usage.cache_read_input_tokens) && usage.cache_read_input_tokens >= 0
      ? usage.cache_read_input_tokens
      : undefined;
  // Anthropic reports cache reads and cache writes outside input_tokens. A
  // Chat prompt_tokens value is the whole input, so the three counters add.
  const prompt =
    count(usage.input_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
  const completion = Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0 ? usage.output_tokens : 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
  };
}

/** The Chat message one Anthropic answer carries. */
function messageOf(original) {
  const content = [];
  const calls = [];
  let thought = "";
  for (const block of original.content) {
    if (!block || typeof block !== "object") throw new TypeError(`${ERROR}: content block`);
    if (block.type === "text" && typeof block.text === "string") content.push(block.text);
    else if (block.type === "thinking" && typeof block.thinking === "string") thought += block.thinking;
    else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      calls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
    // redacted_thinking and server-side tool blocks have no Chat spelling.
  }
  const message = { role: "assistant", content: content.join("") || null };
  if (thought) message.reasoning_content = thought;
  if (calls.length > 0) message.tool_calls = calls;
  return message;
}

/**
 * An Anthropic Messages JSON answer as a Chat completion.
 * @param {object} original the provider's answer
 * @param {string} model the public model id
 */
export function messagesAsChat(original, model) {
  if (!original || typeof original !== "object" || !Array.isArray(original.content)) {
    throw new TypeError(`${ERROR}: answer`);
  }
  const message = messageOf(original);
  const finish = FINISH_REASON[original.stop_reason] ?? "stop";
  return {
    id: mintedId("chatcmpl-"),
    object: "chat.completion",
    model,
    created: Math.floor(Date.now() / 1000),
    choices: [{ index: 0, message, finish_reason: finish }],
    ...(original.usage ? { usage: usageOf(original.usage) } : {}),
  };
}

/** One Chat completion chunk. */
function chunk(id, created, model, delta, finish = null) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

/**
 * Transform an Anthropic event stream into Chat completion chunks.
 * The completed frames contain no provider text beyond the tokens themselves.
 * @param {Response} response the provider's SSE answer
 * @param {string} model the public model id
 */
export function messagesSseAsChat(response, model) {
  if (!response.body) return response;
  const id = mintedId("chatcmpl-");
  const created = Math.floor(Date.now() / 1000);
  const tools = new Map();
  let toolIndex = 0;
  let inputTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  let cachedTokens;
  let stopReason = "end_turn";
  let roleSent = false;
  let done = false;

  const emit = (emitBytes, value) => emitBytes(serializeSseFrame({ data: value }));
  const ensureRole = (emitBytes) => {
    if (roleSent) return;
    roleSent = true;
    emit(emitBytes, chunk(id, created, model, { role: "assistant" }));
  };
  const finish = (emitBytes) => {
    if (done) return;
    ensureRole(emitBytes);
    emit(emitBytes, chunk(id, created, model, {}, FINISH_REASON[stopReason] ?? "stop"));
    const promptTokens = inputTokens + (cachedTokens ?? 0) + cacheWriteTokens;
    emit(emitBytes, {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: outputTokens,
        total_tokens: promptTokens + outputTokens,
        ...(cachedTokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: cachedTokens } }),
      },
    });
    emit(emitBytes, "[DONE]");
    done = true;
  };
  const readUsage = (usage) => {
    if (!usage || typeof usage !== "object") return;
    if (Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0) inputTokens = usage.input_tokens;
    if (Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0) outputTokens = usage.output_tokens;
    if (Number.isSafeInteger(usage.cache_creation_input_tokens) && usage.cache_creation_input_tokens >= 0) {
      cacheWriteTokens = usage.cache_creation_input_tokens;
    }
    if (Number.isSafeInteger(usage.cache_read_input_tokens) && usage.cache_read_input_tokens >= 0) {
      cachedTokens = usage.cache_read_input_tokens;
    }
  };

  const body = transformSseStream(response.body, {
    onFrame(frame, emitBytes) {
      const event = frame.json();
      if (!event || typeof event !== "object") return;
      const type = event.type ?? frame.event ?? "";
      if (type === "message_start") {
        ensureRole(emitBytes);
        readUsage(event.message?.usage);
        return;
      }
      if (type === "content_block_start" && event.content_block?.type === "tool_use") {
        if (tools.size >= MAX_TOOL_STATES) return;
        const key = Number.isInteger(event.index) ? event.index : tools.size;
        const block = event.content_block;
        const call = {
          index: toolIndex++,
          id: typeof block.id === "string" && block.id !== "" ? block.id : mintedId("call_"),
          name: typeof block.name === "string" ? block.name : "",
        };
        tools.set(key, call);
        ensureRole(emitBytes);
        emit(
          emitBytes,
          chunk(id, created, model, {
            tool_calls: [
              { index: call.index, id: call.id, type: "function", function: { name: call.name, arguments: "" } },
            ],
          }),
        );
        return;
      }
      if (type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          ensureRole(emitBytes);
          emit(emitBytes, chunk(id, created, model, { content: delta.text }));
        } else if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
          ensureRole(emitBytes);
          emit(emitBytes, chunk(id, created, model, { reasoning_content: delta.thinking }));
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const call = tools.get(event.index);
          if (!call) return;
          ensureRole(emitBytes);
          emit(
            emitBytes,
            chunk(id, created, model, {
              tool_calls: [
                {
                  index: call.index,
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: delta.partial_json },
                },
              ],
            }),
          );
        }
        return;
      }
      if (type === "message_delta") {
        if (typeof event.delta?.stop_reason === "string") stopReason = event.delta.stop_reason;
        readUsage(event.usage);
        return;
      }
      if (type === "message_stop") {
        finish(emitBytes);
        return;
      }
      if (type === "error") {
        ensureRole(emitBytes);
        emit(emitBytes, { error: { type: "upstream_error", message: "Anthropic upstream reported a failure" } });
        done = true;
      }
    },
    onFlush(emitBytes) {
      finish(emitBytes);
    },
  });
  return rebuildResponse(response, body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}
