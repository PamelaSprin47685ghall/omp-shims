import { describe, expect, test } from "bun:test";
import { runPinned } from "../lib/credential-pin.js";
import { Attempt, createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { withUpstreamEffort } from "../lib/lazy-router/upstream-effort.js";

const generateBody = (params = {}) =>
  JSON.stringify({ config: { workingDir: "/tmp" }, params: { model: "reflection/beam:free", ...params } });

describe("withUpstreamEffort", () => {
  test("commandcode: writes params.reasoning_effort", () => {
    const next = JSON.parse(withUpstreamEffort("commandcode", generateBody(), "low"));
    expect(next.params.reasoning_effort).toBe("low");
    expect(next.config.workingDir).toBe("/tmp");
  });

  test("commandcode: the router's level replaces the plugin's", () => {
    expect(
      JSON.parse(withUpstreamEffort("commandcode", generateBody({ reasoning_effort: "high" }), "low")).params,
    ).toMatchObject({ reasoning_effort: "low" });
    expect(withUpstreamEffort("commandcode", generateBody({ reasoning_effort: "low" }), "low")).toBeUndefined();
  });

  test("leaves the call alone when there is nothing to do", () => {
    expect(withUpstreamEffort("openai-codex", generateBody(), "low")).toBeUndefined();
    expect(withUpstreamEffort("commandcode", generateBody(), undefined)).toBeUndefined();
    expect(withUpstreamEffort("commandcode", generateBody(), "none")).toBeUndefined();
    expect(withUpstreamEffort("commandcode", "not json", "low")).toBeUndefined();
    expect(withUpstreamEffort("commandcode", JSON.stringify({ messages: [] }), "low")).toBeUndefined();
    expect(withUpstreamEffort("commandcode", undefined, "low")).toBeUndefined();
  });
});

describe("attempt layer", () => {
  const credentials = { isBrokerUrl: () => false, providerOf: () => undefined, resolve: async () => undefined };
  const unit = { provider: "commandcode", label: "commandcode", key: "commandcode" };

  async function send(effort) {
    const layer = createAttemptLayer({ credentials });
    const attempt = new Attempt({ unit, model: "commandcode/reflection/beam:free", effort });
    let seen;
    await runPinned(attempt, () =>
      layer(
        "https://api.commandcode.ai/alpha/generate",
        { method: "POST", headers: { "content-type": "application/json" }, body: generateBody() },
        async (url, init) => {
          seen = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
          return new Response("ok");
        },
      ),
    );
    return seen;
  }

  test("the attempt's effort reaches the provider body", async () => {
    const seen = await send("low");
    expect(seen.body.params.reasoning_effort).toBe("low");
    expect(seen.url).toBe("https://api.commandcode.ai/alpha/generate");
    expect(seen.headers.get("content-type")).toBe("application/json");
  });

  test("an attempt without an effort sends the plugin's body unchanged", async () => {
    expect((await send(undefined)).body.params.reasoning_effort).toBeUndefined();
  });
});
