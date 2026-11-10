import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEventLog, hashEmail, redactHeaders, redactUrl, Sink } from "../lib/telemetry.mjs";

const SECRET_HEADER_NAMES = [
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "copilot-session-token",
  "cookie",
  "set-cookie",
  "x-auth-token",
  "openai-api-key",
  "anthropic-api-key",
];

const SECRET_QUERY_NAMES = ["key", "api_key", "access_token", "token", "sig", "signature"];

const REDACTED = "[redacted]";

/** Mix the character case of one header name. The lowercase match must still work. */
function alternateCase(name) {
  return [...name].map((character, index) => (index % 2 === 0 ? character.toUpperCase() : character)).join("");
}

/** Register one cleanup. The afterEach hook runs the cleanups in LIFO order. */
function registerCleanup(cleanup) {
  globalThis.__ompTelemetryV2Cleanup.push(cleanup);
}

/** Create a temp directory and register its removal. */
function makeTempDir() {
  const directory = mkdtempSync(join(tmpdir(), "omp-telemetry-v2-"));
  registerCleanup(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

/** Register the close of a Sink and return the same Sink. */
function trackSink(sink) {
  registerCleanup(() => sink.close());
  return sink;
}

/** Read a JSONL file and return its records. */
function readJsonLines(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  globalThis.__ompTelemetryV2Cleanup = [];
});

afterEach(async () => {
  const cleanups = globalThis.__ompTelemetryV2Cleanup ?? [];
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    try {
      await cleanup();
    } catch {
      // A cleanup error must not fail a test.
    }
  }
  globalThis.__ompTelemetryV2Cleanup = [];
});

describe("redactHeaders", () => {
  test("redacts all required header names in a plain object with mixed case", () => {
    const input = { "X-Trace-Id": "trace-123", Accept: "application/json" };
    for (const name of SECRET_HEADER_NAMES) {
      input[alternateCase(name)] = `${name}-secret`;
    }

    const result = redactHeaders(input);

    for (const name of SECRET_HEADER_NAMES) {
      expect(result[alternateCase(name)]).toBe(REDACTED);
    }
    expect(result["X-Trace-Id"]).toBe("trace-123");
    expect(result.Accept).toBe("application/json");
  });

  test("redacts a Headers instance and keeps non-secret values", () => {
    const headers = new Headers();
    for (const name of SECRET_HEADER_NAMES) {
      headers.set(name, `${name}-secret`);
    }
    headers.set("X-Request-Id", "request-123");
    headers.set("Content-Type", "application/json");

    const result = redactHeaders(headers);

    for (const name of SECRET_HEADER_NAMES) {
      expect(result[name]).toBe(REDACTED);
    }
    expect(result["x-request-id"]).toBe("request-123");
    expect(result["content-type"]).toBe("application/json");
  });

  test("redacts an array of name and value pairs with mixed case", () => {
    const pairs = SECRET_HEADER_NAMES.map((name) => [alternateCase(name), `${name}-secret`]);
    pairs.push(["X-Trace-Id", "trace-456"], ["Accept", "text/plain"]);

    const result = redactHeaders(pairs);

    for (const name of SECRET_HEADER_NAMES) {
      expect(result[alternateCase(name)]).toBe(REDACTED);
    }
    expect(result["X-Trace-Id"]).toBe("trace-456");
    expect(result.Accept).toBe("text/plain");
  });
});

describe("redactUrl", () => {
  test("masks all required query parameters and keeps other parameters", () => {
    const url = new URL("https://example.com/v1/chat");
    for (const [index, name] of SECRET_QUERY_NAMES.entries()) {
      url.searchParams.set(name, `DO-NOT-LEAK-${index}`);
    }
    url.searchParams.set("model", "gpt-4");

    const result = redactUrl(url.toString());
    const parsed = new URL(result);

    for (const [index, name] of SECRET_QUERY_NAMES.entries()) {
      expect(result.includes(`DO-NOT-LEAK-${index}`)).toBe(false);
      expect(parsed.searchParams.get(name)).toBe(REDACTED);
    }
    expect(parsed.searchParams.get("model")).toBe("gpt-4");
  });

  test("returns non-string and malformed input unchanged", () => {
    expect(redactUrl(null)).toBe(null);
    expect(redactUrl(42)).toBe(42);
    expect(redactUrl("not a url")).toBe("not a url");
  });
});

