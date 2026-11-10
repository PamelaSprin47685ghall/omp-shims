// Contract tests for the v2 Copilot Auto module.
//
// The outbound layer negotiates /auto itself. These tests pin the failure
// paths that must never throw: an exact-host miss, a non-200 negotiation and
// a negotiation aborted by its signal (the same branch a timeout takes).

import { afterEach, describe, expect, test } from "bun:test";

import { install, isCopilotEndpoint } from "../features/copilot-auto.mjs";
import copilotPolicy from "../presets/copilot.json";
import { fakeContext } from "./helpers.mjs";

const disposers = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
  globalThis.fetch = originalFetch;
});

function autoBody() {
  return JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] });
}

async function installCopilot(context = {}) {
  const fake = fakeContext(context);
  const dispose = await install({ enabled: true, apiVersion: "2026-08-01" }, fake.context);
  disposers.push(dispose);
  return fake;
}

describe("exact hosts", () => {
  test("accepts the two exact hosts and rejects a suffix lookalike", () => {
    expect(isCopilotEndpoint("https://api.githubcopilot.com/chat/completions")).toBe(true);
    expect(isCopilotEndpoint("https://api.individual.githubcopilot.com/responses")).toBe(true);
    expect(isCopilotEndpoint("https://api.githubcopilot.com.evil/chat/completions")).toBe(false);
  });

  test("a lookalike host reaches next untouched", async () => {
    const { outbound } = await installCopilot();
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      return new Response("unexpected");
    };

    const init = { method: "POST", body: autoBody() };
    const { calls, next } = recordingPassthrough();
    await outbound[0]("https://api.githubcopilot.com.evil/chat/completions", init, next);
    expect(calls[0].init).toBe(init);
    expect(fetched).toBe(false);
  });
});

describe("negotiation failures", () => {
  test("a non-200 negotiation reports and passes the original request through", async () => {
    const { outbound } = await installCopilot();
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });

    const { calls, next } = recordingPassthrough();
    const response = await outbound[0](
      "https://api.githubcopilot.com/chat/completions",
      { method: "POST", body: autoBody() },
      next,
    );

    expect(await response.text()).toBe("passthrough");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe(autoBody());
  });

  test("an aborted negotiation signal passes the original request through", async () => {
    const { outbound } = await installCopilot();
    let signal;
    globalThis.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init.signal;
        const abort = () => reject(init.signal.reason ?? new Error("aborted"));
        if (init.signal.aborted) abort();
        else init.signal.addEventListener("abort", abort, { once: true });
      });

    const controller = new AbortController();
    const { calls, next } = recordingPassthrough();
    const pending = outbound[0](
      "https://api.githubcopilot.com/chat/completions",
      { method: "POST", body: autoBody(), signal: controller.signal },
      next,
    );

    await Bun.sleep(5);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();

    const response = await pending;
    expect(await response.text()).toBe("passthrough");
    expect(calls).toHaveLength(1);
  });

  test("never logs the prompt text", async () => {
    const logs = [];
    const { outbound } = await installCopilot({ log: (line) => logs.push(line) });
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          session_token: "tok",
          selected_model: { id: "gpt-5.6-luna", supported_endpoints: ["/chat/completions"] },
        }),
        { status: 200 },
      );

    const prompt = "PROMPT-SECRET-XYZ";
    await outbound[0](
      "https://api.githubcopilot.com/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: prompt }] }),
      },
      async () => new Response("ok"),
    );

    expect(logs.join("\n")).not.toContain(prompt);
    expect(logs.some((line) => line.includes("negotiating auto model"))).toBe(true);
  });
});

describe("bootstrap model policy", () => {
  /** Drive the inbound rewrite and return the model that reached the gateway. */
  async function rewrittenModel(config = {}) {
    const fake = fakeContext();
    const dispose = await install({ enabled: true, apiVersion: "2026-08-01", ...config }, fake.context);
    disposers.push(dispose);
    let seen;
    await fake.inbound[0](
      new Request("http://127.0.0.1/v1/chat/completions", { method: "POST", body: autoBody() }),
      {},
      async (request) => {
        seen = await request.json();
        return new Response("ok");
      },
    );
    return seen.model;
  }

  test("an auto request uses the preset bootstrap model", async () => {
    expect(await rewrittenModel()).toBe(copilotPolicy.autoBootstrapModel);
  });

  test("a configured bootstrap model overrides the preset", async () => {
    expect(await rewrittenModel({ autoBootstrapModel: "custom/bootstrap-model" })).toBe("custom/bootstrap-model");
  });
});

/** A next that answers "passthrough" and records the call. */
function recordingPassthrough() {
  const calls = [];
  return {
    calls,
    next: async (input, init) => {
      calls.push({ input, init });
      return new Response("passthrough");
    },
  };
}
