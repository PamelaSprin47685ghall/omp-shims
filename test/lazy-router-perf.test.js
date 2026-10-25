import { withUsageRequest } from "../lib/inbound.js";
import { describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers.js";
import {
  mayCarryUsage,
  measureStream,
  ModelPerf,
  outputTokensIn,
  tokenUsageIn,
  tokenUsageInText,
  PERF_WINDOW_MINUTES,
} from "../lib/lazy-router/perf.js";

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text);
const sse = (text) =>
  new Response(text, { headers: { "content-type": "text/event-stream" } });

/** A stream that emits `chunks` on demand, so the reader controls the timing. */
function controlledStream(chunks, { contentType = "text/event-stream" } = {}) {
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes(chunks[index]));
      index += 1;
    },
  });
  return new Response(body, { headers: { "content-type": contentType } });
}

describe("usage frame detection", () => {
  test("only chunks carrying the word are decoded", () => {
    expect(mayCarryUsage(bytes('data: {"choices":[{"delta":{"content":"hi"}}]}'))).toBe(false);
    expect(mayCarryUsage(bytes('data: {"usage":{"completion_tokens":42}}'))).toBe(true);
    expect(mayCarryUsage(bytes("usa"))).toBe(false);
  });

  test("the last token total wins across provider spellings", () => {
    expect(outputTokensIn('"completion_tokens":12 ... "completion_tokens":40')).toBe(40);
    expect(outputTokensIn('{"usage":{"output_tokens":128}}')).toBe(128);
    expect(outputTokensIn('{"usageMetadata":{"candidatesTokenCount":31}}')).toBe(31);
    expect(outputTokensIn("no totals here")).toBeUndefined();
  });

  test("structured usage keeps hidden reasoning inside the reported output total", () => {
    expect(tokenUsageIn({ usage: { completion_tokens: 100, completion_tokens_details: { reasoning_tokens: 60 } } })).toEqual({
      outputTokens: 100,
      reasoningTokens: 60,
    });
    expect(tokenUsageInText('{"usage":{"completionTokens":45,"reasoningTokens":20}}')).toEqual({
      outputTokens: 45,
      reasoningTokens: 20,
    });
  });
});

