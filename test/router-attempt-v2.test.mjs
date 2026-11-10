// Regression tests for the v2 attempt supervisor and transport boundaries.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { withBody } from "../lib/inbound.mjs";
import { Attempt, AttemptAbandoned, createAttemptLayer, runAttempt } from "../lib/router/attempt.mjs";
import { GatewayDispatcher } from "../lib/router/dispatcher.mjs";
import { summarizeUpstreamBody } from "../lib/router/events.mjs";
import { formatForPath, sanitizeAntigravityBody } from "../lib/router/formats.mjs";

/** An attempt on one provider-qualified model. */
function attemptFor(model = "fake/model", credentialId = undefined) {
  return new Attempt({
    unit: { provider: "fake", label: "fake:plus#1", key: "fake/1", credentialId },
    model,
    upstreamHosts: ["api.good.test"],
    upstreamPaths: ["/v1"],
  });
}

describe("held-stream deadline", () => {
  test("a never-emitting stream hits the header deadline", async () => {
    const dispatcher = new GatewayDispatcher({
      tokenPath: "/nonexistent",
      headerTimeoutMs: 40,
      readToken: () => "",
    });
    const body = new ReadableStream({
      start() {
        // Never enqueue and never close.
      },
    });
    dispatcher.bind(() => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }), {});
    const attempt = attemptFor();
    const outcome = await dispatcher.run(
      attempt,
      new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", body: "{}" }),
      {
        headerTimeoutMs: 40,
        format: { classifyEvent: () => "preamble", isOutputEvent: () => false },
      },
    );
    expect(outcome.verdict.source).toBe("timeout");
    expect(outcome.verdict.status).toBe(504);
  });
});

describe("thrown quota classification", () => {
  test("a thrown provider retry failure benches the candidate as quota", async () => {
    const dispatcher = new GatewayDispatcher({
      tokenPath: "/nonexistent",
      headerTimeoutMs: 1_000,
      readToken: () => "",
    });
    dispatcher.bind(async () => {
      throw new Error(
        'Retry failed after 1 attempts: Provider requested 50126635ms waits; exceeds retry.maxDelayMs (300000ms). Original error: Cloud Code Assist API error (429): {"error":{"code":429,"message":"Individual quota reached","status":"RESOURCE_EXHAUSTED","quotaResetDelay":"13h55m26s"}}',
      );
    }, {});
    const attempt = attemptFor();
    const outcome = await dispatcher.run(
      attempt,
      new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", body: "{}" }),
      { headerTimeoutMs: 1_000, format: formatForPath("/v1/chat/completions") },
    );
    expect(outcome.verdict.status).toBe(429);
    expect(outcome.verdict.category).toBe("quota");
    expect(attempt.result?.ok).toBe(false);
  });
});

describe("error redaction", () => {
  test("an upstream error body never reaches the verdict", async () => {
    const layer = createAttemptLayer({ credentials: { resolve: async () => undefined } });
    const attempt = attemptFor();
    const secretBody = JSON.stringify({
      error: {
        message: "quota exceeded for user@example.com with key sk-secret-token",
      },
    });
    await runAttempt(attempt, () =>
      layer(
        "https://api.good.test/v1/chat/completions",
        { method: "POST", body: "{}", headers: {} },
        async () => new Response(secretBody, { status: 429 }),
      ),
    );
    expect(attempt.result?.ok).toBe(false);
    expect(attempt.result?.message).toBe("upstream 429 Too Many Requests");
    expect(attempt.result?.message).not.toContain("sk-secret-token");
    expect(attempt.result?.message).not.toContain("user@example.com");
    expect(attempt.result?.category).toBe("quota");
  });

  test("a malformed Antigravity body is rejected, not sent unsanitized", async () => {
    const layer = createAttemptLayer({ credentials: { resolve: async () => undefined } });
    const attempt = attemptFor("google-antigravity/gemini-test");
    let called = false;
    await expect(
      runAttempt(attempt, () =>
        layer(
          "https://api.good.test/v1/chat/completions",
          { method: "POST", body: "{not json", headers: {} },
          async () => {
            called = true;
            return new Response("ok", { status: 200 });
          },
        ),
      ),
    ).rejects.toBeInstanceOf(AttemptAbandoned);
    expect(called).toBe(false);
    expect(attempt.result?.source).toBe("adapter");
  });
});