describe("hashEmail", () => {
  test("returns a sha256 prefix and never the raw email", () => {
    const raw = "  User@Example.COM  ";
    const result = hashEmail(raw);

    expect(result).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(result).toBe(hashEmail("user@example.com"));
    expect(result).toBe(hashEmail("USER@EXAMPLE.COM"));
    expect(result.includes("User@Example.COM")).toBe(false);
    expect(result.includes("user@example.com")).toBe(false);
    expect(result.includes("@")).toBe(false);
  });

  test("returns a hash for an empty input", () => {
    expect(hashEmail("")).toMatch(/^sha256:[0-9a-f]{12}$/);
  });
});

describe("Sink", () => {
  test("creates a nested directory with mode 0700 and a file with mode 0600", () => {
    const root = makeTempDir();
    const logPath = join(root, "nested", "deep", "events.jsonl");
    trackSink(new Sink({ path: logPath, maxBytes: 1024 * 1024, keep: 2 }));

    expect(statSync(dirname(logPath)).mode & 0o777).toBe(0o700);
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  test("writes JSONL records with ts, event, requestId, and detail after flush", async () => {
    const root = makeTempDir();
    const logPath = join(root, "events.jsonl");
    const sink = trackSink(new Sink({ path: logPath }));

    await sink.emit("request", { requestId: "req-1", provider: "openai", status: 200 });
    await sink.flush();

    const records = readJsonLines(logPath);
    expect(records).toHaveLength(1);
    expect(records[0].event).toBe("request");
    expect(records[0].requestId).toBe("req-1");
    expect(records[0].provider).toBe("openai");
    expect(records[0].status).toBe(200);
    expect(typeof records[0].ts).toBe("string");
    expect(new Date(records[0].ts).toISOString()).toBe(records[0].ts);
  });

  test("ignores emit after close", async () => {
    const root = makeTempDir();
    const logPath = join(root, "events.jsonl");
    const sink = trackSink(new Sink({ path: logPath }));

    await sink.emit("before-close", { requestId: "req-1" });
    await sink.close();
    const before = readFileSync(logPath, "utf8");

    await sink.emit("after-close", { requestId: "req-2" });
    await sink.flush();

    expect(readFileSync(logPath, "utf8")).toBe(before);
    expect(readJsonLines(logPath).map((record) => record.event)).toEqual(["before-close"]);
  });
});

describe("createEventLog", () => {
  test("appends JSON lines to the given file", () => {
    const root = makeTempDir();
    const out = join(root, "logs", "events.jsonl");
    const emit = createEventLog({ out });

    emit("first", { requestId: "req-1", detail: "one" });
    emit("second", { requestId: "req-2" });

    expect(statSync(dirname(out)).mode & 0o777).toBe(0o700);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const records = readJsonLines(out);
    expect(records).toHaveLength(2);
    expect(records[0].event).toBe("first");
    expect(records[0].requestId).toBe("req-1");
    expect(records[0].detail).toBe("one");
    expect(records[1].event).toBe("second");
    expect(records[1].requestId).toBe("req-2");
    for (const record of records) {
      expect(new Date(record.ts).toISOString()).toBe(record.ts);
    }
  });

  test("writes to stderr without a path and does not throw", () => {
    const originalWrite = process.stderr.write;
    const writes = [];
    process.stderr.write = (chunk) => {
      writes.push(String(chunk));
      return true;
    };
    registerCleanup(() => {
      process.stderr.write = originalWrite;
    });

    const emit = createEventLog({});
    let thrown;
    try {
      emit("stderr-event", { requestId: "req-stderr" });
    } catch (error) {
      thrown = error;
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(thrown).toBeUndefined();
    const output = writes.join("");
    expect(output).toContain("stderr-event");
    expect(output).toContain("req-stderr");
  });
});

describe("Sink rotation", () => {
  test("rotates at maxBytes, keeps two generations, and keeps records intact", async () => {
    const root = makeTempDir();
    const logPath = join(root, "rotate", "events.jsonl");
    const sink = trackSink(new Sink({ path: logPath, maxBytes: 250, keep: 2 }));

    for (let index = 0; index < 8; index += 1) {
      await sink.emit("rotate", { requestId: `req-${index}`, pad: "x".repeat(160) });
      await sink.flush();
    }
    await sink.close();

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(existsSync(`${logPath}.2`)).toBe(true);
    expect(existsSync(`${logPath}.3`)).toBe(false);

    const groups = [logPath, `${logPath}.1`, `${logPath}.2`].map((generationPath) => readJsonLines(generationPath));
    const records = groups.flat();

    expect(records.map((record) => record.requestId).sort()).toEqual(["req-5", "req-6", "req-7"]);
    for (const group of groups) {
      expect(group).toHaveLength(1);
      for (const record of group) {
        expect(record.event).toBe("rotate");
        expect(record.pad).toBe("x".repeat(160));
        expect(new Date(record.ts).toISOString()).toBe(record.ts);
      }
    }
  });
});
