// Contract tests for the v2 traffic-log process feature.
//
// The layer writes one JSONL record per request event through the shared Sink.
// Tests use a real Bun.serve on port 0 and a temporary log directory. Secrets
// must be redacted, the body is opt-in, and the sweep must not delete files it
// does not own.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { install } from "../features/traffic-log.mjs";
import { dispose as disposeInbound } from "../lib/inbound.mjs";

const originalArgv = process.argv.slice();
process.argv.push("auth-gateway", "serve");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const servers = [];
const disposers = [];
const directories = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "omp-traffic-v2-"));
  directories.push(dir);
  return dir;
}

function serve(fetchImpl) {
  const server = Bun.serve({ port: 0, fetch: fetchImpl });
  servers.push(server);
  return server;
}

function urlFor(server, pathname = "/") {
  return `http://127.0.0.1:${server.port}${pathname}`;
}

/** Read every JSONL record in a directory. */
function readRecords(dir) {
  const records = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() !== "") records.push(JSON.parse(line));
    }
  }
  return records;
}

async function disposeAll() {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
  await disposeAll();
  disposeInbound();
});

afterAll(() => {
  process.argv = originalArgv.slice();
  disposeInbound();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("records", () => {
  test("redacts headers and query tokens, and logs the body only when logBody is on", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, logBody: true, sweepMs: 100_000 }, {}));
    const server = serve(async () => new Response("ok", { status: 200 }));

    const response = await fetch(urlFor(server, "/v1/chat/completions?token=secret&key=api"), {
      method: "POST",
      headers: {
        authorization: "Bearer top-secret",
        "x-api-key": "key-value",
        "x-keep": "1",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(await response.text()).toBe("ok");
    await disposeAll();

    const records = readRecords(dir);
    const request = records.find((record) => record.event === "request");
    const responseRecord = records.find((record) => record.event === "response");
    expect(request).toBeDefined();
    expect(responseRecord).toBeDefined();
    expect(request.headers.authorization).toBe("[redacted]");
    expect(request.headers["x-api-key"]).toBe("[redacted]");
    expect(request.headers["x-keep"]).toBe("1");
    expect(new URL(request.url).searchParams.get("token")).toBe("[redacted]");
    expect(new URL(request.url).searchParams.get("key")).toBe("[redacted]");
    expect(request.body).toBe(JSON.stringify({ hello: "world" }));
    expect(responseRecord.status).toBe(200);
    expect(responseRecord.requestId).toBe(request.requestId);
    expect(typeof responseRecord.ms).toBe("number");
  });

  test("omits the body when logBody is off", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, logBody: false, sweepMs: 100_000 }, {}));
    const server = serve(async () => new Response("ok"));
    await (
      await fetch(urlFor(server, "/v1/chat/completions"), {
        method: "POST",
        body: JSON.stringify({ secret: "prompt" }),
      })
    ).text();
    await disposeAll();

    const request = readRecords(dir).find((record) => record.event === "request");
    expect(request).toBeDefined();
    expect(Object.hasOwn(request, "body")).toBe(false);
  });

  test("writes one UTC-hour JSONL file", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, sweepMs: 100_000 }, {}));
    const server = serve(async () => new Response("ok"));
    await (await fetch(urlFor(server, "/v1/models"))).text();
    await disposeAll();

    const names = readdirSync(dir);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^gateway-\d{4}-\d{2}-\d{2}-\d{2}\.jsonl$/);
  });

  test("defaults to <context.paths.logsDir>/traffic", async () => {
    const logsDir = tempDir();
    disposers.push(await install({ enabled: true, sweepMs: 100_000 }, { paths: { logsDir } }));
    const server = serve(async () => new Response("ok"));
    await (await fetch(urlFor(server, "/v1/models"))).text();
    await disposeAll();

    const names = readdirSync(join(logsDir, "traffic"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^gateway-\d{4}-\d{2}-\d{2}-\d{2}\.jsonl$/);
  });

  test("bounds an uncompressed body at 256 KiB", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, logBody: true, sweepMs: 100_000 }, {}));
    const server = serve(async (request) => {
      await request.text();
      return new Response("ok");
    });
    const large = "a".repeat(300_000);
    await (
      await fetch(urlFor(server, "/v1/chat/completions"), {
        method: "POST",
        body: large,
      })
    ).text();
    await disposeAll();

    const request = readRecords(dir).find((record) => record.event === "request");
    expect(request.body.endsWith("…<truncated>")).toBe(true);
    expect(request.body.length).toBeLessThanOrEqual(256 * 1024 + 16);
    expect(request.body.length).toBeGreaterThanOrEqual(256 * 1024);
  });

  test("describes a compressed body by size without decompressing it", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, logBody: true, sweepMs: 100_000 }, {}));
    const server = serve(async (request) => {
      await request.arrayBuffer();
      return new Response("ok");
    });
    const compressed = gzipSync(Buffer.from(`secret ${"payload ".repeat(2_000)}`));
    await (
      await fetch(urlFor(server, "/v1/chat/completions"), {
        method: "POST",
        headers: {
          "content-encoding": "gzip",
          "content-length": String(compressed.byteLength),
        },
        body: compressed,
      })
    ).text();
    await disposeAll();

    const request = readRecords(dir).find((record) => record.event === "request");
    expect(request.body).toMatch(/^<compressed \d+ bytes>$/);
    expect(request.body).not.toContain("payload");
  });
});

describe("sweep", () => {
  test("removes old log files and rotated generations but keeps other files", async () => {
    const dir = tempDir();
    const old = new Date(Date.now() - 120_000);
    for (const name of ["gateway-old.jsonl", "gateway-old.jsonl.1", "gateway-old.log", "keep.txt"]) {
      const path = join(dir, name);
      writeFileSync(path, "x");
      utimesSync(path, old, old);
    }

    disposers.push(await install({ enabled: true, dir, maxAgeMs: 60_000, sweepMs: 50 }, {}));
    await sleep(150);

    expect(existsSync(join(dir, "gateway-old.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "gateway-old.jsonl.1"))).toBe(false);
    expect(existsSync(join(dir, "gateway-old.log"))).toBe(false);
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);
  });

  test("dispose clears the sweep timer", async () => {
    const dir = tempDir();
    disposers.push(await install({ enabled: true, dir, maxAgeMs: 60_000, sweepMs: 50 }, {}));
    await disposeAll();

    const old = new Date(Date.now() - 120_000);
    const path = join(dir, "gateway-after-dispose.jsonl");
    writeFileSync(path, "x");
    utimesSync(path, old, old);
    await sleep(150);
    expect(existsSync(path)).toBe(true);
  });
});
