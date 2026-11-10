// A direct model call bypasses the Lazy Router. Its provider quota body must
// still be replaced before it reaches the client.

import { describe, expect, test } from "bun:test";
import { sanitizeDirectError, sanitizeDirectResponse } from "../lib/router/direct-guard.mjs";

const QUOTA_BODY = "402 You're out of credits. Add more at https://hyper.charm.land (type=billing_error)";

function json(status, payload) {
  return Response.json(payload, { status });
}

describe("direct quota guard", () => {
  test("a 402 billing body becomes one generic 503", async () => {
    const events = [];
    const response = await sanitizeDirectResponse(json(402, { error: { message: QUOTA_BODY } }), {
      report: (event, detail) => events.push({ event, ...detail }),
    });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { type: "lazy_router_unavailable", message: "no healthy candidate could serve this request" },
    });
    for (const leaked of ["charm", "credits", "billing", "hyper.charm.land", "402"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
    expect(events).toEqual([{ event: "direct upstream quota response sanitized", status: 402 }]);
  });

  test("a 401 with billing wording is sanitized", async () => {
    const response = await sanitizeDirectResponse(json(401, { error: { message: "out of credits" } }));
    expect(response.status).toBe(503);
  });

  test("a 429 with quota wording is sanitized", async () => {
    const response = await sanitizeDirectResponse(json(429, { error: { message: "quota exhausted" } }));
    expect(response.status).toBe(503);
  });

  test("a genuine 401 keeps its original response", async () => {
    const original = json(401, { error: { message: "invalid api key" } });
    const response = await sanitizeDirectResponse(original);
    expect(response).toBe(original);
    expect(response.status).toBe(401);
  });

  test("a 429 rate limit without quota wording keeps its response", async () => {
    const original = json(429, { error: { message: "slow down" } });
    const response = await sanitizeDirectResponse(original);
    expect(response).toBe(original);
  });

  test("a successful response is untouched", async () => {
    const original = json(200, { ok: true });
    const response = await sanitizeDirectResponse(original);
    expect(response).toBe(original);
  });
});

describe("direct thrown quota guard", () => {
  const thrown = () =>
    new Error(
      'Retry failed after 1 attempts: Provider requested 50126635ms waits; exceeds retry.maxDelayMs (300000ms). Original error: Cloud Code Assist API error (429): {"error":{"code":429,"message":"Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 13h55m26s.","status":"RESOURCE_EXHAUSTED","model":"claude-opus-5-5-medium","quotaResetDelay":"13h55m26.634700152s"}}',
    );

  test("a thrown gateway retry failure becomes one generic 503", async () => {
    const events = [];
    const response = sanitizeDirectError(thrown(), {
      report: (event, detail) => events.push({ event, ...detail }),
    });
    expect(response).toBeInstanceOf(Response);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { type: "lazy_router_unavailable", message: "no healthy candidate could serve this request" },
    });
    for (const leaked of [
      "cloud code assist",
      "individual quota",
      "claude-opus",
      "429",
      "resource_exhausted",
      "retry",
      "upgrade",
    ]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
    expect(events).toEqual([{ event: "direct upstream quota error sanitized", status: 429 }]);
  });

  test("a non-account thrown failure stays available to the normal error path", () => {
    expect(sanitizeDirectError(new Error("connection reset"))).toBeUndefined();
  });
});

function sse(frames) {
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("direct stream quota guard", () => {
  test("a 200 stream that carries a 429 error frame becomes one generic 503", async () => {
    const response = sse([
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
      'data: {"error":{"message":"Cloud Code Assist API error (429): individual quota reached","type":"upstream_error"}}\n\n',
    ]);
    const safe = await sanitizeDirectResponse(response);
    const text = await safe.text();
    expect(safe.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { type: "lazy_router_unavailable", message: "no healthy candidate could serve this request" },
    });
    for (const leaked of ["cloud code assist", "individual quota", "429", "upstream_error"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
  });

  test("a 200 stream with visible content is preserved", async () => {
    const response = sse([
      'data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n',
    ]);
    const safe = await sanitizeDirectResponse(response);
    expect(safe.status).toBe(200);
    expect(await safe.text()).toContain('"content":"hello"');
  });
});
