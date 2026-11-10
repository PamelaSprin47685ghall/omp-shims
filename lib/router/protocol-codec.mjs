// One protocol conversion layer for the three inbound dialects.
//
// The gateway speaks OpenAI Chat, OpenAI Responses, and Anthropic Messages.
// Shim-owned providers expose one of these dialects natively. This module
// translates a request into the provider's dialect and translates the answer
// back, so no caller carries a second copy of the conversion rules.
//
// Every stream path uses lib/sse.mjs. A frame is parsed once and serialised
// once, so a CRLF split across two chunks and a `[DONE]` without a space are
// both handled in one place. Stream buffers and event sizes are bounded by the
// codec. A non-stream JSON answer is read with a byte cap.

import { randomUUID } from "node:crypto";
import { preserveResponseUrl } from "../contracts.mjs";
import { rebuildResponse, serializeSseFrame, transformSseStream } from "../sse.mjs";

const ERROR = "Unsupported request content for provider bridge";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
/** Largest visible answer, reasoning text, or tool argument string retained. */
export const MAX_RETAINED_CHARS = 4 * 1024 * 1024;
/** Largest number of tool calls retained for a final frame. */
const MAX_TOOL_STATES = 1_024;
const TRUNCATION_MARK = "\n[truncated]";

/** Append up to the retained-character cap. The state records truncation. */
function appendRetained(current, delta, state) {
  if (!delta || state.truncated) return current;
  if (current.length >= MAX_RETAINED_CHARS) {
    state.truncated = true;
    return `${current}${TRUNCATION_MARK}`;
  }
  const room = MAX_RETAINED_CHARS - current.length;
  if (delta.length > room) {
    state.truncated = true;
    return `${current}${delta.slice(0, room)}${TRUNCATION_MARK}`;
  }
  return `${current}${delta}`;
}

/** Protocol-shaped ids. A chat upstream's `chatcmpl-` id must never leak. */
const mintedId = (prefix) => prefix + randomUUID().replace(/-/g, "");
const responseId = () => mintedId("resp_");
const messageId = () => mintedId("msg_");
const reasoningId = () => mintedId("rs_");
const functionCallId = () => mintedId("fc_");

/** Chat providers disagree on the reasoning field; read all three names. */
function chatReasoning(message) {
  for (const key of ["reasoning_content", "reasoning", "reasoning_text"]) {
    if (typeof message?.[key] === "string" && message[key]) return message[key];
  }
  return "";
}

function chatReasoningSignature(message) {
  return typeof message?.reasoning_signature === "string" && message.reasoning_signature
    ? message.reasoning_signature
    : undefined;
}

function textParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(ERROR);
  let result = "";
  for (const part of value) {
    if (["text", "input_text", "output_text", "summary_text", "reasoning_text"].includes(part?.type)) {
      if (typeof part.text !== "string") throw new TypeError(ERROR);
      result += part.text;
    } else if (part?.type === "refusal" && typeof part.refusal === "string") {
      result += part.refusal;
    } else if (["input_image", "input_file", "image_url"].includes(part?.type)) {
      result += "[image]";
    } else throw new TypeError(ERROR);
  }
  return result;
}

const UNAVAILABLE_REASONING = "reasoning unavailable";

function reasoningText(item) {
  const text = (parts) =>
    (parts ?? [])
      .map((part) => part?.text)
      .filter((value) => typeof value === "string" && value && value !== UNAVAILABLE_REASONING)
      .join("\n");
  return text(item?.summary) || text(item?.content);
}

function reasoningSignature(item) {
  if (typeof item?.encrypted_content === "string" && item.encrypted_content) return item.encrypted_content;
  if (typeof item?.signature === "string" && item.signature) return item.signature;
  return undefined;
}

function imagePart(part) {
  const raw = part.type === "image_url" ? part.image_url : (part.image_url ?? part);
  const url = typeof raw === "string" ? raw : raw?.url;
  if (typeof url !== "string" || !url) throw new TypeError(ERROR);
  const detail = typeof raw === "object" ? raw.detail : part.detail;
  return { type: "image_url", image_url: { url, ...(detail ? { detail } : {}) } };
}

function chatContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new TypeError(ERROR);
  const parts = [];
  let text = "";
  const flush = () => {
    if (!text) return;
    parts.push({ type: "text", text });
    text = "";
  };
  for (const part of value) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    if (["text", "input_text", "output_text", "summary_text", "reasoning_text"].includes(part?.type)) {
      if (typeof part.text !== "string") throw new TypeError(ERROR);
      text += part.text;
    } else if (part?.type === "refusal" && typeof part.refusal === "string") {
      text += part.refusal;
    } else if (part?.type === "input_image" || part?.type === "image_url") {
      flush();
      parts.push(imagePart(part));
    } else throw new TypeError(ERROR);
  }
  flush();
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.length ? parts : "";
}

function assistantTurn({ text = "", thought = "", signature, calls }) {
  const content = [];
  if (typeof text === "string") {
    if (text) content.push({ type: "text", text });
  } else if (Array.isArray(text)) {
    content.push(...text);
  }
  const message = { role: "assistant" };
  if (!content.length) message.content = null;
  else if (content.length === 1 && content[0].type === "text") message.content = content[0].text;
  else message.content = content;
  if (thought) message.reasoning_content = thought;
  if (signature) message.reasoning_signature = signature;
  if (calls?.length) message.tool_calls = calls;
  return message;
}

function fromAnthropic(body) {
  if (!Array.isArray(body.messages)) throw new TypeError(ERROR);
  const messages = [];
  if (body.system) messages.push({ role: "system", content: textParts(body.system) });
  for (const source of body.messages) {
    if (!["user", "assistant"].includes(source.role)) throw new TypeError(ERROR);
    if (typeof source.content === "string") {
      messages.push({ role: source.role, content: source.content });
      continue;
    }
    if (!Array.isArray(source.content)) throw new TypeError(ERROR);
    const text = [];
    const calls = [];
    let thought = "";
    let signature;
    for (const part of source.content) {
      if (part?.type === "text") text.push(textParts([part]));
      else if (part?.type === "thinking") {
        const value =
          typeof part.thinking === "string"
            ? part.thinking
            : Array.isArray(part.thinking)
              ? part.thinking.map((piece) => (piece?.type === "text" ? piece.text : "")).join("")
              : "";
        if (value) thought += value;
        if (typeof part.signature === "string" && part.signature) signature = part.signature;
      } else if (part?.type === "tool_use" && typeof part.name === "string" && typeof part.id === "string") {
        calls.push({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
        });
      } else if (part?.type === "tool_result" && typeof part.tool_use_id === "string") {
        if (text.length) {
          messages.push({ role: source.role, content: text.join("") });
          text.length = 0;
        }
        messages.push({ role: "tool", tool_call_id: part.tool_use_id, content: textParts(part.content) });
      } else throw new TypeError(ERROR);
    }
    if (calls.length || text.length || thought) {
      messages.push({
        role: source.role,
        content: text.join("") || null,
        ...(thought ? { reasoning_content: thought } : {}),
        ...(signature ? { reasoning_signature: signature } : {}),
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    }
  }
  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    max_tokens: body.max_tokens,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(Array.isArray(body.tools)
      ? {
          tools: body.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
          })),
        }
      : {}),
  };
}

