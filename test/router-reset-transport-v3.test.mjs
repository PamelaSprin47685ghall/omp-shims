// Reset transport and base-path matrix for the lazy-router handler.
//
// Loopback plain HTTP is the local-operator path; every remote peer needs real
// TLS. A configured base path owns the whole status surface, and an unprefixed
// request must 404 rather than leak a second mount point.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { lazyRouterHandler } from "../features/lazy-router.mjs";
import { buildSnapshot } from "../lib/router/status-page/snapshot.mjs";
import { createStatusPage, STATUS_MANIFEST } from "../lib/router/status-page.mjs";
import { NOW, snapshotInput } from "./fixtures/status-v3.mjs";

const directories = [];
const servers = [];
const TOKEN = "gateway-test-token";

function tempToken() {
  const directory = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "omp-reset-transport-"));
  directories.push(directory);
  const path = join(directory, "auth-gateway.token");
  writeFileSync(path, `${TOKEN}\n`, { mode: 0o600 });
  return path;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function snapshot() {
  return buildSnapshot(snapshotInput());
}

function harness({ basePath = "", resetResult, tokenPath = tempToken() } = {}) {
  const view = snapshot();
  const calls = [];
  const statusPage = createStatusPage({ statusView: () => view });
  const router = {
    catalog: { host: new Set(), gateway: new Set() },
    status: () => Response.json(view, { headers: { "cache-control": "no-store" } }),
    statusView: () => view,
  };
  const dispatcher = { bind() {} };
  const store = {
    resetTokenTotals({ resetId }) {
      calls.push(resetId);
      if (resetResult !== undefined) return resetResult;
      return { epoch: { id: "epoch_2000000000000_fixture", since: new Date(NOW).toISOString() }, idempotent: false };
    },
  };
  const handler = lazyRouterHandler({
    router,
    dispatcher,
    statusPage,
    credentials: null,
    config: { statusPath: "/v1/lazy/status", statusBasePath: basePath, clientOnlyPrefix: "" },
    paths: { gatewayTokenPath: tokenPath },
    store,
  });
  const next = async () => new Response("gateway", { status: 200 });
  const request = (url, { method = "GET", headers = {}, body } = {}) => new Request(url, { method, headers, body });
  const send = (url, options, address = "127.0.0.1") =>
    handler(options?.request ?? request(url, options), { requestIP: () => ({ address }) }, next);
  return { handler, send, request, calls, tokenPath, view };
}

function nonLoopbackAddress() {
  for (const rows of Object.values(networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === "IPv4" && !row.internal) return row.address;
    }
  }
  return null;
}

async function realServer({ basePath = "", hostname = "127.0.0.1" } = {}) {
  const dependencies = harness({ basePath });
  const server = Bun.serve({
    hostname,
    port: 0,
    fetch: (request, bunServer) => dependencies.handler(request, bunServer, async () => new Response("gateway")),
  });
  servers.push(server);
  return { ...dependencies, server, port: server.port };
}

function resetRequest(
  base,
  {
    token = TOKEN,
    marker = "token-totals",
    contentType = "application/json",
    body = '{"resetId":"reset-uuid-1"}',
    method = "POST",
  } = {},
) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (marker !== null) headers["x-lazy-reset"] = marker;
  if (contentType !== null) headers["content-type"] = contentType;
  return { method, headers, body: method === "POST" ? body : undefined, url: base };
}

