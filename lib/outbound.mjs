// Outbound fetch pipeline.
//
// This module owns the only globalThis.fetch wrapper in the process. A layer
// registers one handler with a priority. A smaller priority sits further out:
// it sees the request first and the response last.
//
// A handler has this shape:
//
//   (input, init, next) => Response | Promise<Response>
//
//   return next(input, init)                       pass the call inward
//   return next(rewrittenInput, rewrittenInit)     rewrite the call
//   return next(input, init).then(tap)             watch the response
//   return response                                answer without the network
//
// A broken handler must never kill the call: its error is reported and the
// call continues inward. A genuine network failure is different: it
// propagates to the caller without a second network call.
//
// A layer removes itself with the disposer returned by addFetchHandler.
// dispose() removes every layer and restores the original fetch.

// The namespace import keeps zstd optional: an older Bun without it must not
// fail at preload time.
import * as zlib from "node:zlib";
import { report } from "./contracts.mjs";

export { isCloudCodeStreamUrl as isCloudCodeStream, preserveResponseUrl } from "./contracts.mjs";

/**
 * Fetch-layer priorities. A smaller value sits further out.
 *
 * The order keeps the v1 onion: tool-id-hash sees the final response after
 * every inner rewrite. Account routing sits outside continuation, so a
 * re-issue re-enters continuation. Copilot Auto sits outside the lazy router.
 * The lazy router sits outside Cline and the Antigravity routing rewrite. IPv6
 * pinning is innermost except the always-on Antigravity sanitizer.
 */
export const outboundPriority = Object.freeze({
  toolIdHash: 10,
  antigravityCapture: 20,
  antigravityAccountRouting: 30,
  antigravityContinuation: 40,
  antigravitySystemInstruction: 50,
  copilotAuto: 55,
  lazyRouter: 60,
  clinePinUpstream: 65,
  antigravityRouting: 70,
  ipv6First: 80,
  antigravitySanitizer: 90,
});

const state = {
  installed: false,
  original: null,
  patched: null,
  /** @type {{ handler: Function, name: string, priority: number, sequence: number }[]} */
  handlers: [],
  sequence: 0,
};

/** Return a useful message from any thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Decompress zstd only when this runtime provides it. Older runtimes keep the bytes. */
function zstdDecompress(buffer) {
  return typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync(buffer) : buffer;
}

/** Decode one buffer. The caller checked the encoding name. */
function decompress(buffer, encoding) {
  if (encoding === "gzip") return zlib.gunzipSync(buffer);
  if (encoding === "deflate") return zlib.inflateSync(buffer);
  if (encoding === "zstd") return zstdDecompress(buffer);
  return buffer;
}

/** Detect zstd, gzip, or zlib-wrapped deflate from the first bytes. */
function sniffEncoding(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd) {
    return "zstd";
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return "gzip";
  if (buffer.length >= 2 && buffer[0] === 0x78) {
    if (buffer[1] === 0x9c || buffer[1] === 0x01 || buffer[1] === 0xda) return "deflate";
  }
  return undefined;
}

/** Read the last content-encoding name from a header bag. */
function headerEncoding(headers) {
  if (!headers) return undefined;
  let value;
  try {
    value =
      typeof headers.get === "function"
        ? headers.get("content-encoding")
        : new Headers(headers).get("content-encoding");
  } catch {
    return undefined;
  }
  if (!value) return undefined;
  const encodings = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const last = encodings.at(-1);
  if (last === "gzip" || last === "x-gzip") return "gzip";
  if (last === "deflate") return "deflate";
  if (last === "zstd") return "zstd";
  return undefined;
}

/** Decode bytes to text, with decompression when the bytes or header say so. */
function decodeBytes(buffer, encodingHeader) {
  const encoding = sniffEncoding(buffer) ?? headerEncoding(encodingHeader);
  if (!encoding) return buffer.toString("utf8");
  try {
    return decompress(buffer, encoding).toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

/** Convert an ArrayBuffer or any view over one into a Buffer. */
function toBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return undefined;
}

/** Extract the request URL for the (input, init) or (Request) calling shape. */
export function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && typeof input.url === "string") return input.url;
  return "";
}

/** Extract the request body when it is already an in-memory string. */
export function requestBody(input, init) {
  if (init && typeof init.body === "string") return init.body;
  if (input && typeof input === "object" && typeof input.body === "string") return input.body;
  return undefined;
}

/**
 * Read an outbound body as text. Handles a string, a byte view, an
 * ArrayBuffer, a Blob or stream body, and a Request clone. Compressed bytes
 * are decompressed with node:zlib. Returns undefined when no body is readable.
 */
export async function readOutboundBodyText(input, init) {
  const body = init?.body;
  if (typeof body === "string") return body;

  const bytes = toBuffer(body);
  if (bytes) return decodeBytes(bytes, headerEncoding(init?.headers));

  if (body !== undefined && body !== null) {
    try {
      const buffer = Buffer.from(await new Response(body).arrayBuffer());
      return decodeBytes(buffer, headerEncoding(init?.headers));
    } catch {
      return undefined;
    }
  }

  if (typeof input === "string" || input instanceof URL) return undefined;
  if (!input || typeof input !== "object") return undefined;
  if (typeof input.clone === "function") {
    try {
      const buffer = Buffer.from(await input.clone().arrayBuffer());
      return decodeBytes(buffer, input.headers);
    } catch {
      return undefined;
    }
  }
  if (typeof input.body === "string") return input.body;
  return undefined;
}

