import { describe, expect, it, test } from "bun:test";
import { extractPrompt, install, isAutoModel, isCopilotEndpoint } from "../features/copilot-auto.js";
import { fakeContext } from "./helpers.js";

describe("copilot-auto", () => {
  it("detects copilot endpoints and auto models correctly", () => {
    expect(isCopilotEndpoint("https://api.individual.githubcopilot.com/chat/completions")).toBe(true);
    expect(isCopilotEndpoint("https://api.githubcopilot.com/responses")).toBe(true);
    expect(isCopilotEndpoint("https://api.openai.com/v1/chat/completions")).toBe(false);

    expect(isAutoModel("auto")).toBe(true);
    expect(isAutoModel("copilot-auto")).toBe(true);
    expect(isAutoModel("copilot/auto")).toBe(true);
    expect(isAutoModel("github-copilot/auto")).toBe(true);
    expect(isAutoModel("auto/gpt-5")).toBe(true);
    expect(isAutoModel("copilot/auto/test")).toBe(true);
    expect(isAutoModel("gpt-4o")).toBe(false);
  });

  it("extracts prompt from various request bodies", () => {
    expect(extractPrompt({ prompt: "hello world" })).toBe("hello world");
    expect(extractPrompt({ input: "from input" })).toBe("from input");
    expect(
      extractPrompt({
        messages: [{ role: "user", content: "from messages" }],
      }),
    ).toBe("from messages");
    expect(
      extractPrompt({
        messages: [{ role: "user", content: [{ type: "text", text: "from content parts" }] }],
      }),
    ).toBe("from content parts");
  });

  it("passes through non-copilot requests untouched", async () => {
    const { context, handlers } = fakeContext();
    install({ enabled: true }, context);

    let nextCalled = false;
    const handler = handlers[0];
    await handler(
      "https://api.openai.com/v1/chat/completions",
      { body: JSON.stringify({ model: "auto", messages: [] }) },
      (_target, _init) => {
        nextCalled = true;
        return new Response("ok");
      },
    );

    expect(nextCalled).toBe(true);
  });

  it("negotiates auto model, injects Copilot-Session-Token, and rewrites target if needed", async () => {
    const { context, handlers } = fakeContext();
    install({ enabled: true }, context);

    // Mock global fetch for /auto endpoint
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (typeof url === "string" && url.includes("/auto?")) {
        return new Response(
          JSON.stringify({
            session_token: "mock-jwt-token-12345",
            selected_model: {
              id: "gpt-5.6-luna",
              name: "GPT-5.6 Luna",
              supported_endpoints: ["/responses", "ws:/responses"],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return originalFetch(url, init);
    };

    try {
      const handler = handlers[0];
      let rewrittenTarget;
      let rewrittenInit;

      await handler(
        "https://api.individual.githubcopilot.com/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "github-copilot/auto",
            messages: [{ role: "user", content: "write python code" }],
          }),
        },
        (target, init) => {
          rewrittenTarget = target;
          rewrittenInit = init;
          return new Response("ok");
        },
      );

      // Verify routing rewrote target to /responses because gpt-5.6-luna only supports /responses
      expect(rewrittenTarget).toBe("https://api.individual.githubcopilot.com/responses");

      // Verify Copilot-Session-Token was injected
      const headers = new Headers(rewrittenInit.headers);
      expect(headers.get("Copilot-Session-Token")).toBe("mock-jwt-token-12345");
      expect(headers.get("X-GitHub-Api-Version")).toBe("2026-08-01");
      expect(headers.get("Copilot-Integration-Id")).toBe("vscode-chat");

      // Verify model was rewritten to selected_model
      const body = JSON.parse(rewrittenInit.body);
      expect(body.model).toBe("gpt-5.6-luna");
      expect(body.input).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("copilot-auto Request-body negotiation (/v1/responses route)", () => {
  test("reads a Request streamed body, negotiates on 400, retries with session token", async () => {
    const { context, handlers } = fakeContext();
    install({ enabled: true }, context);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/auto?")) {
        return new Response(
          JSON.stringify({
            session_token: "jwt-abc",
            selected_model: { id: "gpt-5.6-luna", supported_endpoints: ["/responses", "ws:/responses"] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("unexpected", { status: 599 });
    };

    try {
      const handler = handlers[0];
      const request = new Request("https://api.individual.githubcopilot.com/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer gho_test" },
        body: JSON.stringify({ model: "gpt-5.6-luna", input: [{ role: "user", content: "ls" }], stream: true }),
      });

      const calls = [];
      const response = await handler(
        request,
        undefined,
        async (input, init) => {
          calls.push({ input, init });
          if (calls.length === 1) {
            // Request is replayable: the layer must not have consumed it.
            const sent = input instanceof Request ? await input.clone().json() : JSON.parse(init.body);
            if (sent.model === "gpt-5.6-luna" && !new Headers(init?.headers ?? input.headers).has("Copilot-Session-Token")) {
              return new Response(JSON.stringify({ error: { message: "nope", code: "model_not_supported" } }), { status: 400 });
            }
          }
          return new Response("stream-ok", { status: 200 });
        },
      );

      expect(calls.length).toBe(2);
      expect(response.status).toBe(200);
      const retryInit = calls[1].init;
      const retryHeaders = new Headers(retryInit.headers);
      expect(retryHeaders.get("Copilot-Session-Token")).toBe("jwt-abc");
      const retryBody = JSON.parse(retryInit.body);
      expect(retryBody.model).toBe("gpt-5.6-luna");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("copilot-auto streamed init.body negotiation", () => {
  test("buffers a ReadableStream body, negotiates on 400, retries with token and string body", async () => {
    const { context, handlers } = fakeContext();
    install({ enabled: true }, context);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes("/auto?")) {
        return new Response(
          JSON.stringify({
            session_token: "jwt-stream",
            selected_model: { id: "gpt-5.6-luna", supported_endpoints: ["/responses"] },
          }),
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 599 });
    };

    try {
      const handler = handlers[0];
      const payload = JSON.stringify({ model: "gpt-5.6-luna", input: [{ role: "user", content: "ls" }] });
      const calls = [];
      const response = await handler(
        "https://api.individual.githubcopilot.com/responses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer gho_test" },
          body: new Response(payload).body,
          duplex: "half",
        },
        async (_input, init) => {
          calls.push(init);
          const bodyText = typeof init.body === "string" ? init.body : await new Response(init.body).text();
          const sent = JSON.parse(bodyText);
          const hasToken = new Headers(init.headers).has("Copilot-Session-Token");
          if (!hasToken) {
            return new Response(JSON.stringify({ error: { code: "model_not_supported" } }), { status: 400 });
          }
          return new Response("ok", { status: 200 });
        },
      );

      expect(calls.length).toBe(2);
      expect(response.status).toBe(200);
      // original body must survive buffering and arrive intact on first pass
      expect(JSON.parse(await new Response(calls[0].body).text()).model).toBe("gpt-5.6-luna");
      expect(new Headers(calls[1].headers).get("Copilot-Session-Token")).toBe("jwt-stream");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
