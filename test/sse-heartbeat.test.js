import { describe, expect, test } from "bun:test";
import { lazyRouterHandler } from "../features/lazy-router.js";
import {
  BoundaryTracker,
  heartbeatStream,
  KEEP_ALIVE,
  streamingHeaders,
  withHeartbeat,
  withSseHeartbeat,
} from "../lib/sse-heartbeat.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SSE = { "content-type": "text/event-stream; charset=utf-8" };

/** A source stream fed by hand: push(text), pause, end(). */
function manualSource() {
  let controller;
  let cancelled = null;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    cancel(reason) {
      cancelled = reason ?? "cancelled";
    },
  });
  return {
    stream,
    push: (text) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: (error) => controller.error(error),
    get cancelled() {
      return cancelled;
    },
  };
}

/** Read everything a stream produces, as text pieces in arrival order. */
async function collect(stream) {
  const pieces = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return pieces;
    pieces.push(decoder.decode(value));
  }
}

describe("BoundaryTracker", () => {
  test("a fresh stream is between events", () => {
    expect(new BoundaryTracker().atBoundary).toBe(true);
  });

  test("LF and CRLF terminators, also split across chunks", () => {
    const t = new BoundaryTracker();
    t.push(encoder.encode("data: {}\n"));
    expect(t.atBoundary).toBe(false);
    t.push(encoder.encode("\n"));
    expect(t.atBoundary).toBe(true);
    t.push(encoder.encode("data: x\r\n\r"));
    expect(t.atBoundary).toBe(false);
    t.push(encoder.encode("\n"));
    expect(t.atBoundary).toBe(true);
    t.push(encoder.encode("data: half"));
    expect(t.atBoundary).toBe(false);
  });
});

describe("heartbeatStream", () => {
  test("writes a keep-alive after an idle interval at an event boundary", async () => {
    const source = manualSource();
    const reading = collect(heartbeatStream(source.stream, { intervalMs: 20 }));
    source.push("data: 1\n\n");
    await sleep(55);
    source.push("data: 2\n\n");
    source.end();
    const pieces = await reading;
    expect(pieces[0]).toBe("data: 1\n\n");
    expect(pieces.filter((p) => p === KEEP_ALIVE).length).toBeGreaterThanOrEqual(1);
    expect(pieces.at(-1)).toBe("data: 2\n\n");
  });

  test("never splits an event: no keep-alive while an event is half written", async () => {
    const source = manualSource();
    const reading = collect(heartbeatStream(source.stream, { intervalMs: 15 }));
    source.push('data: {"a":');
    await sleep(60);
    source.push("1}\n\n");
    source.end();
    expect((await reading).join("")).toBe('data: {"a":1}\n\n');
  });

  test("every forwarded chunk restarts the idle clock", async () => {
    const source = manualSource();
    let beats = 0;
    const reading = collect(heartbeatStream(source.stream, { intervalMs: 40, onKeepAlive: () => beats++ }));
    for (let i = 0; i < 6; i++) {
      source.push(`data: ${i}\n\n`);
      await sleep(15);
    }
    source.end();
    await reading;
    expect(beats).toBe(0);
  });

  test("forwards bytes unchanged and closes with the source", async () => {
    const source = manualSource();
    const reading = collect(heartbeatStream(source.stream, { intervalMs: 1_000 }));
    source.push("event: a\r\ndata: 1\r\n\r\n");
    source.push("data: [DONE]\n\n");
    source.end();
    expect((await reading).join("")).toBe("event: a\r\ndata: 1\r\n\r\ndata: [DONE]\n\n");
  });

  test("client cancel stops the timer and cancels the source", async () => {
    const source = manualSource();
    let beats = 0;
    const reader = heartbeatStream(source.stream, { intervalMs: 10, onKeepAlive: () => beats++ }).getReader();
    source.push("data: 1\n\n");
    await reader.read();
    await reader.cancel("client gone");
    const after = beats;
    await sleep(40);
    expect(source.cancelled).toBe("client gone");
    expect(beats).toBe(after);
  });

  test("request abort stops the timer and cancels the source", async () => {
    const source = manualSource();
    const abort = new AbortController();
    let beats = 0;
    const reader = heartbeatStream(source.stream, {
      intervalMs: 10,
      signal: abort.signal,
      onKeepAlive: () => beats++,
    }).getReader();
    source.push("data: 1\n\n");
    await reader.read();
    abort.abort("bye");
    const after = beats;
    await sleep(40);
    expect(source.cancelled).toBe("bye");
    expect(beats).toBe(after);
  });

  test("a source error reaches the client", async () => {
    const source = manualSource();
    const reading = collect(heartbeatStream(source.stream, { intervalMs: 1_000 }));
    source.push("data: 1\n\n");
    source.fail(new Error("upstream reset"));
    await expect(reading).rejects.toThrow("upstream reset");
  });

  test("reads from the source only when the client asks (backpressure)", async () => {
    let pulls = 0;
    const source = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          controller.enqueue(encoder.encode(`data: ${pulls}\n\n`));
        },
      },
      { highWaterMark: 0 },
    );
    const reader = heartbeatStream(source, { intervalMs: 1_000 }).getReader();
    await sleep(20);
    expect(pulls).toBe(0);
    await reader.read();
    await reader.read();
    await sleep(20);
    expect(pulls).toBe(2);
    await reader.cancel();
  });
});