describe("reset transport matrix", () => {
  test("loopback plain HTTP reaches auth: invalid token is 401, valid token is 200", async () => {
    const { send } = harness();
    const missing = await send(
      "http://127.0.0.1/v1/lazy/token-totals/reset",
      resetRequest("http://127.0.0.1/v1/lazy/token-totals/reset", { token: null }),
    );
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");

    const wrong = await send(
      "http://127.0.0.1/v1/lazy/token-totals/reset",
      resetRequest("http://127.0.0.1/v1/lazy/token-totals/reset", { token: "wrong" }),
    );
    expect(wrong.status).toBe(401);

    const ok = await send(
      "http://127.0.0.1/v1/lazy/token-totals/reset",
      resetRequest("http://127.0.0.1/v1/lazy/token-totals/reset"),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.epoch.id).toBe("epoch_2000000000000_fixture");
    expect(body.tokenTotals).toBeTruthy();
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  test("a non-loopback peer over plain HTTP is 403 even with a valid token", async () => {
    const { send } = harness();
    const response = await send(
      "http://gateway.example/v1/lazy/token-totals/reset",
      resetRequest("http://gateway.example/v1/lazy/token-totals/reset"),
      "203.0.113.9",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "https_required" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a non-loopback peer cannot spoof x-forwarded-proto: https", async () => {
    const { send, request } = harness();
    const options = resetRequest("http://gateway.example/v1/lazy/token-totals/reset");
    options.headers["x-forwarded-proto"] = "https";
    const response = await send(
      "http://gateway.example/v1/lazy/token-totals/reset",
      { request: request("http://gateway.example/v1/lazy/token-totals/reset", options) },
      "203.0.113.9",
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("https_required");
  });

  test("real TLS from a remote peer passes the transport gate", async () => {
    const { send } = harness();
    const response = await send(
      "https://gateway.example/v1/lazy/token-totals/reset",
      resetRequest("https://gateway.example/v1/lazy/token-totals/reset"),
      "203.0.113.9",
    );
    expect(response.status).toBe(200);
  });

  test("the remaining status matrix is exact and no-store", async () => {
    const { send } = harness();
    const url = "http://127.0.0.1/v1/lazy/token-totals/reset";
    const get = await send(url, resetRequest(url, { method: "GET" }));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect(get.headers.get("cache-control")).toBe("no-store");

    const marker = await send(url, resetRequest(url, { marker: null }));
    expect(marker.status).toBe(401);
    const contentType = await send(url, resetRequest(url, { contentType: "text/plain" }));
    expect(contentType.status).toBe(401);

    const bad = await send(url, resetRequest(url, { body: "{}" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("bad_request");

    const conflict = harness({
      resetResult: { conflict: true, epoch: { id: "epoch_old", since: new Date(NOW).toISOString() } },
    });
    const conflictResponse = await conflict.send(url, resetRequest(url));
    expect(conflictResponse.status).toBe(409);
    expect((await conflictResponse.json()).error).toBe("reset_conflict");

    const unavailable = harness({ resetResult: null });
    const unavailableResponse = await unavailable.send(url, resetRequest(url));
    expect(unavailableResponse.status).toBe(503);
    expect((await unavailableResponse.json()).error).toBe("counter_unavailable");
    expect(unavailableResponse.headers.get("cache-control")).toBe("no-store");
  });
});

describe("configured base path owns the status surface", () => {
  test("unprefixed page, asset, status and reset paths are 404", async () => {
    const { send, view } = harness({ basePath: "/ops" });
    const entry = "status-page.retained.js";
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", `/assets/lazy-status/${entry}`],
      ["GET", "/v1/lazy/status"],
      ["POST", "/v1/lazy/token-totals/reset"],
    ]) {
      const response = await send(`http://127.0.0.1${path}`, resetRequest(`http://127.0.0.1${path}`, { method }));
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 404 });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(view.snapshotId).toMatch(/^snap_/);
  });

  test("the /ops prefix serves the page, asset, status and reset", async () => {
    const { send, view } = harness({ basePath: "/ops" });
    const page = await send("http://127.0.0.1/ops/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('content="/ops/v1/lazy/status"');

    const status = await send("http://127.0.0.1/ops/v1/lazy/status");
    expect(status.status).toBe(200);
    expect((await status.json()).snapshotId).toBe(view.snapshotId);

    const asset = await send(`http://127.0.0.1/ops/assets/lazy-status/${STATUS_MANIFEST.entry}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const reset = await send(
      "http://127.0.0.1/ops/v1/lazy/token-totals/reset",
      resetRequest("http://127.0.0.1/ops/v1/lazy/token-totals/reset"),
    );
    expect(reset.status).toBe(200);
  });

  test("a stripped proxy path with a loopback X-Forwarded-Prefix renders /ops URLs", async () => {
    const { send, request } = harness({ basePath: "" });
    const options = { method: "GET", headers: { "x-forwarded-prefix": "/ops" } };
    const response = await send("http://127.0.0.1/", { request: request("http://127.0.0.1/", options) }, "127.0.0.1");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="/ops/v1/lazy/status"');
    expect(html).toContain('content="/ops/v1/lazy/token-totals/reset"');
    expect(html).toContain('src="/ops/assets/lazy-status/');
  });

  test("a remote peer cannot choose a trusted prefix", async () => {
    const { send, request } = harness({ basePath: "" });
    const options = { method: "GET", headers: { "x-forwarded-prefix": "/ops" } };
    const response = await send("http://127.0.0.1/", { request: request("http://127.0.0.1/", options) }, "203.0.113.9");
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('content="/ops/v1/lazy/status"');
  });
});

describe("real Bun.serve transport", () => {
  function postReset(base, token = TOKEN, extra = {}) {
    const headers = { "content-type": "application/json", "x-lazy-reset": "token-totals", ...extra };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    return fetch(base, { method: "POST", headers, body: '{"resetId":"reset-real-1"}' });
  }

  test("configured /ops: prefixed loopback auth works and unprefixed paths are 404", async () => {
    const { port } = await realServer({ basePath: "/ops" });
    const origin = `http://127.0.0.1:${port}`;

    const noauth = await postReset(`${origin}/ops/v1/lazy/token-totals/reset`, null);
    expect(noauth.status).toBe(401);
    expect(noauth.headers.get("cache-control")).toBe("no-store");

    const valid = await postReset(`${origin}/ops/v1/lazy/token-totals/reset`);
    expect(valid.status).toBe(200);
    expect((await valid.json()).ok).toBe(true);

    const get = await fetch(`${origin}/ops/v1/lazy/token-totals/reset`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    for (const [method, path] of [
      ["POST", "/v1/lazy/token-totals/reset"],
      ["GET", "/v1/lazy/token-totals/reset"],
      ["GET", "/v1/lazy/status"],
      ["GET", "/"],
      ["GET", "/assets/lazy-status/status-page.retained.js"],
    ]) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: method === "POST" ? { "content-type": "application/json", "x-lazy-reset": "token-totals" } : {},
        body: method === "POST" ? '{"resetId":"unprefixed"}' : undefined,
      });
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 404 });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }

    const page = await fetch(`${origin}/ops/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('content="/ops/v1/lazy/status"');
  });

  test("base empty + trusted loopback X-Forwarded-Prefix: reset and /ops page URLs", async () => {
    const { port } = await realServer({ basePath: "" });
    const origin = `http://127.0.0.1:${port}`;
    const prefix = { "x-forwarded-prefix": "/ops" };

    const page = await fetch(`${origin}/`, { headers: prefix });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('content="/ops/v1/lazy/status"');
    expect(html).toContain('src="/ops/assets/lazy-status/');

    const noauth = await postReset(`${origin}/v1/lazy/token-totals/reset`, null, prefix);
    expect(noauth.status).toBe(401);
    const valid = await postReset(`${origin}/v1/lazy/token-totals/reset`, TOKEN, prefix);
    expect(valid.status).toBe(200);
  });

  test("a non-loopback local address over plain HTTP and a spoofed proto are 403", async () => {
    const address = nonLoopbackAddress();
    if (!address) return;
    const { port } = await realServer({ basePath: "/ops", hostname: "0.0.0.0" });
    const origin = `http://${address}:${port}`;

    const plain = await postReset(`${origin}/ops/v1/lazy/token-totals/reset`);
    expect(plain.status).toBe(403);
    expect((await plain.json()).error).toBe("https_required");

    const spoofed = await postReset(`${origin}/ops/v1/lazy/token-totals/reset`, TOKEN, {
      "x-forwarded-proto": "https",
    });
    expect(spoofed.status).toBe(403);
    expect((await spoofed.json()).error).toBe("https_required");
  });
});
