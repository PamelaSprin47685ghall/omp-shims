// Shared test helpers for the v2 modules.
//
// The context records registrations instead of patching Bun.serve or fetch, so
// each feature and each pipeline can be driven in isolation.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temporary directory. */
export function tempDir(prefix = "omp-shims-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A feature context that records inbound and outbound registrations.
 *
 * Each entry is callable, so a test can drive it directly, and it also keeps
 * the original function under `.middleware` or `.handler` plus `.name` and
 * `.priority`. Every registration returns a disposer, `disposers` lists them,
 * and `disposeAll()` removes every entry.
 *
 * `outbound` and `handlers` are the same array. v1 feature tests use
 * `handlers[0](input, init, next)`; a v2 test reads the priority from the same
 * entry. `inbound` holds the Bun.serve middleware entries.
 */
export function fakeContext(extra = {}) {
  const inbound = [];
  const outbound = [];
  const disposers = [];

  // A function's own `name` is read-only by assignment; keep the layer name
  // visible on the callable entry with defineProperty.
  const tag = (entry, name, priority) => {
    Object.defineProperty(entry, "name", { value: name, configurable: true });
    entry.priority = priority;
    return entry;
  };

  const register = (list, entry) => {
    list.push(entry);
    const dispose = () => {
      const index = list.indexOf(entry);
      if (index !== -1) list.splice(index, 1);
      const at = disposers.indexOf(dispose);
      if (at !== -1) disposers.splice(at, 1);
    };
    disposers.push(dispose);
    return dispose;
  };

  const context = {
    log: () => {},
    addInboundMiddleware(middleware, { name = "anonymous", priority = 50 } = {}) {
      const entry = tag((request, server, next) => middleware(request, server, next), name, priority);
      entry.middleware = middleware;
      return register(inbound, entry);
    },
    addFetchHandler(handler, { name = "anonymous", priority = 50 } = {}) {
      const entry = tag((input, init, next) => handler(input, init, next), name, priority);
      entry.handler = handler;
      return register(outbound, entry);
    },
    preserveResponseUrl: (response) => response,
    extraHosts: [],
    ...extra,
  };

  const disposeAll = () => {
    for (const dispose of disposers.splice(0).reverse()) dispose();
  };

  return { inbound, outbound, handlers: outbound, disposers, disposeAll, context };
}

/** A `next` that records what reached it and answers with `respond(input, init)`. */
export function recordingNext(respond = () => new Response("ok")) {
  const calls = [];
  const next = async (input, init) => {
    calls.push({ input, init });
    return respond(input, init, calls.length);
  };
  return { calls, next };
}

/** A text/event-stream response from a list of JSON payloads. */
export function sseResponse(payloads) {
  const text = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

/** Parse the JSON payloads out of an SSE body. `[DONE]` is ignored with or without a space. */
export function parseSse(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((data) => data !== "" && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

export const CLOUD_CODE_URL = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
