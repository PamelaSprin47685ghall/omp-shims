// Give every tool-call id a short stable id, and put the client's id back.
//
// Some providers reject two tool calls whose ids share a long prefix, and some
// clients mint ids longer than OpenAI's 64-character limit. The inbound request
// replaces every tool-call id with a short id derived from a SHA-256 digest of
// the whole original. The outbound response walks the same fields and restores
// the exact original.
//
// The mapping lives in the shared omp-shims-state.sqlite (see
// lib/tool-id-store.mjs), so every worker and every later process resolves the
// same original to the same short. The short is deterministic, which keeps the
// write path to one upsert per new id and needs no counter.
//
// Every occurrence of the same id inside a request maps to the same short, so a
// tool call and the tool result that answers it stay paired. An id is shortened
// once per distinct original, not once per occurrence.
//
// Only id fields are touched. Arguments, names, and any unknown value are never
// rewritten, and an outbound value that is not a known short passes through.

import { homedir } from "node:os";
import { join } from "node:path";

import { report } from "../lib/contracts.mjs";
import { addInboundMiddleware, middlewarePriority, readBody, withBody } from "../lib/inbound.mjs";
import { addFetchHandler, outboundPriority } from "../lib/outbound.mjs";
import { isEventStream, rebuildResponse, serializeSseFrame, transformSseStream } from "../lib/sse.mjs";
import { SHORT_PREFIX, toolIdStore } from "../lib/tool-id-store.mjs";

export const name = "tool-id-hash";
export const phase = "outbound";

/** Largest non-SSE response body this layer will buffer to restore ids. */
const MAX_RESTORE_BYTES = 4 * 1024 * 1024;

/** True after the first oversize response has been reported. */
let oversizeReported = false;

/**
 * Substrings that can carry a tool-call id in any inbound dialect.
 * A body without one is left byte-identical and is never parsed here.
 */
const ID_MARKERS = Object.freeze([
  "tool_call",
  "tool_use",
  "tool-call",
  "toolCall",
  "toolUse",
  "toolId",
  "call_id",
  "callId",
  "callID",
  "function_call",
]);

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

/** Block types that keep their call id in `id`. */
const ID_BLOCK_TYPES = new Set(["tool_use", "tool-call", "function_call"]);

/**
 * Walk a parsed envelope and transform every tool-call id.
 *
 * The field name decides what to transform. Providers convert a request into
 * their own native form, and those forms spell the field differently. A block
 * whose type is a tool call keeps its id in `id`; its arguments are opaque and
 * never walked.
 *
 * @param value parsed JSON, mutated in place
 * @param transform applied to each id found
 * @returns true when any value changed
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
  const block = ID_BLOCK_TYPES.has(value.type);

  // A tool-use block keeps its call id in `id`. It appears under `content`
  // (Messages), under `content_block` (Messages SSE), and under `item`
  // (Responses SSE). Transform it wherever it is found.
  if (block && typeof value.id === "string") {
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

  for (const key in value) {
    if (ID_FIELDS.has(key)) {
      const item = value[key];
      const next = transform(item);
      if (next !== item) {
        value[key] = next;
        changed = true;
      }
    } else if (key !== "tool_calls" && !(block && (key === "id" || key === "input" || key === "arguments"))) {
      const item = value[key];
      if (item !== null && typeof item === "object" && mapIds(item, transform)) changed = true;
    }
  }

  return changed;
}

/** Parse, transform, and re-serialize. Return undefined when nothing changed. */
function transformJson(text, transform) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return mapIds(parsed, transform) ? JSON.stringify(parsed) : undefined;
}

/** True when a request body can contain a tool-call id at all. */
function mayCarryToolIds(text) {
  return ID_MARKERS.some((marker) => text.includes(marker));
}

/** Render one SSE frame with a replaced JSON data value. */
function render(frame, value) {
  const lines = frame.lines.filter((line) => !line.startsWith("data:"));
  return serializeSseFrame({ lines: [...lines, `data: ${JSON.stringify(value)}`] });
}

