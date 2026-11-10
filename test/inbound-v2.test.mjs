// Contract tests for the inbound pipeline.
//
// One Bun.serve wrapper per process, priority order with a per-request
// snapshot, failure isolation, and the request body store. The server tests use
// a real Bun.serve on port 0: the wrapper lives in Bun.serve itself, so only a
// real request proves it.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import * as inbound from "../lib/inbound.mjs";

const realServe = Bun.serve;
const servers = [];

/** Start a throwaway server on an ephemeral port. */
function serve(fetchImpl) {
  const server = Bun.serve({ port: 0, fetch: fetchImpl });
  servers.push(server);
  return server;
}

/** The local URL of a throwaway server. */
function urlFor(server) {
  return `http://127.0.0.1:${server.port}/`;
}

/** Keep expected failure logs out of the test output. */
function silenceReport() {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  inbound.dispose();
});

afterAll(() => {
  inbound.dispose();
  expect(Bun.serve).toBe(realServe);
});

describe("single Bun.serve wrapper", () => {
  test("installs once, never double-wraps, and restores on the last dispose", () => {
    const disposeFirst = inbound.addInboundMiddleware(async (_request, _server, next) => next(), {
      name: "first",
      priority: 10,
    });
    const patched = Bun.serve;
    expect(patched).not.toBe(realServe);

    const disposeSecond = inbound.addInboundMiddleware(async (_request, _server, next) => next(), {
      name: "second",
      priority: 20,
    });
    expect(Bun.serve).toBe(patched);

    disposeSecond();
    expect(Bun.serve).toBe(patched);

    disposeFirst();
    expect(Bun.serve).toBe(realServe);
  });

  test("dispose() clears every middleware and restores Bun.serve", () => {
    inbound.addInboundMiddleware(async (_request, _server, next) => next(), { priority: 10 });
    inbound.addInboundMiddleware(async (_request, _server, next) => next(), { priority: 20 });
    expect(Bun.serve).not.toBe(realServe);

    inbound.dispose();
    expect(Bun.serve).toBe(realServe);
  });

  test("resetInboundForTests() restores Bun.serve", () => {
    inbound.addInboundMiddleware(async (_request, _server, next) => next(), { priority: 10 });
    expect(Bun.serve).not.toBe(realServe);

    inbound.resetInboundForTests();
    expect(Bun.serve).toBe(realServe);
  });
});

describe("priority order", () => {
  test("a smaller priority runs further out and ties keep registration order", async () => {
    const order = [];
    const dispose = [
      inbound.addInboundMiddleware(
        async (_request, _server, next) => {
          order.push("inner");
          return next();
        },
        { name: "inner", priority: 30 },
      ),
      inbound.addInboundMiddleware(
        async (_request, _server, next) => {
          order.push("outer");
          return next();
        },
        { name: "outer", priority: 10 },
      ),
      inbound.addInboundMiddleware(
        async (_request, _server, next) => {
          order.push("tie");
          return next();
        },
        { name: "tie", priority: 10 },
      ),
    ];
    const server = serve(() => new Response("gateway"));
    try {
      expect(await (await fetch(urlFor(server))).text()).toBe("gateway");
      expect(order).toEqual(["outer", "tie", "inner"]);
    } finally {
      for (const remove of dispose) remove();
    }
  });

  test("the outermost layer sees the raw request and the final response last", async () => {
    const seen = [];
    const dispose = [
      inbound.addInboundMiddleware(
        async (request, _server, next) => {
          seen.push(`outer-in:${new URL(request.url).pathname}`);
          const response = await next();
          seen.push(`outer-out:${response.status}`);
          return response;
        },
        { priority: 10 },
      ),
      inbound.addInboundMiddleware(
        async (_request, _server, next) => {
          seen.push("inner-in");
          const response = await next();
          seen.push(`inner-out:${response.status}`);
          return response;
        },
        { priority: 20 },
      ),
    ];
    const server = serve(() => new Response("gateway", { status: 201 }));
    try {
      await (await fetch(urlFor(server))).text();
      expect(seen).toEqual(["outer-in:/", "inner-in", "inner-out:201", "outer-out:201"]);
    } finally {
      for (const remove of dispose) remove();
    }
  });

  test("a middleware can replace the request and short-circuit the gateway", async () => {
    const dispose = [
      inbound.addInboundMiddleware(
        async (request, _server, next) => {
          const rewritten = new Request(request.url, {
            method: "POST",
            headers: request.headers,
            body: "rewritten",
          });
          return next(rewritten);
        },
        { priority: 10 },
      ),
      inbound.addInboundMiddleware(async () => new Response("short-circuit"), { priority: 20 }),
    ];
    const server = serve(async (request) => new Response(`${request.method}:${await request.text()}`));
    try {
      expect(await (await fetch(urlFor(server))).text()).toBe("short-circuit");
    } finally {
      for (const remove of dispose) remove();
    }
  });
});

