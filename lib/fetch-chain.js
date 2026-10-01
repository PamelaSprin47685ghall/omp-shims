// Shared helpers for the fetch-wrapping features.
//
// Every feature patches `globalThis.fetch`. To keep them independent and
// order-stable they all share ONE wrapper installed by the first feature that
// needs it; each feature then contributes a handler which is tried in order
// and the first one that returns a value wins. A handler that returns
// `undefined` passes the request along untouched.

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

/** Re-wrap a response so Bun keeps the canonical `url` (Bun drops it on `new Response`). */
export function preserveResponseUrl(response, url) {
  try {
    if (typeof url !== "string" || url === "") return response;
    Object.defineProperty(response, "url", { value: url, configurable: true, enumerable: true });
  } catch {}
  return response;
}

/**
 * Rewrite an in-memory request body and re-issue the request, handling both the
 * (url, init) and (Request) calling shapes. Returns undefined when there is no
 * string body to rewrite, so the caller can pass the request through untouched.
 *
 * Never spreads `init` over a Request object: fetch ignores a body on a Request
 * unless the method is set explicitly, and would silently downgrade to GET.
 */
export function rewriteRequestBody(originalFetch, thisArg, input, init, rewrite) {
  const body = requestBody(input, init);
  if (body === undefined) return undefined;

  const next = rewrite(body);
  if (next === undefined || next === body) return undefined;

  if (typeof input === "string" || input instanceof URL) {
    return originalFetch.call(thisArg, input, { ...init, body: next });
  }

  return originalFetch.call(thisArg, requestUrl(input), {
    method: init?.method ?? input.method,
    headers: init?.headers ?? input.headers,
    signal: init?.signal ?? input.signal,
    body: next,
  });
  return response;
}

/** Append one JSON line, never throwing: diagnostics must not affect traffic. */
export function appendJsonLine(path, entry) {
  try {
    if (!path) return;
    require("node:fs").appendFileSync(path, JSON.stringify(entry) + "\n");
  } catch {}
}

/**
 * Register a fetch handler. Returns a disposer.
 * Handlers run in registration order; the first truthy return short-circuits.
 */
export function addFetchHandler(handler) {
  if (!state.installed) {
    state.original = globalThis.fetch;
    const original = state.original;
    globalThis.fetch = function patchedFetch(input, init) {
      for (const h of state.handlers) {
        try {
          const result = h(input, init, original);
          if (result !== undefined) return result;
        } catch {
          // a broken handler must never break the request
        }
      }
      return original.call(this, input, init);
    };
    state.installed = true;
  }
  state.handlers.push(handler);
  return () => {
    const index = state.handlers.indexOf(handler);
    if (index !== -1) state.handlers.splice(index, 1);
  };
}