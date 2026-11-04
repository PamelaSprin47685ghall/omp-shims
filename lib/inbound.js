// Inbound gateway request rewriting.
//
// Applied once, at the edge, to the body a client sends. Doing it here rather
// than on the outbound fetch means the hashed ids are what the gateway stores,
// replays and forwards, so every later copy is already keyed correctly and no
// layer downstream has to know the rule exists.
//
// A gateway request body carries a whole conversation (megabytes), and several
// independent layers inspect it: optional-null normalization, tool-id hashing,
// the router, and the provider fallbacks. Each one used to clone the Request
// and read or parse it again. The cache below makes the first read and the
// first parse the only ones; every wrapper that receives the same Request, or
// a Request derived from it, shares them.

/** Request → {text?: Promise<string|undefined>, json?: unknown} */
const bodyCache = new WeakMap();

function entryFor(request) {
  let entry = bodyCache.get(request);
  if (!entry) {
    entry = {};
    bodyCache.set(request, entry);
  }
  return entry;
}

/** Share an already-read body (and its parsed form) with later wrappers. */
export function setBodyCache(request, { text, json } = {}) {
  bodyCache.set(request, {
    ...(text === undefined ? {} : { text: Promise.resolve(text) }),
    ...(json === undefined ? {} : { json }),
  });
  return request;
}

/** Hand a derived Request the same body text and parsed form. */
export function copyBodyCache(from, to) {
  const entry = bodyCache.get(from);
  if (entry) bodyCache.set(to, entry);
  return to;
}

/** Join an init with a new body, without ever spreading one over a Request. */
export function withBody(request, body, json) {
  const headers = new Headers(request.headers);
  headers.delete("content-length"); // A rewritten JSON body has new byte length.
  const next = new Request(request.url, {
    method: request.method,
    headers,
    body,
    signal: request.signal,
  });
  return setBodyCache(next, { text: body, json });
}

/** Read a request body as text, or undefined when it cannot be read. */
export async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const entry = entryFor(request);
  entry.text ??= request.clone().text().catch(() => undefined);
  return entry.text;
}

/**
 * The request body as parsed JSON, or undefined when it is absent or malformed.
 * Parsed once per Request: the gateway layers all inspect the same object.
 */
export async function readJson(request) {
  const text = await readBody(request);
  if (typeof text !== "string" || text === "") return undefined;
  const entry = entryFor(request);
  if (entry.json === undefined) {
    try {
      entry.json = JSON.parse(text);
    } catch {
      entry.json = null;
    }
  }
  return entry.json ?? undefined;
}

/**
 * Wrap a gateway request handler so `rewrite(bodyString)` can adjust the
 * inbound body. The original request is passed through untouched when there is
 * nothing to change.
 */
export function withInboundRewrite(handler, rewrite) {
  return async function rewrittenHandler(request, server) {
    const original = await readBody(request);
    if (original === undefined) return handler(request, server);

    let next;
    try {
      next = rewrite(original);
    } catch {
      // Never reject a request because a rewrite misbehaved.
      return handler(request, server);
    }
    if (next === undefined || next === original) return handler(request, server);

    return handler(withBody(request, next), server);
  };
}

/** Paths whose clients all consume the OpenAI usage frame, so it can be asked for. */
export const USAGE_REQUEST_PATHS = Object.freeze(new Set(["/v1/chat/completions"]));

/**
 * Add `stream_options.include_usage` to a chat body that streams, without
 * re-serializing it: the bodies carry whole conversations, so this is string
 * surgery on the two shapes a client can send. Returns undefined when there is
 * nothing to change.
 * @param {string} pathname
 * @param {string} text the raw request body
 */
export function withUsageRequest(pathname, text) {
  if (!USAGE_REQUEST_PATHS.has(pathname) || typeof text !== "string") return undefined;
  if (!/"stream"\s*:\s*true/.test(text)) return undefined;
  if (/"include_usage"\s*:\s*true/.test(text)) return undefined;
  // A client that turned it off explicitly is overruled, not duplicated.
  const enabled = text.replace(/("include_usage"\s*:\s*)false/, "$1true");
  if (enabled !== text) return enabled;
  const inside = text.replace(/("stream_options"\s*:\s*\{)/, '$1"include_usage":true,');
  if (inside !== text) return inside;
  // No stream_options at all: the body is an object with at least a model.
  return text.replace(/^(\s*\{)(?=\s*")/, '$1"stream_options":{"include_usage":true},');
}

/**
 * Patch every Bun.serve instance so `wrap(handler)` replaces its request
 * handler. Patches installed later sit closer to the gateway's own handler.
 */
export function wrapServe(wrap) {
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") return false;
  const original = Bun.serve;
  // Several gateway workers can share one address: the kernel spreads new
  // connections across them, and each connection keeps hitting the worker that
  // accepted it (which is what keeps prompt-cache affinity intact).
  const reusePort = process.env.OMP_SHIMS_REUSE_PORT === "1";

  Bun.serve = function patchedServe(options) {
    if (typeof options.fetch === "function") {
      options = { ...options, fetch: wrap(options.fetch) };
      if (reusePort && options.reusePort === undefined) options.reusePort = true;
    }
    return original.call(this, options);
  };
  return true;
}

/** Patch every Bun.serve instance so its request handler gains the rewrite. */
export function patchServe(rewrite) {
  return wrapServe((handler) => withInboundRewrite(handler, rewrite));
}
