import { describe, expect, test } from "bun:test";
import { CLIENT_CLOSED_STATUS, classifyFailure, FAILURE, requestContextRequirement } from "../lib/lazy-router/failures.js";

const outcome = (verdict, upstreamContacted = true) => ({ verdict: { ok: false, ...verdict }, upstreamContacted });
const aborted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("classifyFailure", () => {
  test("a closed client wins over anything the attempt reported", () => {
    expect(classifyFailure(outcome({ status: 429, source: "upstream" }), aborted())).toBe(FAILURE.CLIENT_GONE);
    expect(classifyFailure(outcome({ status: CLIENT_CLOSED_STATUS, source: "gateway" }))).toBe(FAILURE.CLIENT_GONE);
  });

  test("socket errors before any answer are stale connections", () => {
    for (const message of [
      "The connection was closed.",
      "ECONNRESET: The socket connection was closed unexpectedly. For more information, pass `verbose: true`",
      "socket hang up",
    ]) {
      expect(classifyFailure(outcome({ status: 502, source: "network", message }))).toBe(FAILURE.STALE_CONNECTION);
    }
  });

  test("a socket error that never reached upstream, or a refused connection, is the unit's", () => {
    expect(
      classifyFailure(outcome({ status: 502, source: "network", message: "The connection was closed." }, false)),
    ).toBe(FAILURE.UNIT);
    expect(
      classifyFailure(outcome({ status: 502, source: "network", message: "ECONNREFUSED: Unable to connect" })),
    ).toBe(FAILURE.UNIT);
  });

  test("exhausted quotas are recognised by status or wording, whatever status wraps them", () => {
    expect(classifyFailure(outcome({ status: 402, source: "upstream" }))).toBe(FAILURE.QUOTA);
    for (const message of [
      "[Qoder CN 额度限制] 今日调用次数已达上限 (Billing daily count exceeded, 错误码 110)",
      '{"error":{"code":"insufficient_quota"}}',
      "You exceeded your current quota, please check your plan",
      "User Provided API Key Rate Limit Exceeded",
    ]) {
      expect(classifyFailure(outcome({ status: 502, source: "gateway", message }))).toBe(FAILURE.QUOTA);
    }
  });

  test("plain rate limits and server errors stay with the probe", () => {
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: '{"error":"quota"}' }))).toBe(
      FAILURE.UNIT,
    );
    expect(classifyFailure(outcome({ status: 503, source: "upstream", message: "overloaded" }))).toBe(FAILURE.UNIT);
  });

  test("temporary limits receive a short probe, while quota and unknown 429 stay unchanged", () => {
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "Too Many Requests" }), undefined, "mistral-vibe")).toBe(FAILURE.THROTTLE);
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "Monthly usage limit reached" }), undefined, "mistral-vibe")).toBe(FAILURE.QUOTA);
    expect(classifyFailure(outcome({ status: 402, source: "upstream", message: "Vibe budget exhausted" }), undefined, "mistral-vibe")).toBe(FAILURE.QUOTA);
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "requests per minute limit" }), undefined, "ollama-cloud")).toBe(FAILURE.THROTTLE);
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "Too Many Requests" }), undefined, "openai-codex")).toBe(FAILURE.UNIT);
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "Too Many Requests" }, false), undefined, "mistral-vibe")).toBe(FAILURE.UNIT);
    expect(classifyFailure(outcome({ status: 429, source: "upstream", message: "User Provided API Key Rate Limit Exceeded" }), undefined, "cline-pass")).toBe(FAILURE.QUOTA);
  });

  test("qoder's reformatted quota codes cool the unit without a probe", () => {
    for (const message of [
      "[Qoder quota limit] Daily call allowance exhausted (Billing daily count exceeded, code 110)",
      "[Qoder enterprise quota] The organization's credit pool is exhausted (code 116)",
      "[Qoder model free tier] This model's free daily trial allowance is used up (code 119)",
    ]) {
      expect(classifyFailure(outcome({ status: 429, source: "upstream", message }))).toBe(FAILURE.QUOTA);
    }
  });

  test("qoder hard capacity is account-scoped and cools immediately without a probe", () => {
    const message =
      "[Qoder CN 无可用容量] 网关回 serviceAvailable:false（子码 RESOURCE_LIMIT，队列长度 0，优先级通道 p3，模型 qfmodel）";
    expect(classifyFailure(outcome({ status: 502, source: "stream", message }))).toBe(FAILURE.QUOTA);
  });

  test("a provider plugin crash cools the unit instead of probing it again", () => {
    for (const message of [
      "undefined is not an object (evaluating 'e.content.length')",
      'No transport registered for api "openai-responses". The provider plugin must be loaded before streaming.',
    ]) {
      expect(classifyFailure(outcome({ status: 502, source: "stream", message }))).toBe(FAILURE.QUOTA);
    }
  });

  test("bad-request semantics belong to the request, even when a plugin wraps upstream 400 as stream 502", () => {
    expect(
      classifyFailure(outcome({
        status: 400,
        source: "upstream",
        message: 'The input token count exceeds the maximum number of tokens allowed (1048576).',
      })),
    ).toBe(FAILURE.REQUEST);
    expect(
      classifyFailure(outcome({
        status: 502,
        source: "stream",
        message: 'Upstream status 400: {"code":"provider_error","details":"invalid_parameter_error"}',
      })),
    ).toBe(FAILURE.REQUEST);
    expect(
      classifyFailure(outcome({
        status: 400,
        source: "upstream",
        message: '{"error":{"type":"invalid_request_error","message":"Invalid input. Please review your request before trying again."}}',
      })),
    ).toBe(FAILURE.REQUEST);
  });

  test("context rejections expose the minimum window a later model must clear", () => {
    expect(requestContextRequirement("The input token count exceeds the maximum number of tokens allowed (1048576)."))
      .toBe(1048577);
    expect(
      requestContextRequirement(
        "This model's maximum context length is 1048576 tokens. However, your messages resulted in 2275691 tokens.",
      ),
    ).toBe(2275691);
    expect(requestContextRequirement("invalid_parameter_error")).toBe(0);
  });
});
