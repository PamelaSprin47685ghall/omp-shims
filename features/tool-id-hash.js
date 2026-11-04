// Give every tool-call id a hash8 prefix, and put the client's id back.
//
// Upstream rejects two calls whose ids share their first nine characters when
// those nine are alphanumeric. Clients mint ids like `call_0000000000000001`
// and `call_0000000000000002`, which collide, so the second call fails.
//
// Prefixing with a hash8 derived from the id fixes it twice over:
//
//   * eight base64 characters carry 48 bits, so two distinct ids essentially
//     never share a prefix; and
//   * the separator that follows is not alphanumeric, so even a stricter
//     nine-character comparison never sees nine alphanumeric characters.
//
// Measured on the offending model: a shared alphanumeric prefix of 8 passes, 9
// or more fails, and content past the ninth character is never consulted.
//
// The transform is applied to the inbound request, so the gateway stores,
// replays and forwards the hashed ids, and undone on the outbound response, so
// the client still sees the ids it sent. Both directions walk the parsed JSON
// and touch only the id fields, so an id that happens to look like one of ours
// is restored only on an exact match.
//
// It is not idempotent, and that is deliberate: an id that merely looks hashed
// may still be one a client minted, and structured ids such as
// `chatcmpl-tool-x000` collide precisely because they look regular. Every
// occurrence of the same id within a request is transformed identically, so an
// assistant tool call and the tool result answering it stay paired.
//
// Env:
//   OMP_SHIMS_TOOL_ID_SALT  mixed into the digest; change it to re-key ids

import { createHash } from "node:crypto";
import { addFetchHandler as sharedAddFetchHandler } from "../lib/fetch-chain.js";
import { originalFor, remember } from "../lib/id-map.js";
import { readBody, readJson, withBody, wrapServe } from "../lib/inbound.js";
import { count, enabled, note, span } from "../lib/profile.js";

const SALT = process.env.OMP_SHIMS_TOOL_ID_SALT ?? "";
const HASH_LENGTH = 8;

/** hash8(id): the same prefix for the same id on every call. */
function hash8(id) {
  return createHash("sha256")
    .update(SALT, "utf8")
    .update("\0", "utf8")
    .update(id, "utf8")
    .digest("base64url")
    .slice(0, HASH_LENGTH);
}

/** Prefix an id, recording the original so the response can restore it. */
function hashifyId(id) {
  if (typeof id !== "string" || id === "") return id;
  const hashed = `${hash8(id)}_h${id.slice(HASH_LENGTH)}`;
  remember(id, hashed);
  return hashed;
}

/** Put the client's id back, if this is one we minted. */
function restoreId(id) {
  return typeof id === "string" ? (originalFor(id) ?? id) : id;
}

/**
 * Fields that carry a tool-call id in the envelope shapes in play: OpenAI
 * (`tool_call_id`), Anthropic (`tool_use_id`), and the native generate envelope
 * (`toolCallId`, `content[].id`).
 */
const ID_FIELDS = new Set([
  "tool_call_id",
  "tool_use_id",
  "toolUseId",
  "toolCallId",
  "toolCallID",
  "toolId",
  "call_id",
  "callId",
]);

/**
 * Walk a parsed envelope and transform every tool-call id.
 *
 * Dispatching on the field name rather than a fixed layout keeps this working
 * across envelope shapes: providers convert requests into their own native form,
 * and those spell the field differently.
 *
 * @param value parsed JSON, mutated in place
 * @param transform applied to each id found
 */
function mapIds(value, transform) {
  if (Array.isArray(value)) {
    let changed = false;
    for (const item of value) {
      if (mapIds(item, transform)) changed = true;
    }
    return changed;
  }
  if (value === null || typeof value !== "object") return false;
  let changed = false;

  // A tool-use block keeps its call id in `id` and appears in three places:
  // inside a `content` array (Messages), under `content_block` (Messages SSE),
  // and under `item` (Responses SSE). Transform it wherever it is found.
  if ((value.type === "tool_use" || value.type === "tool-call") && typeof value.id === "string") {
    const next = transform(value.id);
    if (next !== value.id) {
      value.id = next;
      changed = true;
    }
  }

  if (Array.isArray(value.tool_calls)) {
    for (const call of value.tool_calls) {
      if (!call || typeof call !== "object") continue;
      const next = transform(call.id);
      if (next !== call.id) {
        call.id = next;
        changed = true;
      }
    }
  }

  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      // A tool block's own id is handled by the type rule above; a
      // `tool_result` may carry the id of the call it answers, so it is walked
      // like any other object.
      if (block && typeof block === "object" && mapIds(block, transform)) changed = true;
    }
  }

  for (const key in value) {
    if (ID_FIELDS.has(key)) {
      const item = value[key];
      const next = transform(item);
      if (next !== item) {
        value[key] = next;
        changed = true;
      }
    } else if (
      key !== "tool_calls" &&
      key !== "content" &&
      !((value.type === "tool_use" || value.type === "tool-call") && (key === "input" || key === "arguments"))
    ) {
      const item = value[key];
      if (item !== null && typeof item === "object" && mapIds(item, transform)) changed = true;
    }
  }

  return changed;
}

export const rewriteToolIds = (value) => {
  mapIds(value, hashifyId);
  return value;
};
export const restoreToolIds = (value) => {
  mapIds(value, restoreId);
  return value;
};

/** Parse, transform, re-serialise. Returns undefined when nothing changed. */
function transformJson(text, transform) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return mapIds(parsed, transform) ? JSON.stringify(parsed) : undefined;
}

