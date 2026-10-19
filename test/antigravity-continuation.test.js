import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildContinuation,
  continuationDigest,
  findContinuationMarker,
  install,
  PROMPTS,
  sanitizeTerminalBlock,
  splitContents,
  textOutsideThinking,
} from "../features/antigravity-continuation.js";
import { CLOUD_CODE_URL, fakeContext, parseSse, recordingNext, sseResponse, tempDir } from "./helpers.js";

describe("sanitizeTerminalBlock", () => {
  test("turns a malformed finish into a clean STOP that is still valid JSON", () => {
    const block = `data: ${JSON.stringify({
      response: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: 'bad "call"' }] },
    })}\n\n`;
    const [payload] = parseSse(sanitizeTerminalBlock(block));
    expect(payload.response.candidates[0]).toEqual({ finishReason: "STOP", finishMessage: "" });
  });

  test("leaves ordinary blocks untouched", () => {
    const block = 'data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n';
    expect(sanitizeTerminalBlock(block)).toBe(block);
  });
});

describe("continuation markers", () => {
  test("a marker appended to its own text is recognised and split back out", () => {
    const text = "thinking about it";
    const match = findContinuationMarker(`${text}${continuationDigest(text, "empty")} then the answer`);
    expect(match).toMatchObject({ prompt: PROMPTS.empty, before: text, after: " then the answer" });
  });

  test("a digest of different text is not a marker", () => {
    expect(findContinuationMarker(`abc${continuationDigest("xyz", "empty")}`)).toBeNull();
  });

  test("splitContents unwinds markers into model + user turns", () => {
    const text = "partial";
    const { contents, splits } = splitContents([
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ text: `${text}${continuationDigest(text, "malformed")}done` }] },
      { role: "user", parts: [{ text: "next" }] },
    ]);
    expect(splits).toBe(1);
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "q" }] },
      { role: "model", parts: [{ text: "partial" }] },
      { role: "user", parts: [{ text: PROMPTS.malformed }] },
      { role: "model", parts: [{ text: "done" }] },
      { role: "user", parts: [{ text: "next" }] },
    ]);
  });

  test("splitContents repairs model-first and model-last histories", () => {
    const { contents } = splitContents([{ role: "model", parts: [{ text: "x" }] }]);
    expect(contents.map((turn) => turn.role)).toEqual(["user", "model", "user"]);
  });
});

test("textOutsideThinking strips thinking fences", () => {
  expect(textOutsideThinking("<think>hmm</think>answer")).toBe("answer");
  expect(textOutsideThinking("```thinking\nhmm\n```\nanswer")).toBe("answer");
});

test("buildContinuation replays the reasoning and appends the nudge", () => {
  const body = JSON.stringify({ request: { contents: [{ role: "user", parts: [{ text: "q" }] }] } });
  const state = { thoughtBuffer: [{ text: "hmm", thoughtSignature: "c2ln" }], visibleText: "" };
  const { request } = JSON.parse(buildContinuation(body, state, "empty"));
  expect(request.contents.slice(1)).toEqual([
    { role: "model", parts: [{ thought: true, text: "hmm", thoughtSignature: "c2ln" }] },
    { role: "user", parts: [{ text: PROMPTS.empty }] },
  ]);
});

describe("install", () => {
  const thoughtOnly = [
    { response: { candidates: [{ content: { parts: [{ thought: true, text: "planning" }] } }] } },
    { response: { candidates: [{ finishReason: "STOP" }] } },
  ];
  const answer = [
    { response: { candidates: [{ content: { parts: [{ text: "the answer" }] } }] } },
    { response: { candidates: [{ finishReason: "STOP" }] } },
  ];
  const requestInit = () => ({
    method: "POST",
    body: JSON.stringify({ model: "gemini-x", request: { contents: [{ role: "user", parts: [{ text: "q" }] }] } }),
  });

  test("continues a thought-only turn and streams one terminal event", async () => {
    const out = join(tempDir(), "diag.jsonl");
    const { context, handlers } = fakeContext();
    install({ maxContinuations: 3, locationRetries: 0, out }, context);
    const { next, calls } = recordingNext((_input, _init, n) => sseResponse(n === 1 ? thoughtOnly : answer));

    const response = await handlers[0](CLOUD_CODE_URL, requestInit(), next);
    const events = parseSse(await response.text());

    expect(calls).toHaveLength(2);
    const continued = JSON.parse(calls[1].init.body).request.contents;
    expect(continued.at(-1)).toEqual({ role: "user", parts: [{ text: PROMPTS.empty }] });

    const texts = events.flatMap((e) => e.response.candidates.flatMap((c) => c.content?.parts ?? []));
    expect(texts.map((part) => part.text)).toContain("the answer");
    const terminals = events.filter((e) => e.response.candidates.some((c) => c.finishReason));
    expect(terminals).toHaveLength(1);

    const log = readFileSync(out, "utf8").trim().split("\n").map(JSON.parse);
    expect(log.map((entry) => entry.event)).toContain("continuation-summary");
  });

  test("passes a turn with a real answer straight through", async () => {
    const { context, handlers } = fakeContext();
    install({ maxContinuations: 3, locationRetries: 0, out: join(tempDir(), "d.jsonl") }, context);
    const { next, calls } = recordingNext(() => sseResponse(answer));
    const response = await handlers[0](CLOUD_CODE_URL, requestInit(), next);
    await response.text();
    expect(calls).toHaveLength(1);
  });

  test("with no continuation budget it still sanitizes malformed finishes", async () => {
    const { context, handlers } = fakeContext();
    install({ maxContinuations: 0, out: join(tempDir(), "d.jsonl") }, context);
    const { next } = recordingNext(() =>
      sseResponse([{ response: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: "x" }] } }]),
    );
    const response = await handlers[0](CLOUD_CODE_URL, requestInit(), next);
    const [event] = parseSse(await response.text());
    expect(event.response.candidates[0].finishReason).toBe("STOP");
  });

  test("ignores requests to other endpoints", async () => {
    const { context, handlers } = fakeContext();
    install({ maxContinuations: 3, out: join(tempDir(), "d.jsonl") }, context);
    const { next, calls } = recordingNext();
    await handlers[0]("https://example.com/v1/chat", requestInit(), next);
    expect(calls).toHaveLength(1);
  });
});
