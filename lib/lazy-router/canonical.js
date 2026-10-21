// Canonical transcript: the substance of a conversation as one byte string.
//
// Prefix-cache affinity (affinity.js) needs the same conversation to produce
// the same bytes whichever inbound dialect carried it, and a longer turn of
// that conversation to produce a byte-wise extension of the shorter one. So
// each dialect reader below reduces a request body to an ordered list of
// blocks drawn from one small vocabulary:
//
//   role:  system | user | assistant | tool
//   kind:  text | thinking | image | tool_call | tool_result
//
// and `canonicalBytes` serialises them, one JSON array per line, as UTF-8.
// Everything that does not change what the model reads is left out: ids,
// timestamps, cache_control, signatures, sampling parameters, effort, limits,
// the model name. Tool-call arguments are re-serialised with sorted keys
// (Chat sends a JSON string, Anthropic an object), images are reduced to a
// digest of their source, and empty text is dropped. The bytes are hashed and
// never stored.

import { createHash } from "node:crypto";

/** Block roles and kinds of the canonical vocabulary. */
export const ROLE = Object.freeze({ SYSTEM: "system", USER: "user", ASSISTANT: "assistant", TOOL: "tool" });
export const KIND = Object.freeze({
  TEXT: "text",
  THINKING: "thinking",
  IMAGE: "image",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
});

/** Inbound roles folded onto the vocabulary ("developer" is OpenAI's newer "system"). */
const ROLE_ALIASES = { system: ROLE.SYSTEM, developer: ROLE.SYSTEM, user: ROLE.USER, assistant: ROLE.ASSISTANT };

const TEXT_PART_TYPES = new Set(["text", "input_text", "output_text", "summary_text", "reasoning_text"]);

/**
 * @typedef {{role: string, kind: string, value: string}} Block
 */

const block = (role, kind, value) => ({ role, kind, value });

/** `value` when it is an array, else none: malformed bodies read as empty, never throw. */
const list = (value) => (Array.isArray(value) ? value : []);

/** JSON with object keys sorted at every depth, so equal values serialise equally. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Tool arguments as canonical JSON, whether they arrive as a JSON string or an object. */
function canonicalArguments(args) {
  if (typeof args === "string") {
    try {
      return stableJson(JSON.parse(args));
    } catch {
      return args;
    }
  }
  return stableJson(args ?? {});
}

/** A short digest standing in for an image source (URL or inline data). */
function imageDigest(source) {
  return createHash("sha256")
    .update(String(source ?? ""))
    .digest("base64url");
}

/** An Anthropic image source as the data URL the OpenAI dialects would carry. */
function anthropicImageSource(source) {
  if (source?.type === "base64") return `data:${source.media_type};base64,${source.data}`;
  return source?.url ?? stableJson(source ?? {});
}

/** Plain text of a content value: a string, or the text parts of a part list. */
function plainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : stableJson(content);
  return content
    .map((part) => (typeof part === "string" ? part : TEXT_PART_TYPES.has(part?.type) ? (part.text ?? "") : ""))
    .join("");
}

/** Blocks of an OpenAI-style content value (string or part list) under one role. */
function openAiContent(role, content) {
  if (typeof content === "string") return [block(role, KIND.TEXT, content)];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === "string") return [block(role, KIND.TEXT, part)];
    if (TEXT_PART_TYPES.has(part?.type)) return [block(role, KIND.TEXT, part.text ?? "")];
    if (part?.type === "image_url")
      return [block(role, KIND.IMAGE, imageDigest(part.image_url?.url ?? part.image_url))];
    if (part?.type === "input_image") return [block(role, KIND.IMAGE, imageDigest(part.image_url ?? part.file_id))];
    return [];
  });
}

const toolCall = (name, args) => block(ROLE.ASSISTANT, KIND.TOOL_CALL, `${name ?? ""}(${canonicalArguments(args)})`);
const toolResult = (content) => block(ROLE.TOOL, KIND.TOOL_RESULT, plainText(content));

/** OpenAI Chat Completions: `messages`. */
export function chatTranscript(body) {
  return list(body?.messages).flatMap((message) => {
    if (message?.role === "tool") return [toolResult(message.content)];
    const role = ROLE_ALIASES[message?.role];
    if (!role) return [];
    const thinking = message.reasoning_content ?? message.reasoning;
    return [
      ...(typeof thinking === "string" ? [block(role, KIND.THINKING, thinking)] : []),
      ...openAiContent(role, message.content),
      ...list(message.tool_calls).map((call) => toolCall(call.function?.name, call.function?.arguments)),
    ];
  });
}

/** OpenAI Responses: `instructions` plus `input` (a string or a list of items). */
export function responsesTranscript(body) {
  const system = typeof body?.instructions === "string" ? [block(ROLE.SYSTEM, KIND.TEXT, body.instructions)] : [];
  const input = typeof body?.input === "string" ? [{ role: "user", content: body.input }] : list(body?.input);
  return [
    ...system,
    ...input.flatMap((item) => {
      switch (item?.type) {
        case "function_call":
        case "custom_tool_call":
          return [toolCall(item.name, item.arguments ?? item.input)];
        case "function_call_output":
        case "custom_tool_call_output":
          return [toolResult(item.output)];
        case "reasoning":
          return [block(ROLE.ASSISTANT, KIND.THINKING, plainText([...list(item.summary), ...list(item.content)]))];
        case undefined:
        case "message": {
          const role = ROLE_ALIASES[item?.role];
          return role ? openAiContent(role, item.content) : [];
        }
        default:
          return [];
      }
    }),
  ];
}

/** Anthropic Messages: `system` plus `messages` of content blocks. */
export function messagesTranscript(body) {
  const system = typeof body?.system === "string" ? body.system : plainText(list(body?.system));
  return [
    ...(system ? [block(ROLE.SYSTEM, KIND.TEXT, system)] : []),
    ...list(body?.messages).flatMap((message) => {
      const role = ROLE_ALIASES[message?.role];
      if (!role) return [];
      if (typeof message.content === "string") return [block(role, KIND.TEXT, message.content)];
      return list(message.content).flatMap((part) => {
        switch (part?.type) {
          case "text":
            return [block(role, KIND.TEXT, part.text ?? "")];
          case "thinking":
            return [block(role, KIND.THINKING, part.thinking ?? "")];
          case "image":
            return [block(role, KIND.IMAGE, imageDigest(anthropicImageSource(part.source)))];
          case "tool_use":
            return [toolCall(part.name, part.input)];
          case "tool_result":
            return [toolResult(part.content)];
          default:
            return [];
        }
      });
    }),
  ];
}

/**
 * The canonical bytes of a block list: one `[role,kind,value]` JSON line per
 * non-empty block. Appending turns to a conversation appends lines, so a
 * conversation's earlier request is a byte prefix of its later one.
 * @param {Block[]} blocks
 * @returns {Buffer}
 */
export function canonicalBytes(blocks) {
  const lines = blocks.filter((b) => b.value !== "").map((b) => `${JSON.stringify([b.role, b.kind, b.value])}\n`);
  return Buffer.from(lines.join(""), "utf8");
}