describe("withHeartbeat", () => {
  test("non-SSE responses are returned untouched", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(withHeartbeat(json, { intervalMs: 10 })).toBe(json);
    const empty = new Response(null, { status: 204, headers: SSE });
    expect(withHeartbeat(empty, { intervalMs: 10 })).toBe(empty);
  });

  test("SSE responses keep status and headers, and gain no-buffering hints", () => {
    const original = new Response("data: 1\n\n", {
      status: 200,
      headers: { ...SSE, "x-lazy-router-unit": "u", "content-length": "9" },
    });
    const wrapped = withHeartbeat(original, { intervalMs: 10 });
    expect(wrapped).not.toBe(original);
    expect(wrapped.status).toBe(200);
    expect(wrapped.headers.get("x-lazy-router-unit")).toBe("u");
    expect(wrapped.headers.get("x-accel-buffering")).toBe("no");
    expect(wrapped.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(wrapped.headers.get("content-length")).toBeNull();
  });

  test("an existing cache-control gains no-transform once", () => {
    expect(streamingHeaders({ "cache-control": "no-cache" }).get("cache-control")).toBe("no-cache, no-transform");
    expect(streamingHeaders({ "cache-control": "no-store, no-transform" }).get("cache-control")).toBe(
      "no-store, no-transform",
    );
  });
});

describe("withSseHeartbeat", () => {
  test("nothing is written before the inner handler has decided", async () => {
    // A lazy-router stand-in that spends a while failing over before answering.
    const router = {
      handles: (model) => model === "lazy/task",
      serve: async () => {
        await sleep(60);
        return new Response("data: answer\n\ndata: [DONE]\n\n", { status: 200, headers: SSE });
      },
    };
    const dispatcher = { bind() {} };
    const inner = lazyRouterHandler(async () => new Response("gateway"), {
      router,
      dispatcher,
      statusPath: "/v1/lazy/status",
      statusPage: () => undefined,
    });
    const handler = withSseHeartbeat(inner, { intervalMs: 10 });
    const request = new Request("http://x/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "lazy/task", stream: true }),
    });
    const response = await handler(request);
    expect(response.status).toBe(200);
    expect((await collect(response.body)).join("")).toBe("data: answer\n\ndata: [DONE]\n\n");
  });

  test("a failed attempt's error response passes through untouched", async () => {
    const failure = new Response('{"error":"no unit"}', {
      status: 503,
      headers: { "content-type": "application/json" },
    });
    const handler = withSseHeartbeat(async () => failure, { intervalMs: 10 });
    expect(await handler(new Request("http://x/"))).toBe(failure);
  });
});