/** Restore ids in an event stream one frame at a time. */
function restoreEventStream(response, store) {
  const restore = (id) => (typeof id === "string" ? (store.originalFor(id) ?? id) : id);
  const body = transformSseStream(response.body, {
    onFrame(frame, emit) {
      if (frame.commentOnly || frame.isDone || frame.data === "" || !frame.raw.includes(SHORT_PREFIX)) {
        emit(serializeSseFrame({ lines: frame.lines }));
        return;
      }
      const value = frame.json();
      if (value === undefined) {
        emit(serializeSseFrame({ lines: frame.lines }));
        return;
      }
      emit(mapIds(value, restore) ? render(frame, value) : serializeSseFrame({ lines: frame.lines }));
    },
  });
  return rebuildResponse(response, body);
}

/**
 * Read a response clone with a hard byte cap.
 * Return undefined when the body passes the cap, without buffering it.
 */
async function readBoundedText(response, limit) {
  const clone = response.clone();
  if (!clone.body) return "";
  const reader = clone.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        return undefined;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/** Restore ids in a JSON or text response body. */
async function restoreBody(response, store) {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type && !type.includes("json") && !type.startsWith("text/")) return response;

  let text;
  try {
    text = await readBoundedText(response, MAX_RESTORE_BYTES);
  } catch {
    return response;
  }
  if (text === undefined) {
    if (!oversizeReported) {
      oversizeReported = true;
      report("tool-id-hash response exceeds the restore cap", { maxBytes: MAX_RESTORE_BYTES });
    }
    return response;
  }
  if (!text.includes(SHORT_PREFIX)) return response;
  const restore = (id) => (typeof id === "string" ? (store.originalFor(id) ?? id) : id);
  const mapped = transformJson(text, restore);
  return mapped === undefined ? response : rebuildResponse(response, mapped);
}

/** Restore ids in a response. A failure returns the original response. */
async function restoreResponse(response, store) {
  if (!response?.body || !response.ok) return response;
  if (isEventStream(response)) return restoreEventStream(response, store);
  return restoreBody(response, store);
}

/** One installed feature per process. */
let active;

export async function install(config, context = {}) {
  if (config?.enabled === false) return;
  if (active) return active;

  const addInbound = context.addInboundMiddleware ?? addInboundMiddleware;
  const addFetch = context.addFetchHandler ?? addFetchHandler;
  const log = context.log ?? (() => {});
  const dbPath = context.paths?.stateDbPath ?? join(homedir(), ".omp", "omp-shims-state.sqlite");
  const store = () => toolIdStore(dbPath);

  const disposeInbound = addInbound(
    async (request, _server, next) => {
      if (request.method !== "POST") return next();
      const text = await readBody(request);
      if (typeof text !== "string" || !mayCarryToolIds(text)) return next();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return next();
      }
      if (body === null || typeof body !== "object") return next();
      try {
        const mapping = store();
        if (!mapIds(body, (id) => mapping.shortFor(id))) return next();
        return next(withBody(request, JSON.stringify(body), body));
      } catch (error) {
        // A failed store leaves the whole body untouched: a half-rewritten
        // turn would pair a short call with an original result.
        report("tool-id-hash inbound rewrite failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return next();
      }
    },
    { name, priority: middlewarePriority.toolIdHash },
  );

  let disposeOutbound;
  try {
    disposeOutbound = addFetch(
      async (input, init, next) => {
        const response = await next(input, init);
        try {
          return await restoreResponse(response, store());
        } catch (error) {
          report("tool-id-hash outbound restore failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          return response;
        }
      },
      // Outermost fetch layer: it must see the final response after every
      // inner layer has finished its retries and re-issues.
      { name, priority: outboundPriority.toolIdHash },
    );
  } catch (error) {
    disposeInbound();
    throw error;
  }

  active = () => {
    active = undefined;
    disposeInbound();
    disposeOutbound();
    log("tool-id-hash: inbound short ids and outbound restore stopped");
  };
  log("tool-id-hash: inbound short ids and outbound restore active");
  return active;
}