describe("ModelPerf", () => {
  const at = (ms) => () => ms;

  test("latency and speed are summed over the window, not averaged per answer", () => {
    let clock = 1_000_000;
    const perf = new ModelPerf({ now: () => clock });
    perf.record("p/a", { ttftMs: 400, outputTokens: 100, generationMs: 2_000, totalMs: 3_000 });
    clock += 1_000;
    perf.record("p/a", { ttftMs: 600, outputTokens: 300, generationMs: 4_000, totalMs: 5_000 });
    const view = perf.view()["p/a"];
    expect(view.ttftMs).toBe(500);
    expect(view.samples).toBe(2);
    expect(view.tokens).toBe(400);
    // 400 tokens over 6 s of generation, whichever answer produced them.
    expect(view.tokensPerSecond).toBeCloseTo(66.67, 1);
    expect(view.totalMs).toBe(4_000);
  });

  test("an answer that was not streamed contributes its duration only", () => {
    const perf = new ModelPerf({ now: () => 7_000_000 });
    perf.record("p/a", { totalMs: 1_500 });
    const view = perf.view()["p/a"];
    expect(view.totalMs).toBe(1_500);
    expect(view.ttftMs).toBeNull();
    expect(view.tokensPerSecond).toBeNull();
    expect(view.samples).toBe(1);
  });

  test("a sample with nothing to record leaves no model behind", () => {
    const perf = new ModelPerf({ now: () => 8_000_000 });
    perf.record("p/a", {});
    expect(perf.view()).toEqual({});
  });

  test("an answer that carried no token count reports latency only", () => {
    const perf = new ModelPerf({ now: () => 5_000_000 });
    perf.record("p/a", { ttftMs: 300, outputTokens: undefined, generationMs: 900, totalMs: 1_200 });
    perf.record("p/b", { ttftMs: 200, outputTokens: 50, generationMs: 10, totalMs: 400 });
    const view = perf.view();
    expect(view["p/a"].ttftMs).toBe(300);
    expect(view["p/a"].tokensPerSecond).toBeNull();
    // 50 tokens in 10 ms is a whole answer in one chunk: count the tokens, but do not invent a speed.
    expect(view["p/b"].tokensPerSecond).toBeNull();
    expect(view["p/b"].tokens).toBe(50);
    expect(view["p/b"].tokenSamples).toBe(1);
    expect(view["p/b"].speedSamples).toBe(0);
  });

  test("samples older than the window are forgotten, and stale models dropped", () => {
    let clock = 10_000_000;
    const perf = new ModelPerf({ now: () => clock });
    perf.record("p/old", { ttftMs: 900, outputTokens: 10, generationMs: 1_000, totalMs: 2_000 });
    clock += PERF_WINDOW_MINUTES * 60_000 + 1_000;
    expect(perf.view()["p/old"]).toBeUndefined();
    perf.record("p/new", { ttftMs: 100, outputTokens: 10, generationMs: 1_000, totalMs: 2_000 });
    expect(Object.keys(perf.view())).toEqual(["p/new"]);
  });

  test("buckets are reused once their minute comes round again", () => {
    let clock = 0;
    const perf = new ModelPerf({ now: () => clock });
    perf.record("p/a", { ttftMs: 100, outputTokens: 10, generationMs: 1_000, totalMs: 2_000 });
    clock += PERF_WINDOW_MINUTES * 60_000;
    perf.record("p/a", { ttftMs: 500, outputTokens: 10, generationMs: 1_000, totalMs: 2_000 });
    // The old sample fell out with its bucket; only the new one counts.
    expect(perf.view()["p/a"].ttftMs).toBe(500);
    expect(perf.view()["p/a"].samples).toBe(1);
  });
  test("persists the rolling window across a restart with private state-file permissions", () => {
    let clock = 12_000_000;
    const statePath = join(tempDir("omp-perf-state-"), "perf.json");
    const first = new ModelPerf({ now: () => clock, statePath });
    first.record("p/a", { ttftMs: 400, outputTokens: 20, generationMs: 1_000, totalMs: 2_000 }, "peak");
    first.record("p/a", { totalMs: 9_000 }, "offPeak");

    const second = new ModelPerf({ now: () => clock, statePath });
    expect(second.view("peak")["p/a"]).toMatchObject({ ttftMs: 400, totalMs: 2_000, samples: 1 });
    expect(second.view("offPeak")["p/a"]).toMatchObject({ totalMs: 9_000, samples: 1 });
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });

  test("expired live data becomes only a weak historical prior, and one fresh sample replaces it", () => {
    let clock = 20_000_000;
    const statePath = join(tempDir("omp-perf-history-"), "perf.json");
    const perf = new ModelPerf({ now: () => clock, statePath });
    perf.record("p/a", { totalMs: 20_000 }, "peak");
    clock += PERF_WINDOW_MINUTES * 60_000 + 1_000;

    expect(perf.view("peak")["p/a"]).toBeUndefined();
    expect(perf.routingView("peak")["p/a"]).toMatchObject({ totalMs: 20_000, samples: 0, historical: true });
    expect(perf.routingView("offPeak")["p/a"]).toBeUndefined();

    perf.record("p/a", { totalMs: 1_000 }, "peak");
    const fresh = perf.routingView("peak")["p/a"];
    expect(fresh.totalMs).toBe(1_000);
    expect(fresh.samples).toBe(1);
    expect(fresh.historical).toBeUndefined();
  });

  test("historical evidence decays and imputed aborts never become historical facts", () => {
    let clock = 30_000_000;
    const perf = new ModelPerf({ now: () => clock, historyHalfLifeMs: 1_000 });
    perf.record("p/real", { totalMs: 4_000 }, "peak");
    perf.record("p/imputed", { totalMs: 8_000, imputed: true }, "peak");
    clock += PERF_WINDOW_MINUTES * 60_000 + 1;
    expect(perf.routingView("peak")["p/imputed"]).toBeUndefined();
    expect(perf.routingView("peak")["p/real"]).toBeUndefined();
  });

});

