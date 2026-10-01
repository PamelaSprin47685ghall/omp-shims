// Inbound gateway request rewriting.
//
// Applied once, at the edge, to the body a client sends. Doing it here rather
// than on the outbound fetch means the hashed ids are what the gateway stores,
// replays and forwards, so every later copy is already keyed correctly and no
// layer downstream has to know the rule exists.

/** Join an init with a new body, without ever spreading one over a Request. */
function withBody(request, body) {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

/** Read a request body as text, or undefined when it cannot be read. */
export async function readBody(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  try {
    return await request.clone().text();
  } catch {
    return undefined;
  }
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

/** Patch every Bun.serve instance so its request handler gains the rewrite. */
export function patchServe(rewrite) {
  if (typeof Bun === "undefined" || typeof Bun.serve !== "function") return false;
  const original = Bun.serve;

  Bun.serve = function patchedServe(options) {
    if (typeof options.fetch === "function") {
      options = { ...options, fetch: withInboundRewrite(options.fetch, rewrite) };
    }
    return original.call(this, options);
  };
  return true;
}
