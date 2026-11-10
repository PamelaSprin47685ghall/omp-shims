// Contract tests for the v2 Antigravity module.
//
// The module installs several outbound layers in one call. These tests drive
// them in priority order and check the two properties that matter most:
// every Cloud Code body is sanitized, and a continuation replay is sanitized
// again after its body is rebuilt.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  install,
  rewriteRouting,
  rewriteSystemInstruction,
  sanitizeCloudCodeBody,
  sanitizeSchemaEnums,
} from "../features/antigravity.mjs";
import { CredentialRepository } from "../lib/credentials.mjs";
import { sanitizeAntigravityBody } from "../lib/router/formats.mjs";
import { CLOUD_CODE_URL, fakeContext, parseSse, tempDir } from "./helpers.mjs";

const disposers = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

/** Run one request through the recorded layers, outermost first. */
function drive(entries, input, init, next) {
  const sorted = [...entries].sort((left, right) => left.priority - right.priority);
  const call = (index, nextInput, nextInit) =>
    index >= sorted.length
      ? next(nextInput, nextInit)
      : sorted[index](nextInput, nextInit, (innerInput, innerInit) => call(index + 1, innerInput, innerInit));
  return call(0, input, init);
}

/** A tool declaration with one schema key. */
function declaration(name, key, schema) {
  return { name, [key]: schema };
}

/** A body whose schemas live under custom tool keys and a bare tool key. */
function customToolBody() {
  return {
    request: {
      contents: [{ role: "user", parts: [{ text: "keep me byte-identical" }] }],
      tools: [
        {
          custom: {
            name: "mcp_status",
            input_schema: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["a", "b", ""] },
                empty: { type: "string", enum: [""] },
                legacy: { type: "string", enum_: ["", ""] },
              },
            },
          },
        },
        {
          custom: {
            name: "mcp_more",
            inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["", "x"] } } },
          },
        },
      ],
    },
    tools: [
      {
        name: "variant",
        parametersJsonSchema: {
          type: "object",
          properties: { level: { type: "string", enum: ["low", "", "high"] } },
        },
      },
      {
        custom: {
          name: "response_variant",
          response_schema: {
            type: "object",
            properties: { ok: { type: "string", enum: ["", "yes"] } },
          },
        },
      },
    ],
  };
}

const LONG_KEY = "k".repeat(70);

/** A body with property names the provider rejects at several schema depths. */
function invalidKeyBody() {
  return {
    request: {
      contents: [{ role: "user", parts: [{ text: "keep me byte-identical" }] }],
      tools: [
        {
          custom: {
            name: "mcp_keys",
            input_schema: {
              type: "object",
              properties: {
                ok: { type: "string" },
                [LONG_KEY]: { type: "string" },
                "bad key!": { type: "string" },
                details: {
                  type: "object",
                  properties: {
                    nested_ok: { type: "string" },
                    "also bad!": { type: "string" },
                  },
                  required: ["nested_ok", "also bad!"],
                },
              },
              required: ["ok", LONG_KEY, "bad key!", "details"],
            },
          },
        },
      ],
    },
    tools: [
      {
        name: "variant",
        parametersJsonSchema: {
          type: "object",
          properties: { level: { type: "string" }, ["x".repeat(70)]: { type: "string" } },
          required: ["level", "x".repeat(70)],
        },
      },
    ],
  };
}

/** A request body with the live offender at a late tool index. */
function offenderBody() {
  const tools = Array.from({ length: 12 }, (_, index) => ({
    functionDeclarations: [
      index === 11
        ? declaration("update_goal_task", "parameters", {
            type: "object",
            properties: {
              status: { type: "string", enum: ["start", "complete", "skipped", "pending", ""] },
            },
          })
        : declaration(`tool_${index}`, "parameters", { type: "object", properties: {} }),
    ],
  }));

  return {
    model: "gemini-4-argon",
    requestType: "agent",
    request: {
      systemInstruction: { parts: [{ text: "be concise" }] },
      contents: [{ role: "user", parts: [{ text: "go" }] }],
      generationConfig: { maxOutputTokens: 100 },
      tools,
    },
  };
}

