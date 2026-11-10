// Contract tests for the v2 ipv6-first outbound feature.
//
// The OS interface scan and DNS lookup are mocked, so the address-order and
// init-preservation contract is testable without a real AAAA record. The
// critical regression is the (Request, init) shape: a rewritten Request must
// not lose its body or downgrade to GET.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { gzipSync } from "node:zlib";

let lookups = 0;

mock.module("node:os", () => ({
  networkInterfaces: () => ({
    eth0: [{ family: "IPv6", internal: false, address: "2001:db8::1" }],
  }),
}));

mock.module("node:dns/promises", () => ({
  lookup: async () => {
    lookups += 1;
    return [
      { address: "2001:db8::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ];
  },
}));

const { install } = await import("../features/ipv6-first.mjs?contract-test");

const disposers = [];

beforeEach(() => {
  lookups = 0;
});

/** Install with a context that records the fetch handler. */
async function installHandler(config = {}) {
  const handlers = [];
  const dispose = await install(config, {
    log: () => {},
    addFetchHandler(handler) {
      handlers.push(handler);
      return () => handlers.splice(handlers.indexOf(handler), 1);
    },
  });
  disposers.push(dispose);
  return handlers[0];
}

/** A next function that records calls and fails the first attempt. */
function fallbackNext() {
  const calls = [];
  const next = async (input, init) => {
    calls.push({ input, init });
    if (calls.length === 1) throw new Error("first address refused");
    return new Response("ok");
  };
  return { calls, next };
}

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

afterAll(() => {
  mock.restore();
});

describe("(Request, init) shape", () => {
  test("keeps method, body, headers, signal, and the full init across the fallback", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    const controller = new AbortController();
    const request = new Request("http://example.test/path?q=1", {
      method: "POST",
      headers: { "x-request": "1" },
      body: "alpha",
      signal: controller.signal,
      redirect: "manual",
      credentials: "include",
      mode: "cors",
      cache: "no-store",
    });
    const { calls, next } = fallbackNext();

    const response = await handler(request, {}, next);

    expect(calls).toHaveLength(2);
    expect(calls[0].input).toContain("[2001:db8::1]");
    expect(calls[1].input).toContain("127.0.0.1");

    const [first, second] = calls;
    expect(first.init.method).toBe("POST");
    expect(first.init.headers.get("x-request")).toBe("1");
    expect(first.init.headers.get("host")).toBe("example.test");
    expect(first.init.signal).toBe(controller.signal);
    expect(first.init.redirect).toBe("manual");
    expect(first.init.credentials).toBe("include");
    expect(first.init.mode).toBe("cors");
    expect(first.init.cache).toBe("no-store");
    expect(first.init.duplex).toBe(request.duplex);
    expect(first.init.tls.serverName).toBe("example.test");
    expect(await new Response(first.init.body).text()).toBe("alpha");
    expect(await new Response(second.init.body).text()).toBe("alpha");
    expect(response.url).toBe("http://example.test/path?q=1");
  });

  test("strips stale body headers when init.body replaces a compressed inbound body", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    const compressed = gzipSync(Buffer.from(JSON.stringify({ hello: "world" })));
    const request = new Request("http://example.test/upload", {
      method: "POST",
      headers: {
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
        "content-type": "application/json",
        "x-keep": "1",
      },
      body: compressed,
    });
    const calls = [];
    const next = async (input, init) => {
      calls.push({ input, init });
      return new Response("ok");
    };

    await handler(request, { body: "alpha" }, next);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.get("content-encoding")).toBeNull();
    expect(calls[0].init.headers.get("content-length")).toBeNull();
    expect(calls[0].init.headers.get("transfer-encoding")).toBeNull();
    expect(calls[0].init.headers.get("content-type")).toBe("application/json");
    expect(calls[0].init.headers.get("x-keep")).toBe("1");
    expect(calls[0].init.body).toBe("alpha");
  });
});

describe("(url, init) shape", () => {
  test("keeps every outgoing init field and the canonical response url", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    const controller = new AbortController();
    const calls = [];
    const next = async (input, init) => {
      calls.push({ input, init });
      return new Response("ok");
    };

    const response = await handler(
      "http://example.test/x",
      {
        method: "POST",
        body: "beta",
        headers: { "x-init": "2" },
        signal: controller.signal,
        redirect: "error",
        duplex: "half",
        credentials: "omit",
        mode: "same-origin",
        cache: "reload",
      },
      next,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toContain("[2001:db8::1]");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("beta");
    expect(calls[0].init.headers.get("x-init")).toBe("2");
    expect(calls[0].init.headers.get("host")).toBe("example.test");
    expect(calls[0].init.signal).toBe(controller.signal);
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].init.duplex).toBe("half");
    expect(calls[0].init.credentials).toBe("omit");
    expect(calls[0].init.mode).toBe("same-origin");
    expect(calls[0].init.cache).toBe("reload");
    expect(calls[0].init.tls.serverName).toBe("example.test");
    expect(response.url).toBe("http://example.test/x");
  });

  test("an already-aborted signal stops before the second address", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    const controller = new AbortController();
    controller.abort("bye");
    let calls = 0;
    const next = async () => {
      calls += 1;
      throw new Error("aborted");
    };
    await expect(handler("http://example.test/x", { signal: controller.signal }, next)).rejects.toThrow("aborted");
    expect(calls).toBe(1);
  });
});

describe("address selection", () => {
  test("tries every IPv6 address before IPv4 and caches the lookup", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    const seen = [];
    const next = async (input) => {
      seen.push(input);
      return new Response("ok");
    };

    await handler("http://example.test/one", {}, next);
    await handler("http://example.test/two", {}, next);

    expect(lookups).toBe(1);
    expect(seen[0]).toContain("[2001:db8::1]");
    expect(seen[1]).toContain("[2001:db8::1]");
  });

  test("IP literals and localhost pass through untouched", async () => {
    const handler = await installHandler({ ttlMs: 60_000 });
    for (const url of ["http://127.0.0.1/x", "http://localhost/x", "http://[::1]/x"]) {
      const calls = [];
      const next = async (input, init) => {
        calls.push({ input, init });
        return new Response("ok");
      };
      await handler(url, { method: "POST", body: "raw" }, next);
      expect(calls).toHaveLength(1);
      expect(calls[0].input).toBe(url);
      expect(calls[0].init).toEqual({ method: "POST", body: "raw" });
    }
  });
});
