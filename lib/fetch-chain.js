// Shared fetch pipeline.
//
// Features that inspect or repair provider traffic stack as middleware around
// the real `fetch`. Registration order is onion depth: the first layer registered
// is the outermost, so it sees the request first and the response last.
//
// A layer receives `(input, init, next)` and returns a value:
//
//   return next(input, init)                    pass through
//   return next(rewrittenInput, rewrittenInit)  rewrite on the way in
//   return next(input, init).then(tap)          observe the way out
//   return response                             answer without calling next
//
// Ordering carries the meaning, so no layer needs a special escape hatch:
//
//   capture       outermost, watches the final stream
//   continuation  owns the response for Cloud Code Assist; its retries and
//                 continuation turns re-enter via next(), so they pass back
//                 through every repair below
//   system-instruction / routing   rewrite the outgoing envelope
//   ipv6-first    innermost, pins the egress address family
//   network
//
// Because continuation sits above ipv6-first, a re-issued upstream call is
// address-pinned exactly like the first one. Antigravity rejects the IPv4 path
// with "User location is not supported", so that ordering is load-bearing.

const state = {
  installed: false,
  original: null,
  handlers: [],
};

export function isCloudCodeStream(url, extraHosts = []) {
  if (typeof url !== "string") return false;
  if (!url.includes("/v1internal:streamGenerateContent")) return false;
  if (url.includes("cloudcode-pa.googleapis.com")) return true;
  return extraHosts.some((host) => host && url.includes(host));
}

/** Extract the request URL regardless of the (url, init) / (Request) calling shape. */
export function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && typeof input.url === "string") return input.url;
  return "";
}

/** Extract the request body when it is an in-memory string. */
export function requestBody(input, init) {
  if (init && typeof init.body === "string") return init.body;
  if (input && typeof input === "object" && typeof input.body === "string") return input.body;
  return undefined;
}

/** Restore the canonical URL on a response we rebuilt (Bun drops it). */
export function preserveResponseUrl(response, url) {
  try {
    if (typeof url !== "string" || url === "") return response;
    Object.defineProperty(response, "url", { value: url, configurable: true, enumerable: true });
  } catch {}
  return response;
}

/** Append one JSON line, never throwing: diagnostics must not affect traffic. */
export function appendJsonLine(path, entry) {
  try {
    if (!path) return;
    require("node:fs").appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {}
}

/** Join an init with a new body, without ever spreading one over a Request. */
function withBody(input, init, body) {
  if (typeof input === "string" || input instanceof URL) {
    return { target: input, init: { ...init, body } };
  }
  // (Request) form: rebuild as (url, init). Spreading init over a Request makes
  // fetch ignore the body and silently downgrade the call to GET.
  return {
    target: requestUrl(input),
    init: {
      method: init?.method ?? input.method,
      headers: init?.headers ?? input.headers,
      signal: init?.signal ?? input.signal,
      body,
    },
  };
}

/**
 * Rewrite an in-memory request body and re-issue it through `next`.
 * Returns undefined when there is nothing to rewrite, so the caller can pass the
 * request through untouched.
 */
export function rewriteRequestBody(next, input, init, rewrite) {
  const body = requestBody(input, init);
  if (body === undefined) return undefined;

  const rewritten = rewrite(body);
  if (rewritten === undefined || rewritten === body) return undefined;

  const { target, init: nextInit } = withBody(input, init, rewritten);
  return next(target, nextInit);
}

/**
 * Register a fetch middleware layer. Returns a disposer that removes it.
 * Registration order is onion depth: earlier = further out.
 */
export function addFetchHandler(handler) {
  if (!state.installed) {
    const original = (state.original = globalThis.fetch);

    const call = function (self, input, init, index) {
      if (index >= state.handlers.length) return original.call(self, input, init);
      const next = (nextInput, nextInit) => call(self, nextInput, nextInit, index + 1);
      try {
        return state.handlers[index](input, init, next);
      } catch (error) {
        // A broken layer must never break the request: continue inward.
        console.warn(`[omp-shims] fetch handler failed: ${error.message}`);
        return next(input, init);
      }
    };

    globalThis.fetch = function patchedFetch(input, init) {
      return call(this, input, init, 0);
    };
    state.installed = true;
  }

  state.handlers.push(handler);
  return () => {
    const index = state.handlers.indexOf(handler);
    if (index !== -1) state.handlers.splice(index, 1);
  };
}
