import { describe, expect, test } from "bun:test";
import { CLIENT_CLOSED_STATUS, classifyFailure, FAILURE } from "../lib/lazy-router/failures.js";

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
});
