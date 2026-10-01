// Antigravity turn continuation.
//
// Some Antigravity turns end without usable output: only thinking parts, a
// MALFORMED_FUNCTION_CALL finish, or a truncated body. The provider then
// re-requests the identical body and finally errors out, which the gateway
// forwards as `{"type":"upstream_error"}`.
//
// This shim instead replays the turn as a real continuation: the reasoning is
// sent back as a `model` turn (keeping its thought signature) followed by a
// `user` turn carrying a targeted nudge, so the model can finish the work.
// Non-terminal SSE events of each attempt are forwarded as they arrive, so the
// client keeps streaming while the continuation is in flight, and a single
// terminal event is emitted at the end. Nudge text never reaches the client.
//
// The marker the shim appends to the visible transcript is a salted SHA-256 of
// the reasoning it just produced, tagged by continuation variant. Salting keeps
// the marker unforgeable by model output (a model cannot pre-compute a digest
// of text it has not written yet), which is what lets `splitContents` safely
// recognise and unwind shim-generated continuations when rebuilding history —
// and lets Google's prompt prefix cache hit, because the replayed prefix is
// byte-identical to what upstream already cached.
//
// Env:
//   OMP_SHIMS_AG_HASH_SALT        salt mixed into every marker digest
//   OMP_SHIMS_AG_CONTINUE_MAX     extra continuations after the first turn
//   OMP_SHIMS_AG_LOCATION_RETRIES retries when upstream rejects the region

import { createHash } from "node:crypto";
import {
  addFetchHandler as sharedAddFetchHandler,
  appendJsonLine,
  isCloudCodeStream,
  requestBody,
  requestUrl,
  preserveResponseUrl,
} from "../lib/fetch-chain.js";
import { join } from "node:path";
import { homedir } from "node:os";

const HASH_SALT = process.env.OMP_SHIMS_AG_HASH_SALT ?? "omp-shims/antigravity-continuation/v1";
const STREAM_IDLE_TIMEOUT_MS = 30_000;
const LOCATION_BACKOFF_MS = [500, 1000, 2000];
const MIN_OUTPUT_BUDGET = 8192;

/** Nudge text per continuation variant. Deliberately plain text, no markup. */
const PROMPTS = {
  empty: "Continue your response from where you left off. Provide the final answer or the next required tool call.",
  malformed:
    "The function call was malformed and was not executed. Re-issue the intended call through the native function-calling interface with arguments matching the tool schema, or provide a text response.",
};

/** Variants a marker digest can encode. */
const VARIANTS = Object.keys(PROMPTS);

/** Prefix every digest with the salt, then a NUL, so the marker domain is separated. */
function saltedHash() {
  const hash = createHash("sha256");
  hash.update(HASH_SALT, "utf8");
  hash.update("\0", "utf8");
  return hash;
}

/** The marker digest for `text` under continuation `variant`. */
function continuationDigest(text, variant) {
  const hash = saltedHash();
  return hash.update(text, "utf8").update("\0", "utf8").update(variant, "utf8").digest("hex");
}

const DIGEST_PATTERN = /[0-9a-fA-F]{64}/g;
const THINKING_WRAPPERS = [
  { start: "```thinking\r\n", end: "\r\n```" },
  { start: "```thinking\n", end: "\n```" },
  { start: "<think>\r\n", end: "\r\n</think>" },
  { start: "<think>\n", end: "\n</think>" },
  { start: "<think>", end: "</think>" },
];

/**
 * Find a shim continuation marker inside one text part, returning the split that
 * turns `[prefix][marker][rest]` back into the original model turn followed by
 * the `user` nudge it was generated from. Handles markers inside thinking fences
 * so the fence structure survives the round trip.
 *
 * Runs a single incremental hasher over the text and compares at each candidate
 * digest position, so cost stays O(N) regardless of how many digests appear.
 */