describe("exact upstream allowlist", () => {
  test("a lookalike host receives no credential and cannot settle", async () => {
    const layer = createAttemptLayer({
      credentials: { resolve: async () => ({ provider: "fake", secret: "top-secret" }) },
    });
    const attempt = attemptFor("fake/model", 7);
    let seen;
    await runAttempt(attempt, () =>
      layer(
        "https://api.good.test.evil.test/v1/chat/completions",
        { method: "POST", body: "{}", headers: {} },
        async (_input, init) => {
          seen = init;
          return new Response("ok", { status: 200 });
        },
      ),
    );
    expect(seen.headers.authorization).toBeUndefined();
    expect(attempt.contacted).toBe(false);
    const settled = await Promise.race([attempt.verdict.then(() => "settled"), Promise.resolve("pending")]);
    expect(settled).toBe("pending");
  });
});

describe("root-path upstream allowlist", () => {
  test("a root baseUrl still matches the Cloud Code stream call and injects the pin", async () => {
    const base = new URL("https://daily-cloudcode-pa.googleapis.com");
    const attempt = new Attempt({
      unit: {
        provider: "google-antigravity",
        label: "google-antigravity:ultra#1",
        key: "google-antigravity/41",
        credentialId: 41,
      },
      model: "google-antigravity/gemini-4-argon",
      upstreamHosts: [base.hostname],
      upstreamPaths: [base.pathname],
    });
    expect(attempt.upstreamPaths).toEqual(["/"]);

    const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
    expect(attempt.isUpstream(url)).toBe(true);

    const layer = createAttemptLayer({
      credentials: {
        resolve: async () => ({ provider: "google-antigravity", secret: "cloud-code-secret" }),
      },
    });
    let seen;
    const response = await runAttempt(attempt, () =>
      layer(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: "gemini-4-argon" }),
        },
        async (_input, init) => {
          seen = init;
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(seen.headers.get("authorization")).toBe("Bearer cloud-code-secret");
    expect(attempt.contacted).toBe(true);
    expect(attempt.result?.ok).toBe(true);
  });

  test("empty and slash-only path entries both normalize to the root path", () => {
    const attempt = new Attempt({
      unit: { provider: "fake", label: "fake", key: "fake" },
      model: "fake/model",
      upstreamHosts: ["api.good.test"],
      upstreamPaths: ["", "/", "///"],
    });
    expect(attempt.upstreamPaths).toEqual(["/", "/", "/"]);
    expect(attempt.isUpstream("https://api.good.test/any/path")).toBe(true);
  });
});

describe("dispatcher token reader", () => {
  test("internalRequest reads tokenPath without an explicit readToken callback", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-router-token-"));
    try {
      const tokenPath = join(dir, "auth-gateway.token");
      writeFileSync(tokenPath, "gateway-file-token\n");
      const dispatcher = new GatewayDispatcher({ tokenPath, headerTimeoutMs: 50 });
      const request = dispatcher.internalRequest("/v1/chat/completions", { model: "lazy/default" });
      expect(request.headers.get("authorization")).toBe("Bearer gateway-file-token");
      expect(request.method).toBe("POST");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing token file sends no authorization header", () => {
    const dispatcher = new GatewayDispatcher({
      tokenPath: "/nonexistent/omp-router-gateway.token",
      headerTimeoutMs: 50,
    });
    expect(dispatcher.internalRequest("/v1/models").headers.get("authorization")).toBeNull();
  });
});