describe("measureStream", () => {
  test("a streamed answer records latency, tokens and generation time", async () => {
    // One clock reading per streamed chunk: 1_000, 1_500, 3_000.
    const times = [1_000, 1_500, 3_000];
    let index = 0;
    const recorded = [];
    const measure = measureStream({
      model: "p/a",
      startedAt: 400,
      now: () => times[Math.min(index++, times.length - 1)],
      perf: { record: (model, sample) => recorded.push({ model, ...sample }) },
    });
    const response = measure(
      controlledStream([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" there"}}]}\n\n',
        'data: {"usage":{"completion_tokens":50}}\n\n',
      ]),
    );
    const text = await response.text();
    expect(text).toContain('"completion_tokens":50');
    // First chunk at 1_000 against a 400 start, last at 3_000.
    // The clock's last reading is the end of the answer, three seconds in.
    expect(recorded).toEqual([
      { model: "p/a", totalMs: 2_600, ttftMs: 600, outputTokens: 50, speedTokens: 50, generationMs: 500 },
    ]);
  });

  test("a usage frame split across chunks is still read structurally", async () => {
    const recorded = [];
    const measure = measureStream({
      model: "p/a",
      startedAt: 0,
      now: () => 1_000,
      perf: { record: (model, sample) => recorded.push(sample) },
    });
    const response = measure(controlledStream(['data: {"usa', 'ge":{"output_tokens":77}}\n\n']));
    await response.text();
    expect(recorded[0].outputTokens).toBe(77);
  });

  test("a usage-only tail frame does not extend generation time", async () => {
    const times = [1_000, 1_400, 5_000, 5_000];
    let index = 0;
    const recorded = [];
    const response = measureStream({
      model: "p/a",
      startedAt: 500,
      now: () => times[Math.min(index++, times.length - 1)],
      perf: { record: (_model, sample) => recorded.push(sample) },
      classify: ({ data }) => data?.usage || data?.choices?.[0]?.delta?.content ? "progress" : "preamble",
      isOutput: ({ data }) => Boolean(data?.choices?.[0]?.delta?.content),
    })(controlledStream([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      'data: {"usage":{"completion_tokens":100,"completion_tokens_details":{"reasoning_tokens":80}}}\n\n',
    ]));
    await response.text();
    expect(recorded[0]).toMatchObject({ ttftMs: 500, generationMs: 400, outputTokens: 100, speedTokens: 100 });
  });

  test("an answer that is not an event stream is timed, but not measured for speed", async () => {
    const recorded = [];
    const perf = { record: (model, sample) => recorded.push(sample) };
    const plain = new Response('{"usage":{"completion_tokens":9}}', {
      headers: { "content-type": "application/json" },
    });
    const measure = measureStream({ model: "p/a", startedAt: 100, perf, now: () => 900 });
    const wrapped = measure(plain);
    expect(wrapped).not.toBe(plain);
    expect(await wrapped.text()).toBe('{"usage":{"completion_tokens":9}}');
    expect(recorded).toEqual([{ totalMs: 800, outputTokens: 9, speedTokens: 9 }]);

    const bodyless = new Response(null, { status: 204 });
    expect(measure(bodyless)).toBe(bodyless);
  });
});

