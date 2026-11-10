// Catalog, tier, and provider-fallback regressions for the live v2 cutover.

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lazyRouterHandler } from "../features/lazy-router.mjs";
import { listExtensionProviders, registerExtensionProviderMeta } from "../lib/host-bridge.mjs";
import { Attempt, runAttempt } from "../lib/router/attempt.mjs";
import { ModelCatalog } from "../lib/router/catalog.mjs";
import { withCustomProviderFallback } from "../lib/router/custom-provider-fallback.mjs";
import { withExtensionFallback } from "../lib/router/extension-fallback.mjs";
import { classifyFailure, FAILURE } from "../lib/router/failures.mjs";
import { clearOfficialModelCache, officialModels } from "../lib/router/model-cache.mjs";
import { AccountDirectory } from "../lib/router/tiers.mjs";

/** Build an unsigned JWT with the given payload. */
function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;
}

const temporary = [];
afterEach(() => {
  clearOfficialModelCache();
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("live account tiers", () => {
  test("openai-codex reads the ChatGPT plan from the JWT claim", async () => {
    const secret = jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: "Plus" } });
    const credentials = {
      listProviders: async () => ["openai-codex"],
      listAccounts: async () => [{ id: 1 }],
      resolve: async () => ({ secret, expiresAt: 0 }),
    };
    const directory = new AccountDirectory({ credentials, providers: [], now: () => 1_000 });
    await directory.refresh();
    expect(directory.tierOf("openai-codex", 1)).toBe("plus");
  });

  test("google-antigravity resolves loadCodeAssist and refreshes an expiring token", async () => {
    const calls = [];
    let refreshCalls = 0;
    const credentials = {
      listProviders: async () => ["google-antigravity"],
      listAccounts: async () => [{ id: 2 }],
      resolve: async () => ({ secret: "old-secret", expiresAt: Date.now() + 1_000 }),
      refresh: async () => {
        refreshCalls += 1;
        return { secret: "new-secret", expiresAt: Date.now() + 3_600_000 };
      },
    };
    const fetch = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ paidTier: { id: "g1-ultra-tier" } });
    };
    const directory = new AccountDirectory({
      credentials,
      providers: [],
      fetch,
      now: () => Date.now(),
    });
    await directory.refresh();
    expect(refreshCalls).toBe(1);
    expect(directory.tierOf("google-antigravity", 2)).toBe("ultra");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
    expect(calls[0].init.headers.authorization).toBe("Bearer new-secret");
    expect(calls[0].init.headers["user-agent"]).toBe("antigravity");
    expect(JSON.parse(calls[0].init.body).metadata.ideType).toBe("ANTIGRAVITY");
  });
});