describe("replay headers", () => {
  test("a gzip inbound body is replayed as plain JSON", async () => {
    const payload = { model: "lazy/pro", messages: [{ role: "user", content: "hello" }] };
    const text = JSON.stringify(payload);
    const compressed = gzipSync(Buffer.from(text));
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: compressed,
    });
    const replay = withBody(request, text, payload);
    expect(replay.headers.get("content-encoding")).toBeNull();
    expect(replay.headers.get("content-length")).toBeNull();
    expect(await replay.text()).toBe(text);
  });
});

describe("upstream log redaction", () => {
  test("only structural fields and a tool count are logged", () => {
    const summary = summarizeUpstreamBody(
      JSON.stringify({
        model: "provider/model",
        reasoning_effort: "high",
        messages: [{ role: "user", content: "secret prompt text" }],
        tools: [{ name: "one" }, { name: "two" }],
      }),
    );
    expect(summary.model).toBe("provider/model");
    expect(summary.reasoning_effort).toBe("high");
    expect(summary.toolCount).toBe(2);
    expect(summary.bodyBytes).toBeGreaterThan(0);
    expect(JSON.stringify(summary)).not.toContain("secret prompt text");
    expect(JSON.stringify(summary)).not.toContain("one");
  });
});

describe("antigravity body sanitizer", () => {
  test("filters empty enum entries inside native function declarations", () => {
    const body = {
      request: {
        contents: [
          {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "update_goal_task",
                  args: { parameters: { status: { enum: ["", "keep"] } } },
                },
              },
            ],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              {
                name: "update_goal_task",
                parameters: {
                  type: "object",
                  properties: { status: { type: "string", enum: ["", "start", 7, "pending"] } },
                  $defs: { nested: { items: { anyOf: [{ enum: ["", "kept"] }] } } },
                },
              },
            ],
          },
        ],
      },
    };

    expect(sanitizeAntigravityBody(body)).toBe(true);
    const schema = body.request.tools[0].functionDeclarations[0].parameters;
    expect(schema.properties.status.enum).toEqual(["start", "pending"]);
    expect(schema.$defs.nested.items.anyOf[0].enum).toEqual(["kept"]);
    // Conversation history and the tools array are untouched.
    expect(body.request.contents[0].parts[0].functionCall.args.parameters.status.enum).toEqual(["", "keep"]);
    expect(body.request.tools).toHaveLength(1);
  });

  test("deletes an enum that only held empty entries", () => {
    const body = {
      tools: [{ function_declarations: [{ name: "f", parameters_json_schema: { enum: [""] } }] }],
    };
    expect(sanitizeAntigravityBody(body)).toBe(true);
    expect(body.tools).toHaveLength(1);
    expect("enum" in body.tools[0].function_declarations[0].parameters_json_schema).toBe(false);
  });

  test("a clean body reports no change", () => {
    const body = {
      request: { tools: [{ functionDeclarations: [{ name: "f", parameters: { enum: ["a"] } }] }] },
    };
    expect(sanitizeAntigravityBody(body)).toBe(false);
  });

  test("a deeply nested hostile schema is walked without throwing", () => {
    const schema = { type: "object", properties: {} };
    let node = schema;
    for (let index = 0; index < 500; index += 1) {
      node.properties = { child: { type: "object", properties: {} } };
      node = node.properties.child;
    }
    node.enum = [];
    expect(() =>
      sanitizeAntigravityBody({
        request: { tools: [{ functionDeclarations: [{ name: "deep", parameters: schema }] }] },
      }),
    ).not.toThrow();
  });
});

