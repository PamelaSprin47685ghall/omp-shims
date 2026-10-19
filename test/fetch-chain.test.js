import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addFetchHandler,
  appendJsonLine,
  isCloudCodeStream,
  preserveResponseUrl,
  requestBody,
  requestUrl,
  rewriteRequestBody,
} from "../lib/fetch-chain.js";
import { CLOUD_CODE_URL, recordingNext, tempDir } from "./helpers.js";

describe("isCloudCodeStream", () => {
  test("matches the Cloud Code Assist streaming endpoint", () => {
    expect(isCloudCodeStream(CLOUD_CODE_URL)).toBe(true);
    expect(isCloudCodeStream("https://127.0.0.1:9000/v1internal:streamGenerateContent")).toBe(true);
    expect(isCloudCodeStream("https://proxy.example/v1internal:streamGenerateContent", ["proxy.example"])).toBe(true);
  });

  test("rejects other endpoints and hosts", () => {
    expect(isCloudCodeStream("https://cloudcode-pa.googleapis.com/v1internal:generateContent")).toBe(false);
    expect(isCloudCodeStream("https://example.com/v1internal:streamGenerateContent")).toBe(false);
    expect(isCloudCodeStream(undefined)).toBe(false);
  });
});

describe("request helpers", () => {
  test("requestUrl handles every calling shape", () => {
    expect(requestUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(requestUrl(new URL("https://a.example/y"))).toBe("https://a.example/y");
    expect(requestUrl(new Request("https://a.example/z"))).toBe("https://a.example/z");
    expect(requestUrl(undefined)).toBe("");
  });

  test("requestBody only returns in-memory strings", () => {
    expect(requestBody("u", { body: "{}" })).toBe("{}");
    expect(requestBody({ url: "u", body: "x" })).toBe("x");
    expect(requestBody("u", { body: new Uint8Array(1) })).toBeUndefined();
  });

  test("preserveResponseUrl pins the url on a rebuilt response", () => {
    const response = preserveResponseUrl(new Response("x"), "https://a.example/");
    expect(response.url).toBe("https://a.example/");
  });

  test("appendJsonLine appends one line and never throws", () => {
    const file = join(tempDir(), "log.jsonl");
    appendJsonLine(file, { a: 1 });
    appendJsonLine(file, { b: 2 });
    expect(readFileSync(file, "utf8")).toBe('{"a":1}\n{"b":2}\n');
    expect(() => appendJsonLine("/nonexistent-dir/x/y.jsonl", {})).not.toThrow();
    expect(() => appendJsonLine(undefined, {})).not.toThrow();
  });
});

describe("rewriteRequestBody", () => {
  test("returns undefined when there is nothing to rewrite", () => {
    const { next, calls } = recordingNext();
    expect(rewriteRequestBody(next, "u", { body: "a" }, () => undefined)).toBeUndefined();
    expect(rewriteRequestBody(next, "u", { body: "a" }, (body) => body)).toBeUndefined();
    expect(rewriteRequestBody(next, "u", {}, () => "b")).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("re-issues a (url, init) call with the new body", async () => {
    const { next, calls } = recordingNext();
    await rewriteRequestBody(next, "https://a.example/", { method: "POST", body: "a" }, () => "b");
    expect(calls[0].input).toBe("https://a.example/");
    expect(calls[0].init).toMatchObject({ method: "POST", body: "b" });
  });

  test("rebuilds a Request-shaped call without downgrading it to GET", async () => {
    const { next, calls } = recordingNext();
    const input = { url: "https://a.example/", method: "POST", headers: { x: "1" }, body: "a" };
    await rewriteRequestBody(next, input, undefined, () => "b");
    expect(calls[0].input).toBe("https://a.example/");
    expect(calls[0].init).toMatchObject({ method: "POST", headers: { x: "1" }, body: "b" });
  });
});

describe("addFetchHandler", () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input) => {
    seen.push(["network", input]);
    return new Response("network");
  };
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test("layers run outermost first and can rewrite or answer", async () => {
    seen.length = 0;
    const disposers = [
      addFetchHandler((input, init, next) => {
        seen.push(["outer", input]);
        return next(`${input}/outer`, init);
      }),
      addFetchHandler((input, init, next) => {
        seen.push(["inner", input]);
        return next(input, init);
      }),
    ];
    const response = await globalThis.fetch("https://a.example");
    expect(await response.text()).toBe("network");
    expect(seen).toEqual([
      ["outer", "https://a.example"],
      ["inner", "https://a.example/outer"],
      ["network", "https://a.example/outer"],
    ]);
    for (const dispose of disposers) dispose();
  });

  test("a throwing layer is skipped instead of failing the request", async () => {
    const warn = console.warn;
    console.warn = () => {};
    const dispose = addFetchHandler(() => {
      throw new Error("boom");
    });
    try {
      expect(await (await globalThis.fetch("https://a.example")).text()).toBe("network");
    } finally {
      console.warn = warn;
      dispose();
    }
  });

  test("the disposer removes the layer", async () => {
    let hits = 0;
    const dispose = addFetchHandler((input, init, next) => {
      hits++;
      return next(input, init);
    });
    await globalThis.fetch("https://a.example");
    dispose();
    await globalThis.fetch("https://a.example");
    expect(hits).toBe(1);
  });
});