function fromResponses(body) {
  let input = body.input;
  if (typeof input === "string") input = [{ role: "user", content: input }];
  if (!Array.isArray(input)) throw new TypeError(ERROR);
  const messages = [];
  let pendingThought = "";
  let pendingSignature;
  if (body.instructions) messages.push({ role: "system", content: textParts(body.instructions) });
  const takeThought = () => {
    const thought = pendingThought;
    const signature = pendingSignature;
    pendingThought = "";
    pendingSignature = undefined;
    return { thought, signature };
  };
  for (const part of input) {
    if (part?.type === "reasoning") {
      const thought = reasoningText(part);
      const signature = reasoningSignature(part);
      if (thought) pendingThought = pendingThought ? `${pendingThought}\n${thought}` : thought;
      if (signature) pendingSignature = signature;
      continue;
    }
    if ((part?.type === "function_call" || part?.type === "custom_tool_call") && typeof part.name === "string") {
      const argumentsText = part.type === "custom_tool_call" ? (part.input ?? "{}") : (part.arguments ?? "{}");
      const thought = takeThought();
      messages.push(
        assistantTurn({
          thought: thought.thought,
          signature: thought.signature,
          calls: [{ type: "function", id: part.call_id, function: { name: part.name, arguments: argumentsText } }],
        }),
      );
    } else if (part?.type === "function_call_output" && typeof part.call_id === "string") {
      messages.push({ role: "tool", tool_call_id: part.call_id, content: textParts(part.output) });
    } else if (part?.type === "custom_tool_call_output" && typeof part.call_id === "string") {
      messages.push({ role: "tool", tool_call_id: part.call_id, content: textParts(part.output) });
    } else if (part?.role === "assistant") {
      const thought = takeThought();
      messages.push(
        assistantTurn({
          text: chatContent(part.content),
          thought: thought.thought,
          signature: thought.signature,
        }),
      );
    } else if (["developer", "system", "user"].includes(part?.role)) {
      messages.push({
        role: part.role === "developer" ? "system" : part.role,
        content: chatContent(part.content),
      });
    } else throw new TypeError(ERROR);
  }
  if (pendingThought || pendingSignature) {
    messages.push(assistantTurn({ thought: pendingThought, signature: pendingSignature }));
  }
  return {
    model: body.model,
    messages,
    stream: body.stream === true,
    max_tokens: body.max_output_tokens,
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(Array.isArray(body.tools)
      ? {
          tools: body.tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
        }
      : {}),
    ...(body.reasoning?.effort ? { reasoning_effort: body.reasoning.effort } : {}),
  };
}

/** Convert any supported inbound body into the Chat dialect. */
export function requestAsChat(path, body) {
  if (!body || typeof body !== "object" || typeof body.model !== "string") {
    throw new TypeError(ERROR);
  }
  if (path === "/v1/chat/completions") return structuredClone(body);
  if (path === "/v1/messages") return fromAnthropic(body);
  if (path === "/v1/responses") return fromResponses(body);
  throw new TypeError(ERROR);
}

function chatResult(body) {
  return (body.choices ?? [{}])[0] ?? {};
}

function toAnthropic(body, model) {
  const choice = chatResult(body);
  const message = choice.message ?? {};
  const content = [];
  const thought = chatReasoning(message);
  const signature = chatReasoningSignature(message);
  if (thought) content.push({ type: "thinking", thinking: thought, ...(signature ? { signature } : {}) });
  if (typeof message.content === "string" && message.content) {
    content.push({ type: "text", text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    let input;
    try {
      input = JSON.parse(call.function?.arguments ?? "{}");
    } catch {
      input = {};
    }
    content.push({ type: "tool_use", id: call.id, name: call.function?.name, input });
  }
  return {
    id: messageId(),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason:
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      output_tokens: body.usage?.completion_tokens ?? 0,
      ...(body.usage?.prompt_tokens_details?.cached_tokens !== undefined
        ? { cache_read_input_tokens: body.usage.prompt_tokens_details.cached_tokens }
        : {}),
    },
  };
}

function toResponses(body, model) {
  const choice = chatResult(body);
  const message = choice.message ?? {};
  const output = [];
  const thought = chatReasoning(message);
  const signature = chatReasoningSignature(message);
  if (thought || signature) {
    output.push({
      id: reasoningId(),
      type: "reasoning",
      status: "completed",
      ...(signature ? { encrypted_content: signature } : {}),
      summary: thought ? [{ type: "summary_text", text: thought }] : [],
      content: thought ? [{ type: "reasoning_text", text: thought }] : [],
    });
  }
  if (typeof message.content === "string" && message.content) {
    output.push({
      id: messageId(),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    });
  }
  for (const call of message.tool_calls ?? []) {
    output.push({
      id: functionCallId(),
      type: "function_call",
      name: call.function?.name,
      call_id: call.id,
      arguments: call.function?.arguments ?? "{}",
      status: "completed",
    });
  }
  const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    id: responseId(),
    object: "response",
    created_at: body.created ?? Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    usage: {
      input_tokens: body.usage?.prompt_tokens ?? 0,
      input_tokens_details: { cached_tokens: cached },
      output_tokens: body.usage?.completion_tokens ?? 0,
      total_tokens: body.usage?.total_tokens ?? 0,
    },
    error: null,
    incomplete_details: null,
  };
}