function findContinuationMarker(text) {
  const wrapper = THINKING_WRAPPERS.find((candidate) => text.startsWith(candidate.start)) ?? null;
  const wrapperLength = wrapper ? wrapper.start.length : 0;

  const plain = saltedHash();
  let plainPosition = 0;
  const wrapped = wrapperLength > 0 ? saltedHash() : null;
  let wrappedPosition = wrapperLength;

  let match;
  DIGEST_PATTERN.lastIndex = 0;
  while ((match = DIGEST_PATTERN.exec(text)) !== null) {
    const at = match.index;
    const hex = match[0].toLowerCase();

    if (at > plainPosition) {
      plain.update(text.slice(plainPosition, at), "utf8");
      plainPosition = at;
    }
    const plainVariant = variantOf(plain, hex);
    if (plainVariant !== undefined) {
      return {
        prompt: PROMPTS[plainVariant],
        before: text.slice(0, at),
        after: text.slice(at + 64),
        wrapper: null,
      };
    }

    if (wrapped && at >= wrapperLength) {
      if (at > wrappedPosition) {
        wrapped.update(text.slice(wrappedPosition, at), "utf8");
        wrappedPosition = at;
      }
      const wrappedVariant = variantOf(wrapped, hex);
      if (wrappedVariant !== undefined) {
        const afterRaw = text.slice(at + 64);
        return {
          prompt: PROMPTS[wrappedVariant],
          before: text.slice(0, at) + wrapper.end,
          after: afterRaw.startsWith(wrapper.start) ? afterRaw : wrapper.start + afterRaw,
          wrapper,
        };
      }
    }
  }

  return null;
}

/** Which variant produced `hex`, or undefined when the digest is not ours. */
function variantOf(hasher, hex) {
  for (const variant of VARIANTS) {
    const candidate = hasher.copy();
    candidate.update("\0", "utf8");
    candidate.update(variant, "utf8");
    if (candidate.digest("hex") === hex) return variant;
  }
  return undefined;
}

/** Visible text that is not inside a thinking block. */
function textOutsideThinking(text) {
  return text
    .replace(/```(?:thinking|thought)\s*[\s\S]*?(?:```|$)/gi, "")
    .replace(/<(?:think|thinking|thought|scratchpad)>[\s\S]*?(?:<\/(?:think|thinking|thought|scratchpad)>|$)/gi, "")
    .replace(/<\|channel\|?>thought[\s\S]*?(?:<\|channel\|?>|<channel\|?>|$)/gi, "")
    .replace(/<\|channel\|?>analysis<\|message\|?>[\s\S]*?(?:<\|end\|?>|$)/gi, "")
    .trim();
}

/** First complete JSON object in `text`, if the text starts with one. */
function firstJsonObject(text) {
  const start = text.search(/\S/);
  if (start === -1 || text[start] !== "{") return undefined;
  const source = text.slice(start);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return { jsonText: source.slice(0, i + 1), rest: source.slice(i + 1) };
    }
  }
  return undefined;
}

/**
 * The provider discards "planning leak" text: a visible turn that is really the
 * model narrating its plan as a JSON blob is stripped upstream, leaving the turn
 * empty. Recover the remainder so the continuation carries real content.
 */
function planningLeakRemainder(text, toolNames) {
  const trimmed = text.trim();
  if (trimmed === "") return { leaked: false, visible: "" };
  if (!trimmed.startsWith("{")) return { leaked: false, visible: text };

  const object = firstJsonObject(text);
  const jsonText = object?.jsonText ?? trimmed;
  let leaked;
  try {
    const parsed = JSON.parse(jsonText) ?? {};
    leaked =
      typeof parsed.thought === "string" ||
      (typeof parsed.call === "string" && toolNames.has(parsed.call)) ||
      "_i" in parsed ||
      "paths" in parsed ||
      "command" in parsed ||
      ("path" in parsed && "content" in parsed);
  } catch {
    leaked = /"thought"|"_i"|"paths"|"command"/.test(jsonText) || [...toolNames].some((name) => jsonText.includes(`"${name}"`));
  }
  if (!leaked) return { leaked: false, visible: text };
  return { leaked: true, visible: object?.rest ?? "" };
}

function toolNamesOf(bodyString) {
  const names = new Set();
  try {
    for (const tool of JSON.parse(bodyString).request?.tools ?? []) {
      for (const declaration of tool.functionDeclarations ?? []) {
        if (typeof declaration.name === "string") names.add(declaration.name);
      }
    }
  } catch {}
  return names;
}

/**
 * Rewrite terminal blocks so a malformed finish is never handed to the client.
 *
 * A MALFORMED_FUNCTION_CALL turn is an upstream rejection of the turn's function
 * call, not a result the caller can act on. Delivering it surfaces as
 * "Generation failed with finish reason: MALFORMED_FUNCTION_CALL"; presenting it
 * as a normal stop is the honest representation once recovery has run or given
 * up.
 */
function sanitizeTerminalBlock(block) {
  return block
    .replace(/"finishReason"\s*:\s*"MALFORMED_FUNCTION_CALL"/g, '"finishReason":"STOP"')
    .replace(/"finishMessage"\s*:\s*"[^"]*"/g, '""');
}

