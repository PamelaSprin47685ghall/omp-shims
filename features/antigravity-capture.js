// Antigravity stream diagnostics.
//
// The gateway logs neither a MALFORMED_FUNCTION_CALL finish nor a thought-only
// turn, so both failure shapes are recorded here as one JSON line per event.
// Purely observational: bytes are forwarded untouched.
//
// Env:
//   OMP_SHIMS_AG_CAPTURE_OUT       output file (default ~/.omp/logs/antigravity-streams.jsonl)
//   OMP_SHIMS_AG_CAPTURE_SAMPLE    record a summary for every Nth stream (0 = only failures)

import {
  addFetchHandler as sharedAddFetchHandler,
  appendJsonLine,
  isCloudCodeStream,
  requestBody,
  requestUrl,
} from "../lib/fetch-chain.js";
import { join } from "node:path";
import { homedir } from "node:os";

const MARKERS = ["MALFORMED_FUNCTION_CALL", "malformed function call", "malformed-function-call"];
const TAIL_BYTES = 4096;

function isDegradedSchema(schema) {
  return (
    schema !== undefined &&
    typeof schema === "object" &&
    schema !== null &&
    schema.type === "object" &&
    typeof schema.properties === "object" &&
    schema.properties !== null &&
    Object.keys(schema.properties).length === 0 &&
    Object.keys(schema).length <= 2
  );
}

function requestShape(bodyString) {
  const shape = {
    model: undefined,
    thinkingLevel: undefined,
    maxOutputTokens: undefined,
    systemInstruction: false,
    turns: undefined,
    tools: 0,
    degradedTools: [],
  };
  try {
    const parsed = JSON.parse(bodyString);
    const request = parsed.request ?? {};
    const generation = request.generationConfig ?? {};
    shape.model = parsed.model;
    shape.thinkingLevel = generation.thinkingConfig?.thinkingLevel;
    shape.maxOutputTokens = generation.maxOutputTokens;
    shape.systemInstruction = request.systemInstruction !== undefined;
    shape.turns = Array.isArray(request.contents) ? request.contents.length : undefined;
    for (const tool of request.tools ?? []) {
      for (const declaration of tool.functionDeclarations ?? []) {
        shape.tools += 1;
        if (isDegradedSchema(declaration.parameters)) shape.degradedTools.push(declaration.name);
      }
    }
  } catch {}
  return shape;
}

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];
  const out = config.out ?? process.env.OMP_SHIMS_AG_CAPTURE_OUT ?? join(homedir(), ".omp", "logs", "antigravity-streams.jsonl");
  const sampleEvery = Number.parseInt(process.env.OMP_SHIMS_AG_CAPTURE_SAMPLE ?? String(config.sampleEvery ?? 0), 10) || 0;

  const record = (entry) => appendJsonLine(out, entry);
  let streamCount = 0;

  function createInspector(url, bodyString, startedAt) {
    const stats = { bytes: 0, events: 0, finishReason: undefined, thoughtParts: 0, visibleChars: 0, toolCalls: 0 };
    let window = "";
    let tail = "";
    const markers = [];

    const scan = (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const response = parsed.response ?? parsed;
      if (response.usageMetadata && !stats.finishReason) stats.finishReason = "STOP";
      for (const candidate of response.candidates ?? []) {
        if (candidate.finishReason) stats.finishReason = candidate.finishReason;
        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall && typeof part.functionCall.name === "string" && part.functionCall.name.trim()) stats.toolCalls += 1;
          if (part.thought === true) stats.thoughtParts += 1;
          if (typeof part.text === "string" && part.thought !== true && part.text.trim()) stats.visibleChars += part.text.trim().length;
        }
      }
    };

    return {
      push(chunk) {
        const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk, { stream: true });
        stats.bytes += text.length;
        tail = (tail + text).slice(-TAIL_BYTES);
        window += text;
        for (const marker of MARKERS) {
          if (window.includes(marker) && !markers.includes(marker)) markers.push(marker);
        }
        let newline;
        while ((newline = window.indexOf("\n")) !== -1) {
          const line = window.slice(0, newline).trim();
          window = window.slice(newline + 1);
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data !== "" && data !== "[DONE]") {
              stats.events += 1;
              scan(data);
            }
          }
        }
        if (window.length > 1 << 20) window = window.slice(-4096);
      },
      flush() {
        streamCount += 1;
        const base = { ts: new Date().toISOString(), url, ms: Math.round(performance.now() - startedAt), ...requestShape(bodyString), ...stats };
        if (markers.length > 0) {
          record({ ...base, event: "malformed-function-call", markers, tail });
          return;
        }
        if (stats.finishReason !== undefined && stats.visibleChars === 0 && stats.toolCalls === 0 && stats.events > 0) {
          record({ ...base, event: "empty-output", thoughtOnly: stats.thoughtParts > 0, tail });
          return;
        }
        if (stats.events > 0 && stats.finishReason === undefined) {
          record({ ...base, event: "incomplete-stream", tail });
          return;
        }
        if (sampleEvery > 0 && streamCount % sampleEvery === 0) record({ ...base, event: "stream" });
      },
    };
  }

  return addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return next(input, init);

    const bodyString = requestBody(input, init);
    if (bodyString === undefined) return next(input, init);

    return next(input, init).then((response) => {
      const startedAt = performance.now();
      if (!response.body) {
        response
          .clone()
          .text()
          .then((text) => {
            const inspector = createInspector(url, bodyString, startedAt);
            inspector.push(text);
            inspector.flush();
          })
          .catch(() => {});
        return response;
      }

      const inspector = createInspector(url, bodyString, startedAt);
      const scanner = new TransformStream({
        transform(chunk, controller) {
          inspector.push(chunk);
          controller.enqueue(chunk);
        },
        flush() {
          inspector.flush();
        },
      });
      // Rebuilding a Response in Bun drops `.url`, which OMP reads on its own
      // retry path; put the original back.
      const wrapped = new Response(response.body.pipeThrough(scanner), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      try {
        if (typeof response.url === "string" && response.url !== "") {
          Object.defineProperty(wrapped, "url", { value: response.url, configurable: true, enumerable: true });
        }
      } catch {}
      return wrapped;
    });
  });
}