describe("clean Antigravity body", () => {
  test("a body without a bad enum reaches the provider byte-identical", async () => {
    const layer = createAttemptLayer({ credentials: { resolve: async () => undefined } });
    const attempt = attemptFor("google-antigravity/gemini-test");
    const body = `{
  "request": {
    "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
    "tools": [{"functionDeclarations": [{"name": "ok", "parameters": {"type": "object", "properties": {"mode": {"type": "string", "enum": ["a", "b"]}}}}]}]
  }
}`;
    let seen;
    await runAttempt(attempt, () =>
      layer(
        "https://api.good.test/v1/chat/completions",
        { method: "POST", body, headers: {} },
        async (_input, init) => {
          seen = init;
          return new Response("ok", { status: 200 });
        },
      ),
    );
    expect(seen.body).toBe(body);
  });

  test("a bad enum is filtered while conversation history stays intact", async () => {
    const layer = createAttemptLayer({ credentials: { resolve: async () => undefined } });
    const attempt = attemptFor("google-antigravity/gemini-test");
    const original = {
      request: {
        contents: [
          {
            role: "model",
            parts: [{ functionCall: { name: "f", args: { parameters: { enum: ["", "history"] } } } }],
          },
        ],
        tools: [
          {
            functionDeclarations: [
              { name: "f", parameters: { type: "object", properties: { status: { enum: ["", "ready"] } } } },
            ],
          },
        ],
      },
    };
    let seen;
    await runAttempt(attempt, () =>
      layer(
        "https://api.good.test/v1/chat/completions",
        { method: "POST", body: JSON.stringify(original), headers: {} },
        async (_input, init) => {
          seen = init;
          return new Response("ok", { status: 200 });
        },
      ),
    );
    const sent = JSON.parse(seen.body);
    expect(sent.request.tools[0].functionDeclarations[0].parameters.properties.status.enum).toEqual(["ready"]);
    expect(sent.request.contents).toEqual(original.request.contents);
  });
});

describe("credential header rewrite", () => {
  test("adds credential headers, keeps content-encoding, and preserves Request fields", async () => {
    const layer = createAttemptLayer({
      credentials: { resolve: async () => ({ provider: "fake", secret: "top-secret" }) },
    });
    const attempt = attemptFor("fake/model", 7);
    let seen;
    const input = new Request("https://api.good.test/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "99",
        "content-encoding": "gzip",
      },
      body: "{}",
      redirect: "manual",
      credentials: "include",
      mode: "cors",
      cache: "no-store",
    });
    await runAttempt(attempt, () =>
      layer(input, undefined, async (_input, init) => {
        seen = init;
        return new Response("ok", { status: 200 });
      }),
    );
    expect(seen.headers.get("content-length")).toBeNull();
    expect(seen.headers.get("content-encoding")).toBe("gzip");
    expect(seen.headers.get("authorization")).toBe("Bearer top-secret");
    expect(seen.redirect).toBe("manual");
    expect(seen.credentials).toBe("include");
    expect(seen.mode).toBe("cors");
    expect(seen.cache).toBe("no-store");
    expect(seen.duplex).toBe("half");
  });

  test("keeps content-encoding when init supplies a stream body", async () => {
    const layer = createAttemptLayer({
      credentials: { resolve: async () => ({ provider: "fake", secret: "top-secret" }) },
    });
    const attempt = attemptFor("fake/model", 7);
    let seen;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    await runAttempt(attempt, () =>
      layer(
        "https://api.good.test/v1/chat/completions",
        {
          method: "POST",
          headers: { "content-length": "5", "content-encoding": "gzip" },
          body: stream,
        },
        async (_input, init) => {
          seen = init;
          return new Response("ok", { status: 200 });
        },
      ),
    );
    expect(seen.headers.get("content-length")).toBeNull();
    expect(seen.headers.get("content-encoding")).toBe("gzip");
    expect(seen.duplex).toBe("half");
  });

  test("a pinned openai-codex attempt sends a compressed tool body with its encoding", async () => {
    const layer = createAttemptLayer({
      credentials: {
        resolve: async () => ({
          provider: "openai-codex",
          secret: "codex-secret",
          accountId: "acct-1",
        }),
      },
    });
    const attempt = new Attempt({
      unit: {
        provider: "openai-codex",
        label: "openai-codex:plus#1",
        key: "openai-codex/18",
        credentialId: 18,
      },
      model: "openai-codex/gpt-6.1-terra",
      upstreamHosts: ["chatgpt.com"],
      upstreamPaths: ["/backend-api/codex/responses"],
    });
    const ids = Array.from({ length: 10 }, (_, index) => `call_${index}_${"x".repeat(83)}`);
    const text = JSON.stringify({
      model: "gpt-6.1-terra",
      input: ids.map((id) => ({ type: "function_call", id, call_id: id, name: "tool", arguments: "{}" })),
      tools: ids.map((_, index) => ({
        type: "function",
        name: `tool_${index}`,
        parameters: { type: "object", properties: {} },
      })),
      stream: true,
    });
    const compressed = gzipSync(Buffer.from(text));
    let seen;
    const response = await runAttempt(attempt, () =>
      layer(
        "https://chatgpt.com/backend-api/codex/responses",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-encoding": "gzip",
            "content-length": String(compressed.byteLength),
          },
          body: compressed,
        },
        async (_input, init) => {
          seen = init;
          return Response.json(
            {
              output: [
                {
                  type: "function_call",
                  id: "call_1",
                  call_id: "call_1",
                  name: "tool_0",
                  arguments: "{}",
                },
              ],
            },
            { status: 200 },
          );
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(seen.headers.get("content-encoding")).toBe("gzip");
    expect(seen.headers.get("authorization")).toBe("Bearer codex-secret");
    expect(seen.headers.get("chatgpt-account-id")).toBe("acct-1");
    expect(gunzipSync(Buffer.from(seen.body)).toString("utf8")).toBe(text);
    expect(attempt.result?.ok).toBe(true);
  });
});

