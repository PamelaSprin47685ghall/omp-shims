// Account-status replies must classify as quota or credential even when the
// transport never observed a provider contact. Only a malformed 400 is a
// request error.

import { describe, expect, test } from "bun:test";
import { classifyFailure, FAILURE } from "../lib/router/failures.mjs";

function outcome(status, { contacted = false, ...verdict } = {}) {
  return {
    upstreamContacted: contacted,
    verdict: { status, source: "gateway", message: `upstream ${status}`, ...verdict },
  };
}

describe("failure classification for account statuses", () => {
  test("402 is quota with and without provider contact", () => {
    expect(classifyFailure(outcome(402))).toBe(FAILURE.QUOTA);
    expect(classifyFailure(outcome(402, { contacted: true }))).toBe(FAILURE.QUOTA);
  });

  test("401 and 403 are credential failures", () => {
    expect(classifyFailure(outcome(401))).toBe(FAILURE.CREDENTIAL);
    expect(classifyFailure(outcome(403))).toBe(FAILURE.CREDENTIAL);
    expect(classifyFailure(outcome(403, { contacted: true }))).toBe(FAILURE.CREDENTIAL);
  });

  test("429 is a quota failure, never a request error", () => {
    expect(classifyFailure(outcome(429))).toBe(FAILURE.QUOTA);
    expect(classifyFailure(outcome(429, { contacted: true }))).toBe(FAILURE.QUOTA);
  });

  test("quota wording wins even on a 400", () => {
    expect(classifyFailure(outcome(400, { category: "quota" }))).toBe(FAILURE.QUOTA);
  });

  test("only a malformed 400 is a request error", () => {
    expect(classifyFailure(outcome(400))).toBe(FAILURE.REQUEST);
    expect(classifyFailure(outcome(413))).not.toBe(FAILURE.REQUEST);
    expect(classifyFailure(outcome(422))).not.toBe(FAILURE.REQUEST);
  });
});
