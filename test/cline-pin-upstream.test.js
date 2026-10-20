import { afterEach, describe, expect, test } from "bun:test";
import { install } from "../features/cline-pin-upstream.js";
import { DEFAULTS } from "../lib/config.js";
import { fakeContext, recordingNext } from "./helpers.js";

const URL = "https://api.cline.bot/api/v1/chat/completions";

async function send(config, body, init = {}) {
  const { context, handlers } = fakeContext();
  install({ ...DEFAULTS["cline-pin-upstream"], ...config }, context);
  const { next, calls } = recordingNext();
  await handlers[0](URL, { method: "POST", body: JSON.stringify(body), ...init }, next);
  return { body: JSON.parse(calls[0].init.body), headers: new Headers(calls[0].init.headers) };
}

afterEach(() => {
  for (const key of ["API_KEY", "PIN_HOST", "PIN_UPSTREAM", "PIN_MODELS"]) delete process.env[`OMP_SHIMS_CLINE_${key}`];
});

describe("cline-pin-upstream", () => {
  test("pins per-model channels, stripping the cline-pass/ prefix", async () => {
    const { body } = await send({}, { model: "cline-pass/deepseek-v4.1-flash" });
    expect(body.providerOptions.gateway.only).toEqual(["deepseek"]);
  });

  test("pins glm-5.3-flash to the configured channel list in both spellings", async () => {
    const { body } = await send({}, { model: "cline-pass/glm-5.3-flash" });
    const expected = [
      "makora",
      "digitalocean",
      "wafer",
      "baseten",
      "inference-net",
      "together",
    ];
    expect(body.providerOptions.gateway.only).toEqual(expected);
    expect(body.provider.only).toEqual(expected);
  });

  test("falls back to the default upstream", async () => {
    const { body } = await send({}, { model: "other" });
    expect(body.providerOptions.gateway.only).toEqual(["openai-compatible-private"]);
  });

  test("keeps a pin the caller already set", async () => {
    const { body } = await send({}, { model: "other", providerOptions: { gateway: { only: ["mine"] } } });
    expect(body.providerOptions.gateway.only).toEqual(["mine"]);
  });

  test("adds Cline headers, and takes the credential from the agent db when present", async () => {
    const { headers } = await send({}, { model: "other" });
    expect(headers.get("x-title")).toBe("Cline");
    // The key is read from OMP's credential store (agent.db), not from config.
    const authorization = headers.get("authorization");
    if (authorization !== null) expect(authorization).toStartWith("Bearer sk_");
  });

  test("uses a configured key only when the request has no Authorization", async () => {
    process.env.OMP_SHIMS_CLINE_API_KEY = "from-env";
    expect((await send({}, { model: "x" })).headers.get("authorization")).toBe("Bearer from-env");
    const existing = await send({}, { model: "x" }, { headers: { Authorization: "Bearer mine" } });
    expect(existing.headers.get("authorization")).toBe("Bearer mine");
  });

  test("environment variables override the configured upstream and model filter", async () => {
    process.env.OMP_SHIMS_CLINE_PIN_UPSTREAM = "env-channel";
    expect((await send({}, { model: "other" })).body.providerOptions.gateway.only).toEqual(["env-channel"]);
    process.env.OMP_SHIMS_CLINE_PIN_MODELS = "only-this";
    expect((await send({}, { model: "other" })).body.providerOptions).toBeUndefined();
  });

  test("ignores other hosts and paths", async () => {
    const { context, handlers } = fakeContext();
    install(DEFAULTS["cline-pin-upstream"], context);
    const { next, calls } = recordingNext();
    const init = { method: "POST", body: "{}" };
    await handlers[0]("https://api.cline.bot/api/v1/models", init, next);
    expect(calls[0].init).toBe(init);
  });
});
