// Contract tests for the bounded SSE codec.
//
// Chunk-boundary CR handling, [DONE] detection, byte limits, stream
// cancellation, and response rebuilding.

import { describe, expect, test } from "bun:test";
import * as sse from "../lib/sse.mjs";

const encoder = new TextEncoder();

describe("parseSseFrame", () => {
  test("detects [DONE] with and without the optional space", () => {
    expect(sse.parseSseFrame("data:[DONE]").isDone).toBe(true);
    expect(sse.parseSseFrame("data: [DONE]").isDone).toBe(true);
    expect(sse.parseSseFrame("data:  [DONE]").isDone).toBe(true);
    expect(sse.parseSseFrame("data: [DONE]\n").isDone).toBe(true);
    expect(sse.parseSseFrame('data: {"x":1}').isDone).toBe(false);
    expect(sse.parseSseFrame("data: [DONE]x").isDone).toBe(false);
  });

  test("joins data lines, strips one space, and keeps event and id", () => {
    const frame = sse.parseSseFrame('event: delta\nid: 7\ndata: {"a":\ndata:  1}');
    expect(frame.event).toBe("delta");
    expect(frame.id).toBe("7");
    expect(frame.data).toBe('{"a":\n 1}');
    expect(frame.commentOnly).toBe(false);
    expect(frame.json()).toEqual({ a: 1 });
    expect(sse.parseSseFrame("data: not json").json()).toBeUndefined();
    expect(sse.parseSseFrame(": keep-alive").commentOnly).toBe(true);
  });
});

describe("createSseScanner", () => {
  test("holds a CR that a chunk boundary splits from its LF", () => {
    const scanner = sse.createSseScanner();
    const blocks = [
      ...scanner.push("event: a\r"),
      ...scanner.push("\ndata: 1\r"),
      ...scanner.push("\n\r"),
      ...scanner.push("\n"),
    ];
    expect(blocks).toEqual(["event: a\ndata: 1"]);
    expect(scanner.pendingBytes).toBe(0);
  });

  test("handles a \\n\\r\\n sequence split across chunks", () => {
    const scanner = sse.createSseScanner();
    expect(scanner.push("data: 1\n\r")).toEqual([]);
    expect(scanner.push("\ndata: 2\n\n")).toEqual(["data: 1", "data: 2"]);
  });

  test("normalizes bare CR endings and flush completes the last event", () => {
    const scanner = sse.createSseScanner();
    expect(scanner.push("data: tail\r\r")).toEqual([]);
    expect(scanner.flush()).toEqual(["data: tail"]);
    expect(scanner.flush()).toEqual([]);
  });

  test("rejects an event that grows past maxEventBytes", () => {
    const scanner = sse.createSseScanner({ maxEventBytes: 8 });
    expect(() => scanner.push("data: 123456789")).toThrow(RangeError);

    const complete = sse.createSseScanner({ maxEventBytes: 4 });
    expect(() => complete.push("data: 12345\n\n")).toThrow(RangeError);
  });
});

describe("transformSseStream", () => {
  test("rewrites frames and runs onFlush at the end", async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: 1\r"));
        controller.enqueue(encoder.encode("\n\r\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const frames = [];
    const stream = sse.transformSseStream(source, {
      onFrame(frame, emit) {
        frames.push(frame.data);
        if (frame.isDone) emit("data: [DONE]\n\n");
        else emit(`data: ${JSON.stringify(frame.json())}\n\n`);
      },
      onFlush(emit) {
        emit(": end\n\n");
      },
    });
    expect(await new Response(stream).text()).toBe("data: 1\n\ndata: [DONE]\n\n: end\n\n");
    expect(frames).toEqual(["1", "[DONE]"]);
  });

  test("enforces maxBufferBytes on retained text", async () => {
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: 123456789"));
        controller.close();
      },
    });
    const stream = sse.transformSseStream(source, { maxBufferBytes: 4 });
    await expect(new Response(stream).text()).rejects.toThrow(RangeError);
  });

  test("cancelling the transformed stream cancels the source", async () => {
    let cancelled = false;
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: 1\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const reader = sse.transformSseStream(source).getReader();
    await reader.read();
    await reader.cancel("client gone");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelled).toBe(true);
  });
});

describe("rebuildResponse", () => {
  test("keeps the url and strips content-length and content-encoding", async () => {
    const response = new Response("data: 1\n\n", {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "content-length": "9",
        "content-encoding": "gzip",
        "x-keep": "1",
      },
    });
    const rebuilt = sse.rebuildResponse(response, "data: 2\n\n", { url: "https://a.example/stream" });

    expect(rebuilt.url).toBe("https://a.example/stream");
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.headers.get("content-length")).toBeNull();
    expect(rebuilt.headers.get("content-encoding")).toBeNull();
    expect(rebuilt.headers.get("content-type")).toBe("text/event-stream");
    expect(rebuilt.headers.get("x-keep")).toBe("1");
    expect(await rebuilt.text()).toBe("data: 2\n\n");
  });
});
