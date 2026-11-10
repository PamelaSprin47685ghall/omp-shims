// Extension provider stream failures: fail over before output, name the cause
// after output, and never turn a client cancel into a provider failure.

import { describe, expect, test } from "bun:test";
import { Attempt, runAttempt } from "../lib/router/attempt.mjs";
import { withExtensionFallback } from "../lib/router/extension-fallback.mjs";

const PROVIDER = "kiro";
const MODEL = "kiro/extension-test";

/** Build one trusted extension attempt with a scripted plugin stream. */
function serve(streamSimple, { stream = true } = {}) {
  const handler = withExtensionFallback(async () => new Response("gateway", { status: 500 }), {
    credentials: {
      listAccounts: async () => [{ id: 1 }],
      resolve: async () => ({ secret: "plugin-key" }),
    },
    tokenPath: "/nonexistent/omp-gateway.token",
    nativeRegistered: () => false,
    providers: new Map([
      [
        PROVIDER,
        {
          api: "openai-completions",
          models: [{ id: "extension-test", contextWindow: 200_000, maxTokens: 8_000 }],
          streamSimple,
        },
      ],
    ]),
  });
  const attempt = new Attempt({
    unit: { provider: PROVIDER, label: PROVIDER, key: PROVIDER },
    model: MODEL,
    upstreamHosts: [],
    upstreamPaths: [],
  });
  const request = new Request("http://127.0.0.1/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "hi" }],
      stream,
    }),
  });
  return runAttempt(attempt, () => handler(request, {}));
}

/** Capture the diagnostic lines a test produces. */
function captureReport() {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  return {
    lines,
    restore() {
      console.error = original;
    },
  };
}

describe("extension provider stream", () => {
  test("a first-event plugin error answers 502 so the router can fail over", async () => {
    const response = await serve(async function* () {
      yield { type: "error", error: { status: 403, code: "permission_error", message: "No API access" } };
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.json();
    expect(body.error.type).toBe("upstream_error");
    expect(body.error.message).toBe("Extension provider request failed");
  });

  test("a plugin stream that throws before its first event answers 502", async () => {
    // A plain iterator rejects on its first read before any event arrives.
    const streamSimple = () => ({
      [Symbol.asyncIterator]: () => ({
        async next() {
          throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
        },
      }),
    });
    const response = await serve(streamSimple);
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toBe("Extension provider request failed");
  });

  test("a bare Error message yields the HTTP status as the reason code", async () => {
    const report = captureReport();
    try {
      const streamSimple = () => ({
        [Symbol.asyncIterator]: () => ({
          async next() {
            throw new Error("HTTP 502 Bad Gateway");
          },
        }),
      });
      const response = await serve(streamSimple);
      expect(response.status).toBe(502);
      const logs = report.lines.filter((line) => line.includes("extension provider stream failed"));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('"code":"status_502"');
      expect(logs[0]).toContain('"status":502');
    } finally {
      report.restore();
    }
  });

  test("a non-streaming plugin error answers 502", async () => {
    const response = await serve(
      async function* () {
        yield { type: "error", error: { status: 429, code: "rate_limited", message: "slow down" } };
      },
      { stream: false },
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.message).toBe("Extension provider request failed");
  });

  test("an error after output keeps the stream and names a stable failure code", async () => {
    const report = captureReport();
    try {
      const response = await serve(async function* () {
        yield { type: "text_delta", delta: "hello" };
        yield {
          type: "error",
          error: {
            status: 500,
            code: "server_error",
            message: "upstream exploded sk-live-123456789 user@example.com",
          },
        };
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const text = await response.text();
      expect(text).toContain('"content":"hello"');
      expect(text).toContain('"code":"extension_stream_failed"');
      expect(text).toContain("Extension provider stream failed");
      expect(text).not.toContain("sk-live-123456789");
      expect(text).not.toContain("user@example.com");
      expect(text).not.toContain("[DONE]");

      const logs = report.lines.filter((line) => line.includes("extension provider stream failed"));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('"provider":"kiro"');
      expect(logs[0]).toContain('"model":"kiro/extension-test"');
      expect(logs[0]).toContain('"code":"server_error"');
      expect(logs[0]).not.toContain("sk-live-123456789");
      expect(logs[0]).not.toContain("upstream exploded");
    } finally {
      report.restore();
    }
  });

  test("a successful stream is unchanged", async () => {
    const response = await serve(async function* () {
      yield { type: "text_delta", delta: "hello" };
      yield { type: "done", reason: "stop", usage: { inputTokens: 3, outputTokens: 2 } };
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"delta":{"role":"assistant"}');
    expect(text).toContain('"content":"hello"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text).toContain("[DONE]");
  });

  test("a transport throw after output is framed and logged once", async () => {
    const report = captureReport();
    try {
      const streamSimple = () => {
        let read = 0;
        return {
          [Symbol.asyncIterator]: () => ({
            async next() {
              if (read++ === 0) return { done: false, value: { type: "text_delta", delta: "hello" } };
              throw Object.assign(new Error("socket reset"), { code: "ECONNRESET" });
            },
          }),
        };
      };
      const response = await serve(streamSimple);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('"content":"hello"');
      expect(text).toContain('"code":"extension_stream_failed"');
      expect(text).toContain("Extension provider stream failed");
      expect(text).not.toContain("socket reset");
      const logs = report.lines.filter((line) => line.includes("extension provider stream failed"));
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('"code":"econnreset"');
      expect(logs[0]).not.toContain("socket reset");
    } finally {
      report.restore();
    }
  });

  test("a client cancel keeps the old 200-and-close shape", async () => {
    const streamSimple = () => ({
      [Symbol.asyncIterator]: () => ({
        async next() {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        },
      }),
    });
    const response = await serve(streamSimple);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"code":"extension_stream_aborted"');
    expect(text).not.toContain("extension_stream_failed");
  });
});
