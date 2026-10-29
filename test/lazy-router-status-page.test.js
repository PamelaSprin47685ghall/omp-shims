import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { lazyRouterHandler } from "../features/lazy-router.js";
import { describeStatus } from "../lib/lazy-router/status-page/view.js";
import { ASSET_PREFIX, CONTENT_SECURITY_POLICY, escapeHtml, renderStatusPage } from "../lib/lazy-router/status-page.js";
import { TokenTotals, extractTokenAccounting } from "../lib/lazy-router/token-totals.js";

const NOW = "2026-10-29T05:55:00.000Z";
const STATUS = {
  now: NOW, catalogReady: true,
  routes: {
    "lazy/pro": [{ unit: "ag:ultra#1", model: "google-antigravity/gemini-4-argon",
      eligible: true, health: "alive" }],
    "lazy/task": [
      { unit: "mistral-vibe#1", model: "mistral-vibe/deepseek-v4-1-flash-1017",
        eligible: true, health: "alive", inFlight: 4, maxInFlight: 20 },
      { unit: "mistral-vibe#2", model: "mistral-vibe/deepseek-v4-1-flash-1017",
        eligible: true, health: "cooling", reason: "429", nextProbeAt: "2026-10-29T05:55:30Z" },
    ],
  },
  topology: {
    "lazy/pro": { graph: { type: "rating", children: [
      { type: "fallback", children: [
        { type: "model", model: "google-antigravity/gemini-4-argon", tier: "ultra", effort: "medium" },
        { type: "model", model: "google-antigravity/gemini-4-argon", tier: "pro", effort: "medium" },
      ] },
    ] } },
    "lazy/task": { graph: { type: "rating", children: [
      { type: "model", model: "mistral-vibe/deepseek-v4-1-flash-1017", effort: "max" },
      { type: "model", model: "opencode-go/deepseek-v4.1-flash", offPeakOnly: "deepseek", effort: "max" },
    ] } },
  },
  cyclicSpeed: { "mistral-vibe/deepseek-v4-1-flash-1017": {
    totalMs: 3510, rd: 0.45, weight: 22.5, censored: 3,
  } },
  concurrencyProof: { "mistral-vibe/deepseek-v4-1-flash-1017": { verifiedMaxConcurrency: 16 } },
  tokenTotals: {
    since: "2026-10-29T05:50:00Z",
    totals: { uncachedInput: 123456, cachedInput: 987654, output: 111222 },
    coverage: { complete: 77, uncachedInput: 65, cachedInput: 62, output: 70 },
  },
  affinity: { lookups: 8, hits: 6, hitRate: 0.75 },
  perf: { "mistral-vibe/deepseek-v4-1-flash-1017": { samples: 12, imputedSamples: 1, totalMs: 4000 } },
};
const html = renderStatusPage(STATUS, { statusPath: "/v1/lazy/status", nowMs: Date.parse(NOW) });
function inbound() {
  const calls = [];
  const gateway = async (request) => {
    calls.push(request.method + " " + new URL(request.url).pathname);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  };
  const router = { status: () => Response.json(STATUS), statusView: () => STATUS,
    advertisedModels: () => [], handles: () => false };
  const send = (method, path) => lazyRouterHandler(gateway, {
    router, dispatcher: { bind() {} }, statusPath: "/v1/lazy/status",
  })(new Request("http://gateway.test" + path, { method }));
  return { send, calls };
}
describe("clean-break dashboard", () => {
  test("server renders all counts and measured speed, with coverage and measurement start", () => {
    expect(html).toContain("123,456");
    expect(html).toContain("987,654");
    expect(html).toContain("111,222");
    expect(html).toContain("65 / 77");
    expect(html).toContain("2026-10-29 05:50 UTC");
    expect(html).toContain("3.5 s");
    expect(html).toContain("0.45");
    expect(html).toContain("4/20");
    expect(html).toContain("无错并发实证");
  });
  test("only current Lazy routes and compositional ordering semantics are presented", () => {
    expect(html).toContain("严格有序的后备链");
    expect(html).toContain("按总耗时评分");
    expect(html).toContain("tier=ultra");
    expect(html).toContain("tier=pro");
    expect(html).not.toContain("Rush");
    expect(html).not.toContain("智力");
    expect(html).not.toContain("TTFT");
    expect(html).not.toContain("高峰时段顺序");
  });
  test("shared model-level evidence; no key-level rating is invented", () => {
    const view = describeStatus(STATUS);
    expect(view.routes.find((r) => r.id === "lazy/task").channels[0].units).toHaveLength(2);
    expect(view.routes.find((r) => r.id === "lazy/task").channels[0].duration).toBe("3.5 s");
    expect(view.routes.find((r) => r.id === "lazy/task").channels[0].verifiedMaxConcurrency).toBe(16);
  });
  test("malicious strings are escaped and no credential metadata is rendered", () => {
    const bad = '"><script>alert(1)</script>';
    const page = renderStatusPage({ ...STATUS, routes: {
      "lazy/task": [{ ...STATUS.routes["lazy/task"][0], unit: bad, reason: bad }],
    } }, { statusPath: bad });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).not.toContain("credentialId");
    expect(page).not.toContain("access_token");
    expect(escapeHtml("&'")).toBe("&amp;&#39;");
  });
  test("GET / and assets remain public but every other path uses gateway auth", async () => {
    const { send, calls } = inbound();
    const page = await send("GET", "/");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(await page.text()).toContain("Lazy");
    expect((await send("HEAD", "/")).status).toBe(200);
    for (const file of ["style.css", "client.js"]) {
      expect((await send("GET", ASSET_PREFIX + "/" + file)).status).toBe(200);
    }
    expect((await send("POST", "/")).status).toBe(401);
    expect((await send("GET", ASSET_PREFIX + "/secret.js")).status).toBe(401);
    expect(calls).toHaveLength(2);
  });
  test("browser refresh never uses innerHTML or executes supplied HTML", async () => {
    const source = await Bun.file(new URL("../lib/lazy-router/status-page/client.js", import.meta.url)).text();
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(source).toContain("DOMParser");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
  });
});
describe("durable provider-reported token accounting", () => {
  test("OpenAI prompt total and cached details yield independent input categories", () => {
    expect(extractTokenAccounting({ usage: {
      prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 65 }, completion_tokens: 42,
    } })).toEqual({ uncachedInput: 35, cachedInput: 65, output: 42 });
  });
  test("Anthropic reports cache writes as uncached; Gemini subtracts cached from prompt", () => {
    expect(extractTokenAccounting({ usage: {
      input_tokens: 20, cache_read_input_tokens: 15, cache_creation_input_tokens: 8, output_tokens: 7,
    } })).toEqual({ uncachedInput: 28, cachedInput: 15, output: 7 });
    expect(extractTokenAccounting({ usageMetadata: {
      promptTokenCount: 60, cachedContentTokenCount: 45, candidatesTokenCount: 12,
    } })).toEqual({ uncachedInput: 15, cachedInput: 45, output: 12 });
  });
  test("unknown input and cache remain unreported, not guessed as zero", () => {
    expect(extractTokenAccounting({ usage: { completion_tokens: 9 } })).toEqual({ output: 9 });
  });
  test("persists cumulative totals and field coverage over restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-totals-"));
    try {
      const path = join(dir, "counts.sqlite");
      const first = new TokenTotals({ path });
      first.record("p/model", { uncachedInput: 50, cachedInput: 20, output: 15 });
      first.record("p/model", { output: 9 });
      first.close();
      const next = new TokenTotals({ path });
      expect(next.view().totals).toEqual({ uncachedInput: 50, cachedInput: 20, output: 24 });
      expect(next.view().coverage).toEqual({ complete: 2, uncachedInput: 1, cachedInput: 1, output: 2 });
      expect(next.view().since).toMatch(/2026/);
      next.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
