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
import { addFetchHandler } from "../lib/fetch-chain.js";
import { patchServe } from "../lib/inbound.js";
import { remember, originalFor } from "../lib/id-map.js";

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
const ID_FIELDS = new Set(["tool_call_id", "tool_use_id", "toolCallId", "toolCallID", "toolId"]);

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
    for (const item of value) mapIds(item, transform);
    return value;
  }
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value.tool_calls)) {
    for (const call of value.tool_calls) {
      if (call && typeof call === "object") call.id = transform(call.id);
    }
  }

  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_use" || block.type === "tool-call") block.id = transform(block.id);
    }
  }

  for (const [key, item] of Object.entries(value)) {
    if (ID_FIELDS.has(key)) {
      value[key] = transform(item);
    } else if (key !== "tool_calls" && key !== "content" && item !== null && typeof item === "object") {
      mapIds(item, transform);
    }
  }

  return value;
}

export const rewriteToolIds = (value) => mapIds(value, hashifyId);
export const restoreToolIds = (value) => mapIds(value, restoreId);

/** Parse, transform, re-serialise. Returns undefined when nothing changed. */
function transformJson(text, transform) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const before = JSON.stringify(parsed);
  mapIds(parsed, transform);
  const after = JSON.stringify(parsed);
  return after === before ? undefined : after;
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
    const marker = line.startsWith("data:") ? "data:" : undefined;
    if (!marker) continue;
    const payload = line.slice(marker.length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    const mapped = transformJson(payload, restoreId);
    if (mapped !== undefined) {
      lines[i] = `${marker} ${mapped}`;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : undefined;
}

export function install(config, context) {
  const log = context.log ?? (() => {});

  // Inbound: hash the ids the client sent.
  patchServe((body) => transformJson(body, hashifyId));

  // Outbound: put them back as the response streams past, innermost so it sees
  // the ids exactly as the provider produced them.
  addFetchHandler((input, init, next) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
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
  let pending = "";

  const stream = new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      // Emit only whole lines, so a split event is not parsed half-read.
      const lastBreak = pending.lastIndexOf("\n");
      if (lastBreak === -1) return;
      const head = pending.slice(0, lastBreak + 1);
      pending = pending.slice(lastBreak + 1);
      const mapped = restoreStream(head);
      controller.enqueue(encoder.encode(mapped ?? head));
    },
    flush(controller) {
      if (pending === "") return;
      const mapped = restoreStream(pending);
      controller.enqueue(encoder.encode(mapped ?? pending));
    },
  });

  const wrapped = new Response(response.body.pipeThrough(stream), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  return copyUrl(response, wrapped);
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