/**
 * Restore ids in an SSE or plain-text response.
 *
 * Tool calls arrive as JSON inside `data:` lines, so each line is parsed and
 * mapped on its own rather than pattern-matching the text. Lines that are not
 * JSON are forwarded byte for byte.
 */
function restoreStream(text) {
  const lines = text.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Every id this feature mints carries "_h"; a line without it has nothing
    // to restore and never needs parsing.
    if (!line.startsWith("data:") || !line.includes(MINTED_ID_MARK)) continue;
    const payload = line.slice(5).trim();
    if (payload === "" || payload === "[DONE]") continue;
    const mapped = transformJson(payload, restoreId);
    if (mapped !== undefined) {
      lines[i] = `data: ${mapped}`;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : undefined;
}

/** Substring every minted id contains: hash8 + "_h" + the original tail. */
const MINTED_ID_MARK = "_h";

/** Bytes of MINTED_ID_MARK, for the byte-level fast path. */
const MARK_BYTES = Object.freeze([0x5f, 0x68]);

/** True when `bytes` contains the minted-id marker. */
function hasMintedId(bytes) {
  const last = bytes.length - 1;
  for (let i = 0; i < last; i += 1) {
    if (bytes[i] === MARK_BYTES[0] && bytes[i + 1] === MARK_BYTES[1]) return true;
  }
  return false;
}

/** Substrings that can carry a tool-call id in any inbound dialect. */
const ID_MARKERS = Object.freeze(["tool_call", "tool_use", "tool-call", "toolCall", "toolId"]);

/** True when the body can contain a tool-call id at all. */
const mayCarryToolIds = (text) => ID_MARKERS.some((marker) => text.includes(marker));

export function install(_config, context) {
  const log = context.log ?? (() => {});
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;

  // Inbound: hash the ids the client sent, on the body the rest of the stack
  // already parsed. A body with no tool-call id is left byte-for-byte alone.
  wrapServe((handler) => async (request, server) => {
    if (request.method !== "POST") return handler(request, server);
    return handleWithHashedIds(handler, request, server);
  });

  // Outbound: put them back as the response streams past, innermost so it sees
  // the ids exactly as the provider produced them.
  addFetchHandler((input, init, next) => {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    if (!url) return next(input, init);
    return next(input, init).then((response) => {
      if (!response?.body || !response.ok) return response;
      if (response.headers?.get?.("content-type")?.includes("text/event-stream")) {
        return restoreEventStream(response);
      }
      return restoreJsonResponse(response);
    });
  });

  log("tool-id-hash: inbound hash + outbound restore active");
}

/** One pass over the shared parsed body: hash ids, re-serialise only if changed. */
async function handleWithHashedIds(handler, request, server) {
  const text = await readBody(request);
  if (text === undefined) return handler(request, server);
  count("request-bytes", text.length);
  if (!mayCarryToolIds(text)) return handler(request, server);
  const body = await readJson(request);
  const rewritten = span("inbound-tool-id", () => {
    if (!body || typeof body !== "object") return undefined;
    return mapIds(body, hashifyId) ? JSON.stringify(body) : undefined;
  });
  if (rewritten === undefined) return handler(request, server);
  return handler(withBody(request, rewritten, body), server);
}

/** Restore ids in a JSON response body. */
async function restoreJsonResponse(response) {
  const text = await response.clone().text();
  const mapped = transformJson(text, restoreId);
  if (mapped === undefined) return response;

  const rebuilt = new Response(mapped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return copyUrl(response, rebuilt);
}

/** Restore ids in an SSE stream, keeping it streaming. */
function restoreEventStream(response) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  /** Bytes after the last newline; every line starts on a character boundary. */
  let carry = EMPTY_BYTES;

  const stream = new TransformStream({
    transform(chunk, controller) {
      const stepAt = enabled ? performance.now() : 0;
      count("out-chunks");
      count("response-bytes", chunk.length ?? 0);
      const bytes = carry.length === 0 ? chunk : concatBytes(carry, chunk);
      const lastBreak = bytes.lastIndexOf(0x0a);
      if (lastBreak === -1) {
        carry = bytes.slice();
        return;
      }
      const head = bytes.subarray(0, lastBreak + 1);
      carry = bytes.slice(lastBreak + 1);
      // Fast path: no minted id in these complete lines, so forward the bytes
      // without decoding, parsing or re-encoding.
      if (!hasMintedId(head)) {
        controller.enqueue(head.slice());
      } else {
        const mapped = restoreStream(decoder.decode(head));
        controller.enqueue(mapped === undefined ? head.slice() : encoder.encode(mapped));
      }
      if (enabled) note("outbound-tool-id", performance.now() - stepAt);
    },
    flush(controller) {
      if (carry.length === 0) return;
      const tail = carry;
      carry = EMPTY_BYTES;
      if (!hasMintedId(tail)) {
        controller.enqueue(tail);
        return;
      }
      const mapped = restoreStream(decoder.decode(tail));
      controller.enqueue(mapped === undefined ? tail : encoder.encode(mapped));
    },
  });

  const wrapped = new Response(response.body.pipeThrough(stream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return copyUrl(response, wrapped);
}

const EMPTY_BYTES = new Uint8Array(0);

function concatBytes(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

/** Bun drops `.url` when a Response is rebuilt; OMP reads it on replay paths. */
function copyUrl(source, target) {
  try {
    if (typeof source.url === "string" && source.url !== "") {
      Object.defineProperty(target, "url", { value: source.url, configurable: true, enumerable: true });
    }
  } catch {}
  return target;
}
