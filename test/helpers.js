// Shared test helpers.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temporary directory. */
export function tempDir(prefix = "omp-shims-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A feature context whose addFetchHandler records layers instead of patching
 * the global fetch, so each feature can be driven in isolation.
 */
export function fakeContext(extra = {}) {
  const handlers = [];
  return {
    handlers,
    context: {
      log: () => {},
      addFetchHandler: (handler) => {
        handlers.push(handler);
        return () => {};
      },
      preserveResponseUrl: (response) => response,
      extraHosts: [],
      ...extra,
    },
  };
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

/** Parse the JSON payloads out of an SSE body. */
export function parseSse(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((data) => data !== "" && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

export const CLOUD_CODE_URL = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