function modelOf(bodyString) {
  try {
    return JSON.parse(bodyString).model;
  } catch {
    return undefined;
  }
}

/**
 * Unwind shim continuations embedded in request history: each `[prefix][marker]`
 * becomes `[model: prefix] [user: nudge]`, restoring the turn structure upstream
 * originally saw. Also repairs the model-first / model-last turn shapes the
 * Cloud Code Assist API rejects.
 */
function splitContents(contents) {
  if (!Array.isArray(contents)) return { contents, splits: 0 };
  const output = [];
  let splits = 0;

  for (const turn of contents) {
    if (turn?.role !== "model" || !Array.isArray(turn.parts)) {
      output.push(turn);
      continue;
    }

    const queue = [turn.parts];
    while (queue.length > 0) {
      const parts = queue.shift();
      let split = null;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!part || typeof part.text !== "string") continue;
        const match = findContinuationMarker(part.text);
        if (!match) continue;

        split = match;
        const before = parts.slice(0, i);
        if (match.before.length > 0) before.push({ ...part, text: match.before });
        const after = [];
        if (match.after.length > 0) after.push({ ...part, text: match.after });
        after.push(...parts.slice(i + 1));

        if (before.length > 0) output.push({ role: "model", parts: before });
        output.push({ role: "user", parts: [{ text: match.prompt }] });
        splits++;
        queue.unshift(after);
        break;
      }

      if (!split && parts.length > 0) output.push({ role: "model", parts });
    }
  }

  if (output.length > 0) {
    if (output[0]?.role === "model") {
      output.unshift({ role: "user", parts: [{ text: "Hello" }] });
      splits++;
    }
    if (output[output.length - 1]?.role === "model") {
      output.push({ role: "user", parts: [{ text: PROMPTS.empty }] });
      splits++;
    }
  }

  return { contents: output, splits };
}

function splitBody(bodyString) {
  let parsed;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    return { bodyString, splits: 0 };
  }
  if (!Array.isArray(parsed?.request?.contents)) return { bodyString, splits: 0 };

  const { contents, splits } = splitContents(parsed.request.contents);
  if (splits === 0) return { bodyString, splits: 0 };
  parsed.request.contents = contents;
  return { bodyString: JSON.stringify(parsed), splits };
}

/** Build the body that continues `state`'s turn with a `user` nudge. */
function buildContinuation(bodyString, state, variant) {
  const parsed = JSON.parse(bodyString);
  const request = (parsed.request ??= {});
  const contents = Array.isArray(request.contents) ? request.contents.slice() : [];
  const parts = [];

  if (state.thoughtBuffer.length > 0) {
    const signature = state.thoughtBuffer
      .slice()
      .reverse()
      .find((part) => part.thoughtSignature && /^[A-Za-z0-9+/=]+$/.test(part.thoughtSignature))?.thoughtSignature;
    parts.push({
      thought: true,
      text: state.thoughtBuffer.map((part) => part.text).join(""),
      ...(signature ? { thoughtSignature: signature } : {}),
    });
    const visible = textOutsideThinking(state.visibleText);
    if (visible.length > 0) parts.push({ text: visible });
  } else {
    const visible = textOutsideThinking(state.visibleText);
    if (visible.length > 0) {
      // Real visible text exists: replay it, and keep any fenced thinking with it.
      const fenced = state.visibleText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i)?.[1]?.trim();
      if (fenced) parts.push({ text: fenced, thought: true });
      parts.push({ text: visible });
    } else if (state.visibleText.trim().length > 0) {
      // Everything visible was a thinking fence. Send it as a normal model part
      // so upstream sees a real assistant utterance instead of a bare thought.
      parts.push({ text: state.visibleText.trim() });
    }
  }

  if (parts.length > 0) contents.push({ role: "model", parts });
  contents.push({ role: "user", parts: [{ text: PROMPTS[variant] }] });
  request.contents = contents;

  // Continuations need headroom to finish reasoning and still emit the answer.
  const generation = (request.generationConfig ??= {});
  const current = typeof generation.maxOutputTokens === "number" ? generation.maxOutputTokens : 0;
  if (current > 0 && current < MIN_OUTPUT_BUDGET) generation.maxOutputTokens = MIN_OUTPUT_BUDGET;

  return JSON.stringify(parsed);
}

