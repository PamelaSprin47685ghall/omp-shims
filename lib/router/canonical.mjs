// Canonical transcript: the substance of a conversation as one byte string.
//
// Prefix-cache affinity needs the same conversation to produce the same bytes
// whichever inbound dialect carried it. A later turn of that conversation must
// produce a byte-wise extension of the earlier turn. Each reader below reduces
// a request body to an ordered list of blocks from one small vocabulary:
//
//   role: system | user | assistant | tool
//   kind: text | thinking | image | tool_call | tool_result
//
// Everything that does not change what the model reads is left out: ids,
// timestamps, cache_control, signatures, sampling parameters, effort, limits,
// and the model name. Tool arguments are re-serialised with sorted keys. An
// image is reduced to a digest of its source. Empty text is dropped.

import { createHash } from "node:crypto";

/** The block roles. */
export const ROLE = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
  TOOL: "tool",
});

/** The block kinds. */
export const KIND = Object.freeze({
  TEXT: "text",
  THINKING: "thinking",
  IMAGE: "image",
  TOOL_CALL: "tool_call",
  TOOL_RESULT: "tool_result",
});

/** Inbound roles folded onto the vocabulary. "developer" is a system alias. */
const ROLE_ALIASES = Object.freeze({
  system: ROLE.SYSTEM,
  developer: ROLE.SYSTEM,
  user: ROLE.USER,
  assistant: ROLE.ASSISTANT,
});

const TEXT_PART_TYPES = new Set(["text", "input_text", "output_text", "summary_text", "reasoning_text"]);

/** Return `value` when it is an array, else an empty list. */
const list = (value) => (Array.isArray(value) ? value : []);

/** Build one block. */
function block(role, kind, value) {
  return { role, kind, value };
}

/**
 * JSON with object keys sorted at every depth.
 * Equal values serialise equally whatever their key order.
 */
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

/** Tool arguments as canonical JSON, from a JSON string or an object. */
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

/** A short digest that stands in for an image source. */
function imageDigest(source) {
  return createHash("sha256")
    .update(String(source ?? ""))
    .digest("base64url");
}

/** An Anthropic image source as the data URL the OpenAI dialects carry. */
function anthropicImageSource(source) {
  if (source?.type === "base64") return `data:${source.media_type};base64,${source.data}`;
  return source?.url ?? stableJson(source ?? {});
}

/** Plain text of a content value. */
function plainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : stableJson(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return TEXT_PART_TYPES.has(part?.type) ? (part.text ?? "") : "";
    })
    .join("");
}

/** Blocks of an OpenAI-style content value under one role. */
function openAiContent(role, content) {
  if (typeof content === "string") return [block(role, KIND.TEXT, content)];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (typeof part === "string") return [block(role, KIND.TEXT, part)];
    if (TEXT_PART_TYPES.has(part?.type)) return [block(role, KIND.TEXT, part.text ?? "")];
    if (part?.type === "image_url") {
      return [block(role, KIND.IMAGE, imageDigest(part.image_url?.url ?? part.image_url))];
    }
    if (part?.type === "input_image") {
      return [block(role, KIND.IMAGE, imageDigest(part.image_url ?? part.file_id))];
    }
    return [];
  });
}

/** One assistant tool call as a canonical block. */
function toolCall(name, args) {
  return block(ROLE.ASSISTANT, KIND.TOOL_CALL, `${name ?? ""}(${canonicalArguments(args)})`);
}

/** One tool result as a canonical block. */
function toolResult(content) {
  return block(ROLE.TOOL, KIND.TOOL_RESULT, plainText(content));
}

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

/** OpenAI Responses: `instructions` plus `input` (a string or a list). */
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
 * non-empty block. A later turn extends the earlier bytes.
 * @param {{role: string, kind: string, value: string}[]} blocks
 * @returns {Buffer}
 */
export function canonicalBytes(blocks) {
  const lines = blocks
    .filter((entry) => entry.value !== "")
    .map((entry) => `${JSON.stringify([entry.role, entry.kind, entry.value])}\n`);
  return Buffer.from(lines.join(""), "utf8");
}

/** Defaults for the recorded prefix set. */
export const PREFIX_MIN_BYTES = 1_024;
export const PREFIX_GRID_BYTES = 16_384;

/**
 * Digests of `bytes` at every recorded prefix length, ascending.
 *
 * The lengths sit on a fixed grid, so the set stays bounded even when request
 * sizes vary. The first grid step is the minimum prefix size. The last entry
 * never exceeds the input. One incremental hash covers the whole list.
 *
 * @param {Uint8Array} bytes
 * @param {{minPrefixBytes?: number, gridBytes?: number}} [options]
 * @returns {{length: number, digest: string}[]}
 */
export function prefixDigests(bytes, { minPrefixBytes = PREFIX_MIN_BYTES, gridBytes = PREFIX_GRID_BYTES } = {}) {
  const size = bytes?.length ?? 0;
  const step = Math.max(1, gridBytes);
  const first = Math.max(1, minPrefixBytes);
  if (size < first) return [];

  const hash = createHash("sha256");
  const digests = [];
  let offset = 0;
  for (let length = first; length <= size; length += step) {
    hash.update(bytes.subarray(offset, length));
    offset = length;
    digests.push({ length, digest: hash.copy().digest("base64url") });
  }
  // A transcript shorter than one grid step after the first entry still ends
  // with its full length, so a later turn can match the whole earlier body.
  if (offset !== size && size >= first) {
    hash.update(bytes.subarray(offset, size));
    digests.push({ length: size, digest: hash.copy().digest("base64url") });
  }
  return digests;
}
