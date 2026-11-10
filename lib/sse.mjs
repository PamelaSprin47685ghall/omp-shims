// One bounded server-sent-events codec.
//
// Every module that reads an event stream uses this file. It gives one frame
// parser, one incremental scanner, one transforming stream, and one response
// rebuilder. The scanner accepts any chunk split, including a CRLF pair split
// across two chunks, and it rejects an event that grows past its byte limit.
//
// A RawBlock is the text between two blank lines. It keeps its line endings
// exactly as received. parseSseFrame() interprets one block.

import { preserveResponseUrl } from "./contracts.mjs";

/** Largest single event, in bytes. */
export const DEFAULT_MAX_EVENT_BYTES = 1024 * 1024;

/** Largest text held by one transform before it must reach a frame boundary. */
export const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

/** @typedef {string} RawBlock */

/** True for a response that carries a server-sent event stream. */
export function isEventStream(response) {
  const type = response?.headers?.get?.("content-type") ?? "";
  return Boolean(response?.body) && type.toLowerCase().startsWith("text/event-stream");
}

/**
 * Response headers for a stream that must reach the client unbuffered and
 * unaltered. The stale body length and encoding go, because the stream body
 * that follows has neither.
 */
export function streamingHeaders(headers) {
  const next = new Headers(headers);
  next.delete("content-length");
  next.delete("content-encoding");
  next.set("x-accel-buffering", "no");
  const cache = next.get("cache-control");
  if (!cache) next.set("cache-control", "no-cache, no-transform");
  else if (!/\bno-transform\b/i.test(cache)) next.set("cache-control", `${cache}, no-transform`);
  return next;
}

/** Remove one optional leading space from an SSE field value. */
function fieldValue(line, colon) {
  if (colon === -1) return "";
  const value = line.slice(colon + 1);
  return value.startsWith(" ") ? value.slice(1) : value;
}

/**
 * Parse one RawBlock into its SSE fields.
 *
 * `data` joins every data line with a newline. `isDone` is true when that
 * text, trimmed, is "[DONE]"; this also covers `data:[DONE]` with no space.
 * `commentOnly` is true when the block carries no data, event, or id field.
 * `json()` parses `data` once; invalid JSON returns undefined.
 */
export function parseSseFrame(rawBlock) {
  const raw = typeof rawBlock === "string" ? rawBlock : String(rawBlock ?? "");
  const text = raw.includes("\r") ? raw.replace(/\r\n?/g, "\n") : raw;
  const lines = text === "" ? [] : text.split("\n");

  const dataLines = [];
  let event;
  let id;
  let hasField = false;

  for (const line of lines) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data" && field !== "event" && field !== "id") continue;

    hasField = true;
    const value = fieldValue(line, colon);
    if (field === "data") dataLines.push(value);
    else if (field === "event") event = value;
    else id = value;
  }

  const data = dataLines.join("\n");
  let parsed;
  let parsedReady = false;
  const json = () => {
    if (!parsedReady) {
      parsedReady = true;
      try {
        parsed = JSON.parse(data);
      } catch {
        parsed = undefined;
      }
    }
    return parsed;
  };

  return {
    raw,
    lines,
    event,
    id,
    commentOnly: !hasField,
    data,
    isDone: dataLines.length > 0 && data.trim() === "[DONE]",
    json,
  };
}

/**
 * Serialize one SSE frame. The result always ends with a blank line.
 * `lines` wins when present; otherwise the frame is built from event, id, and
 * data. A non-string data value is JSON-encoded. Embedded newlines in data
 * become one `data:` line each.
 */
export function serializeSseFrame({ event, id, data, lines } = {}) {
  const out = [];
  if (Array.isArray(lines)) {
    for (const line of lines) out.push(String(line).replace(/\r\n?/g, "\n"));
  } else {
    if (event !== undefined && event !== null && event !== "") out.push(`event: ${event}`);
    if (id !== undefined && id !== null && id !== "") out.push(`id: ${id}`);
    if (data !== undefined && data !== null) {
      const text = typeof data === "string" ? data : JSON.stringify(data);
      for (const line of text.split(/\r\n|\r|\n/)) out.push(`data: ${line}`);
    }
  }
  const body = out.join("\n").replace(/\n+$/, "");
  return `${body}\n\n`;
}

/** Measure a block in bytes. */
function byteLength(text) {
  return Buffer.byteLength(text);
}

/**
 * Create an incremental SSE scanner.
 *
 * The scanner holds a trailing CR until the next chunk, so a CRLF pair split
 * across two chunks still counts as one line ending. Lone CR and CRLF both
 * normalize to LF. It throws RangeError when a complete or pending block
 * exceeds maxEventBytes.
 */