describe("models.db traits", () => {
  test("official models are found when the host snapshot is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-router-cache-"));
    temporary.push(dir);
    const db = new Database(join(dir, "models.db"), { create: true });
    db.exec("CREATE TABLE model_cache (provider_id TEXT PRIMARY KEY, models TEXT)");
    db.query("INSERT INTO model_cache (provider_id, models) VALUES (?, ?)").run(
      "google-antigravity",
      JSON.stringify([
        {
          provider: "google-antigravity",
          id: "gemini-4-argon",
          contextWindow: 1_000_000,
          maxTokens: 64_000,
          input: ["text", "image"],
          reasoning: true,
          thinking: { efforts: ["low", "high"], requiresEffort: false },
          baseUrl: "https://daily-cloudcode-pa.googleapis.com",
        },
      ]),
    );
    db.close();

    const catalog = new ModelCatalog({
      hostSnapshot: () => [],
      extensionProviders: () => [],
      customProviders: () => [],
      agentDbPath: join(dir, "agent.db"),
    });
    const traits = catalog.find("google-antigravity/gemini-4-argon");
    expect(traits).toBeDefined();
    expect(traits.contextWindow).toBe(1_000_000);
    expect(traits.maxTokens).toBe(64_000);
    expect(traits.input).toEqual(["text", "image"]);
    expect(traits.reasoning).toBe(true);
    expect(traits.baseUrl).toBe("https://daily-cloudcode-pa.googleapis.com");
    expect(catalog.hasNativeModel("google-antigravity/gemini-4-argon")).toBe(true);
  });

  test("a registered extension provider hides its stale models.db entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-router-extension-cache-"));
    temporary.push(dir);
    const dbPath = join(dir, "models.db");
    const db = new Database(dbPath, { create: true });
    db.exec("CREATE TABLE model_cache (provider_id TEXT PRIMARY KEY, models TEXT)");
    db.query("INSERT INTO model_cache (provider_id, models) VALUES (?, ?)").run(
      "kiro",
      JSON.stringify([
        {
          provider: "kiro",
          id: "claude-opus-5-5",
          contextWindow: 500_000,
          maxTokens: 64_000,
          input: ["text"],
          reasoning: true,
          baseUrl: "https://stale-kiro.example.test/v1",
        },
      ]),
    );
    db.close();

    const dispose = registerExtensionProviderMeta("kiro", {
      api: "openai-completions",
      models: [{ id: "claude-opus-5", contextWindow: 200_000, maxTokens: 8_000 }],
    });
    try {
      // Prove the stale row is readable; the live plugin must still win.
      expect(officialModels("kiro", { path: dbPath }).has("kiro/claude-opus-5-5")).toBe(true);
      expect(listExtensionProviders().map((row) => row.id)).toEqual(["kiro/claude-opus-5"]);

      const catalog = new ModelCatalog({
        hostSnapshot: () => [],
        customProviders: () => [],
        agentDbPath: join(dir, "agent.db"),
      });
      // Even a gateway row built from the same stale cache cannot resurrect it.
      catalog.ingestGatewayModels([
        {
          id: "kiro/claude-opus-5-5",
          object: "model",
          context_length: 500_000,
          max_output_tokens: 64_000,
          input_modalities: ["text"],
        },
      ]);

      const live = catalog.find("kiro/claude-opus-5");
      expect(live).toBeDefined();
      expect(live.contextWindow).toBe(200_000);
      expect(catalog.hasNativeModel("kiro/claude-opus-5")).toBe(true);

      expect(catalog.find("kiro/claude-opus-5-5")).toBeUndefined();
      expect(catalog.baseUrlOf("kiro/claude-opus-5-5")).toBeUndefined();
      expect(catalog.hasNativeModel("kiro/claude-opus-5-5")).toBe(false);
    } finally {
      dispose();
    }
  });

  test("a versioned provider cache row answers its logical provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-router-versioned-cache-"));
    temporary.push(dir);
    const db = new Database(join(dir, "models.db"), { create: true });
    db.exec("CREATE TABLE model_cache (provider_id TEXT PRIMARY KEY, models TEXT)");
    db.query("INSERT INTO model_cache (provider_id, models) VALUES (?, ?)").run(
      "openai-codex:0.159.0",
      JSON.stringify([
        {
          provider: "openai-codex",
          id: "gpt-6.1-terra",
          api: "openai-codex-responses",
          contextWindow: 500_000,
          maxTokens: 128_000,
          input: ["text", "image"],
          reasoning: true,
          baseUrl: "https://chatgpt.com/backend-api",
        },
      ]),
    );
    db.close();

    expect(officialModels("openai-codex", { path: join(dir, "models.db") }).has("openai-codex/gpt-6.1-terra")).toBe(
      true,
    );

    const catalog = new ModelCatalog({
      hostSnapshot: () => [],
      extensionProviders: () => [],
      customProviders: () => [],
      agentDbPath: join(dir, "agent.db"),
    });
    const traits = catalog.find("openai-codex/gpt-6.1-terra");
    expect(traits).toBeDefined();
    expect(traits.contextWindow).toBe(500_000);
    expect(traits.maxTokens).toBe(128_000);
    expect(traits.input).toEqual(["text", "image"]);
    expect(traits.baseUrl).toBe("https://chatgpt.com/backend-api");
    expect(catalog.hasNativeModel("openai-codex/gpt-6.1-terra")).toBe(true);
  });

  test("an exact provider row wins over a versioned duplicate", () => {
    const dir = mkdtempSync(join(tmpdir(), "omp-router-exact-cache-"));
    temporary.push(dir);
    const dbPath = join(dir, "models.db");
    const db = new Database(dbPath, { create: true });
    db.exec("CREATE TABLE model_cache (provider_id TEXT PRIMARY KEY, models TEXT)");
    const model = (contextWindow) => ({
      provider: "openai-codex",
      id: "gpt-6.1-terra",
      contextWindow,
      maxTokens: 128_000,
      input: ["text", "image"],
      baseUrl: "https://chatgpt.com/backend-api",
    });
    db.query("INSERT INTO model_cache (provider_id, models) VALUES (?, ?)").run(
      "openai-codex:0.159.0",
      JSON.stringify([model(100_000)]),
    );
    db.query("INSERT INTO model_cache (provider_id, models) VALUES (?, ?)").run(
      "openai-codex",
      JSON.stringify([model(500_000)]),
    );
    db.close();

    const models = officialModels("openai-codex", { path: dbPath });
    expect(models.get("openai-codex/gpt-6.1-terra").contextWindow).toBe(500_000);
  });
});

