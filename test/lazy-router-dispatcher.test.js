import { describe, expect, test } from "bun:test";
import { Attempt, VERDICT_SOURCE } from "../lib/lazy-router/attempt.js";
import { GatewayDispatcher } from "../lib/lazy-router/dispatcher.js";
import { classifyFailure, FAILURE } from "../lib/lazy-router/failures.js";
import { FORMATS } from "../lib/lazy-router/formats.js";

const CHAT = FORMATS["/v1/chat/completions"];
const encoder = new TextEncoder();
const qoderUnit = { key: "qoder", label: "qoder", provider: "qoder-cn" };

function responseFrom(parts) {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= parts.length) return controller.close();
        controller.enqueue(encoder.encode(parts[index++]));
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

function dispatcherFor(parts, unit = qoderUnit, model = "qoder-cn/qwen3.8-flash") {
  const attempt = new Attempt({ unit, model });
  const dispatcher = new GatewayDispatcher({ tokenPath: "/nonexistent", headerTimeoutMs: 1_000 });
  dispatcher.bind(async () => {
    // Exact production shape: the plugin/provider call has already returned HTTP 200,
    // but the model transport may still emit an SSE error before any model output.
    attempt.contacted = true;
    attempt.settle({ ok: true, status: 200, source: VERDICT_SOURCE.UPSTREAM });
    return responseFrom(parts);
  }, null);
  return { attempt, dispatcher };
}

const request = () => new Request("http://gateway.test/v1/chat/completions", { method: "POST", body: "{}" });

describe("GatewayDispatcher SSE guard", () => {
  test("a Qoder error after HTTP 200 but before model output is an attempt failure, not downstream text", async () => {
    const { attempt, dispatcher } = dispatcherFor([
      'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"error":{"message":"[Qoder CN 额度限制] 今日调用次数已达上限 (Billing daily count exceeded, 错误码 110)","type":"upstream_error"}}\n\n',
    ]);
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.response).toBeUndefined();
    expect(outcome.verdict).toMatchObject({ ok: false, status: 502, source: VERDICT_SOURCE.STREAM });
    expect(outcome.verdict.message).toContain("错误码 110");
    expect(classifyFailure(outcome)).toBe(FAILURE.QUOTA);
  });

  test("holding through the role preamble replays every byte once real output arrives", async () => {
    const role = 'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n';
    const text = 'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n';
    const done = 'data: [DONE]\n\n';
    const { attempt, dispatcher } = dispatcherFor([role, text, done]);
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.verdict.ok).toBe(true);
    expect(await outcome.response.text()).toBe(role + text + done);
  });

  test("a Cline 200 stream error is held and fails before reaching downstream", async () => {
    const clineUnit = { key: "cline/1", label: "cline-pass#1", provider: "cline-pass" };
    const { attempt, dispatcher } = dispatcherFor(
      [
        'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"error":{"message":"User Provided API Key Rate Limit Exceeded","type":"upstream_error"}}\n\n',
      ],
      clineUnit,
      "cline-pass/glm-5.3-flash",
    );
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.response).toBeUndefined();
    expect(outcome.verdict).toMatchObject({ ok: false, status: 502, source: VERDICT_SOURCE.STREAM });
    expect(classifyFailure(outcome)).toBe(FAILURE.QUOTA);
  });

  test("Cline quota text split across ordinary content deltas never leaks a prefix", async () => {
    const clineUnit = { key: "cline/2", label: "cline-pass#2", provider: "cline-pass" };
    const { attempt, dispatcher } = dispatcherFor(
      [
        'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"User Provided API Key "},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Rate Limit Exceeded"},"finish_reason":null}]}\n\n',
      ],
      clineUnit,
      "cline-pass/glm-5.3-flash",
    );
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.response).toBeUndefined();
    expect(outcome.verdict.message).toBe("User Provided API Key Rate Limit Exceeded");
    expect(classifyFailure(outcome)).toBe(FAILURE.QUOTA);
  });

  test("CTYun Coding Plan quota text split across content deltas fails before any prefix can leak", async () => {
    const ctyunUnit = { key: "ctyun", label: "ctyun", provider: "ctyun" };
    const { attempt, dispatcher } = dispatcherFor(
      [
        'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"您的Coding Plan套餐的额"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"度已用完！\\n请等待周期时间刷新"},"finish_reason":null}]}\n\n',
      ],
      ctyunUnit,
      "ctyun/glm-5.3-oc",
    );
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.response).toBeUndefined();
    expect(outcome.verdict).toMatchObject({ ok: false, status: 502, source: VERDICT_SOURCE.STREAM });
    expect(outcome.verdict.message).toBe("ctyun coding-plan quota exhausted");
    expect(classifyFailure(outcome)).toBe(FAILURE.QUOTA);
  });

  test("CTYun non-streaming 200 quota content is a failure, not a successful answer", async () => {
    const unit = { key: "ctyun", label: "ctyun", provider: "ctyun" };
    const attempt = new Attempt({ unit, model: "ctyun/glm-5.3-oc" });
    const dispatcher = new GatewayDispatcher({ tokenPath: "/nonexistent", headerTimeoutMs: 1_000 });
    dispatcher.bind(async () => {
      attempt.contacted = true;
      attempt.settle({ ok: true, status: 200, source: VERDICT_SOURCE.UPSTREAM });
      return Response.json({
        choices: [{ message: { role: "assistant", content: "您的Coding Plan套餐的额度已用完！\n请等待周期时间刷新" } }],
      });
    }, null);
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.response).toBeUndefined();
    expect(outcome.verdict).toMatchObject({ ok: false, status: 502, source: VERDICT_SOURCE.GATEWAY });
    expect(outcome.verdict.message).toBe("ctyun coding-plan quota exhausted");
    expect(classifyFailure(outcome)).toBe(FAILURE.QUOTA);
  });

  test("a normal Cline answer sharing the sentinel prefix is replayed byte-for-byte", async () => {
    const clineUnit = { key: "cline/1", label: "cline-pass#1", provider: "cline-pass" };
    const role = 'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n';
    const first = 'data: {"choices":[{"delta":{"content":"User Provided API Key "},"finish_reason":null}]}\n\n';
    const second = 'data: {"choices":[{"delta":{"content":"configuration looks valid."},"finish_reason":null}]}\n\n';
    const done = 'data: [DONE]\n\n';
    const { attempt, dispatcher } = dispatcherFor(
      [role, first, second, done],
      clineUnit,
      "cline-pass/glm-5.3-flash",
    );
    const outcome = await dispatcher.run(attempt, request(), { format: CHAT });
    expect(outcome.verdict.ok).toBe(true);
    expect(await outcome.response.text()).toBe(role + first + second + done);
  });
});
