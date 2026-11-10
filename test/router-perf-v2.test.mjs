import { afterEach, describe, expect, test } from "bun:test";
import { ModelPerf } from "../lib/router/perf.mjs";
import { StateStore } from "../lib/router/state-store.mjs";

const stores = [];

function memory(options = {}) {
  const store = StateStore.memory(options);
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("ModelPerf aggregation", () => {
  test("latency, first token and samples are summed over the window", () => {
    let now = 1_000_000;
    const store = memory({ now: () => now });
    const perf = new ModelPerf({ store, now: () => now });
    perf.observe(
      { model: "p/m", period: "peak" },
      { ttftMs: 200, outputTokens: 10, generationMs: 500, totalMs: 1_000 },
    );
    now += 1_000;
    perf.observe({ model: "p/m", period: "peak" }, { ttftMs: 400, totalMs: 3_000 });
    const summary = perf.summary("p/m", "peak");
    expect(summary).toMatchObject({ ttftMs: 300, totalMs: 2_000, samples: 2, ttftSamples: 2 });
    expect(summary.tokensPerSecond).toBeCloseTo(20, 5);
    expect(perf.summary("p/m", "offPeak")).toBeUndefined();
  });

  test("periods are independent regimes", () => {
    let now = 1_000_000;
    const store = memory({ now: () => now });
    const perf = new ModelPerf({ store, now: () => now });
    perf.observe({ model: "p/m", period: "peak" }, { totalMs: 100 });
    perf.observe({ model: "p/m", period: "offPeak" }, { totalMs: 900 });
    expect(perf.summary("p/m", "peak").totalMs).toBe(100);
    expect(perf.summary("p/m", "offPeak").totalMs).toBe(900);
    now += 1;
  });

  test("the local fallback aggregates without a store", () => {
    let now = 1_000_000;
    const perf = new ModelPerf({ now: () => now });
    perf.observe({ model: "p/local", period: "peak" }, { totalMs: 1_000, ttftMs: 100 });
    now += 60_000;
    perf.observe({ model: "p/local", period: "peak" }, { totalMs: 3_000 });
    expect(perf.summary("p/local", "peak")).toMatchObject({ totalMs: 2_000, samples: 2, ttftMs: 100 });
  });

  test("the window keeps exactly 30 minutes and drops the oldest bucket", () => {
    const minute = Math.floor(1_000_000 / 60_000);
    let now = minute * 60_000;
    const perf = new ModelPerf({ now: () => now });
    for (let index = 0; index < 31; index += 1) {
      now = (minute + index) * 60_000;
      perf.observe({ model: "p/window", period: "peak" }, { totalMs: 1_000 + index });
    }
    now = (minute + 30) * 60_000;
    const summary = perf.summary("p/window", "peak");
    expect(summary.completeSamples).toBe(30);
    expect(summary.totalMs).toBe(1_016); // 1001..1030, the 1000 ms bucket left
  });

  test("imputed samples are counted separately and never enter the complete mean", () => {
    const minute = Math.floor(1_000_000 / 60_000);
    let now = minute * 60_000;
    const perf = new ModelPerf({ now: () => now });
    perf.observe({ model: "p/mixed", period: "peak" }, { totalMs: 2_000 });
    perf.observe({ model: "p/mixed", period: "peak" }, { totalMs: 9_000, imputed: true });
    now += 1;
    const summary = perf.summary("p/mixed", "peak");
    expect(summary.completeSamples).toBe(1);
    expect(summary.imputedSamples).toBe(1);
    expect(summary.totalMs).toBe(2_000);
  });
});

describe("ModelPerf.wrapStream", () => {
  test("drops stale lengths, keeps url and measures an SSE answer", async () => {
    let now = 900;
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
      encoder.encode('data: {"usage":{"completion_tokens":9}}\n\n'),
    ];
    let step = 0;
    const source = new ReadableStream(
      {
        pull(controller) {
          if (step === 0) {
            now = 1_100;
            controller.enqueue(chunks[0]);
            step = 1;
            return;
          }
          if (step === 1) {
            now = 1_400;
            controller.enqueue(chunks[1]);
            step = 2;
            return;
          }
          now = 1_500;
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const response = new Response(source, {
      headers: { "content-type": "text/event-stream", "content-length": "999", "content-encoding": "gzip" },
    });
    Object.defineProperty(response, "url", {
      value: "https://example.test/v1/chat",
      configurable: true,
      enumerable: true,
    });

    const store = memory({ now: () => now });
    const perf = new ModelPerf({ store, now: () => now });
    const wrapped = perf.wrapStream(response, { model: "p/m", period: "peak", startedAt: 900 });

    expect(wrapped.headers.get("content-length")).toBeNull();
    expect(wrapped.headers.get("content-encoding")).toBeNull();
    expect(wrapped.url).toBe("https://example.test/v1/chat");
    expect(await wrapped.text()).toBe(chunks.map((chunk) => new TextDecoder().decode(chunk)).join(""));

    const summary = perf.summary("p/m", "peak");
    expect(summary.totalMs).toBe(600);
    expect(summary.ttftMs).toBe(200);
    expect(summary.tokens).toBe(9);
    expect(summary.tokensPerSecond).toBeCloseTo((9 / 300) * 1_000, 6);
  });

  test("a JSON response keeps its body and drops stale length headers", async () => {
    const now = 1_000_000;
    const body = JSON.stringify({ choices: [{ message: { content: "hello" } }], usage: { completion_tokens: 3 } });
    const response = new Response(body, {
      headers: { "content-type": "application/json", "content-length": "999", "content-encoding": "gzip" },
    });
    Object.defineProperty(response, "url", { value: "https://example.test/v1/complete", configurable: true });
    const store = memory({ now: () => now });
    const perf = new ModelPerf({ store, now: () => now });
    const wrapped = perf.wrapStream(response, { model: "p/json", startedAt: now });
    expect(wrapped.headers.get("content-length")).toBeNull();
    expect(wrapped.headers.get("content-encoding")).toBeNull();
    expect(wrapped.url).toBe("https://example.test/v1/complete");
    expect(await wrapped.text()).toBe(body);
    expect(perf.summary("p/json").tokens).toBe(3);
  });

  test("a raw stream returns a raw stream with the same bytes", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
        controller.close();
      },
    });
    const store = memory();
    const perf = new ModelPerf({ store });
    const wrapped = perf.wrapStream(source, { model: "p/raw", period: "peak" });
    expect(wrapped).toBeInstanceOf(ReadableStream);
    expect(await new Response(wrapped).text()).toBe('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
  });

  test("a bodyless response is returned unchanged", () => {
    const now = 1_000_000;
    const store = memory({ now: () => now });
    const perf = new ModelPerf({ store, now: () => now });
    const response = new Response(null, { status: 204 });
    expect(perf.wrapStream(response, { model: "p/m" })).toBe(response);
  });
});