function sseBlock(payload) {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

/** A response whose body is split inside the first CRLF pair. */
function splitResponse(text) {
  const cut = text.indexOf("\r\n") + 1;
  const parts = [text.slice(0, cut), text.slice(cut, cut + 1), text.slice(cut + 1)];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("enum sanitizer", () => {
  test("cleans an empty enum at a late tool index and inside parametersJsonSchema $defs", () => {
    const tools = Array.from({ length: 12 }, (_, index) => ({
      functionDeclarations: [
        index === 11
          ? declaration("update_goal_task", "parametersJsonSchema", {
              type: "object",
              $defs: {
                nested: { items: { anyOf: [{ enum: ["", "kept"] }] } },
              },
              properties: { status: { enum: ["start", ""] } },
            })
          : declaration(`tool_${index}`, "parameters", { type: "object" }),
      ],
    }));

    const rewritten = sanitizeCloudCodeBody(JSON.stringify({ request: { tools } }));
    expect(typeof rewritten).toBe("string");
    const parsed = JSON.parse(rewritten);
    const schema = parsed.request.tools[11].functionDeclarations[0].parametersJsonSchema;
    expect(schema.properties.status.enum).toEqual(["start"]);
    expect(schema.$defs.nested.items.anyOf[0].enum).toEqual(["kept"]);
  });

  test("keeps a malformed body and writes one report line", () => {
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.join(" "));
    try {
      expect(sanitizeCloudCodeBody("{not json")).toBeUndefined();
    } finally {
      console.error = original;
    }
    expect(lines.filter((line) => line.includes("enum sanitizer failed open"))).toHaveLength(1);
  });

  test("sanitizes a 200-level schema and survives a cyclic object", () => {
    const root = { type: "object" };
    let node = root;
    for (let depth = 0; depth < 200; depth++) {
      node.properties = { p: { type: "object" } };
      node = node.properties.p;
    }
    node.enum = ["", "deep"];

    const body = JSON.stringify({
      request: { tools: [{ functionDeclarations: [{ name: "deep", parameters: root }] }] },
    });
    const parsed = JSON.parse(sanitizeCloudCodeBody(body));
    let walked = parsed.request.tools[0].functionDeclarations[0].parameters;
    for (let depth = 0; depth < 200; depth++) walked = walked.properties.p;
    expect(walked.enum).toEqual(["deep"]);

    const cyclic = { type: "object", enum: ["", "x"] };
    cyclic.properties = { self: cyclic };
    let result;
    expect(() => {
      result = sanitizeSchemaEnums(cyclic);
    }).not.toThrow();
    expect(result).toBe(1);
  });

  test("cleans custom tool schemas and leaves contents byte-identical", () => {
    const body = customToolBody();
    const contents = JSON.stringify(body.request.contents);
    const rewritten = sanitizeCloudCodeBody(JSON.stringify(body));
    expect(typeof rewritten).toBe("string");
    const parsed = JSON.parse(rewritten);
    expect(parsed.request.tools[0].custom.input_schema.properties.status.enum).toEqual(["a", "b"]);
    expect(Object.hasOwn(parsed.request.tools[0].custom.input_schema.properties.empty, "enum")).toBe(false);
    expect(Object.hasOwn(parsed.request.tools[0].custom.input_schema.properties.legacy, "enum_")).toBe(false);
    expect(parsed.request.tools[1].custom.inputSchema.properties.mode.enum).toEqual(["x"]);
    expect(parsed.tools[0].parametersJsonSchema.properties.level.enum).toEqual(["low", "high"]);
    expect(parsed.tools[1].custom.response_schema.properties.ok.enum).toEqual(["yes"]);
    expect(JSON.stringify(parsed.request.contents)).toBe(contents);
    expect(parsed.tools).toHaveLength(2);
    expect(sanitizeCloudCodeBody(rewritten)).toBeUndefined();
  });

  test("the router sanitizer cleans the same custom tool schemas in place", () => {
    const body = customToolBody();
    const contents = JSON.stringify(body.request.contents);
    expect(sanitizeAntigravityBody(body)).toBe(true);
    expect(body.request.tools[0].custom.input_schema.properties.status.enum).toEqual(["a", "b"]);
    expect(Object.hasOwn(body.request.tools[0].custom.input_schema.properties.empty, "enum")).toBe(false);
    expect(Object.hasOwn(body.request.tools[0].custom.input_schema.properties.legacy, "enum_")).toBe(false);
    expect(body.request.tools[1].custom.inputSchema.properties.mode.enum).toEqual(["x"]);
    expect(body.tools[0].parametersJsonSchema.properties.level.enum).toEqual(["low", "high"]);
    expect(body.tools[1].custom.response_schema.properties.ok.enum).toEqual(["yes"]);
    expect(JSON.stringify(body.request.contents)).toBe(contents);
    expect(body.tools).toHaveLength(2);
    const clean = JSON.stringify(body);
    expect(sanitizeAntigravityBody(body)).toBe(false);
    expect(JSON.stringify(body)).toBe(clean);
  });

  test("drops invalid property keys and repairs required in a Cloud Code body", () => {
    const body = invalidKeyBody();
    const contents = JSON.stringify(body.request.contents);
    const lines = [];
    const original = console.error;
    const verbose = process.env.OMP_SHIMS_VERBOSE;
    process.env.OMP_SHIMS_VERBOSE = "1";
    console.error = (...args) => lines.push(args.join(" "));
    let rewritten;
    try {
      rewritten = sanitizeCloudCodeBody(JSON.stringify(body));
    } finally {
      console.error = original;
      if (verbose === undefined) delete process.env.OMP_SHIMS_VERBOSE;
      else process.env.OMP_SHIMS_VERBOSE = verbose;
    }
    expect(typeof rewritten).toBe("string");
    const parsed = JSON.parse(rewritten);
    const schema = parsed.request.tools[0].custom.input_schema;
    expect(Object.keys(schema.properties)).toEqual(["ok", "details"]);
    expect(schema.required).toEqual(["ok", "details"]);
    expect(Object.keys(schema.properties.details.properties)).toEqual(["nested_ok"]);
    expect(schema.properties.details.required).toEqual(["nested_ok"]);
    expect(Object.keys(parsed.tools[0].parametersJsonSchema.properties)).toEqual(["level"]);
    expect(parsed.tools[0].parametersJsonSchema.required).toEqual(["level"]);
    expect(JSON.stringify(parsed.request.contents)).toBe(contents);
    expect(parsed.request.tools).toHaveLength(1);
    expect(parsed.tools).toHaveLength(1);
    expect(sanitizeCloudCodeBody(rewritten)).toBeUndefined();

    const keyLogs = lines.filter((line) => line.includes("dropped invalid tool property keys"));
    expect(keyLogs).toHaveLength(1);
    expect(keyLogs[0]).toContain(`"droppedKeys":["${LONG_KEY}","bad key!"]`);
    expect(keyLogs[0]).not.toContain('"type":"string"');
  });

  test("the router sanitizer drops invalid property keys in place", () => {
    const body = invalidKeyBody();
    const contents = JSON.stringify(body.request.contents);
    const lines = [];
    const original = console.error;
    const verbose = process.env.OMP_SHIMS_VERBOSE;
    process.env.OMP_SHIMS_VERBOSE = "1";
    console.error = (...args) => lines.push(args.join(" "));
    let changed;
    try {
      changed = sanitizeAntigravityBody(body);
    } finally {
      console.error = original;
      if (verbose === undefined) delete process.env.OMP_SHIMS_VERBOSE;
      else process.env.OMP_SHIMS_VERBOSE = verbose;
    }
    expect(changed).toBe(true);
    const schema = body.request.tools[0].custom.input_schema;
    expect(Object.keys(schema.properties)).toEqual(["ok", "details"]);
    expect(schema.required).toEqual(["ok", "details"]);
    expect(Object.keys(schema.properties.details.properties)).toEqual(["nested_ok"]);
    expect(schema.properties.details.required).toEqual(["nested_ok"]);
    expect(Object.keys(body.tools[0].parametersJsonSchema.properties)).toEqual(["level"]);
    expect(body.tools[0].parametersJsonSchema.required).toEqual(["level"]);
    expect(JSON.stringify(body.request.contents)).toBe(contents);
    expect(body.request.tools).toHaveLength(1);
    expect(body.tools).toHaveLength(1);
    const clean = JSON.stringify(body);
    expect(sanitizeAntigravityBody(body)).toBe(false);
    expect(JSON.stringify(body)).toBe(clean);

    const keyLogs = lines.filter((line) => line.includes("dropped invalid tool property keys"));
    expect(keyLogs).toHaveLength(1);
    expect(keyLogs[0]).toContain(`"droppedKeys":["${LONG_KEY}","bad key!"]`);
    expect(keyLogs[0]).not.toContain('"type":"string"');
  });
});

describe("system instruction gate", () => {
  /** A native OMP 18.18 envelope: no requestType, request.systemInstruction. */
  function nativeBody() {
    return JSON.stringify({
      model: "gemini-4-argon",
      request: {
        systemInstruction: { parts: [{ text: "be concise" }] },
        contents: [{ role: "user", parts: [{ text: "go" }] }],
        generationConfig: { maxOutputTokens: 100 },
      },
    });
  }

  test("keeps a native envelope's systemInstruction untouched", () => {
    expect(rewriteSystemInstruction(nativeBody())).toBeUndefined();
  });

  test("moves an agent envelope's systemInstruction into a leading user turn", () => {
    const body = JSON.parse(rewriteSystemInstruction(JSON.stringify(offenderBody())));
    expect(body.request.systemInstruction).toBeUndefined();
    expect(body.request.contents[0]).toEqual({ role: "user", parts: [{ text: "be concise" }] });
    expect(body.request.generationConfig.maxOutputTokens).toBe(8192);
  });

  test("forceSystemInstruction opts a native envelope in", () => {
    const body = JSON.parse(rewriteSystemInstruction(nativeBody(), true));
    expect(body.request.systemInstruction).toBeUndefined();
    expect(body.request.contents[0]).toEqual({ role: "user", parts: [{ text: "be concise" }] });
  });

  /** Drive one body through the installed systemInstruction layer. */
  async function runInstalled(config, body) {
    const directory = tempDir("e5-antigravity-gate-");
    const { context, outbound } = fakeContext({ paths: { stateDbPath: ":memory:", logsDir: directory } });
    const dispose = await install(
      {
        enabled: true,
        routing: false,
        continuation: false,
        capture: false,
        accountRouting: false,
        ...config,
      },
      context,
    );
    disposers.push(dispose);
    let seen;
    const response = await drive(outbound, CLOUD_CODE_URL, { method: "POST", body }, async (_input, init) => {
      seen = init.body;
      return new Response("ok", { status: 200 });
    });
    await response.text();
    return seen;
  }

  test("the installed layer leaves a native envelope byte-identical", async () => {
    const body = nativeBody();
    expect(await runInstalled({ systemInstruction: true }, body)).toBe(body);
  });

  test("forceSystemInstruction opts the installed layer in", async () => {
    const seen = await runInstalled({ systemInstruction: true, forceSystemInstruction: true }, nativeBody());
    const parsed = JSON.parse(seen);
    expect(parsed.request.systemInstruction).toBeUndefined();
    expect(parsed.request.contents[0]).toEqual({ role: "user", parts: [{ text: "be concise" }] });
  });
});

describe("routing gate", () => {
  test("routes an agent envelope and leaves a native envelope alone", () => {
    const agent = {
      model: "gemini-3.8-flash",
      requestType: "agent",
      request: { generationConfig: { maxOutputTokens: 1000 } },
    };
    const routed = JSON.parse(rewriteRouting(JSON.stringify(agent), "HIGH"));
    expect(routed.model).toBe("gemini-3.8-flash-tiered");
    expect(routed.request.generationConfig.thinkingConfig.thinkingLevel).toBe("HIGH");

    const native = { ...agent };
    delete native.requestType;
    expect(rewriteRouting(JSON.stringify(native), "HIGH")).toBeUndefined();
  });

  test("a configured tiered pattern replaces the preset families", () => {
    const body = {
      model: "custom-flash",
      requestType: "agent",
      request: { generationConfig: { maxOutputTokens: 1000 } },
    };
    const routed = JSON.parse(rewriteRouting(JSON.stringify(body), "HIGH", /^(custom-flash)$/));
    expect(routed.model).toBe("custom-flash-tiered");

    const presetFamily = { ...body, model: "gemini-3.8-flash" };
    expect(rewriteRouting(JSON.stringify(presetFamily), "HIGH", /^(custom-flash)$/)).toBeUndefined();
  });

  test("the installed routing layer honors the resolved config pattern", async () => {
    const body = JSON.stringify({
      model: "custom-flash",
      requestType: "agent",
      request: { generationConfig: { maxOutputTokens: 1000 } },
    });
    const directory = tempDir("e5-antigravity-pattern-");
    const { context, outbound } = fakeContext({ paths: { stateDbPath: ":memory:", logsDir: directory } });
    const dispose = await install(
      {
        enabled: true,
        systemInstruction: false,
        routing: true,
        tieredPattern: "^(custom-flash)$",
        continuation: false,
        capture: false,
        accountRouting: false,
      },
      context,
    );
    disposers.push(dispose);
    let seen;
    await drive(outbound, CLOUD_CODE_URL, { method: "POST", body }, async (_input, init) => {
      seen = init.body;
      return new Response("ok", { status: 200 });
    });
    expect(JSON.parse(seen).model).toBe("custom-flash-tiered");
  });
});

describe("usage metadata on every chunk", () => {
  /**
   * The live Cloud Code stream attaches usageMetadata to every incremental
   * chunk, while finishReason arrives only on the last one. The body yields one
   * chunk per read, so an early reader.cancel() truncates the answer.
   */
  function usageEveryChunkResponse(onCancel) {
    const chunks = [
      {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] } }],
          usageMetadata: { promptTokenCount: 10 },
        },
      },
      {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "lo" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        },
      },
      {
        response: {
          candidates: [{ content: { role: "model", parts: [{ text: "!" }] }, finishReason: "STOP" }],
          usageMetadata: { totalTokenCount: 13 },
        },
      },
    ];
    const encoder = new TextEncoder();
    let index = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(sseBlock(chunks[index])));
          index += 1;
        },
        cancel: onCancel,
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  /** Texts and finish reasons that reached the downstream consumer. */
  function received(text) {
    const candidates = parseSse(text).flatMap((frame) => frame.response?.candidates ?? []);
    return {
      texts: candidates.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text),
      reasons: candidates.map((candidate) => candidate.finishReason).filter(Boolean),
    };
  }

  async function runPipeline(config, onCancel) {
    const directory = tempDir("e5-antigravity-usage-");
    const { context, outbound } = fakeContext({
      paths: { stateDbPath: ":memory:", logsDir: directory },
    });
    const dispose = await install(
      {
        enabled: true,
        systemInstruction: false,
        routing: false,
        continuation: true,
        maxContinuations: 3,
        locationRetries: 0,
        idleTimeoutMs: 0,
        capture: false,
        accountRouting: false,
        ...config,
      },
      context,
    );
    disposers.push(dispose);
    return drive(
      outbound,
      CLOUD_CODE_URL,
      {
        method: "POST",
        body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "go" }] }] } }),
      },
      async () => usageEveryChunkResponse(onCancel),
    );
  }

  test("forwards every incremental chunk and the terminal finishReason", async () => {
    let cancelled = false;
    const response = await runPipeline({ maxContinuations: 3 }, () => {
      cancelled = true;
    });
    const result = received(await response.text());
    expect(result.texts).toEqual(["Hel", "lo", "!"]);
    expect(result.reasons).toEqual(["STOP"]);
    expect(cancelled).toBe(false);
  });

  test("pass-through mode also preserves every chunk and the finishReason", async () => {
    let cancelled = false;
    const response = await runPipeline({ maxContinuations: 0 }, () => {
      cancelled = true;
    });
    const result = received(await response.text());
    expect(result.texts).toEqual(["Hel", "lo", "!"]);
    expect(result.reasons).toEqual(["STOP"]);
    expect(cancelled).toBe(false);
  });
});