describe("gateway 404 failover", () => {
  test("an inner gateway 404 without upstream contact is an adapter failure", () => {
    expect(
      classifyFailure({
        verdict: { ok: false, status: 404, source: "gateway", message: "upstream 404 Not Found" },
        upstreamContacted: false,
      }),
    ).toBe(FAILURE.ADAPTER);
  });

  test("a 404 that reached the provider stays a request failure", () => {
    expect(
      classifyFailure({
        verdict: { ok: false, status: 404, source: "upstream", message: "upstream 404 Not Found" },
        upstreamContacted: true,
      }),
    ).toBe(FAILURE.REQUEST);
  });
});

/** A handler harness with an inert router. */
function modelsHandler({ clientOnlyPrefix = "lazy/", next }) {
  const catalog = {
    host: new Map(),
    gateway: new Map(),
    ingested: null,
    ingestGatewayModels(rows) {
      this.ingested = rows;
      return true;
    },
    rows: () => [],
    hasNativeModel: () => false,
  };
  const router = {
    catalog,
    advertisedModels: () => [{ id: "lazy/pro", object: "model" }],
    handles: () => false,
    statusView: () => ({}),
    ensureCatalog() {},
    resetTokenTotals() {
      return true;
    },
    serve() {
      throw new Error("not used");
    },
  };
  const handler = lazyRouterHandler({
    router,
    dispatcher: { bind() {} },
    statusPage: () => undefined,
    credentials: { listAccounts: async () => [], resolve: async () => undefined },
    config: { statusPath: "/v1/lazy/status", clientOnlyPrefix },
    paths: { gatewayTokenPath: "/nonexistent" },
  });
  return { handler, catalog, next };
}

describe("GET /v1/models", () => {
  test("a non-200 gateway answer is returned untouched", async () => {
    const { handler, catalog } = modelsHandler({
      next: async () => new Response("unauthorized", { status: 401 }),
    });
    const response = await handler(
      new Request("http://127.0.0.1/v1/models"),
      {},
      async () => new Response("unauthorized", { status: 401 }),
    );
    expect(response.status).toBe(401);
    expect(catalog.ingested).toBeNull();
  });

  test("base models are ingested but only lazy rows are returned under lazy/", async () => {
    const base = {
      object: "list",
      data: [
        { id: "google-antigravity/gemini-4-argon", object: "model" },
        { id: "openai-codex/gpt-6.1-terra", object: "model" },
      ],
    };
    const { handler, catalog } = modelsHandler({
      next: async () => Response.json(base),
    });
    const response = await handler(new Request("http://127.0.0.1/v1/models"), {}, async () => Response.json(base));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.map((row) => row.id)).toEqual(["lazy/pro"]);
    expect(catalog.ingested).toEqual(base.data);
  });
});