export function install(config, context) {
  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];
  const maxContinuations = Number.parseInt(process.env.OMP_SHIMS_AG_CONTINUE_MAX ?? String(config.maxContinuations ?? 3), 10) || 0;
  const maxLocationRetries =
    Number.parseInt(process.env.OMP_SHIMS_AG_LOCATION_RETRIES ?? String(config.locationRetries ?? 3), 10) || 0;
  const out =
    config.out ?? process.env.OMP_SHIMS_AG_DIAG_OUT ?? join(homedir(), ".omp", "logs", "antigravity-continuation.jsonl");
  const record = (entry) => appendJsonLine(out, entry);
  const decoder = new TextDecoder();

  if (maxContinuations <= 0) {
    // No budget for recovery, but the malformed finish must still not reach the
    // client, so stream the response through the sanitizer alone.
    return addFetchHandler((input, init, next) => {
      if (!isCloudCodeStream(requestUrl(input), extraHosts)) return next(input, init);
      return next(input, init).then((response) => {
        if (!response.ok || !response.body) return response;
        return sanitizeResponse(response);
      });
    });
  }

  async function isRegionRejected(response) {
    if (!response || (response.status !== 400 && response.status !== 403)) return false;
    try {
      const text = await response.clone().text();
      return text.includes("location is not supported") || text.includes("User location");
    } catch {
      return false;
    }
  }

  /** The daily and sandbox hosts are the same service with different region routing. */
  function alternateHost(url) {
    if (url.includes("daily-cloudcode-pa.googleapis.com")) {
      return url.replace("daily-cloudcode-pa.googleapis.com", "daily-cloudcode-pa.sandbox.googleapis.com");
    }
    if (url.includes("daily-cloudcode-pa.sandbox.googleapis.com")) {
      return url.replace("daily-cloudcode-pa.sandbox.googleapis.com", "daily-cloudcode-pa.googleapis.com");
    }
    return url;
  }

  async function fetchWithRegionRetry(callFetch, url, init) {
    let target = url;
    let response = await callFetch(target, init);
    if (maxLocationRetries <= 0) return { response, target };

    for (let attempt = 1; attempt <= maxLocationRetries; attempt++) {
      if (!(await isRegionRejected(response))) break;
      if (attempt === 2) target = alternateHost(target);

      record({ ts: new Date().toISOString(), event: "region-retry", attempt, target, status: response.status });
      try {
        await response.body?.cancel();
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, LOCATION_BACKOFF_MS[attempt - 1] ?? 2000));
      if (init?.signal?.aborted) break;
      response = await callFetch(target, init);
    }
    return { response, target };
  }

  /**
   * Read one upstream attempt. Forwards non-terminal blocks as they arrive and
   * holds the terminal block for end-of-turn inspection.
   */
  async function pump(body, controller, state, signal) {
    const reader = body.getReader();
    const held = [];
    let buffered = "";

    const observe = (block) => {
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "" || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const error = parsed.error ?? parsed.response?.error;
        if (error) {
          state.finishReason = "ERROR";
          record({ ts: new Date().toISOString(), event: "upstream-sse-error", error });
        }

        const response = parsed.response ?? parsed;
        for (const candidate of response.candidates ?? []) {
          if (candidate.finishReason) state.finishReason = candidate.finishReason;
          for (const part of candidate.content?.parts ?? []) {
            if (part.functionCall && typeof part.functionCall.name === "string" && part.functionCall.name.trim()) {
              state.toolCalls += 1;
            }
            if (part.thought === true) {
              state.thoughtParts += 1;
              if (typeof part.text === "string" && part.text !== "") {
                state.thoughtBuffer.push({
                  text: part.text,
                  ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                });
              }
            } else if (typeof part.text === "string" && part.text.trim() !== "") {
              state.visibleChars += part.text.trim().length;
              if (state.visibleText.length < 262144) state.visibleText += part.text;
            }
          }
        }
      }
      return state.finishReason !== undefined;
    };

    const enqueue = (block) => {
      if (signal?.aborted) return;
      try {
        controller.enqueue(encoder.encode(block));
      } catch {}
    };

    for (;;) {
      if (signal?.aborted) return "aborted";
      const read = reader.read();
      // Clear the guard timer on every settled read: a leaked 30s timer per
      // chunk keeps the process event loop alive long after the response ends.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Upstream stream idle timeout")), STREAM_IDLE_TIMEOUT_MS);
      });
      let result;
      try {
        result = await Promise.race([read, timeout]);
      } finally {
        clearTimeout(timer);
      }
      const { done, value } = result;
      if (done) break;
      if (value === undefined) continue;

      buffered += decoder.decode(value, { stream: true });

      for (;;) {
        const crlf = buffered.indexOf("\r\n\r\n");
        const lf = buffered.indexOf("\n\n");
        let boundary = -1;
        let separator = 2;
        if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
          boundary = crlf;
          separator = 4;
        } else if (lf !== -1) {
          boundary = lf;
        }
        if (boundary === -1) break;

        const block = buffered.slice(0, boundary + separator);
        buffered = buffered.slice(boundary + separator);
        observe(block);

        // Stream everything except the terminal block, which decides the outcome.
        if (block.includes('"finishReason"') || block.includes("[DONE]")) held.push(block);
        else enqueue(block);
      }

      // Upstream sends the terminal event before closing the HTTP/2 stream; do
      // not block on EOF waiting for it.
      if (state.finishReason !== undefined || held.some((block) => block.includes("[DONE]"))) {
        try {
          reader.cancel();
        } catch {}
        break;
      }
    }

    if (buffered !== "") {
      observe(buffered);
      if (buffered.includes('"finishReason"') || buffered.includes("[DONE]")) held.push(buffered);
      else enqueue(buffered);
    }

    // A stream that ends with no finishReason at all would surface downstream as
    // an incomplete-stream error; give the turn a clean terminal instead.
    const upstreamEndedCleanly = state.finishReason !== undefined;
    if (state.finishReason === undefined && !state.aborted) {
      state.finishReason = "STOP";
      held.push('data: {"response":{"candidates":[{"finishReason":"STOP"}]}}\n\n');
    }

    state.terminalBlocks = held;
    if (!upstreamEndedCleanly) return "no-terminal";
    return held.length > 0 ? "terminal" : "terminal-missing";
  }

  const encoder = new TextEncoder();

  /** Stream a response through, rewriting malformed terminal blocks in place. */
  function sanitizeResponse(response) {
    const decoderLocal = new TextDecoder();
    const bytes = new TextEncoder();
    let pending = "";
    const rewriter = new TransformStream({
      transform(chunk, controller) {
        pending += decoderLocal.decode(chunk, { stream: true });
        // Hold only the trailing partial event; everything complete is forwarded
        // immediately so streaming stays real time.
        const boundary = pending.lastIndexOf("\n\n");
        if (boundary === -1) return;
        const head = pending.slice(0, boundary + 2);
        const tail = pending.slice(boundary + 2);
        pending = "";
        controller.enqueue(bytes.encode(sanitizeTerminalBlock(head) + tail));
      },
      flush(controller) {
        if (pending !== "") controller.enqueue(bytes.encode(sanitizeTerminalBlock(pending)));
      },
    });
    return preserveResponseUrl(
      new Response(response.body.pipeThrough(rewriter), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
      response.url,
    );
  }

  return addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return next(input, init);

    const bodyString = requestBody(input, init);
    if (bodyString === undefined) return next(input, init);

    // This layer sits ABOVE the body rewrites and ipv6-first, so re-issuing an
    // upstream call through `next` sends it back down the stack and it is
    // rewritten and address-pinned exactly like the first attempt. Re-entering
    // from here does not re-enter this layer, because `next` always moves inward.
    const callFetch = (target, targetInit) => next(target, targetInit);

    let firstBody = bodyString;
    const split = splitBody(bodyString);
    if (split.splits > 0) {
      firstBody = split.bodyString;
      record({ ts: new Date().toISOString(), event: "history-split", splits: split.splits });
    }

    const firstInit = firstBody === bodyString ? init : { ...init, body: firstBody };

    return fetchWithRegionRetry(callFetch, url, firstInit)
      .catch((error) => {
        record({ ts: new Date().toISOString(), event: "fetch-rejected", url, error: String(error?.stack ?? error) });
        throw error;
      })
      .then(async (first) => {
        let response = first.response;
        if (!response.body || !response.ok) return response;

        const startedAt = performance.now();
        const signal = init?.signal;
        const toolNames = toolNamesOf(firstBody);
        const attempts = [];
        let current = response;
        let body = firstBody;

        const stream = new ReadableStream({
          async start(controller) {
            let attempt = 0;
            try {
              for (;;) {
                const state = {
                  thoughtParts: 0,
                  visibleChars: 0,
                  toolCalls: 0,
                  visibleText: "",
                  thoughtBuffer: [],
                  finishReason: undefined,
                  terminalBlocks: [],
                  aborted: signal?.aborted ?? false,
                };

                const outcome = await pump(current.body, controller, state, signal);
                if (state.aborted || signal?.aborted) {
                  attempts.push({ attempt, outcome: "aborted" });
                  break;
                }

                const outside = textOutsideThinking(state.visibleText);
                const { visible: meaningful } = planningLeakRemainder(outside, toolNames);

                // A MALFORMED_FUNCTION_CALL finish means upstream rejected the
                // turn's function call, so the turn produced nothing usable no
                // matter what text it carried, and the error must not reach the
                // client. It is recovered on its own condition.
                const malformed = state.finishReason === "MALFORMED_FUNCTION_CALL";
                const variant = malformed ? "malformed" : "empty";

                // Otherwise only intervene when the turn produced no tool call
                // and no visible answer. A bare tool call with thinking-only
                // narration is a valid turn and must flow through untouched.
                const producedOutput = state.toolCalls > 0 || meaningful.trim() !== "";
                const truncated =
                  state.finishReason === "MAX_TOKENS" &&
                  state.toolCalls === 0 &&
                  (meaningful.trim().length < 10 || meaningful.trim() === "{" || meaningful.trim().startsWith("```thinking"));
                const needsContinuation =
                  attempt < maxContinuations &&
                  (malformed || (!producedOutput && (truncated || state.thoughtParts > 0 || state.visibleChars > 0)));

                record({
                  ts: new Date().toISOString(),
                  event: "turn-eval",
                  model: modelOf(body),
                  attempt,
                  outcome,
                  finishReason: state.finishReason,
                  toolCalls: state.toolCalls,
                  visibleChars: state.visibleChars,
                  thoughtParts: state.thoughtParts,
                  meaningfulLen: meaningful.trim().length,
                  variant,
                  needsContinuation,
                });
                attempts.push({
                  attempt,
                  outcome,
                  finishReason: state.finishReason,
                  thoughtParts: state.thoughtParts,
                  toolCalls: state.toolCalls,
                  ...(state.finishReason === "MALFORMED_FUNCTION_CALL" ? { malformedRecovered: true } : {}),
                  continued: needsContinuation,
                });

                const finish = () => {
                  for (const block of state.terminalBlocks) {
                    if (signal?.aborted) return;
                    try {
                      controller.enqueue(encoder.encode(sanitizeTerminalBlock(block)));
                    } catch {}
                  }
                };

                if (!needsContinuation) {
                  finish();
                  break;
                }

                // Publish the salted marker so the client-visible transcript can
                // be rebuilt into this exact turn + nudge pair later.
                const marker = continuationDigest(
                  state.thoughtBuffer.map((part) => part.text).join("") || state.visibleText || "empty_turn",
                  variant,
                );
                const asThought = state.thoughtParts > 0 || state.visibleText.includes("<think") || state.visibleText.includes("```thinking");
                const markerBlock = `data: ${JSON.stringify({
                  response: {
                    candidates: [
                      { content: { role: "model", parts: [asThought ? { text: marker, thought: true } : { text: marker }] } },
                    ],
                  },
                })}\n\n`;
                if (!signal?.aborted) {
                  try {
                    controller.enqueue(encoder.encode(markerBlock));
                  } catch {}
                }

                body = buildContinuation(body, state, variant);
                attempt++;
                const next = await fetchWithRegionRetry(callFetch, first.target, { ...init, body });
                current = next.response;
                if (!current.ok) {
                  const detail = await current.text().catch(() => "");
                  attempts[attempts.length - 1].error = `continuation HTTP ${current.status}`;
                  record({ ts: new Date().toISOString(), event: "continuation-error", status: current.status, error: detail.slice(0, 500) });
                  if (attempt < maxContinuations) continue;
                  finish();
                  break;
                }
              }
            } catch (error) {
              record({ ts: new Date().toISOString(), event: "continuation-failed", url, error: String(error?.stack ?? error) });
              try {
                controller.error(error);
              } catch {}
            } finally {
              if (attempts.length > 0) {
                record({ ts: new Date().toISOString(), event: "continuation-summary", url, ms: Math.round(performance.now() - startedAt), attempts });
              }
              try {
                controller.close();
              } catch {}
            }
          },
        });

        // Bun drops `.url` when a Response is rebuilt, and OMP re-reads it on its
        // internal replay; restore the canonical URL.
        return preserveResponseUrl(
          new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers }),
          response.url,
        );
      });
  });
}