describe("installed pipeline", () => {
  test("sanitizes the first request and the rebuilt continuation body", async () => {
    const directory = tempDir("e5-antigravity-");
    const { context, outbound } = fakeContext({
      paths: { stateDbPath: join(directory, "state.sqlite"), logsDir: directory },
    });
    const dispose = await install(
      {
        enabled: true,
        systemInstruction: true,
        routing: false,
        continuation: true,
        maxContinuations: 3,
        locationRetries: 0,
        idleTimeoutMs: 0,
        capture: false,
        accountRouting: false,
      },
      context,
    );
    disposers.push(dispose);

    const thought = { response: { candidates: [{ content: { parts: [{ thought: true, text: "planning" }] } }] } };
    const stop = { response: { candidates: [{ finishReason: "STOP" }] } };
    const answer = {
      response: { candidates: [{ content: { parts: [{ text: "final answer" }] }, finishReason: "STOP" }] },
    };

    const calls = [];
    const next = async (_input, init) => {
      calls.push({ body: init.body, headers: new Headers(init.headers) });
      if (calls.length === 1) return splitResponse(sseBlock(thought) + sseBlock(stop));
      return new Response(sseBlock(answer), { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    const response = await drive(
      outbound,
      CLOUD_CODE_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "999" },
        body: JSON.stringify(offenderBody()),
      },
      next,
    );
    const text = await response.text();

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.headers.has("content-encoding")).toBe(false);
      expect(call.headers.has("content-length")).toBe(false);
    }
    const first = JSON.parse(calls[0].body);
    expect(first.request.systemInstruction).toBeUndefined();
    expect(first.request.contents[0]).toEqual({ role: "user", parts: [{ text: "be concise" }] });
    expect(first.request.generationConfig.maxOutputTokens).toBe(8192);
    expect(first.request.tools[11].functionDeclarations[0].parameters.properties.status.enum).toEqual([
      "start",
      "complete",
      "skipped",
      "pending",
    ]);

    const retry = JSON.parse(calls[1].body);
    expect(retry.request.contents.at(-1).role).toBe("user");
    expect(retry.request.tools[11].functionDeclarations[0].parameters.properties.status.enum).toEqual([
      "start",
      "complete",
      "skipped",
      "pending",
    ]);

    expect(text).toContain("final answer");
    const frames = parseSse(text);
    expect(
      frames.filter((frame) => frame.response?.candidates?.some((candidate) => candidate.finishReason)),
    ).toHaveLength(1);
  });
});

