import { afterEach, describe, expect, test } from "bun:test";
import * as compat from "../vendor/earendil-works-pi-ai/compat.mjs";
import * as ai from "../vendor/earendil-works-pi-ai/index.mjs";
import { getAgentDir } from "../vendor/earendil-works-pi-coding-agent/index.mjs";

const originalEnv = {
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  OMP_AGENT_DIR: process.env.OMP_AGENT_DIR,
  PI_AGENT_DIR: process.env.PI_AGENT_DIR,
};

afterEach(() => {
  ai.setHostStream(null);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("EventStream settlement", () => {
  test("end(message) resolves result()", async () => {
    const message = { role: "assistant", content: [] };
    const stream = new ai.EventStream();
    stream.end(message);
    expect(await stream.result()).toBe(message);
  });

  test("end() without a result rejects instead of leaving result() pending", async () => {
    const stream = new ai.EventStream();
    stream.end();
    await expect(stream.result()).rejects.toThrow(/without a final result/);
  });

  test("fail(error) rejects result() and stops the iterator", async () => {
    const stream = new ai.EventStream();
    const failure = new Error("stream failed");
    stream.fail(failure);
    await expect(stream.result()).rejects.toBe(failure);

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toBe(failure);
  });

  test("a terminal done event resolves with the message it carries", async () => {
    const message = { role: "assistant", content: [] };
    const stream = ai.createAssistantMessageEventStream();
    stream.push({ type: "text_delta", delta: "hi", partial: message });
    stream.push({ type: "done", message });

    const events = [];
    for await (const event of stream) events.push(event.type);
    expect(events).toEqual(["text_delta", "done"]);
    expect(await stream.result()).toBe(message);
  });

  test("a terminal error event resolves with the failed assistant message", async () => {
    const message = { role: "assistant", stopReason: "error", errorMessage: "nope" };
    const stream = ai.createAssistantMessageEventStream();
    stream.push({ type: "error", error: message });
    expect(await stream.result()).toBe(message);
  });
});

describe("streamSimple precedence", () => {
  test("transport wins over host, and host wins over the missing-transport error", async () => {
    ai.registerTransport("e4-priority-transport", () => "from-transport");
    ai.setHostStream(() => "from-host");

    expect(ai.hasTransport("e4-priority-transport")).toBe(true);
    expect(ai.streamSimple({ api: "e4-priority-transport" })).toBe("from-transport");
    expect(ai.streamSimple({ api: "e4-standard-api" })).toBe("from-host");

    ai.setHostStream(null);
    const missing = ai.streamSimple({ api: "e4-missing-api" });
    await expect(missing.result()).rejects.toThrow('No transport registered for api "e4-missing-api"');
  });

  test("compat re-exports the shim surface but omits registerApiProvider", () => {
    expect(compat.EventStream).toBe(ai.EventStream);
    expect(compat.streamSimple).toBe(ai.streamSimple);
    expect(compat.clampThinkingLevel).toBe(ai.clampThinkingLevel);
    expect("registerApiProvider" in compat).toBe(false);
  });
});

describe("clampThinkingLevel", () => {
  test("passes off through untouched", () => {
    expect(ai.clampThinkingLevel({ reasoning: true, thinking: { efforts: ["low"] } }, "off")).toBe("off");
  });

  test("a served level stays", () => {
    expect(ai.clampThinkingLevel({ reasoning: true, thinking: { efforts: ["low", "high"] } }, "high")).toBe("high");
  });

  test("an unserved level climbs down to the nearest lower served level", () => {
    const model = { reasoning: true, thinking: { efforts: ["low", "high"] } };
    expect(ai.clampThinkingLevel(model, "medium")).toBe("low");
    expect(ai.clampThinkingLevel(model, "max")).toBe("high");
  });

  test("an effortMap alias is used only when its target is served and stable", () => {
    const model = { reasoning: true, thinking: { efforts: ["high"], effortMap: { medium: "high" } } };
    expect(ai.clampThinkingLevel(model, "medium")).toBe("high");
  });

  test("a non-reasoning model falls back to off", () => {
    expect(ai.clampThinkingLevel({ reasoning: false }, "high")).toBe("off");
  });

  test("supported levels list off first for reasoning models", () => {
    expect(ai.getSupportedThinkingLevels({ reasoning: true, thinking: { efforts: ["low", "high"] } })).toEqual([
      "off",
      "low",
      "high",
    ]);
    expect(ai.getSupportedThinkingLevels({ reasoning: false })).toEqual(["off"]);
  });
});

describe("coding-agent getAgentDir", () => {
  test("honours PI_CODING_AGENT_DIR, then OMP_AGENT_DIR, then PI_AGENT_DIR, then the default", () => {
    process.env.PI_CODING_AGENT_DIR = "/tmp/vendor-a";
    process.env.OMP_AGENT_DIR = "/tmp/vendor-b";
    process.env.PI_AGENT_DIR = "/tmp/vendor-c";
    expect(getAgentDir()).toBe("/tmp/vendor-a");

    delete process.env.PI_CODING_AGENT_DIR;
    expect(getAgentDir()).toBe("/tmp/vendor-b");

    delete process.env.OMP_AGENT_DIR;
    expect(getAgentDir()).toBe("/tmp/vendor-c");

    delete process.env.PI_AGENT_DIR;
    expect(getAgentDir().endsWith("/.omp/agent")).toBe(true);
  });

  test("the cache follows an environment change", () => {
    process.env.PI_AGENT_DIR = "/tmp/vendor-first";
    expect(getAgentDir()).toBe("/tmp/vendor-first");
    process.env.PI_AGENT_DIR = "/tmp/vendor-second";
    expect(getAgentDir()).toBe("/tmp/vendor-second");
  });
});