describe("withUsageRequest", () => {
  const path = "/v1/chat/completions";

  test("a streaming chat body gains the usage request without re-serializing", () => {
    const body = '{"model":"m","stream":true,"messages":[{"role":"user","content":"hi"}]}';
    const next = withUsageRequest(path, body);
    expect(JSON.parse(next)).toEqual({
      stream_options: { include_usage: true },
      model: "m",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  test("an existing stream_options object keeps its own fields", () => {
    const next = withUsageRequest(path, '{"stream":true,"stream_options":{"foo":1}}');
    expect(JSON.parse(next).stream_options).toEqual({ foo: 1, include_usage: true });
  });

  test("an explicit opt-out is turned on rather than duplicated", () => {
    const next = withUsageRequest(path, '{"stream":true,"stream_options":{"include_usage":false}}');
    expect(JSON.parse(next).stream_options).toEqual({ include_usage: true });
  });

  test("nothing changes when it is already asked for, not streaming, or another dialect", () => {
    expect(withUsageRequest(path, '{"stream":true,"stream_options":{"include_usage":true}}')).toBeUndefined();
    expect(withUsageRequest(path, '{"model":"m","stream":false}')).toBeUndefined();
    expect(withUsageRequest("/v1/messages", '{"stream":true}')).toBeUndefined();
    expect(withUsageRequest("/v1/responses", '{"stream":true}')).toBeUndefined();
  });
});


describe("censored completion", () => {
  test("right-censored requests are completed from the rolling posterior", () => {
    const perf = new ModelPerf({ now: () => 1_000_000 });
    for (const ms of [4_000, 5_000, 6_000, 5_500]) perf.record("p/a", { totalMs: ms });
    const estimate = perf.estimateCompletion("p/a", 3_000);
    expect(estimate).toBeGreaterThan(3_000);
    expect(estimate).toBeLessThan(20_000);
    perf.record("p/a", { totalMs: estimate, imputed: true });
    expect(perf.view()["p/a"].imputedSamples).toBe(1);
  });

  test("an unseen model borrows the rolling population instead of a fixed latency prior", () => {
    const fast = new ModelPerf({ now: () => 1_000_000 });
    const slow = new ModelPerf({ now: () => 1_000_000 });
    for (const ms of [900, 1_000, 1_200]) fast.record("p/other", { totalMs: ms });
    for (const ms of [18_000, 20_000, 22_000]) slow.record("p/other", { totalMs: ms });
    const fastEstimate = fast.estimateCompletion("p/new", 500);
    const slowEstimate = slow.estimateCompletion("p/new", 500);
    expect(fastEstimate).toBeGreaterThan(500);
    expect(slowEstimate).toBeGreaterThan(fastEstimate);
  });

  test("an empty system centers the diffuse prior on elapsed time, not a fixed number", () => {
    const perf = new ModelPerf({ now: () => 1_000_000 });
    const short = perf.estimateCompletion("p/new", 500);
    const long = perf.estimateCompletion("p/new", 5_000);
    expect(long / short).toBeCloseTo(10, 1);
  });

  test("an abort records one Bayesian-completed total", async () => {
    const controller = new AbortController();
    const recorded = [];
    const perf = {
      estimateCompletion: (_model, elapsed) => elapsed + 7_000,
      record: (_model, sample) => recorded.push(sample),
    };
    const wrapped = measureStream({ model: "p/a", startedAt: 1_000, perf, signal: controller.signal, now: () => 3_000 })(
      controlledStream(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n']),
    );
    controller.abort();
    await wrapped.body.cancel();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ totalMs: 9_000, imputed: true });
  });
});


describe("period-isolated performance evidence", () => {
  test("peak and off-peak keep independent windows for the same model", () => {
    const perf = new ModelPerf({ now: () => 1_000_000 });
    perf.record("ctyun/deepseek-v4-pro-0813-oc", { totalMs: 20_000, ttftMs: 12_000 }, "peak");
    perf.record("ctyun/deepseek-v4-pro-0813-oc", { totalMs: 2_000, ttftMs: 700 }, "offPeak");
    expect(perf.view("peak")["ctyun/deepseek-v4-pro-0813-oc"]).toMatchObject({ totalMs: 20_000, ttftMs: 12_000, samples: 1 });
    expect(perf.view("offPeak")["ctyun/deepseek-v4-pro-0813-oc"]).toMatchObject({ totalMs: 2_000, ttftMs: 700, samples: 1 });
  });

  test("censored completion never borrows its population prior across periods", () => {
    const perf = new ModelPerf({ now: () => 1_000_000 });
    for (const ms of [800, 900, 1_000]) perf.record("p/fast-offpeak", { totalMs: ms }, "offPeak");
    const isolated = perf.estimateCompletion("p/new", 500, "peak");
    const empty = new ModelPerf({ now: () => 1_000_000 }).estimateCompletion("p/new", 500, "peak");
    expect(isolated).toBeCloseTo(empty, 8);
  });

  test("measureStream records and imputes into the request-start period", async () => {
    const controller = new AbortController();
    const calls = [];
    const perf = {
      estimateCompletion: (model, elapsed, period) => (calls.push(["estimate", model, period]), elapsed + 1_000),
      record: (model, sample, period) => calls.push(["record", model, period, sample]),
    };
    const wrapped = measureStream({
      model: "p/a", startedAt: 1_000, period: "peak", perf, signal: controller.signal, now: () => 2_000,
    })(controlledStream(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n']));
    controller.abort();
    await wrapped.body.cancel();
    expect(calls[0]).toEqual(["estimate", "p/a", "peak"]);
    expect(calls[1].slice(0, 3)).toEqual(["record", "p/a", "peak"]);
  });
});
