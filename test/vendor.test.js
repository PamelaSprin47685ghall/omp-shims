import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  hasTransport,
  registerTransport,
  setHostStream,
  streamSimple,
} from "../vendor/earendil-works-pi-ai/index.js";
import { getAgentDir } from "../vendor/earendil-works-pi-coding-agent/index.js";

describe("@earendil-works/pi-ai shim", () => {
  test("EventStream yields pushed events and resolves with the final message", async () => {
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "text", text: "a" });
    stream.push({ type: "done", message: "final" });
    const seen = [];
    for await (const event of stream) seen.push(event.type);
    expect(seen).toEqual(["text", "done"]);
    expect(await stream.result()).toBe("final");
  });

  test("streamSimple dispatches to a registered transport, then the host", () => {
    registerTransport("test-api", () => "transport");
    expect(hasTransport("test-api")).toBe(true);
    expect(streamSimple({ api: "test-api" })).toBe("transport");

    setHostStream(() => "host");
    expect(streamSimple({ api: "openai-completions" })).toBe("host");
    setHostStream(null);
  });

  test("streamSimple reports a missing transport as an error event", async () => {
    const stream = streamSimple({ api: "nothing-registered" });
    await expect(stream.result()).rejects.toThrow('No transport registered for api "nothing-registered"');
  });
});

test("getAgentDir honours overrides and defaults to ~/.omp/agent", () => {
  process.env.OMP_AGENT_DIR = "/custom";
  expect(getAgentDir()).toBe("/custom");
  delete process.env.OMP_AGENT_DIR;
  expect(getAgentDir()).toBe(join(homedir(), ".omp", "agent"));
});