describe("mid-flight dispose", () => {
  test("a snapshot keeps a layer that is disposed during the request", async () => {
    let innerCalls = 0;
    let disposeInner;
    const disposeOuter = inbound.addInboundMiddleware(
      async (_request, _server, next) => {
        disposeInner();
        return next();
      },
      { name: "outer", priority: 10 },
    );
    disposeInner = inbound.addInboundMiddleware(
      async (_request, _server, next) => {
        innerCalls += 1;
        return next();
      },
      { name: "inner", priority: 20 },
    );

    const server = serve(() => new Response("gateway"));
    try {
      await (await fetch(urlFor(server))).text();
      await (await fetch(urlFor(server))).text();
      expect(innerCalls).toBe(1);
    } finally {
      disposeOuter();
    }
  });
});

describe("failure isolation", () => {
  test("a sync throw degrades to next", async () => {
    let calls = 0;
    const dispose = inbound.addInboundMiddleware(
      () => {
        calls += 1;
        throw new Error("sync boom");
      },
      { name: "sync-broken", priority: 10 },
    );
    const server = serve(() => new Response("served"));
    const restore = silenceReport();
    try {
      expect(await (await fetch(urlFor(server))).text()).toBe("served");
      expect(calls).toBe(1);
    } finally {
      restore();
      dispose();
    }
  });

  test("an async rejection degrades to next", async () => {
    let calls = 0;
    const dispose = inbound.addInboundMiddleware(
      async () => {
        calls += 1;
        throw new Error("async boom");
      },
      { name: "async-broken", priority: 10 },
    );
    const server = serve(() => new Response("served"));
    const restore = silenceReport();
    try {
      expect(await (await fetch(urlFor(server))).text()).toBe("served");
      expect(calls).toBe(1);
    } finally {
      restore();
      dispose();
    }
  });

  test("a gateway rejection reaches the layer above and is not retried", async () => {
    let gatewayCalls = 0;
    let caught = 0;
    const dispose = inbound.addInboundMiddleware(
      async (_request, _server, next) => {
        try {
          return await next();
        } catch (error) {
          caught += 1;
          return new Response(`caught:${error.message}`);
        }
      },
      { name: "catcher", priority: 10 },
    );
    const server = serve(() => {
      gatewayCalls += 1;
      throw new Error("gateway-down");
    });
    const restore = silenceReport();
    try {
      const response = await fetch(urlFor(server));
      expect(await response.text()).toBe("caught:gateway-down");
      expect(caught).toBe(1);
      expect(gatewayCalls).toBe(1);
    } finally {
      restore();
      dispose();
    }
  });
});

describe("BodyStore", () => {
  test("reads and parses a body once per logical Request", async () => {
    const originalClone = Request.prototype.clone;
    let clones = 0;
    Request.prototype.clone = function clone() {
      clones += 1;
      return originalClone.call(this);
    };
    try {
      const request = new Request("http://x/", { method: "POST", body: '{"a":1}' });
      const first = await inbound.readJson(request);
      const second = await inbound.readJson(request);
      expect(first).toEqual({ a: 1 });
      expect(second).toBe(first);
      expect(await inbound.readBody(request)).toBe('{"a":1}');
      expect(clones).toBe(1);
    } finally {
      Request.prototype.clone = originalClone;
    }
  });

  test("GET and HEAD requests have no body", async () => {
    expect(await inbound.readBody(new Request("http://x/"))).toBeUndefined();
    expect(await inbound.readBody(new Request("http://x/", { method: "HEAD" }))).toBeUndefined();
  });

  test("decompresses gzip, deflate, and zstd request bodies", async () => {
    const payload = '{"model":"lazy/task","stream":true}';
    const cases = [
      ["gzip", gzipSync],
      ["deflate", deflateSync],
      ["zstd", zstdCompressSync],
    ];
    for (const [encoding, compress] of cases) {
      const request = new Request("http://x/v1/chat/completions", {
        method: "POST",
        headers: { "content-encoding": encoding },
        body: compress(Buffer.from(payload)),
      });
      expect(await inbound.readBody(request)).toBe(payload);
      expect(await inbound.readJson(request)).toEqual({ model: "lazy/task", stream: true });
    }
  });

  test("withBody strips content-length and content-encoding", async () => {
    const controller = new AbortController();
    const request = new Request("http://x/v1/chat", {
      method: "POST",
      headers: { "content-encoding": "gzip", "content-length": "3", "x-keep": "1" },
      body: "old",
      signal: controller.signal,
    });
    const next = inbound.withBody(request, '{"b":2}', { b: 2 });

    expect(next.method).toBe("POST");
    expect(next.url).toBe("http://x/v1/chat");
    expect(next.headers.get("content-length")).toBeNull();
    expect(next.headers.get("content-encoding")).toBeNull();
    expect(next.headers.get("x-keep")).toBe("1");
    expect(next.signal).toBe(controller.signal);
    expect(await inbound.readBody(next)).toBe('{"b":2}');
    expect(await inbound.readJson(next)).toEqual({ b: 2 });
  });

  test("setBodyCache merges a sibling field instead of clobbering it", async () => {
    const request = new Request("http://x/", { method: "POST", body: '{"a":1}' });
    inbound.setBodyCache(request, { text: '{"a":1}' });
    inbound.setBodyCache(request, { json: { a: 1 } });
    expect(await inbound.readBody(request)).toBe('{"a":1}');
    expect(await inbound.readJson(request)).toEqual({ a: 1 });
  });
});
