// Contract tests for the v2 gateway-compat edge feature.
//
// The pure rule is checked directly. The installed layer is checked through a
// real Bun.serve on port 0: only a real request proves the inbound middleware
// reaches the gateway with the rewritten body.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { install, normalizeOptionalNulls } from "../features/gateway-compat.mjs";
import { dispose as disposeInbound } from "../lib/inbound.mjs";

const originalArgv = process.argv.slice();
process.argv.push("auth-gateway", "serve");

/** Servers and disposers created by one test. */
const servers = [];
const disposers = [];

function serve(fetchImpl) {
  const server = Bun.serve({ port: 0, fetch: fetchImpl });
  servers.push(server);
  return server;
}

function urlFor(server, pathname = "/") {
  return `http://127.0.0.1:${server.port}${pathname}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  for (const dispose of disposers.splice(0).reverse()) await dispose();
  disposeInbound();
});

afterAll(() => {
  process.argv = originalArgv.slice();
  disposeInbound();
});

describe("normalizeOptionalNulls", () => {
  test.each(["/v1/chat/completions", "/v1/responses", "/v1/messages"])(
    "drops only tools and metadata null on %s",
    (pathname) => {
      const body = {
        tools: null,
        metadata: null,
        messages: [{ role: "assistant", content: null }],
        temperature: 0,
        tool_choice: null,
      };
      expect(normalizeOptionalNulls(pathname, body)).toBe(true);
      expect(Object.hasOwn(body, "tools")).toBe(false);
      expect(Object.hasOwn(body, "metadata")).toBe(false);
      expect(body.messages[0].content).toBeNull();
      expect(body.tool_choice).toBeNull();
      expect(body.temperature).toBe(0);
    },
  );

  test("keeps explicit empty arrays, objects, and unknown nulls", () => {
    const body = { tools: [], metadata: {}, tool_choice: null };
    expect(normalizeOptionalNulls("/v1/chat/completions", body)).toBe(false);
    expect(body).toEqual({ tools: [], metadata: {}, tool_choice: null });
  });

  test("ignores other paths, array bodies, and null bodies", () => {
    for (const pathname of ["/private", "/v1/models", "/v1/embeddings"]) {
      expect(normalizeOptionalNulls(pathname, { tools: null })).toBe(false);
    }
    expect(normalizeOptionalNulls("/v1/chat/completions", [null])).toBe(false);
    expect(normalizeOptionalNulls("/v1/chat/completions", null)).toBe(false);
    expect(normalizeOptionalNulls("/v1/chat/completions", "null")).toBe(false);
  });
});

describe("installed inbound layer", () => {
  test("removes the null optionals and leaves nested null content alone", async () => {
    disposers.push(await install({}, {}));
    const server = serve(
      async (request) =>
        new Response(await request.text(), {
          headers: { "content-type": "application/json" },
        }),
    );

    const sent = {
      model: "mistral/deepseek-v4-1-flash-1017",
      messages: [
        { role: "system", content: "Synthetic text." },
        { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function" }] },
        { role: "tool", tool_call_id: "call_1", content: null },
      ],
      tools: null,
      metadata: null,
      temperature: 0,
      stream: false,
    };
    const response = await fetch(urlFor(server, "/v1/chat/completions"), {
      method: "POST",
      body: JSON.stringify(sent),
    });
    const got = await response.json();

    expect(Object.hasOwn(got, "tools")).toBe(false);
    expect(Object.hasOwn(got, "metadata")).toBe(false);
    expect(got.messages).toEqual(sent.messages);
    expect(got.temperature).toBe(0);
    expect(got.stream).toBe(false);
  });

  test("a malformed body reaches the gateway byte for byte", async () => {
    disposers.push(await install({}, {}));
    const server = serve(async (request) => new Response(await request.text()));
    const response = await fetch(urlFor(server, "/v1/chat/completions"), {
      method: "POST",
      body: "{not json",
    });
    expect(await response.text()).toBe("{not json");
  });

  test("other paths and non-POST requests are untouched", async () => {
    disposers.push(await install({}, {}));
    const server = serve(async (request) => new Response(await request.text()));
    for (const pathname of ["/v1/models", "/v1/embeddings"]) {
      const response = await fetch(urlFor(server, pathname), {
        method: "POST",
        body: JSON.stringify({ tools: null }),
      });
      expect(JSON.parse(await response.text())).toEqual({ tools: null });
    }
    const get = await fetch(urlFor(server, "/v1/chat/completions"));
    expect(await get.text()).toBe("");
  });

  test("a second install returns the same disposer and adds one layer", async () => {
    const first = await install({}, {});
    const second = await install({}, {});
    expect(second).toBe(first);
    disposers.push(first);

    // The single layer still normalizes exactly once.
    const server = serve(
      async (request) =>
        new Response(await request.text(), {
          headers: { "content-type": "application/json" },
        }),
    );
    const response = await fetch(urlFor(server, "/v1/messages"), {
      method: "POST",
      body: JSON.stringify({ tools: null, metadata: null, messages: [] }),
    });
    expect(await response.json()).toEqual({ messages: [] });
  });
});
