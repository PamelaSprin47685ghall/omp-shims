// Inbound request pipeline and body store.
//
// This module owns the only Bun.serve wrapper in the process. A layer
// registers one middleware with a priority. A smaller priority sits further
// out: it sees the raw client request first and the final response last.
//
// A middleware has this shape:
//
//   (request, server, next) => Response | Promise<Response>
//
//   return next()                pass the request inward unchanged
//   return next(rewritten)       pass a rewritten request inward
//   return new Response(...)     answer without the gateway
//
// The wrapper takes one snapshot of the middleware list for each request.
// A dispose() call during a request never skips or repeats a layer.
//
// The body cache lives here too. A gateway request carries a whole
// conversation, and several layers read it and parse it. The cache makes the
// first read and the first parse the only ones.

// The namespace import keeps zstd optional: an older Bun without it must not
// fail at preload time.
import * as zlib from "node:zlib";
import { report } from "./contracts.mjs";

/**
 * Request -> { text?: Promise<string | undefined>, json?: Promise<unknown> }
 * Both fields hold promises, so concurrent callers share one read or parse.
 * @type {WeakMap<Request, { text?: Promise<string | undefined>, json?: Promise<unknown> }>}
 */
const bodyCache = new WeakMap();

/** Return the cache entry for a request, and create it when absent. */
function entryFor(request) {
  let entry = bodyCache.get(request);
  if (!entry) {
    entry = {};
    bodyCache.set(request, entry);
  }
  return entry;
}

/** Decompress zstd only when this runtime provides it. Older runtimes keep the bytes. */
function zstdDecompress(buffer) {
  return typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync(buffer) : buffer;
}

/** Decode one compressed body. Unknown or broken data keeps the raw bytes. */
function decompress(buffer, encoding) {
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return zlib.gunzipSync(buffer);
    if (encoding === "deflate") return zlib.inflateSync(buffer);
    if (encoding === "zstd") return zstdDecompress(buffer);
  } catch {
    // A body that lies about its encoding is still readable as raw bytes.
  }
  return buffer;
}

/** Decode a body with the encodings from its content-encoding header, last first. */
function decodeBody(buffer, encodingHeader) {
  if (!encodingHeader) return buffer;
  const encodings = encodingHeader
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  let result = buffer;
  for (let index = encodings.length - 1; index >= 0; index--) {
    result = decompress(result, encodings[index]);
  }
  return result;
}

