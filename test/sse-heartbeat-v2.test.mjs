// Contract tests for the v2 sse-heartbeat edge feature.
//
// The layer is installed through a recording context, so each test can drive
// the middleware directly. A manual source proves the keep-alive only appears
// at an event boundary, and cancel/abort prove the timer is released.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_INTERVAL_MS, install, KEEP_ALIVE } from "../features/sse-heartbeat.mjs";
import { dispose as disposeInbound } from "../lib/inbound.mjs";

const originalArgv = process.argv.slice();
process.argv.push("auth-gateway", "serve");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const disposers = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A source stream fed by the test. */
function manualSource() {
  let controller;
  let cancelled = null;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
    cancel(reason) {
      cancelled = reason ?? "cancelled";
    },
  });
  return {
    stream,
    push(text) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/** Install with a context that records the middleware. */
async function installRecording(config) {
  let middleware;
  const context = {
    log: () => {},
    addInboundMiddleware(handler) {
      middleware = handler;
      return () => {
        middleware = undefined;
      };
    },
  };
  const dispose = await install(config, context);
  disposers.push(dispose);
  return middleware;
}

/** Read a stream to text. */
async function collect(stream) {
  const reader = stream.getReader();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value, { stream: true });
  }
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  disposeInbound();
});

afterAll(() => {
  process.argv = originalArgv.slice();
  disposeInbound();
});

describe("installed heartbeat", () => {
  test("writes a keep-alive between events and never inside a partial event", async () => {
    const middleware = await installRecording({ intervalMs: 50 });
    const source = manualSource();
    const response = await middleware(
      new Request("http://gateway/v1/chat/completions", { method: "POST", body: "{}" }),
      {},
      async () =>
        new Response(source.stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const reading = collect(response.body);
    source.push("data: 1\n\n");
    await sleep(150);

    // Half an event: no keep-alive may be inserted before the terminator.
    source.push('data: {"a":');
    await sleep(100);
    source.push("1}\n\n");
    source.close();

    const text = await reading;
    expect(text).toContain("data: 1\n\n");
    expect(text).toContain('data: {"a":1}\n\n');
    expect(text).not.toContain('data: {"a":\n\n: keep-alive');
    expect(text.match(/: keep-alive/g)?.length ?? 0).toBeGreaterThan(0);
  });

  test("client cancel clears the timer and cancels the source", async () => {
    const middleware = await installRecording({ intervalMs: 50 });
    const source = manualSource();
    const response = await middleware(
      new Request("http://gateway/v1/chat/completions", { method: "POST", body: "{}" }),
      {},
      async () =>
        new Response(source.stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const reader = response.body.getReader();
    source.push("data: 1\n\n");
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe("data: 1\n\n");
    await reader.cancel("client gone");
    await sleep(120);
    expect(source.cancelled).toBe("client gone");
  });

  test("request abort clears the timer and cancels the source", async () => {
    const middleware = await installRecording({ intervalMs: 50 });
    const source = manualSource();
    const abort = new AbortController();
    const request = new Request("http://gateway/v1/chat/completions", {
      method: "POST",
      body: "{}",
      signal: abort.signal,
    });
    const response = await middleware(
      request,
      {},
      async () =>
        new Response(source.stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const reader = response.body.getReader();
    source.push("data: 1\n\n");
    await reader.read();
    abort.abort("bye");
    await sleep(120);
    expect(source.cancelled).toBe("bye");
  });

  test("rebuilds the response with no-buffering headers and keeps its url", async () => {
    const middleware = await installRecording({ intervalMs: 1_000 });
    const source = manualSource();
    source.push("data: 1\n\n");
    source.close();
    const original = new Response(source.stream, {
      status: 200,
      headers: { "content-type": "text/event-stream", "content-length": "999", "x-upstream": "1" },
    });
    Object.defineProperty(original, "url", {
      value: "https://upstream.example/v1/chat/completions",
      configurable: true,
    });

    const response = await middleware(
      new Request("http://gateway/v1/chat/completions", { method: "POST", body: "{}" }),
      {},
      async () => original,
    );

    expect(response.url).toBe("https://upstream.example/v1/chat/completions");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-upstream")).toBe("1");
    expect(await response.text()).toBe("data: 1\n\n");
  });

  test("non-SSE responses pass through untouched", async () => {
    const middleware = await installRecording({ intervalMs: 50 });
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const response = await middleware(
      new Request("http://gateway/v1/chat/completions", { method: "POST", body: "{}" }),
      {},
      async () => json,
    );
    expect(response).toBe(json);
  });
});

test("exports the documented defaults", () => {
  expect(KEEP_ALIVE).toBe(": keep-alive\n\n");
  expect(DEFAULT_INTERVAL_MS).toBe(15_000);
});
