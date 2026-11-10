// A direct model call owns the provider call. A provider retry layer may throw
// an account-quota error instead of returning a Response. The inbound guard
// must turn that into one generic 503 before it reaches the client.

import { describe, expect, test } from "bun:test";
import { lazyRouterHandler } from "../features/lazy-router.mjs";

const QUOTA_ERROR =
  'Retry failed after 1 attempts: Provider requested 50126635ms waits; exceeds retry.maxDelayMs (300000ms). Original error: Cloud Code Assist API error (429): {"error":{"code":429,"message":"Individual quota reached. Please upgrade your subscription to increase your limits.","status":"RESOURCE_EXHAUSTED","model":"claude-opus-5-5-medium","quotaResetDelay":"13h55m26.634700152s"}}';

function handlerFor(next) {
  const router = {
    handles: () => false,
    catalog: { host: new Map(), gateway: new Map(), hasNativeModel: () => false },
    measureDirect: (_model, response) => response,
  };
  return lazyRouterHandler({
    router,
    dispatcher: { bind() {} },
    statusPage: () => undefined,
    credentials: {},
    config: {},
    paths: { gatewayTokenPath: "/nonexistent/omp-gateway.token" },
  })(
    new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "google-antigravity/claude-opus-5-5", messages: [] }),
    }),
    {},
    next,
  );
}

describe("direct thrown quota guard", () => {
  test("a thrown provider retry failure becomes one generic 503", async () => {
    const response = await handlerFor(async () => {
      throw new Error(QUOTA_ERROR);
    });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { type: "lazy_router_unavailable", message: "no healthy candidate could serve this request" },
    });
    for (const leaked of ["cloud code assist", "individual quota", "claude-opus", "429", "retry", "upgrade"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
  });
});