/** Read and decode the request body once. A read failure returns undefined. */
async function readRequestBodyText(request) {
  try {
    const raw = Buffer.from(await request.clone().arrayBuffer());
    return decodeBody(raw, request.headers.get("content-encoding")).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Parse JSON without throwing. */
async function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Read a request body as text, or undefined when it cannot be read.
 * GET and HEAD requests have no body. Compressed bodies are decompressed.
 * The result is cached on the Request.
 */
export async function readBody(request) {
  if (!request || request.method === "GET" || request.method === "HEAD") return undefined;
  const entry = entryFor(request);
  entry.text ??= readRequestBodyText(request);
  return entry.text;
}

/** Read the request body as parsed JSON, or undefined. Parsed once per Request. */
export async function readJson(request) {
  const text = await readBody(request);
  if (typeof text !== "string" || text === "") return undefined;
  const entry = entryFor(request);
  entry.json ??= parseJson(text);
  return entry.json;
}

/** Share an already-read body (and its parsed form) with this Request. */
export function setBodyCache(request, { text, json } = {}) {
  const entry = entryFor(request);
  if (text !== undefined) entry.text = Promise.resolve(text);
  if (json !== undefined) entry.json = Promise.resolve(json);
  return request;
}

/** Hand a derived Request the same body cache. The entry clone is shallow. */
export function copyBodyCache(from, to) {
  const entry = bodyCache.get(from);
  if (entry && from !== to) bodyCache.set(to, { ...entry });
  return to;
}

/**
 * Build a Request with a new body. The stale content-length and
 * content-encoding headers go, because the new body has its own byte length
 * and is plain text. Method, headers, and signal are kept. The body cache is
 * populated on the new Request.
 */
export function withBody(request, bodyText, parsedJson) {
  const hasBody = bodyText !== undefined && request.method !== "GET" && request.method !== "HEAD";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const init = { method: request.method, headers, signal: request.signal };
  if (hasBody) init.body = bodyText;
  const next = new Request(request.url, init);
  if (!hasBody) return next;
  return setBodyCache(next, parsedJson === undefined ? { text: bodyText } : { text: bodyText, json: parsedJson });
}

/**
 * Wrap a gateway request handler so `rewrite(bodyText)` can adjust the
 * inbound body. The rewrite may be async. The original request passes through
 * untouched when there is nothing to change or the rewrite fails.
 */
export function withInboundRewrite(handler, rewrite) {
  return async function rewrittenHandler(request, server) {
    const original = await readBody(request);
    if (original === undefined) return handler(request, server);

    let next;
    try {
      next = await rewrite(original);
    } catch (error) {
      report("inbound rewrite failed", { error: messageOf(error) });
      return handler(request, server);
    }
    if (next === undefined || next === original) return handler(request, server);

    return handler(withBody(request, String(next)), server);
  };
}

/* ------------------------------------------------------------------ */
/* The single Bun.serve wrapper.                                       */
/* ------------------------------------------------------------------ */

/**
 * Layer priorities for the inbound wrapper. A smaller value sits further out.
 * Features import these names so no file scatters magic numbers.
 */
export const middlewarePriority = Object.freeze({
  trafficLog: 10,
  gatewayCompat: 20,
  sseHeartbeat: 30,
  reasoningOrder: 40,
  toolIdHash: 50,
  copilotAuto: 60,
  lazyRouter: 70,
});

const state = {
  installed: false,
  original: null,
  patched: null,
  /** @type {{ middleware: Function, name: string, priority: number, sequence: number }[]} */
  middlewares: [],
  sequence: 0,
};

/** Return a useful message from any thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Run one request through a snapshot of the middleware list.
 * `next(request)` enters the next layer, or the gateway handler at the end.
 */
async function dispatch(chain, index, request, server, gateway) {
  if (index >= chain.length) return gateway.call(server, request, server);
  const { middleware, name } = chain[index];
  let nextRejected = false;

  const next = (nextRequest = request) => {
    nextRejected = false;
    return Promise.resolve(dispatch(chain, index + 1, nextRequest, server, gateway)).catch((error) => {
      nextRejected = true;
      throw error;
    });
  };

  try {
    return await middleware(request, server, next);
  } catch (error) {
    // A broken shim must never kill traffic. A genuine gateway failure is
    // different: it propagates to the caller without a second gateway call.
    report(`inbound middleware "${name}" failed`, { error: messageOf(error) });
    if (nextRejected) throw error;
    return next(request);
  }
}

/** Install the wrapper. Return false when Bun.serve is absent. */
function install() {
  if (state.installed) return true;
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") return false;

  const original = Bun.serve;
  const patched = function patchedServe(options) {
    const gateway = options?.fetch;
    if (typeof gateway !== "function") return original.call(this, options);

    const nextOptions = {
      ...options,
      fetch(request, server) {
        return dispatch(state.middlewares.slice(), 0, request, server, gateway);
      },
    };
    // Several gateway workers can share one address: the kernel spreads new
    // connections across them, and each connection keeps hitting the worker
    // that accepted it, which keeps prompt-cache affinity intact.
    if (process.env.OMP_SHIMS_REUSE_PORT === "1" && nextOptions.reusePort === undefined) {
      nextOptions.reusePort = true;
    }
    return original.call(this, nextOptions);
  };

  state.original = original;
  state.patched = patched;
  state.installed = true;
  Bun.serve = patched;
  return true;
}

/**
 * Register an inbound middleware. Returns a disposer that removes it.
 * A smaller priority sits further out. Ties keep registration order.
 */
export function addInboundMiddleware(middleware, { name = "anonymous", priority = 50 } = {}) {
  if (typeof middleware !== "function") throw new TypeError("inbound middleware must be a function");
  const record = { middleware, name, priority, sequence: state.sequence++ };
  state.middlewares.push(record);
  state.middlewares.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
  install();
  return () => removeMiddleware(record);
}

/** Remove one middleware. The last removal also restores Bun.serve. */
function removeMiddleware(record) {
  const index = state.middlewares.indexOf(record);
  if (index !== -1) state.middlewares.splice(index, 1);
  if (state.middlewares.length === 0) dispose();
}

/** Remove every middleware and restore the original Bun.serve. */
export function dispose() {
  if (typeof Bun !== "undefined" && state.installed && Bun.serve === state.patched) Bun.serve = state.original;
  state.installed = false;
  state.original = null;
  state.patched = null;
  state.middlewares = [];
}

/** Reset the wrapper between tests. Same effect as dispose(). */
export function resetInboundForTests() {
  dispose();
}