export function createSseScanner({ maxEventBytes = DEFAULT_MAX_EVENT_BYTES } = {}) {
  const decoder = new TextDecoder();
  let pending = "";
  let heldCr = false;

  /** Append one text chunk, join a split CR, and normalize line endings. */
  function append(text) {
    let value = heldCr ? `\r${text}` : text;
    heldCr = false;
    if (value.endsWith("\r")) {
      value = value.slice(0, -1);
      heldCr = true;
    }
    if (value !== "") pending += value.replace(/\r\n?/g, "\n");
  }

  /** Throw when a buffer passes the byte limit. */
  function guard(bytes) {
    if (bytes > maxEventBytes) throw new RangeError(`SSE event exceeds ${maxEventBytes} bytes`);
  }

  /** Return the completed blocks and keep the unfinished tail. */
  function takeBlocks() {
    if (!pending.includes("\n\n")) {
      guard(pendingBytes());
      return [];
    }
    const parts = pending.split("\n\n");
    pending = parts.pop() ?? "";
    const ready = parts.filter((block) => block !== "");
    for (const block of ready) guard(byteLength(block));
    guard(pendingBytes());
    return ready;
  }

  /** Bytes held for the unfinished block, including a held CR. */
  function pendingBytes() {
    return byteLength(pending) + (heldCr ? 1 : 0);
  }

  return {
    /** Feed text or bytes. Return every block completed by this chunk. */
    push(chunk) {
      if (typeof chunk === "string") append(chunk);
      else if (chunk) append(decoder.decode(chunk, { stream: true }));
      return takeBlocks();
    },
    /** End the stream. Return every block the final bytes complete. */
    flush() {
      const rest = decoder.decode();
      if (rest !== "") append(rest);
      if (heldCr) {
        pending += "\n";
        heldCr = false;
      }
      const ready = takeBlocks();
      if (pending === "") return ready;
      const block = pending;
      pending = "";
      guard(byteLength(block));
      ready.push(block);
      return ready;
    },
    get pendingBytes() {
      return pendingBytes();
    },
  };
}

/** Convert an emit value to bytes. */
function toBytes(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

/** Build the emit function for one transform call. */
function emitter(controller) {
  return (value) => {
    const bytes = toBytes(value);
    if (bytes && bytes.byteLength > 0) controller.enqueue(bytes);
  };
}

/** Throw when the scanner holds more text than the transform may buffer. */
function guardBuffer(bytes, limit) {
  if (bytes > limit) throw new RangeError(`SSE buffer exceeds ${limit} bytes`);
}

/**
 * Pipe a source through the scanner and let onFrame rewrite each event.
 *
 * onFrame(frame, emit) runs for every block. It emits the bytes to forward;
 * a frame that emits nothing is dropped. With no onFrame, every block passes
 * through unchanged. onFlush(emit) runs once at the end. Backpressure and
 * cancellation follow pipeThrough.
 */
export function transformSseStream(source, { maxEventBytes, maxBufferBytes, onFrame, onFlush } = {}) {
  const eventLimit = maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  const bufferLimit = maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  const frameHandler = typeof onFrame === "function" ? onFrame : (frame, emit) => emit(`${frame.raw}\n\n`);
  const scanner = createSseScanner({ maxEventBytes: eventLimit });

  const transform = new TransformStream({
    transform(chunk, controller) {
      const emit = emitter(controller);
      for (const block of scanner.push(chunk)) frameHandler(parseSseFrame(block), emit);
      guardBuffer(scanner.pendingBytes, bufferLimit);
    },
    flush(controller) {
      const emit = emitter(controller);
      for (const block of scanner.flush()) frameHandler(parseSseFrame(block), emit);
      if (typeof onFlush === "function") onFlush(emit);
    },
  });

  return source.pipeThrough(transform);
}

/**
 * Rebuild a response with a new body. The stale body length and encoding go.
 * Status, status text, headers, and URL default to the source response.
 * A status that cannot carry a body gets none.
 */
export function rebuildResponse(response, body, { status, statusText, headers, url } = {}) {
  const nextStatus = status ?? response.status;
  const nextHeaders = new Headers(headers ?? response.headers);
  nextHeaders.delete("content-length");
  nextHeaders.delete("content-encoding");
  const payload = nextStatus === 204 || nextStatus === 205 || nextStatus === 304 ? null : body;
  const next = new Response(payload, {
    status: nextStatus,
    statusText: statusText ?? response.statusText,
    headers: nextHeaders,
  });
  return preserveResponseUrl(next, url ?? response.url);
}