/** Convert a Chat JSON answer into the requested dialect. */
export function convertChatJson(path, body, model) {
  if (path === "/v1/chat/completions") return body;
  if (path === "/v1/messages") return toAnthropic(body, model);
  if (path === "/v1/responses") return toResponses(body, model);
  throw new TypeError(ERROR);
}

/** Serialise one converted SSE frame. */
function sseFrame(name, data) {
  return serializeSseFrame({ event: name || undefined, data });
}

/**
 * Convert a streamed Chat answer into the requested dialect.
 * The transform holds only the unfinished frame; the codec bounds its size.
 */
export function convertChatSse(path, response, publicModel) {
  if (path === "/v1/chat/completions") return response;
  if (!response.body) return response;

  const responseIdValue = responseId();
  const messageIdValue = messageId();
  const reasoningIdValue = reasoningId();
  const startedAt = Math.floor(Date.now() / 1000);
  let started = false;
  let outputStarted = false;
  let output = "";
  const outputState = { truncated: false };
  let usage = {};
  let finalEmitted = false;
  let thoughtText = "";
  const thoughtState = { truncated: false };
  let thoughtSignature;
  let thoughtStarted = false;
  let thoughtClosed = false;
  let thoughtIndex = 0;
  let nextIndex = 0;
  const toolStates = new Map();
  let textIndex = 0;
  let sequence = 0;

  const emit = (controller, name, data) => {
    const value = path === "/v1/responses" ? { ...data, sequence_number: sequence++ } : data;
    controller.enqueue(sseFrame(name, value));
  };
  const reasoningOutput = () =>
    thoughtText || thoughtSignature
      ? [
          {
            id: reasoningIdValue,
            type: "reasoning",
            status: "completed",
            ...(thoughtSignature ? { encrypted_content: thoughtSignature } : {}),
            summary: thoughtText ? [{ type: "summary_text", text: thoughtText }] : [],
            content: thoughtText ? [{ type: "reasoning_text", text: thoughtText }] : [],
          },
        ]
      : [];
  const toolOutputs = () =>
    [...toolStates.values()].map((tool) => ({
      type: "function_call",
      id: tool.itemId,
      call_id: tool.callId,
      name: tool.name,
      arguments: tool.arguments,
      status: "completed",
    }));
  const ensureStart = (controller) => {
    if (started) return;
    if (path === "/v1/messages") {
      emit(controller, "message_start", {
        type: "message_start",
        message: {
          id: messageIdValue,
          type: "message",
          role: "assistant",
          model: publicModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    } else {
      emit(controller, "response.created", {
        type: "response.created",
        response: {
          id: responseIdValue,
          object: "response",
          created_at: startedAt,
          model: publicModel,
          status: "in_progress",
          output: [],
        },
      });
    }
    started = true;
  };
  const ensureReasoning = (controller) => {
    ensureStart(controller);
    if (thoughtStarted) return;
    thoughtIndex = nextIndex++;
    if (path === "/v1/messages") {
      emit(controller, "content_block_start", {
        type: "content_block_start",
        index: thoughtIndex,
        content_block: { type: "thinking", thinking: "" },
      });
    } else {
      emit(controller, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: thoughtIndex,
        item: { id: reasoningIdValue, type: "reasoning", status: "in_progress", summary: [] },
      });
      emit(controller, "response.reasoning_summary_part.added", {
        type: "response.reasoning_summary_part.added",
        item_id: reasoningIdValue,
        output_index: thoughtIndex,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      });
    }
    thoughtStarted = true;
  };
  const closeReasoning = (controller) => {
    if (!thoughtStarted || thoughtClosed) return;
    if (path === "/v1/messages") {
      if (thoughtSignature) {
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: thoughtIndex,
          delta: { type: "signature_delta", signature: thoughtSignature },
        });
      }
      emit(controller, "content_block_stop", { type: "content_block_stop", index: thoughtIndex });
    } else {
      emit(controller, "response.reasoning_summary_text.done", {
        type: "response.reasoning_summary_text.done",
        item_id: reasoningIdValue,
        output_index: thoughtIndex,
        summary_index: 0,
        text: thoughtText,
      });
      emit(controller, "response.reasoning_summary_part.done", {
        type: "response.reasoning_summary_part.done",
        item_id: reasoningIdValue,
        output_index: thoughtIndex,
        summary_index: 0,
        part: { type: "summary_text", text: thoughtText },
      });
      emit(controller, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: thoughtIndex,
        item: reasoningOutput()[0],
      });
    }
    thoughtClosed = true;
  };
  const finish = (controller, stopReason) => {
    if (finalEmitted) return;
    ensureStart(controller);
    closeReasoning(controller);
    if (path === "/v1/messages") {
      if (outputStarted) {
        emit(controller, "content_block_stop", { type: "content_block_stop", index: textIndex });
      }
      for (const tool of toolStates.values()) {
        if (tool.opened) {
          emit(controller, "content_block_stop", { type: "content_block_stop", index: tool.outputIndex });
        }
      }
      emit(controller, "message_delta", {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { input_tokens: usage.prompt_tokens ?? 0, output_tokens: usage.completion_tokens ?? 0 },
      });
      emit(controller, "message_stop", { type: "message_stop" });
    } else {
      const status = stopReason === "max_tokens" ? "incomplete" : "completed";
      if (outputStarted) {
        emit(controller, "response.output_text.done", {
          type: "response.output_text.done",
          item_id: messageIdValue,
          output_index: textIndex,
          content_index: 0,
          text: output,
        });
        emit(controller, "response.content_part.done", {
          type: "response.content_part.done",
          item_id: messageIdValue,
          output_index: textIndex,
          content_index: 0,
          part: { type: "output_text", text: output, annotations: [] },
        });
        emit(controller, "response.output_item.done", {
          type: "response.output_item.done",
          output_index: textIndex,
          item: {
            id: messageIdValue,
            type: "message",
            role: "assistant",
            status,
            content: [{ type: "output_text", text: output, annotations: [] }],
          },
        });
      }
      for (const tool of toolStates.values()) {
        if (!tool.opened) continue;
        emit(controller, "response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          output_index: tool.outputIndex,
          item_id: tool.itemId,
          arguments: tool.arguments,
        });
        emit(controller, "response.output_item.done", {
          type: "response.output_item.done",
          output_index: tool.outputIndex,
          item: {
            id: tool.itemId,
            type: "function_call",
            call_id: tool.callId,
            name: tool.name,
            arguments: tool.arguments,
            status,
          },
        });
      }
      emit(controller, "response.completed", {
        type: "response.completed",
        response: {
          id: responseIdValue,
          object: "response",
          created_at: startedAt,
          model: publicModel,
          status,
          output: [
            ...reasoningOutput(),
            ...(output
              ? [
                  {
                    id: messageIdValue,
                    type: "message",
                    role: "assistant",
                    status,
                    content: [{ type: "output_text", text: output, annotations: [] }],
                  },
                ]
              : []),
            ...toolOutputs(),
          ],
          ...(status === "incomplete"
            ? { incomplete_details: { reason: "max_output_tokens" } }
            : { incomplete_details: null }),
          usage: {
            input_tokens: usage.prompt_tokens ?? 0,
            input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0 },
            output_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
          },
        },
      });
    }
    finalEmitted = true;
  };

  const transform = (frame, controller) => {
    const event = frame.json();
    if (!event) return;
    if (event.usage) usage = event.usage;
    const text = (event.choices ?? []).map((choice) => choice.delta?.content ?? "").join("");
    const thought = (event.choices ?? []).map((choice) => chatReasoning(choice.delta)).join("");
    const signature = (event.choices ?? [])
      .map((choice) => choice.delta?.reasoning_signature)
      .find((value) => typeof value === "string" && value);
    const calls = (event.choices ?? []).flatMap((choice) => choice.delta?.tool_calls ?? []);
    if (thought) thoughtText = appendRetained(thoughtText, thought, thoughtState);
    if (signature) thoughtSignature = signature;
    if (thought) {
      ensureReasoning(controller);
      if (path === "/v1/messages") {
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: thoughtIndex,
          delta: { type: "thinking_delta", thinking: thought },
        });
      } else {
        emit(controller, "response.reasoning_summary_text.delta", {
          type: "response.reasoning_summary_text.delta",
          item_id: reasoningIdValue,
          output_index: thoughtIndex,
          summary_index: 0,
          delta: thought,
        });
      }
    }
    const finishReason = (event.choices ?? []).find((choice) => choice.finish_reason)?.finish_reason;
    const finished = Boolean(finishReason);
    const emitTool = (call) => {
      const key = call.index ?? call.id ?? toolStates.size;
      let tool = toolStates.get(key);
      if (!tool) {
        if (toolStates.size >= MAX_TOOL_STATES) return;
        const outputIndex = nextIndex++;
        tool = {
          outputIndex,
          itemId: functionCallId(),
          callId: call.id || mintedId("call_"),
          name: call.function?.name || "",
          arguments: "",
          argumentState: { truncated: false },
          opened: false,
        };
        toolStates.set(key, tool);
      }
      if (call.id) tool.callId = call.id;
      if (call.function?.name) tool.name = call.function.name;
      ensureStart(controller);
      if (!tool.opened) {
        closeReasoning(controller);
        if (path === "/v1/messages") {
          emit(controller, "content_block_start", {
            type: "content_block_start",
            index: tool.outputIndex,
            content_block: { type: "tool_use", id: tool.callId, name: tool.name, input: {} },
          });
        } else {
          emit(controller, "response.output_item.added", {
            type: "response.output_item.added",
            output_index: tool.outputIndex,
            item: {
              type: "function_call",
              id: tool.itemId,
              call_id: tool.callId,
              name: tool.name,
              arguments: "",
              status: "in_progress",
            },
          });
        }
        tool.opened = true;
      }
      const delta = call.function?.arguments ?? "";
      if (!delta) return;
      tool.arguments = appendRetained(tool.arguments, delta, tool.argumentState);
      if (path === "/v1/messages") {
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: tool.outputIndex,
          delta: { type: "input_json_delta", partial_json: delta },
        });
      } else {
        emit(controller, "response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          output_index: tool.outputIndex,
          item_id: tool.itemId,
          delta,
        });
      }
    };
    for (const call of calls) emitTool(call);
    if (path === "/v1/messages") {
      ensureStart(controller);
      if (text && !outputStarted) {
        closeReasoning(controller);
        textIndex = nextIndex++;
        emit(controller, "content_block_start", {
          type: "content_block_start",
          index: textIndex,
          content_block: { type: "text", text: "" },
        });
        outputStarted = true;
      }
      if (text) {
        output = appendRetained(output, text, outputState);
        emit(controller, "content_block_delta", {
          type: "content_block_delta",
          index: textIndex,
          delta: { type: "text_delta", text },
        });
      }
      if (finished && !finalEmitted) {
        finish(controller, finishReason === "length" ? "max_tokens" : toolStates.size ? "tool_use" : "end_turn");
      }
    } else {
      ensureStart(controller);
      if (text && !outputStarted) {
        closeReasoning(controller);
        textIndex = nextIndex++;
        emit(controller, "response.output_item.added", {
          type: "response.output_item.added",
          output_index: textIndex,
          item: { id: messageIdValue, type: "message", role: "assistant", status: "in_progress", content: [] },
        });
        emit(controller, "response.content_part.added", {
          type: "response.content_part.added",
          output_index: textIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
        outputStarted = true;
      }
      if (text) {
        output = appendRetained(output, text, outputState);
        emit(controller, "response.output_text.delta", {
          type: "response.output_text.delta",
          output_index: textIndex,
          content_index: 0,
          delta: text,
        });
      }
      if (finished && !finalEmitted) finish(controller, finishReason === "length" ? "max_tokens" : "end_turn");
    }
  };

  const body = transformSseStream(response.body, {
    onFrame(frame, emitBytes) {
      const controller = {
        enqueue(text) {
          emitBytes(text);
        },
      };
      transform(frame, controller);
    },
    onFlush(emitBytes) {
      if (finalEmitted) return;
      const controller = { enqueue: (text) => emitBytes(text) };
      finish(controller, "end_turn");
    },
  });
  return rebuildResponse(response, body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

/* ------------------------------------------------------------------ */
/* Chat to Responses request and answer conversions.                   */
/* ------------------------------------------------------------------ */

function usageOf(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens;
  const result = {};
  if (Number.isSafeInteger(input) && input >= 0) result.prompt_tokens = input;
  if (Number.isSafeInteger(output) && output >= 0) result.completion_tokens = output;
  if (Number.isSafeInteger(cached) && cached >= 0) result.prompt_tokens_details = { cached_tokens: cached };
  if (Number.isSafeInteger(usage.total_tokens) && usage.total_tokens >= 0) {
    result.total_tokens = usage.total_tokens;
  }
  return Object.keys(result).length ? result : undefined;
}

/** A Responses JSON answer as a Chat completion. */
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
      if (typeof item.encrypted_content === "string" && item.encrypted_content) signature = item.encrypted_content;
    } else if (item?.type === "message") {
      for (const part of item.content ?? []) {
        if (part?.type === "output_text" && typeof part.text === "string") content.push(part.text);
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

function responsesContent(content, role) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new TypeError("adapter_unsupported: content");
  const parts = content.map((part) => {
    if (!part || typeof part !== "object") throw new TypeError("adapter_unsupported: content block");
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

/** A Chat request body as an OpenAI Responses body. */
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
    if (calls !== undefined && !Array.isArray(calls)) throw new TypeError("adapter_unsupported: tool calls");
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

/** One Chat completion chunk. */
function chatChunk(model, delta, end = null) {
  return {
    id: "shim_response",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: end }],
  };
}

/** Transform a genuine Responses SSE stream into Chat chunks. */
export function responsesSseAsChat(response, model) {
  if (!response.body) return response;
  let opened = false;
  let done = false;
  const calls = new Map();
  const body = transformSseStream(response.body, {
    onFrame(frame, emitBytes) {
      const event = frame.json();
      if (!event) return;
      if (!opened) {
        opened = true;
        emitBytes(serializeSseFrame({ data: chatChunk(model, { role: "assistant" }) }));
      }
      const type = event?.type ?? frame.event ?? "";
      if (type === "response.output_item.added" && event.item?.type === "function_call") {
        if (calls.size < MAX_TOOL_STATES) {
          calls.set(event.output_index, { id: event.item.call_id, name: event.item.name });
        }
      }
      if (type === "response.output_text.delta" && typeof event.delta === "string") {
        emitBytes(serializeSseFrame({ data: chatChunk(model, { content: event.delta }) }));
      }
      if (
        (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") &&
        typeof event.delta === "string"
      ) {
        emitBytes(serializeSseFrame({ data: chatChunk(model, { reasoning_content: event.delta }) }));
      }
      if (type === "response.function_call_arguments.delta") {
        const call = calls.get(event.output_index);
        if (call) {
          emitBytes(
            serializeSseFrame({
              data: chatChunk(model, {
                tool_calls: [
                  {
                    index: event.output_index,
                    id: call.id,
                    type: "function",
                    function: { name: call.name, arguments: event.delta ?? "" },
                  },
                ],
              }),
            }),
          );
        }
      }
      if (type === "response.completed" && !done) {
        emitBytes(serializeSseFrame({ data: chatChunk(model, {}, calls.size ? "tool_calls" : "stop") }));
        const usage = usageOf(event.response?.usage);
        if (usage) emitBytes(serializeSseFrame({ data: { id: "shim_response", model, choices: [], usage } }));
        emitBytes(serializeSseFrame({ data: "[DONE]" }));
        done = true;
      }
      if (type === "response.failed" || type === "error") {
        emitBytes(
          serializeSseFrame({
            data: { error: { type: "upstream_error", message: "Responses upstream reported a failure" } },
          }),
        );
        done = true;
      }
    },
    onFlush(emitBytes) {
      if (!opened) {
        opened = true;
        emitBytes(serializeSseFrame({ data: chatChunk(model, { role: "assistant" }) }));
      }
      if (!done) {
        emitBytes(
          serializeSseFrame({
            data: {
              error: { type: "stream_incomplete", message: "Responses stream ended unexpectedly" },
            },
          }),
        );
      }
    },
  });
  return rebuildResponse(response, body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" },
  });
}

/* ------------------------------------------------------------------ */
/* Response model identity.                                            */
/* ------------------------------------------------------------------ */

/** Rewrite only the model identity fields owned by the inbound dialect. */
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

/** Read JSON from a response with a byte cap. Return undefined above the cap. */
export async function boundedJson(response, limit = MAX_JSON_BYTES) {
  if (!response.body) {
    try {
      return await response.clone().json();
    } catch {
      return undefined;
    }
  }
  const reader = response.clone().body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"));
  } catch {
    return undefined;
  }
}

/** Rewrite the model identity of an SSE frame. */
function rewrittenSseFrame(format, frame, publicModel) {
  const value = frame.json();
  if (!value || !rewriteModelIdentity(format, value, publicModel)) {
    // frame.raw has no event terminator. Returning it would glue a comment-only
    // keepalive to the next data frame and hide that frame from the client.
    return serializeSseFrame({ lines: frame.lines });
  }
  return serializeSseFrame({ event: frame.event, id: frame.id, data: value });
}

/**
 * Keep a lazy request's public model identity stable even though the provider
 * attempt used a concrete model. The concrete model remains in the
 * x-lazy-router-model header and internal logs.
 */
export function rewriteResponseModel(format, response, publicModel) {
  if (!response?.body || typeof publicModel !== "string" || publicModel.length === 0) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const body = transformSseStream(response.body, {
      onFrame(frame, emitBytes) {
        emitBytes(rewrittenSseFrame(format, frame, publicModel));
      },
    });
    return rebuildResponse(response, body);
  }
  if (contentType.includes("application/json")) {
    return rebuildResponse(response, boundedJsonText(response, format, publicModel));
  }
  return response;
}

/** A text stream that reads bounded JSON, rewrites identity, and emits it. */
function boundedJsonText(response, format, publicModel) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const value = await boundedJson(response);
      // The cloned read did not consume the source. Cancel it so a slot or
      // stream wrapper around the source can settle.
      try {
        await response.body?.cancel();
      } catch {
        // The source is already closed.
      }
      if (value === undefined) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: {
                type: "adapter_unsupported",
                message: "provider answer exceeds the conversion limit",
              },
            }),
          ),
        );
        controller.close();
        return;
      }
      rewriteModelIdentity(format, value, publicModel);
      controller.enqueue(encoder.encode(JSON.stringify(value)));
      controller.close();
    },
  });
}

/** Convert one Chat answer into the requested dialect, JSON or SSE. */
export async function convertChatResponse(path, response, model) {
  if (path === "/v1/chat/completions" || !response.ok) return response;
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return convertChatSse(path, response, model);
  }
  const value = await boundedJson(response);
  try {
    await response.body?.cancel();
  } catch {
    // The source is already closed.
  }
  if (value === undefined) {
    const failure = Response.json(
      { error: { type: "adapter_unsupported", message: "provider answer exceeds the conversion limit" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
    return preserveResponseUrl(failure, response.url);
  }
  const converted = Response.json(convertChatJson(path, value, model), {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
  return preserveResponseUrl(converted, response.url);
}
