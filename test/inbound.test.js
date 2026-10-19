import { describe, expect, test } from "bun:test";
import { readBody, withInboundRewrite } from "../lib/inbound.js";

const echo = async (request) => new Response(`${request.method} ${await request.text()}`);

describe("withInboundRewrite", () => {
  test("hands the handler the rewritten body", async () => {
    const handler = withInboundRewrite(echo, (body) => body.toUpperCase());
    const response = await handler(new Request("http://x/", { method: "POST", body: "abc" }));
    expect(await response.text()).toBe("POST ABC");
  });

  test("passes the original request through when nothing changes", async () => {
    const request = new Request("http://x/", { method: "POST", body: "abc" });
    let received;
    const handler = withInboundRewrite(
      (r) => {
        received = r;
        return new Response();
      },
      () => undefined,
    );
    await handler(request);
    expect(received).toBe(request);
  });

  test("never rejects a request because the rewrite threw", async () => {
    const handler = withInboundRewrite(echo, () => {
      throw new Error("boom");
    });
    const response = await handler(new Request("http://x/", { method: "POST", body: "abc" }));
    expect(await response.text()).toBe("POST abc");
  });

  test("GET and HEAD bodies are not read", async () => {
    expect(await readBody(new Request("http://x/"))).toBeUndefined();
  });
});