describe("near-expiry credential refresh", () => {
  const cloudCodeUrl = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

  /** An Antigravity attempt pinned to one credential row. */
  function antigravityAttempt(credentialId) {
    return new Attempt({
      unit: {
        provider: "google-antigravity",
        label: "google-antigravity:ultra#1",
        key: `google-antigravity/${credentialId}`,
        credentialId,
      },
      model: "google-antigravity/gemini-test",
      upstreamHosts: ["daily-cloudcode-pa.googleapis.com"],
      upstreamPaths: ["/"],
    });
  }

  test("a near-expiry credential is refreshed and the fresh Bearer token is injected", async () => {
    const refreshCalls = [];
    const layer = createAttemptLayer({
      credentials: {
        resolve: async () => ({
          provider: "google-antigravity",
          secret: "stale-secret",
          expiresAt: Date.now() + 30_000,
        }),
        refresh: async (id) => {
          refreshCalls.push(id);
          return { secret: "fresh-secret", expiresAt: Date.now() + 3_600_000 };
        },
      },
    });
    const attempt = antigravityAttempt(12);
    let seen;
    const response = await runAttempt(attempt, () =>
      layer(cloudCodeUrl, { method: "POST", body: JSON.stringify({ model: "gemini-test" }) }, async (_input, init) => {
        seen = init;
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    expect(response.status).toBe(200);
    expect(refreshCalls).toEqual([12]);
    expect(seen.headers.get("authorization")).toBe("Bearer fresh-secret");
  });

  test("a credential with a distant expiry keeps its current secret", async () => {
    let refreshCalls = 0;
    const layer = createAttemptLayer({
      credentials: {
        resolve: async () => ({
          provider: "fake",
          secret: "current-secret",
          expiresAt: Date.now() + 3_600_000,
        }),
        refresh: async () => {
          refreshCalls += 1;
          return { secret: "fresh-secret", expiresAt: Date.now() + 7_200_000 };
        },
      },
    });
    const attempt = attemptFor("fake/model", 7);
    let seen;
    await runAttempt(attempt, () =>
      layer("https://api.good.test/v1/chat/completions", { method: "POST", body: "{}" }, async (_input, init) => {
        seen = init;
        return new Response("ok", { status: 200 });
      }),
    );

    expect(refreshCalls).toBe(0);
    expect(seen.headers.get("authorization")).toBe("Bearer current-secret");
  });
});
