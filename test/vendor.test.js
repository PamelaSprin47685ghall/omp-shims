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

  test("a hostless standard api probes for the plan answer the transport needs", async () => {
    setHostStream(null);
    const model = { api: "openai-responses", id: "reflection/beam:free", baseUrl: "https://example.test/provider/v1" };
    const seen = [];
    const fetchStatus = (status) => async (url, init) => {
      seen.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ error: { code: "upgrade_required" } }), { status });
    };

    // 403: end without events so the provider's transport falls back on its own.
    const upgraded = streamSimple(model, {}, { apiKey: "user_test", fetch: fetchStatus(403) });
    const events = [];
    for await (const event of upgraded) events.push(event);
    expect(events).toEqual([]);
    expect(seen[0].url).toBe("https://example.test/provider/v1/responses");
    expect(seen[0].auth).toBe("Bearer user_test");
    expect(seen[0].body.model).toBe("reflection/beam:free");

    // Anything else: the host genuinely has no stream for this api.
    const unavailable = streamSimple(model, {}, { apiKey: "user_test", fetch: fetchStatus(200) });
    await expect(unavailable.result()).rejects.toThrow('No transport registered for api "openai-responses"');
  });
});

test("getAgentDir honours overrides and defaults to ~/.omp/agent", () => {
  process.env.OMP_AGENT_DIR = "/custom";
  expect(getAgentDir()).toBe("/custom");
  delete process.env.OMP_AGENT_DIR;
  expect(getAgentDir()).toBe(join(homedir(), ".omp", "agent"));
});