describe("provider fallbacks", () => {
  test("a routed extension attempt is served by the plugin transport", async () => {
    const dispose = registerExtensionProviderMeta("kiro", {
      api: "openai-completions",
      models: [{ id: "plugin-model", contextWindow: 200_000, maxTokens: 8_000 }],
      async *streamSimple() {
        yield { type: "text_delta", delta: "hello" };
        yield { type: "done", reason: "stop" };
      },
    });
    try {
      const fallback = withExtensionFallback(async () => new Response("gateway", { status: 500 }), {
        credentials: {
          listAccounts: async () => [{ id: 1 }],
          resolve: async () => ({ secret: "plugin-key" }),
        },
        tokenPath: "/nonexistent",
        nativeRegistered: () => false,
      });
      const attempt = new Attempt({
        unit: { provider: "kiro", label: "kiro", key: "kiro" },
        model: "kiro/plugin-model",
        upstreamHosts: [],
        upstreamPaths: [],
      });
      const request = new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "kiro/plugin-model", messages: [{ role: "user", content: "hi" }] }),
      });
      const response = await runAttempt(attempt, () => fallback(request, {}));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.choices[0].message.content).toBe("hello");
    } finally {
      dispose();
    }
  });

  test("a routed custom-provider attempt is served by models.yml transport", async () => {
    let seen;
    const configured = new Map([
      [
        "ctyun/model",
        {
          descriptor: {
            name: "ctyun",
            baseUrl: "https://api.example.test/v1",
            api: "openai-completions",
            apiKey: "custom-key",
            headers: {},
            models: [{ id: "model" }],
          },
          model: { id: "model" },
          base: new URL("https://api.example.test/v1"),
        },
      ],
    ]);
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath: "/nonexistent",
      configured,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return Response.json({
          id: "x",
          object: "chat.completion",
          model: "model",
          choices: [{ index: 0, message: { role: "assistant", content: "custom hello" }, finish_reason: "stop" }],
        });
      },
    });
    const attempt = new Attempt({
      unit: { provider: "ctyun", label: "ctyun", key: "ctyun" },
      model: "ctyun/model",
      upstreamHosts: [],
      upstreamPaths: [],
    });
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "ctyun/model", messages: [{ role: "user", content: "hi" }] }),
    });
    const response = await runAttempt(attempt, () => fallback(request, {}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.choices[0].message.content).toBe("custom hello");
    expect(seen.url).toBe("https://api.example.test/v1/chat/completions");
    expect(seen.init.headers.get("authorization")).toBe("Bearer custom-key");
  });

  test("a custom-provider quota body never reaches the client", async () => {
    const configured = new Map([
      [
        "charm-hyper/model",
        {
          descriptor: {
            name: "charm-hyper",
            baseUrl: "https://api.example.test/v1",
            api: "openai-completions",
            apiKey: "custom-key",
            headers: {},
            models: [{ id: "model" }],
          },
          model: { id: "model" },
          base: new URL("https://api.example.test/v1"),
        },
      ],
    ]);
    const fallback = withCustomProviderFallback(async () => new Response("gateway", { status: 500 }), {
      tokenPath: "/nonexistent",
      configured,
      fetchImpl: async () =>
        Response.json(
          {
            error: {
              message: "402 You're out of credits. Add more at https://hyper.charm.land (type=billing_error)",
            },
          },
          { status: 402 },
        ),
    });
    const attempt = new Attempt({
      unit: { provider: "charm-hyper", label: "charm-hyper", key: "charm-hyper" },
      model: "charm-hyper/model",
      upstreamHosts: [],
      upstreamPaths: [],
    });
    const request = new Request("http://127.0.0.1/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "charm-hyper/model", messages: [{ role: "user", content: "hi" }] }),
    });
    const response = await runAttempt(attempt, () => fallback(request, {}));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: { type: "lazy_router_unavailable", message: "no healthy candidate could serve this request" },
    });
    for (const leaked of ["charm", "credits", "billing", "hyper.charm.land", "402"]) {
      expect(text.toLowerCase()).not.toContain(leaked);
    }
  });
});