/** Copy headers without the stale body length and encoding. */
function stripBodyHeaders(headers) {
  const next = new Headers(headers ?? {});
  next.delete("content-length");
  next.delete("content-encoding");
  return next;
}

/**
 * Join an init with a new body, without ever spreading one over a Request.
 * Spreading an init over a Request makes fetch ignore the body and silently
 * downgrade the call to GET, so the (Request) shape keeps its own method,
 * signal, redirect, and duplex.
 */
export function withRequestBody(input, init, body) {
  if (typeof input === "string" || input instanceof URL) {
    return { target: input, init: { ...init, headers: stripBodyHeaders(init?.headers), body } };
  }
  return {
    target: requestUrl(input),
    init: {
      ...init,
      method: init?.method ?? input.method,
      headers: stripBodyHeaders(init?.headers ?? input.headers),
      signal: init?.signal ?? input.signal,
      redirect: init?.redirect ?? input.redirect,
      duplex: init?.duplex ?? input.duplex,
      body,
    },
  };
}

/**
 * Rewrite an in-memory request body and re-issue the call through `next`.
 * The rewrite may be sync or async. Returns undefined when there is nothing
 * to rewrite, so the caller can pass the request through untouched.
 */
export function rewriteRequestBody(next, input, init, rewrite) {
  const body = requestBody(input, init);
  if (body === undefined) return undefined;

  let rewritten;
  try {
    rewritten = rewrite(body);
  } catch (error) {
    report("request body rewrite failed", { error: messageOf(error) });
    return undefined;
  }

  if (rewritten && typeof rewritten.then === "function") {
    return Promise.resolve(rewritten).then((value) => {
      if (value === undefined || value === body) return undefined;
      const { target, init: nextInit } = withRequestBody(input, init, value);
      return next(target, nextInit);
    });
  }
  if (rewritten === undefined || rewritten === body) return undefined;

  const { target, init: nextInit } = withRequestBody(input, init, rewritten);
  return next(target, nextInit);
}

/** Call the unpatched fetch. For health checks and broker refresh calls. */
export function bypassFetch(input, init) {
  const original = state.original ?? globalThis.fetch;
  return original.call(globalThis, input, init);
}

/**
 * Run one call through a snapshot of the handler list.
 * `next(input, init)` enters the next layer, or the original fetch at the end.
 */
async function dispatch(chain, original, index, self, input, init) {
  if (index >= chain.length) return original.call(self, input, init);
  const { handler, name } = chain[index];
  let nextRejected = false;

  const next = (nextInput = input, nextInit = init) => {
    nextRejected = false;
    return Promise.resolve(dispatch(chain, original, index + 1, self, nextInput, nextInit)).catch((error) => {
      nextRejected = true;
      throw error;
    });
  };

  try {
    return await handler(input, init, next);
  } catch (error) {
    // A network rejection is not a handler bug. An intentional
    // AttemptAbandoned is a router decision, not a bug either. Both propagate
    // to the caller unchanged, without a report and without a second network
    // call.
    if (nextRejected || error?.name === "AttemptAbandoned") throw error;
    // A broken handler must never kill the call.
    report(`fetch handler "${name}" failed`, { error: messageOf(error) });
    return next(input, init);
  }
}

/** Install the wrapper. Return false when fetch is absent. */
function install() {
  if (state.installed) return true;
  if (typeof globalThis.fetch !== "function") return false;

  const original = globalThis.fetch;
  const patched = function patchedFetch(input, init) {
    return dispatch(state.handlers.slice(), original, 0, this, input, init);
  };

  state.original = original;
  state.patched = patched;
  state.installed = true;
  globalThis.fetch = patched;
  return true;
}

/**
 * Register a fetch handler. Returns a disposer that removes it.
 * A smaller priority sits further out. Ties keep registration order.
 */
export function addFetchHandler(handler, { name = "anonymous", priority = 50 } = {}) {
  if (typeof handler !== "function") throw new TypeError("fetch handler must be a function");
  const record = { handler, name, priority, sequence: state.sequence++ };
  state.handlers.push(record);
  state.handlers.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
  install();
  return () => removeHandler(record);
}

/** Remove one handler. The last removal also restores the original fetch. */
function removeHandler(record) {
  const index = state.handlers.indexOf(record);
  if (index !== -1) state.handlers.splice(index, 1);
  if (state.handlers.length === 0) dispose();
}

/**
 * Remove every handler and restore the original fetch.
 *
 * Idempotent: a second call does nothing, and a call with nothing installed is
 * safe. The original function is restored only when the wrapper is still in
 * place, so a later third-party replacement is never overwritten.
 */
export function dispose() {
  if (state.installed && state.patched && globalThis.fetch === state.patched) globalThis.fetch = state.original;
  state.installed = false;
  state.original = null;
  state.patched = null;
  state.handlers = [];
}

/** Reset the wrapper between tests. Same effect as dispose(). */
export function resetOutboundForTests() {
  dispose();
}