describe("account routing", () => {
  test("drains candidates through a memory state store and sanitizes every re-issue", async () => {
    const directory = tempDir("e5-antigravity-accounts-");
    const originalList = CredentialRepository.prototype.listAccounts;
    const originalResolve = CredentialRepository.prototype.resolve;
    const originalRefresh = CredentialRepository.prototype.refresh;
    const accounts = [
      { id: 1, email: "one@example.com", tier: "pro", disabled: false },
      { id: 2, email: "two@example.com", tier: "pro", disabled: false },
    ];
    CredentialRepository.prototype.listAccounts = async () => accounts;
    CredentialRepository.prototype.resolve = async (_provider, filter) => ({
      id: filter.id,
      secret: `secret-${filter.id}`,
      expiresAt: Date.now() + 3_600_000,
    });
    CredentialRepository.prototype.refresh = async () => undefined;

    try {
      const { context, outbound } = fakeContext({
        paths: { stateDbPath: ":memory:", logsDir: directory },
      });
      const dispose = await install(
        {
          enabled: true,
          systemInstruction: false,
          routing: false,
          continuation: false,
          capture: false,
          accountRouting: true,
          proAccounts: [],
          ultraAccounts: [],
          cooldownMs: 1_000,
        },
        context,
      );
      disposers.push(dispose);

      const bodies = [];
      const authorizations = [];
      const next = async (_input, init) => {
        bodies.push(JSON.parse(init.body));
        authorizations.push(new Headers(init.headers).get("authorization"));
        if (bodies.length === 1) return new Response(JSON.stringify({ retryDelay: "5s" }), { status: 429 });
        return new Response("ok", { status: 200 });
      };

      const response = await drive(
        outbound,
        CLOUD_CODE_URL,
        {
          method: "POST",
          body: JSON.stringify({ ...offenderBody(), model: "gemini-3.8-flash" }),
        },
        next,
      );

      expect(await response.text()).toBe("ok");
      expect(authorizations).toEqual(["Bearer secret-1", "Bearer secret-2"]);
      for (const body of bodies) {
        expect(body.request.tools[11].functionDeclarations[0].parameters.properties.status.enum).toEqual([
          "start",
          "complete",
          "skipped",
          "pending",
        ]);
      }
    } finally {
      CredentialRepository.prototype.listAccounts = originalList;
      CredentialRepository.prototype.resolve = originalResolve;
      CredentialRepository.prototype.refresh = originalRefresh;
    }
  });

  test("a duplicate email resolves by row id and never borrows another row's secret", async () => {
    const directory = tempDir("e5-antigravity-duplicate-");
    const originalList = CredentialRepository.prototype.listAccounts;
    const originalResolve = CredentialRepository.prototype.resolve;
    const originalRefresh = CredentialRepository.prototype.refresh;
    const filters = [];

    CredentialRepository.prototype.listAccounts = async () => [
      { id: 11, email: "same@example.com", tier: "pro", disabled: false },
      { id: 12, email: "same@example.com", tier: "pro", disabled: false },
    ];
    CredentialRepository.prototype.resolve = async (_provider, filter) => {
      filters.push(filter);
      return { id: filter.id, secret: `secret-${filter.id}`, expiresAt: Date.now() + 3_600_000 };
    };
    CredentialRepository.prototype.refresh = async () => undefined;

    try {
      const { context, outbound } = fakeContext({
        paths: { stateDbPath: ":memory:", logsDir: directory },
      });
      const dispose = await install(
        {
          enabled: true,
          systemInstruction: false,
          routing: false,
          continuation: false,
          capture: false,
          accountRouting: true,
          proAccounts: [],
          ultraAccounts: [],
        },
        context,
      );
      disposers.push(dispose);

      let authorization;
      await drive(
        outbound,
        CLOUD_CODE_URL,
        { method: "POST", body: JSON.stringify({ ...offenderBody(), model: "gemini-3.8-flash" }) },
        async (_input, init) => {
          authorization = new Headers(init.headers).get("authorization");
          return new Response("ok", { status: 200 });
        },
      );

      expect(authorization).toBe("Bearer secret-11");
      expect(filters).toEqual([{ id: 11 }]);
    } finally {
      CredentialRepository.prototype.listAccounts = originalList;
      CredentialRepository.prototype.resolve = originalResolve;
      CredentialRepository.prototype.refresh = originalRefresh;
    }
  });
});

