// Contract tests for the v2 ClinePass pin module.
//
// The channel table comes from presets/cline.json. The host check is exact,
// both routing spellings are written, and a caller pin always wins.

import { afterEach, describe, expect, test } from "bun:test";

import { install, isClineChatUrl } from "../features/cline-pin-upstream.mjs";
import { DEFAULTS } from "../lib/config.mjs";
import { fakeContext } from "./helpers.mjs";

const URL = "https://api.cline.bot/api/v1/chat/completions";
const disposers = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

async function installCline(overrides = {}) {
  const fake = fakeContext();
  const config = { ...DEFAULTS["cline-pin-upstream"], apiKey: "sk-test", ...overrides };
  const dispose = await install(config, fake.context);
  disposers.push(dispose);
  return fake.outbound[0];
}

async function send(handler, url, body) {
  const calls = [];
  await handler(url, { method: "POST", body: JSON.stringify(body) }, async (input, init) => {
    calls.push({ input, init });
    return new Response("ok");
  });
  return calls[0];
}

describe("preset channel table", () => {
  test("pins a preset model in both spellings and strips the cline-pass prefix", async () => {
    const handler = await installCline();
    const call = await send(handler, URL, { model: "cline-pass/deepseek-v4.1-flash" });
    const body = JSON.parse(call.init.body);
    expect(body.provider.only).toEqual(["deepseek"]);
    expect(body.providerOptions.gateway.only).toEqual(["deepseek"]);
  });

  test("pins a preset object entry", async () => {
    const handler = await installCline();
    const call = await send(handler, URL, { model: "cline-pass/glm-5.3-flash" });
    const body = JSON.parse(call.init.body);
    expect(body.providerOptions.gateway.only).toEqual(["wafer", "inference-net", "digitalocean"]);
  });

  test("falls back to the configured upstream for an unknown model", async () => {
    const handler = await installCline();
    const call = await send(handler, URL, { model: "unknown" });
    expect(JSON.parse(call.init.body).providerOptions.gateway.only).toEqual(["openai-compatible-private"]);
  });
});

describe("host and path", () => {
  test("accepts the configured baseURL path and rejects a lookalike host", () => {
    const target = { hosts: ["api.cline.bot"], allowHttp: false, expectedPath: "/api/v1/chat/completions" };
    expect(isClineChatUrl(URL, target)).toBe(true);
    expect(isClineChatUrl("https://api.cline.bot.evil/api/v1/chat/completions", target)).toBe(false);
    expect(isClineChatUrl("https://api.cline.bot/api/v1/models", target)).toBe(false);
    expect(isClineChatUrl("https://api.cline.bot/chat/completions", target)).toBe(false);
    expect(isClineChatUrl("http://api.cline.bot/api/v1/chat/completions", target)).toBe(false);
  });

  test("a lookalike host reaches next untouched", async () => {
    const handler = await installCline();
    const init = { method: "POST", body: JSON.stringify({ model: "unknown" }) };
    const calls = [];
    await handler("https://api.cline.bot.evil/api/v1/chat/completions", init, async (input, nextInit) => {
      calls.push({ input, init: nextInit });
      return new Response("ok");
    });
    expect(calls[0].init).toBe(init);
  });
});

describe("caller pin and headers", () => {
  test("keeps a pin the caller already set", async () => {
    const handler = await installCline();
    const call = await send(handler, URL, {
      model: "cline-pass/deepseek-v4.1-flash",
      provider: { only: ["mine"] },
      providerOptions: { gateway: { only: ["mine"] } },
    });
    const body = JSON.parse(call.init.body);
    expect(body.provider.only).toEqual(["mine"]);
    expect(body.providerOptions.gateway.only).toEqual(["mine"]);
  });

  test("adds the configured credential and the standard Cline headers", async () => {
    const handler = await installCline();
    const call = await send(handler, URL, { model: "unknown" });
    const headers = new Headers(call.init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("x-title")).toBe("Cline");
    expect(headers.get("http-referer")).toBe("https://cline.bot");
  });
});