describe("diagnostics", () => {
  test("capture redacts URL secrets and never stores raw upstream text", async () => {
    const directory = tempDir("e5-antigravity-capture-");
    const out = join(directory, "capture.jsonl");
    const { context, outbound } = fakeContext({ paths: { logsDir: directory, stateDbPath: ":memory:" } });
    const dispose = await install(
      {
        enabled: true,
        systemInstruction: false,
        routing: false,
        continuation: false,
        capture: true,
        captureOut: out,
        accountRouting: false,
      },
      context,
    );

    const malformed = { response: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL" }] } };
    const body = {
      response: { candidates: [{ content: { parts: [{ text: "TOPSECRET-RESPONSE-TEXT" }] } }] },
    };
    try {
      const response = await drive(
        outbound,
        `${CLOUD_CODE_URL}&key=SECRET-QUERY`,
        { method: "POST", body: JSON.stringify({ request: { contents: [] } }) },
        async () =>
          new Response(sseBlock(malformed) + sseBlock(body), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      );
      await response.text();
    } finally {
      dispose();
    }
    await Bun.sleep(120);

    const written = readFileSync(out, "utf8");
    expect(written).not.toContain("SECRET-QUERY");
    expect(written).not.toContain("TOPSECRET-RESPONSE-TEXT");
    expect(written).toContain("malformed-function-call");
    expect(written).toContain("sha256:");
  });

  test("region retries record only the host", async () => {
    const directory = tempDir("e5-antigravity-region-");
    const out = join(directory, "continuation.jsonl");
    const { context, outbound } = fakeContext({ paths: { logsDir: directory, stateDbPath: ":memory:" } });
    const dispose = await install(
      {
        enabled: true,
        systemInstruction: false,
        routing: false,
        continuation: true,
        maxContinuations: 0,
        locationRetries: 1,
        continuationOut: out,
        capture: false,
        accountRouting: false,
      },
      context,
    );

    const url = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse&key=SECRET-QUERY";
    let calls = 0;
    try {
      const response = await drive(
        outbound,
        url,
        { method: "POST", body: JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "q" }] }] } }) },
        async () => {
          calls += 1;
          if (calls === 1) return new Response("User location is not supported", { status: 403 });
          return new Response(sseBlock({ response: { candidates: [{ finishReason: "STOP" }] } }), {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
      );
      await response.text();
    } finally {
      dispose();
    }
    await Bun.sleep(120);

    expect(calls).toBe(2);
    const written = readFileSync(out, "utf8");
    expect(written).not.toContain("SECRET-QUERY");
    expect(written).not.toContain("v1internal");
    expect(written).toContain("daily-cloudcode-pa.googleapis.com");
    expect(written).toContain("region-retry");
  });
});
