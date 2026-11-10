// Antigravity: one autonomous outbound module.
//
// The v1 features were five separate fetch layers with five registrations.
// This module keeps the same behaviour behind five switches and one install:
//
//   systemInstruction  move an agent envelope's request.systemInstruction into
//                      a leading user turn and keep a floor on maxOutputTokens;
//   routing            send Gemini Flash to its -tiered model with a thinking
//                      level instead of a thinking budget;
//   continuation       recover thought-only, MALFORMED_FUNCTION_CALL and
//                      truncated turns by replaying them as real continuations;
//   capture            write stream diagnostics through a bounded Sink;
//   accountRouting     drain Ultra and Pro accounts in a fixed order, with
//                      cooldowns in the shared StateStore.
//
// The schema sanitizer is not a switch. Every Cloud Code body passes through
// it, because upstream rejects one bad enum value or property name with HTTP
// 400 even when the turn is otherwise valid. The sanitizer sits at the
// innermost Antigravity layer, so a retry, an account re-issue and a
// continuation replay all pass through it.
//
// URL decisions use isCloudCodeStreamUrl() only; other modules use
// matchHttpsHost() for their exact hosts. The body layers sit above the
// transport layers: every retry calls next(), so IPv6 pinning and the rest of
// the outbound chain still run.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { activePin, isCloudCodeStreamUrl, report, verboseLog } from "../lib/contracts.mjs";
import { CredentialRepository } from "../lib/credentials.mjs";
import {
  addFetchHandler,
  outboundPriority,
  readOutboundBodyText,
  requestBody,
  requestUrl,
  withRequestBody,
} from "../lib/outbound.mjs";
import { StateStore } from "../lib/router/state-store.mjs";
import { createSseScanner, parseSseFrame, rebuildResponse, serializeSseFrame } from "../lib/sse.mjs";
import { hashEmail, redactUrl, Sink } from "../lib/telemetry.mjs";
import antigravityPolicy from "../presets/antigravity.json" with { type: "json" };

export const name = "antigravity";
export const phase = "outbound";

/** The provider id in agent.db. */
export const PROVIDER = "google-antigravity";

/** Smallest output budget that lets a function call finish. */
const MIN_OUTPUT_BUDGET = 8192;
const EMPTY_AGENT_PROMPT = "Continue.";

/** Flash families that upstream serves as -tiered models. */
const DEFAULT_TIERED_PATTERN = new RegExp(antigravityPolicy.tieredPattern);
const EFFORT_LEVELS = {
  "extra-low": "LOW",
  minimal: "MINIMAL",
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

/** Models that only Ultra accounts can serve. The config may override it. */
export const DEFAULT_ULTRA_PATTERN = new RegExp(antigravityPolicy.ultraModelPattern, "i");
const DEFAULT_COOLDOWN_MS = 60_000;
const LOCATION_BACKOFF_MS = [500, 1000, 2000];
const MAX_VISIBLE_TEXT = 262_144;
const MAX_THOUGHT_TEXT = 1_048_576;
const MAX_TERMINAL_FRAMES = 8;
const MAX_SSE_EVENT_BYTES = 1024 * 1024;
/** Deepest schema chain the sanitizer walks. Deeper nodes stop cleanly. */
const MAX_SCHEMA_DEPTH = 256;

/** Property names the Antigravity provider accepts. */
const PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Hosts that serve the same Cloud Code API under a different region. */
const SANDBOX_HOST = "daily-cloudcode-pa.sandbox.googleapis.com";
const DAILY_HOST = "daily-cloudcode-pa.googleapis.com";

const HASH_SALT = "omp-shims/antigravity-continuation/v1";

/** Nudge text per continuation variant. Plain text, no markup. */
export const PROMPTS = {
  empty: "Continue your response from where you left off. Provide the final answer or the next required tool call.",
  malformed:
    "The function call was malformed and was not executed. Re-issue the intended call through the native function-calling interface with arguments matching the tool schema, or provide a text response.",
};

const VARIANTS = Object.keys(PROMPTS);

const DIGEST_PATTERN = /[0-9a-fA-F]{64}/g;
const THINKING_WRAPPERS = [
  { start: "```thinking\r\n", end: "\r\n```" },
  { start: "```thinking\n", end: "\n```" },
  { start: " thinking\r\n", end: "\r\n</think>" },
  { start: " thinking\n", end: "\n</think>" },
  { start: " thinking", end: "</think>" },
];

/** Keys that hold a child schema (one object, even when the value is a list). */
const SCHEMA_SINGLE_KEYS = new Set(["items", "additionalProperties", "additional_properties", "not", "contains"]);
/** Keys that hold an array of child schemas. */
const SCHEMA_LIST_KEYS = new Set(["anyOf", "oneOf", "allOf", "any_of", "one_of", "all_of", "prefixItems"]);
/** Keys that hold a map of name to child schema. */
const SCHEMA_MAP_KEYS = new Set(["properties", "$defs", "definitions"]);
const SCHEMA_KEYS = new Set([...SCHEMA_SINGLE_KEYS, ...SCHEMA_LIST_KEYS, ...SCHEMA_MAP_KEYS]);
const FUNCTION_DECLARATION_KEYS = ["function_declarations", "functionDeclarations"];
const DECLARATION_SCHEMA_KEYS = ["parameters", "parametersJsonSchema", "parameters_json_schema"];
/** Tool keys whose value is one schema outside a function declaration. */
const TOOL_SCHEMA_KEYS = [
  "input_schema",
  "inputSchema",
  "response_schema",
  "responseSchema",
  ...DECLARATION_SCHEMA_KEYS,
];
/** Tool keys that wrap one more object of schema keys. */
const TOOL_SCHEMA_WRAPPERS = ["custom"];

/** Return a useful message from any thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Write one diagnostic record. A sink failure never affects traffic. */
function emit(sink, event, detail) {
  try {
    const pending = sink.emit(event, detail);
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {}
}

/** A truncated digest for a marker or upstream error. Never the raw text. */
function hashMarker(value) {
  try {
    return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12)}`;
  } catch {
    return "sha256:invalid";
  }
}

/** The host of a URL, for structural diagnostics only. */
function hostOf(target) {
  try {
    return new URL(target).hostname;
  } catch {
    return "invalid";
  }
}

/** Read at most `limit` bytes from a response body. */
async function readCappedText(response, limit) {
  if (!response?.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const take = Math.min(value.byteLength, limit - bytes);
      chunks.push(Buffer.from(value.buffer, value.byteOffset, take));
      bytes += take;
      if (take < value.byteLength) break;
    }
  } catch {
    // A broken error body is still an error response.
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** True when the request targets the Cloud Code streaming RPC. */
export function isCloudCodeRequest(input, init, extraHosts = []) {
  const url = requestUrl(input);
  if (url === "") return false;
  let hostHeader;
  try {
    const headers = new Headers(init?.headers ?? (input && typeof input === "object" ? input.headers : undefined));
    hostHeader = headers.get("host") ?? undefined;
  } catch {
    hostHeader = undefined;
  }
  return isCloudCodeStreamUrl(url, extraHosts, { hostHeader });
}

/** Headers of the (input, init) request shape. */
function requestHeaders(input, init) {
  return new Headers(init?.headers ?? (input && typeof input === "object" ? input.headers : undefined));
}

/**
 * Rewrite a body and re-issue the call through `next`.
 * A body read from a stream is always replayed, because the read consumed it.
 */
async function rewriteCloudBody(next, input, init, rewrite) {
  const inline = requestBody(input, init);
  let original = inline;
  let replayed = false;
  if (original === undefined) {
    original = await readOutboundBodyText(input, init);
    if (original === undefined) return next(input, init);
    replayed = true;
  }

  let rewritten;
  try {
    rewritten = rewrite(original);
  } catch (error) {
    report("antigravity body rewrite failed", { error: messageOf(error) });
    rewritten = undefined;
  }

  if ((rewritten === undefined || rewritten === original) && !replayed) return next(input, init);
  const { target, init: nextInit } = withRequestBody(input, init, rewritten ?? original);
  return next(target, nextInit);
}

/* ------------------------------------------------------------------ */
/* Enum sanitizer.                                                     */
/* ------------------------------------------------------------------ */

/**
 * Drop invalid property names (with their `required` entries) and keep only
 * non-empty strings in every enum below one schema node. An enum that becomes
 * empty loses its key. Return the number of enum entries removed and push one
 * detail record per changed enum onto `drops`; key removals go to `keyDrops`.
 * This function never throws.
 */
export function sanitizeSchemaEnums(node, toolName = "", path = "parameters", drops = [], keyDrops = []) {
  let dropped = 0;
  const stack = [{ node, path, depth: 0 }];
  const seen = new WeakSet();

  while (stack.length > 0) {
    const current = stack.pop();
    const child = current.node;
    if (child === null || typeof child !== "object" || Array.isArray(child)) continue;
    if (seen.has(child)) continue;
    seen.add(child);

    const properties = child.properties;
    if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
      const droppedKeys = [];
      for (const key of Object.keys(properties)) {
        if (PROPERTY_KEY.test(key)) continue;
        delete properties[key];
        droppedKeys.push(key);
      }
      if (droppedKeys.length > 0) {
        if (Array.isArray(child.required)) {
          const gone = new Set(droppedKeys);
          child.required = child.required.filter((name) => typeof name !== "string" || !gone.has(name));
        }
        keyDrops.push({ tool: toolName, path: current.path, droppedKeys });
      }
    }

    for (const key of ["enum", "enum_"]) {
      if (!Array.isArray(child[key])) continue;
      const value = child[key];
      const kept = value.filter((entry) => typeof entry === "string" && entry !== "");
      const removed = value.length - kept.length;
      if (removed === 0) continue;
      dropped += removed;
      drops.push({ tool: toolName, path: `${current.path}.${key}`, dropped: removed });
      if (kept.length === 0) delete child[key];
      else child[key] = kept;
    }

    if (current.depth >= MAX_SCHEMA_DEPTH) continue;
    const depth = current.depth + 1;
    for (const key of SCHEMA_KEYS) {
      if (!Object.hasOwn(child, key)) continue;
      const value = child[key];
      const nextPath = `${current.path}.${key}`;
      if (SCHEMA_MAP_KEYS.has(key)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [name, item] of Object.entries(value)) {
          stack.push({ node: item, path: `${nextPath}.${name}`, depth });
        }
        continue;
      }
      if (SCHEMA_LIST_KEYS.has(key)) {
        if (!Array.isArray(value)) continue;
        for (let index = 0; index < value.length; index++) {
          stack.push({ node: value[index], path: `${nextPath}[${index}]`, depth });
        }
        continue;
      }
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          stack.push({ node: value[index], path: `${nextPath}[${index}]`, depth });
        }
      } else {
        stack.push({ node: value, path: nextPath, depth });
      }
    }
  }

  return dropped;
}

/**
 * Sanitize every tool schema in one Cloud Code body.
 * Return the new body text when something changed, else undefined.
 * A malformed body, a missing tools array and any internal error return
 * undefined, so the caller sends the original body unchanged.
 */
export function sanitizeCloudCodeBody(bodyText) {
  if (typeof bodyText !== "string") return undefined;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed === null || typeof parsed !== "object") return undefined;

    const containers = [
      { path: "request.tools", tools: parsed.request?.tools },
      { path: "tools", tools: parsed.tools },
    ].filter((entry) => Array.isArray(entry.tools));
    let changed = false;
    const drops = [];
    const keyDrops = [];

    for (const container of containers) {
      const tools = container.tools;
      for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
        const tool = tools[toolIndex];
        if (tool === null || typeof tool !== "object") continue;
        const toolName =
          typeof tool.custom?.name === "string" ? tool.custom.name : typeof tool.name === "string" ? tool.name : "";
        const schemas = [{ prefix: "", node: tool }];
        for (const wrapperKey of TOOL_SCHEMA_WRAPPERS) {
          const wrapper = tool[wrapperKey];
          if (wrapper !== null && typeof wrapper === "object" && !Array.isArray(wrapper)) {
            schemas.push({ prefix: `.${wrapperKey}`, node: wrapper });
          }
        }
        for (const { prefix, node } of schemas) {
          for (const schemaKey of TOOL_SCHEMA_KEYS) {
            const schema = node[schemaKey];
            if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
            const path = `${container.path}[${toolIndex}]${prefix}.${schemaKey}`;
            const before = drops.length;
            const beforeKeys = keyDrops.length;
            const dropped = sanitizeSchemaEnums(schema, toolName, path, drops, keyDrops);
            if (dropped > 0 || keyDrops.length > beforeKeys) changed = true;
            for (let at = before; at < drops.length; at++) {
              drops[at].toolIndex = toolIndex;
            }
          }
        }
        for (const key of FUNCTION_DECLARATION_KEYS) {
          const declarations = tool[key];
          if (!Array.isArray(declarations)) continue;
          for (let index = 0; index < declarations.length; index++) {
            const declaration = declarations[index];
            if (declaration === null || typeof declaration !== "object") continue;
            const toolName = typeof declaration.name === "string" ? declaration.name : "";
            for (const schemaKey of DECLARATION_SCHEMA_KEYS) {
              const schema = declaration[schemaKey];
              if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
              const path = `${container.path}[${toolIndex}].${key}[${index}].${schemaKey}`;
              const before = drops.length;
              const beforeKeys = keyDrops.length;
              const dropped = sanitizeSchemaEnums(schema, toolName, path, drops, keyDrops);
              if (dropped > 0 || keyDrops.length > beforeKeys) changed = true;
              for (let at = before; at < drops.length; at++) {
                drops[at].toolIndex = toolIndex;
              }
            }
          }
        }
      }
    }

    if (drops.length > 0) verboseLog("antigravity: sanitized tool schemas", { drops });
    if (keyDrops.length > 0) verboseLog("antigravity: dropped invalid tool property keys", { drops: keyDrops });
    return changed ? JSON.stringify(parsed) : undefined;
  } catch (error) {
    report("antigravity: enum sanitizer failed open", { error: messageOf(error) });
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* System instruction and routing.                                     */
/* ------------------------------------------------------------------ */

/**
 * Move the system prompt into a leading user turn. Return a new body or
 * undefined.
 *
 * Only Antigravity agent envelopes carry `requestType: "agent"`. A native host
 * envelope has no requestType and keeps its `systemInstruction` untouched;
 * `force` opts such an envelope into the rewrite explicitly.
 */
export function rewriteSystemInstruction(bodyString, force = false) {
  let parsed;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    return undefined;
  }

  const request = parsed?.request;
  if (!request || typeof request !== "object") return undefined;
  if (parsed.requestType !== "agent" && force !== true) return undefined;
  let changed = false;

  const system = request.systemInstruction;
  if (system && Array.isArray(system.parts) && system.parts.length > 0) {
    request.contents = [
      { role: "user", parts: system.parts },
      ...(Array.isArray(request.contents) ? request.contents : []),
    ];
    delete request.systemInstruction;
    changed = true;
  }

  if (!Array.isArray(request.contents) || request.contents.length === 0) {
    request.contents = [{ role: "user", parts: [{ text: EMPTY_AGENT_PROMPT }] }];
    changed = true;
  }
  const generation = request.generationConfig;
  const budget = generation?.maxOutputTokens;
  if (typeof budget === "number" && budget > 0 && budget < MIN_OUTPUT_BUDGET) {
    generation.maxOutputTokens = MIN_OUTPUT_BUDGET;
    changed = true;
  }

  return changed ? JSON.stringify(parsed) : undefined;
}

/** Compile a configured regular-expression string, or keep the fallback. */
function compilePattern(pattern, fallback) {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern === "string" && pattern !== "") return new RegExp(pattern);
  return fallback;
}

/** True when `model` is a Flash model that upstream serves as -tiered. */
export function resolveRoute(model, request, defaultLevel, tieredPattern = DEFAULT_TIERED_PATTERN) {
  if (typeof model !== "string") return undefined;
  const match = compilePattern(tieredPattern, DEFAULT_TIERED_PATTERN).exec(model);
  if (!match) return undefined;

  let level;
  if (/-(?:minimal|low)$/.test(model)) level = "LOW";
  else if (/-medium$/.test(model)) level = "MEDIUM";
  else if (/-high$/.test(model)) level = "HIGH";

  if (level === undefined) {
    const requested = request?.generationConfig?.thinkingConfig?.thinkingLevel;
    if (requested === "LOW" || requested === "MINIMAL") level = "LOW";
    else if (requested === "MEDIUM") level = "MEDIUM";
    else if (requested === "HIGH") level = "HIGH";
  }

  return { model: `${match[1]}-tiered`, level: level ?? defaultLevel };
}

/** Rewrite one Flash body. Return a new body or undefined. */
export function rewriteRouting(bodyString, defaultLevel, tieredPattern = DEFAULT_TIERED_PATTERN) {
  let parsed;
  try {
    parsed = JSON.parse(bodyString);
  } catch {
    return undefined;
  }
  // Only Antigravity agent envelopes are routed. A native host envelope has no
  // requestType and keeps its model untouched.
  if (parsed?.requestType !== "agent" || typeof parsed.model !== "string") return undefined;

  const request = (parsed.request ??= {});
  const target = resolveRoute(parsed.model, request, defaultLevel, tieredPattern);
  if (target === undefined) return undefined;

  const generation = (request.generationConfig ??= {});
  const maxTokens = typeof generation.maxOutputTokens === "number" ? generation.maxOutputTokens : 0;
  // Forcing thinking on a tiny budget truncates the answer before it starts.
  if (maxTokens > 0 && maxTokens < 256) return undefined;

  parsed.model = target.model;
  const thinking = (generation.thinkingConfig ??= {});
  delete thinking.thinkingBudget;
  thinking.thinkingLevel = target.level;
  return JSON.stringify(parsed);
}

/* ------------------------------------------------------------------ */
/* Continuation helpers.                                               */
/* ------------------------------------------------------------------ */

function saltedHash() {
  const hash = createHash("sha256");
  hash.update(HASH_SALT, "utf8");
  hash.update("\0", "utf8");
  return hash;
}

/** The marker digest for `text` under continuation `variant`. */
export function continuationDigest(text, variant) {
  return saltedHash().update(text, "utf8").update("\0", "utf8").update(variant, "utf8").digest("hex");
}

/** Which variant produced `hex`, or undefined. */
function variantOf(hasher, hex) {
  for (const variant of VARIANTS) {
    const candidate = hasher.copy();
    candidate.update("\0", "utf8");
    candidate.update(variant, "utf8");
    if (candidate.digest("hex") === hex) return variant;
  }
  return undefined;
}

/** Find a shim continuation marker inside one text part. */
export function findContinuationMarker(text) {
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

/** Visible text that is not inside a thinking block. */
export function textOutsideThinking(text) {
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

/** Recover the visible remainder of a planning-leak turn. */
export function planningLeakRemainder(text, toolNames) {
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
    leaked =
      /"thought"|"_i"|"paths"|"command"/.test(jsonText) ||
      [...toolNames].some((name) => jsonText.includes(`"${name}"`));
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

/** Set every malformed finish to STOP and clear finish messages. */
function rewriteTerminalFields(value) {
  let changed = false;
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.finishReason === "MALFORMED_FUNCTION_CALL") {
      node.finishReason = "STOP";
      changed = true;
    }
    if (Object.hasOwn(node, "finishMessage")) {
      node.finishMessage = "";
      changed = true;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return changed;
}

/** Sanitize one parsed frame. */
function sanitizeFrame(frame) {
  const parsed = frame.json();
  if (parsed === null || typeof parsed !== "object") return serializeSseFrame({ lines: frame.lines });
  return rewriteTerminalFields(parsed)
    ? serializeSseFrame({ event: frame.event, id: frame.id, data: parsed })
    : serializeSseFrame({ lines: frame.lines });
}

/** Turn a malformed finish into a clean STOP block. */
export function sanitizeTerminalBlock(block) {
  return sanitizeFrame(parseSseFrame(block));
}

/** Unwind shim continuations embedded in request history. */
export function splitContents(contents) {
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

/** Split every embedded continuation marker out of one body. */
export function splitBody(bodyString) {
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
export function buildContinuation(bodyString, state, variant) {
  const parsed = JSON.parse(bodyString);
  const request = (parsed.request ??= {});
  const contents = Array.isArray(request.contents) ? request.contents.slice() : [];
  const parts = [];

  if (state.thoughtBuffer.length > 0) {
    const signature = state.thoughtBuffer
      .slice()
      .reverse()
      .find((part) => part.thoughtSignature && /^[A-Za-z0-9+/=]+$/.test(part.thoughtSignature))?.thoughtSignature;
    const joinedThoughts = state.thoughtBuffer.map((part) => part.text).join("");
    if (joinedThoughts !== "" || signature) {
      parts.push({
        ...(joinedThoughts !== "" ? { thought: true, text: joinedThoughts } : { text: "" }),
        ...(signature ? { thoughtSignature: signature } : {}),
      });
    }
    const visible = textOutsideThinking(state.visibleText);
    if (visible.length > 0) parts.push({ text: visible });
  } else {
    const visible = textOutsideThinking(state.visibleText);
    if (visible.length > 0) {
      const fenced = state.visibleText.match(/ thinking([\s\S]*?)(?:<\/think>|$)/i)?.[1]?.trim();
      if (fenced) parts.push({ text: fenced, thought: true });
      parts.push({ text: visible });
    } else if (state.visibleText.trim().length > 0) {
      parts.push({ text: state.visibleText.trim() });
    }
  }

  if (parts.length > 0) contents.push({ role: "model", parts });
  contents.push({ role: "user", parts: [{ text: PROMPTS[variant] }] });
  request.contents = contents;

  const generation = (request.generationConfig ??= {});
  const current = typeof generation.maxOutputTokens === "number" ? generation.maxOutputTokens : 0;
  if (current > 0 && current < MIN_OUTPUT_BUDGET) generation.maxOutputTokens = MIN_OUTPUT_BUDGET;

  return JSON.stringify(parsed);
}

function modelOf(bodyString) {
  try {
    return JSON.parse(bodyString).model;
  } catch {
    return undefined;
  }
}

/** The daily and sandbox hosts are one service with different regions. */
export function alternateHost(target) {
  try {
    const url = new URL(target);
    if (url.hostname === DAILY_HOST) url.hostname = SANDBOX_HOST;
    else if (url.hostname === SANDBOX_HOST) url.hostname = DAILY_HOST;
    else return target;
    return url.toString();
  } catch {
    return target;
  }
}

/* ------------------------------------------------------------------ */
/* Account routing helpers.                                            */
/* ------------------------------------------------------------------ */

/** Read a cooldown from a 429 body. */
export function parseCooldownMs(bodyText, defaultMs) {
  if (!bodyText) return defaultMs;
  const secMatch = bodyText.match(/"(?:quotaResetDelay|retryDelay)"\s*:\s*"([0-9.]+)(?:s)?"/i);
  if (secMatch) {
    const sec = Number.parseFloat(secMatch[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 86_400_000);
  }
  const resetsMatch = bodyText.match(/Resets in\s*(?:([0-9]+)h)?\s*(?:([0-9]+)m)?\s*(?:([0-9]+)s)?/i);
  if (resetsMatch && (resetsMatch[1] || resetsMatch[2] || resetsMatch[3])) {
    const hours = Number.parseInt(resetsMatch[1] || "0", 10);
    const mins = Number.parseInt(resetsMatch[2] || "0", 10);
    const secs = Number.parseInt(resetsMatch[3] || "0", 10);
    const totalMs = (hours * 3600 + mins * 60 + secs) * 1000;
    if (totalMs > 0) return Math.min(totalMs, 86_400_000);
  }
  return defaultMs;
}

/** Sort accounts by the configured email order. */
export function sortByConfiguredOrder(accounts, emailOrder) {
  return [...accounts].sort((a, b) => {
    const idxA = emailOrder.indexOf(a.email.toLowerCase());
    const idxB = emailOrder.indexOf(b.email.toLowerCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.id - b.id;
  });
}

/** Pro-model candidate order: available pros, then available ultras. */
export function selectProCandidates(now, pros, ultras) {
  const availablePros = pros.filter((account) => now >= account.cooldownUntil);
  const availableUltras = ultras.filter((account) => now >= account.cooldownUntil);
  if (availablePros.length > 0) return [...availablePros, ...availableUltras];
  if (availableUltras.length > 0) return [...availableUltras];
  const all = [...pros, ...ultras];
  if (all.length === 0) return [];
  return [all.slice().sort((a, b) => a.cooldownUntil - b.cooldownUntil)[0]];
}

/* ------------------------------------------------------------------ */
/* Install.                                                            */
/* ------------------------------------------------------------------ */

/** Build a Sink that never stops traffic when the file cannot be opened. */
function createSink(path, sinks) {
  const silent = { emit() {}, flush() {}, close() {} };
  if (!path) return silent;
  try {
    const sink = new Sink({ path });
    sinks.push(sink);
    return sink;
  } catch (error) {
    report("antigravity: cannot open the diagnostic sink", { path, error: messageOf(error) });
    return silent;
  }
}

/** Account routing state. Everything is lazy: no database opens until needed. */
function createAccountRouter({ config, extraHosts, sink, log, stateDbPath, agentDbPath }) {
  const ultraEmails = new Set((config.ultraAccounts ?? []).map((email) => String(email).toLowerCase()));
  const proEmails = new Set((config.proAccounts ?? []).map((email) => String(email).toLowerCase()));
  const ultraOrder = [...ultraEmails];
  const proOrder = [...proEmails];
  const cooldownMs = Number.parseInt(String(config.cooldownMs ?? DEFAULT_COOLDOWN_MS), 10) || DEFAULT_COOLDOWN_MS;
  const ultraPattern =
    typeof config.ultraModelPattern === "string" && config.ultraModelPattern !== ""
      ? new RegExp(config.ultraModelPattern, "i")
      : DEFAULT_ULTRA_PATTERN;

  let repository;
  let stateStore;
  let cachedAccounts = [];
  let lastAccountsFetch = 0;

  const repositoryOf = () => {
    repository ??= new CredentialRepository({ agentDbPath });
    return repository;
  };

  const stateStoreOf = () => {
    // One v2 state database is shared by every gateway worker. Its default
    // location matches the documented migration output.
    stateStore ??= new StateStore({ path: stateDbPath });
    return stateStore;
  };

  async function loadAccounts() {
    if (cachedAccounts.length > 0 && Date.now() - lastAccountsFetch <= 30_000) return cachedAccounts;
    let listed;
    try {
      listed = await repositoryOf().listAccounts(PROVIDER);
    } catch (error) {
      log(`antigravity-account-routing: cannot list accounts: ${messageOf(error)}`);
      listed = [];
    }
    const next = [];
    for (const account of Array.isArray(listed) ? listed : []) {
      if (!account || account.disabled === true) continue;
      const email = typeof account.email === "string" ? account.email : "";
      if (email === "") continue;
      const key = email.toLowerCase();
      const isUltra = ultraEmails.has(key);
      const isPro = proEmails.has(key) || (!isUltra && proEmails.size === 0);
      const previous = cachedAccounts.find((candidate) => candidate.id === account.id);
      next.push({
        id: account.id,
        email,
        isUltra,
        isPro,
        cooldownUntil: previous?.cooldownUntil ?? 0,
      });
    }
    cachedAccounts = next;
    lastAccountsFetch = Date.now();
    return cachedAccounts;
  }

  function applySharedCooldowns(accounts) {
    let cooldowns;
    try {
      cooldowns = stateStoreOf().listAccountCooldowns(Date.now());
    } catch (error) {
      log(`antigravity-account-routing: cannot read cooldowns: ${messageOf(error)}`);
      return;
    }
    if (!cooldowns || cooldowns.size === 0) return;
    for (const account of accounts) {
      const entry = cooldowns.get(account.email.toLowerCase());
      const until = typeof entry === "object" && entry !== null ? entry.until : entry;
      if (typeof until === "number" && until > account.cooldownUntil) account.cooldownUntil = until;
    }
  }

  async function secretFor(account) {
    const repository_ = repositoryOf();
    // The row id is the only safe selector. Two rows can share one email.
    const filter = account.id === undefined || account.id === null ? { email: account.email } : { id: account.id };
    let credential;
    try {
      credential = await repository_.resolve(PROVIDER, filter);
    } catch (error) {
      log(`antigravity-account-routing: cannot resolve an account: ${messageOf(error)}`);
      return undefined;
    }
    if (!credential?.secret) return undefined;

    const expiresAt = typeof credential.expiresAt === "number" ? credential.expiresAt : 0;
    if (expiresAt > 0 && expiresAt <= Date.now() + 120_000) {
      try {
        const refreshed = await repository_.refresh(credential.id);
        if (refreshed?.secret) return refreshed.secret;
      } catch (error) {
        log(`antigravity-account-routing: token refresh failed: ${messageOf(error)}`);
      }
    }
    return credential.secret;
  }

  function record(account, model, tier, attempt, candidatesCount, status) {
    emit(sink, "account-route", {
      model,
      account: hashEmail(account.email),
      tier,
      attempt,
      candidatesCount,
      status,
    });
  }

  async function tryCandidates(input, init, next, candidates, model, body) {
    let lastResponse;
    let attempted = false;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const secret = await secretFor(candidate);
      if (!secret) continue;
      attempted = true;

      const headers = requestHeaders(input, init);
      headers.set("Authorization", `Bearer ${secret}`);
      let response;
      if (body.replayed) {
        const { target, init: nextInit } = withRequestBody(input, init, body.text);
        nextInit.headers = headers;
        response = await next(target, nextInit);
      } else {
        response = await next(input, { ...init, headers });
      }

      const tier = candidate.isUltra ? "ultra" : "pro";
      record(candidate, model, tier, index + 1, candidates.length, response.status);
      log(`antigravity-account-routing: model "${model}" attempt ${index + 1}/${candidates.length} -> ${tier}`);

      if (response.status !== 429) return response;

      let cooldownDuration = cooldownMs;
      try {
        cooldownDuration = parseCooldownMs(await response.clone().text(), cooldownMs);
      } catch {}
      candidate.cooldownUntil = Date.now() + cooldownDuration;
      try {
        stateStoreOf().setAccountCooldown(candidate.email.toLowerCase(), candidate.cooldownUntil, "429");
      } catch (error) {
        log(`antigravity-account-routing: cannot store a cooldown: ${messageOf(error)}`);
      }
      emit(sink, "account-cooldown", {
        account: hashEmail(candidate.email),
        tier,
        cooldownMs: cooldownDuration,
      });
      try {
        await response.body?.cancel();
      } catch {}
      lastResponse = response;
    }

    return attempted ? lastResponse : undefined;
  }

  return {
    handler: async (input, init, next) => {
      if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);
      if (activePin(PROVIDER)) return next(input, init);

      const inline = requestBody(input, init);
      let bodyText = inline;
      let replayed = false;
      if (bodyText === undefined) {
        bodyText = await readOutboundBodyText(input, init);
        if (bodyText === undefined) return next(input, init);
        replayed = true;
      }
      // A body read from a stream is gone from the request. Replay it on every
      // path, including the paths that decide not to route.
      const pass = () => {
        if (!replayed) return next(input, init);
        const { target, init: nextInit } = withRequestBody(input, init, bodyText);
        return next(target, nextInit);
      };

      let model;
      try {
        model = JSON.parse(bodyText).model;
      } catch {
        return pass();
      }
      if (typeof model !== "string") return pass();

      const accounts = await loadAccounts();
      if (accounts.length === 0) return pass();
      applySharedCooldowns(accounts);

      const now = Date.now();
      const ultras = sortByConfiguredOrder(
        accounts.filter((account) => account.isUltra),
        ultraOrder,
      );
      const pros = sortByConfiguredOrder(
        accounts.filter((account) => account.isPro),
        proOrder,
      );

      let candidates;
      if (ultraPattern.test(model)) {
        const available = ultras.filter((account) => now >= account.cooldownUntil);
        candidates = available.length > 0 ? available : ultras;
      } else {
        candidates = selectProCandidates(now, pros, ultras);
      }
      if (candidates.length === 0) return pass();

      const response = await tryCandidates(input, init, next, candidates, model, { text: bodyText, replayed });
      return response ?? pass();
    },
    close() {
      try {
        repository?.close();
      } catch {}
      try {
        stateStore?.close();
      } catch {}
      repository = undefined;
      stateStore = undefined;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Continuation layer.                                                 */
/* ------------------------------------------------------------------ */

function waitForRead(reader, idleTimeoutMs) {
  const read = reader.read();
  if (!(idleTimeoutMs > 0)) return read;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Upstream stream idle timeout")), idleTimeoutMs);
    timer.unref?.();
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

function createContinuationLayer({ config, extraHosts, sink }) {
  const maxContinuations = Number.parseInt(String(config.maxContinuations ?? 3), 10) || 0;
  const maxLocationRetries = Number.parseInt(String(config.locationRetries ?? 3), 10) || 0;
  const parsedIdle = Number.parseInt(String(config.idleTimeoutMs ?? 0), 10);
  const idleTimeoutMs = Number.isFinite(parsedIdle) ? parsedIdle : 0;
  const encoder = new TextEncoder();
  const sleeps = new Set();
  let disposed = false;

  /** Wait `ms`, or earlier when the signal aborts or the layer is disposed. */
  function sleep(ms, signal) {
    return new Promise((resolve) => {
      if (disposed || signal?.aborted) {
        resolve();
        return;
      }
      const entry = { resolve, timer: null, signal };
      const wake = () => {
        clearTimeout(entry.timer);
        sleeps.delete(entry);
        signal?.removeEventListener?.("abort", wake);
        resolve();
      };
      entry.wake = wake;
      entry.timer = setTimeout(wake, ms);
      entry.timer.unref?.();
      signal?.addEventListener?.("abort", wake, { once: true });
      sleeps.add(entry);
      if (signal?.aborted) wake();
    });
  }

  /** Stop every pending backoff and wake its waiter. */
  function stop() {
    disposed = true;
    for (const entry of [...sleeps]) {
      try {
        clearTimeout(entry.timer);
      } catch {}
      sleeps.delete(entry);
      entry.signal?.removeEventListener?.("abort", entry.wake);
      entry.resolve();
    }
  }

  function record(event, detail) {
    emit(sink, event, detail);
  }

  async function isRegionRejected(response) {
    if (!response || (response.status !== 400 && response.status !== 403)) return false;
    try {
      const text = await readCappedText(response.clone(), 8192);
      return text.includes("location is not supported") || text.includes("User location");
    } catch {
      return false;
    }
  }

  async function fetchWithRegionRetry(callFetch, target, init) {
    let url = target;
    let response = await callFetch(url, init);
    if (maxLocationRetries <= 0) return { response, target: url };

    for (let attempt = 1; attempt <= maxLocationRetries; attempt++) {
      if (disposed) break;
      if (!(await isRegionRejected(response))) break;
      if (attempt === 2) url = alternateHost(url);

      record("region-retry", { attempt, host: hostOf(url), status: response.status });
      try {
        await response.body?.cancel();
      } catch {}
      await sleep(LOCATION_BACKOFF_MS[attempt - 1] ?? 2000, init?.signal);
      if (disposed || init?.signal?.aborted) break;
      response = await callFetch(url, init);
    }
    return { response, target: url };
  }

  function observePart(part, state) {
    if (part === null || typeof part !== "object") return;
    if (part.functionCall && typeof part.functionCall.name === "string" && part.functionCall.name.trim()) {
      state.toolCalls += 1;
    }
    const isThought =
      part.thought === true ||
      (part.thoughtSignature && !part.functionCall && (part.text === undefined || part.text === ""));
    if (isThought) {
      state.thoughtParts += 1;
      if ((typeof part.text === "string" && part.text !== "") || part.thoughtSignature) {
        const text = typeof part.text === "string" ? part.text : "";
        if (state.thoughtChars < MAX_THOUGHT_TEXT) {
          state.thoughtChars += text.length;
          state.thoughtBuffer.push({
            text,
            ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
          });
        } else if (part.thoughtSignature) {
          state.thoughtBuffer.push({ text: "", thoughtSignature: part.thoughtSignature });
        }
      }
      return;
    }
    if (typeof part.text === "string" && part.text.trim() !== "") {
      state.visibleChars += part.text.trim().length;
      if (state.visibleText.length < MAX_VISIBLE_TEXT) {
        state.visibleText += part.text.slice(0, MAX_VISIBLE_TEXT - state.visibleText.length);
      }
    }
  }

  /**
   * Read one upstream attempt. Forward every non-terminal frame as it arrives
   * and hold the terminal frames for the end-of-turn decision.
   */
  async function pump(body, controller, state, signal) {
    const reader = body.getReader();
    const scanner = createSseScanner({ maxEventBytes: MAX_SSE_EVENT_BYTES });
    const held = [];
    let sawDone = false;

    const enqueueFrame = (frame) => {
      if (signal?.aborted) return;
      try {
        controller.enqueue(encoder.encode(serializeSseFrame({ lines: frame.lines })));
      } catch {}
    };

    const observeFrame = (frame) => {
      const parsed = frame.json();
      if (parsed !== null && typeof parsed === "object") {
        const error = parsed.error ?? parsed.response?.error;
        if (error) {
          state.finishReason = "ERROR";
          record("upstream-sse-error", {
            status: error.code ?? error.status ?? "error",
            marker: hashMarker(JSON.stringify(error)),
          });
        }
        const response = parsed.response ?? parsed;
        // usageMetadata rides on every incremental chunk. It says nothing about
        // the turn ending, so only a candidate finishReason or an error settles
        // the outcome.
        const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
        let finish;
        for (const candidate of candidates) {
          if (candidate?.finishReason !== undefined && candidate?.finishReason !== null) {
            state.finishReason = candidate.finishReason;
            finish = true;
          }
          for (const part of candidate?.content?.parts ?? []) observePart(part, state);
        }
        if (frame.isDone) sawDone = true;
        if (finish || frame.isDone) {
          if (held.length < MAX_TERMINAL_FRAMES) held.push(frame);
        } else {
          enqueueFrame(frame);
        }
        return finish || frame.isDone;
      }

      if (frame.isDone) sawDone = true;
      if (frame.isDone) held.push(frame);
      else enqueueFrame(frame);
      return frame.isDone;
    };

    try {
      for (;;) {
        if (signal?.aborted) return "aborted";
        const { done, value } = await waitForRead(reader, idleTimeoutMs);
        if (done) break;
        if (value === undefined) continue;
        for (const block of scanner.push(value)) observeFrame(parseSseFrame(block));
        // Read the upstream stream to its natural end: Google sends trailing
        // usage and signature frames after the terminal candidate frame, so an
        // early cancel on finishReason would truncate the answer. Only an
        // explicit [DONE] ends the read early; an aborted signal is checked at
        // the top of the loop.
        if (sawDone) {
          try {
            await reader.cancel();
          } catch {}
          break;
        }
      }

      for (const block of scanner.flush()) observeFrame(parseSseFrame(block));
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }

    const upstreamFinished = state.finishReason !== undefined;
    if (!upstreamFinished) {
      state.finishReason = "STOP";
      held.push(parseSseFrame(serializeSseFrame({ data: { response: { candidates: [{ finishReason: "STOP" }] } } })));
    }

    state.terminalFrames = held;
    if (!upstreamFinished) return "no-terminal";
    return held.length > 0 ? "terminal" : "terminal-missing";
  }

  const handler = async (input, init, next) => {
    if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);

    let bodyString = requestBody(input, init);
    if (bodyString === undefined) {
      bodyString = await readOutboundBodyText(input, init);
      if (bodyString === undefined) return next(input, init);
    }

    const callFetch = (target, targetInit) => next(target, targetInit);
    // A rebuilt body is plain text. Old length and encoding headers must not
    // survive onto it.
    const built = withRequestBody(input, init, bodyString);
    const baseInit = { ...built.init, method: built.init.method ?? "POST" };

    let firstBody = bodyString;
    const split = splitBody(bodyString);
    if (split.splits > 0) {
      firstBody = split.bodyString;
      baseInit.body = firstBody;
      record("history-split", { splits: split.splits });
    }

    if (maxContinuations <= 0) {
      const first = await fetchWithRegionRetry(callFetch, built.target, baseInit).catch((error) => {
        record("fetch-rejected", { error: String(error?.stack ?? error) });
        throw error;
      });
      if (!first.response.body || !first.response.ok) return first.response;
      return rebuildSanitizedResponse(first.response);
    }

    return fetchWithRegionRetry(callFetch, built.target, baseInit)
      .catch((error) => {
        record("fetch-rejected", { error: String(error?.stack ?? error) });
        throw error;
      })
      .then(async (first) => {
        const response = first.response;
        if (!response.body || !response.ok) return response;

        const startedAt = performance.now();
        const signal = baseInit.signal;
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
                  thoughtChars: 0,
                  visibleChars: 0,
                  toolCalls: 0,
                  visibleText: "",
                  thoughtBuffer: [],
                  finishReason: undefined,
                  terminalFrames: [],
                  aborted: signal?.aborted ?? false,
                };

                const outcome = await pump(current.body, controller, state, signal);
                if (signal?.aborted) {
                  attempts.push({ attempt, outcome: "aborted" });
                  break;
                }

                const outside = textOutsideThinking(state.visibleText);
                const { visible: meaningful } = planningLeakRemainder(outside, toolNames);
                const malformed = state.finishReason === "MALFORMED_FUNCTION_CALL";
                const variant = malformed ? "malformed" : "empty";
                const producedOutput = state.toolCalls > 0 || meaningful.trim() !== "";
                const truncated =
                  state.finishReason === "MAX_TOKENS" &&
                  state.toolCalls === 0 &&
                  (meaningful.trim().length < 10 ||
                    meaningful.trim() === "{" ||
                    meaningful.trim().startsWith("```thinking"));
                const needsContinuation =
                  attempt < maxContinuations &&
                  (malformed || (!producedOutput && (truncated || state.thoughtParts > 0 || state.visibleChars > 0)));

                record("turn-eval", {
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
                  ...(malformed ? { malformedRecovered: true } : {}),
                  continued: needsContinuation,
                });

                const finish = () => {
                  for (const frame of state.terminalFrames) {
                    if (signal?.aborted) return;
                    try {
                      controller.enqueue(encoder.encode(sanitizeFrame(frame)));
                    } catch {}
                  }
                };

                if (!needsContinuation) {
                  finish();
                  break;
                }

                const thoughtText = state.thoughtBuffer.map((part) => part.text).join("");
                if ((thoughtText !== "" || state.visibleText !== "") && !signal?.aborted) {
                  const marker = continuationDigest(thoughtText || state.visibleText, variant);
                  const asThought =
                    thoughtText !== "" ||
                    state.visibleText.includes("<think") ||
                    state.visibleText.includes("```thinking");
                  const markerBlock = serializeSseFrame({
                    data: {
                      response: {
                        candidates: [
                          {
                            content: {
                              role: "model",
                              parts: [asThought ? { text: marker, thought: true } : { text: marker }],
                            },
                          },
                        ],
                      },
                    },
                  });
                  try {
                    controller.enqueue(encoder.encode(markerBlock));
                  } catch {}
                }

                body = buildContinuation(body, state, variant);
                attempt++;
                const rebuilt = withRequestBody(first.target, baseInit, body);
                const nextAttempt = await fetchWithRegionRetry(callFetch, rebuilt.target, rebuilt.init);
                current = nextAttempt.response;
                if (!current.ok) {
                  const detail = await readCappedText(current, 8192);
                  attempts[attempts.length - 1].error = `continuation HTTP ${current.status}`;
                  record("continuation-error", {
                    status: current.status,
                    errorHash: hashMarker(detail),
                  });
                  if (attempt < maxContinuations) continue;
                  finish();
                  break;
                }
              }
            } catch (error) {
              const detail = error instanceof Error ? String(error.stack ?? error) : String(error);
              record("continuation-failed", { error: detail || "(empty error thrown)" });
              try {
                controller.error(error instanceof Error ? error : new Error(detail || "continuation stream failed"));
              } catch {}
            } finally {
              if (attempts.length > 0) {
                record("continuation-summary", {
                  ms: Math.round(performance.now() - startedAt),
                  attempts,
                });
              }
              try {
                controller.close();
              } catch {}
            }
          },
        });

        return rebuildResponse(response, stream);
      });
  };

  /** Stream a response through and rewrite malformed terminal frames. */
  function rebuildSanitizedResponse(response) {
    const scanner = createSseScanner({ maxEventBytes: MAX_SSE_EVENT_BYTES });
    const transform = new TransformStream({
      transform(chunk, controller) {
        for (const block of scanner.push(chunk)) {
          controller.enqueue(encoder.encode(sanitizeFrame(parseSseFrame(block))));
        }
      },
      flush(controller) {
        for (const block of scanner.flush()) {
          controller.enqueue(encoder.encode(sanitizeFrame(parseSseFrame(block))));
        }
      },
    });
    return rebuildResponse(response, response.body.pipeThrough(transform));
  }

  return { handler, dispose: stop };
}

/* ------------------------------------------------------------------ */
/* Capture layer.                                                      */
/* ------------------------------------------------------------------ */

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

function requestShape(bodyText) {
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
    const parsed = JSON.parse(bodyText);
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

function createCaptureLayer({ config, extraHosts, sink }) {
  const sampleEvery = Number.parseInt(String(config.sampleEvery ?? 0), 10) || 0;
  let streamCount = 0;

  function createInspector(url, bodyText, startedAt) {
    const stats = {
      bytes: 0,
      events: 0,
      finishReason: undefined,
      thoughtParts: 0,
      visibleChars: 0,
      toolCalls: 0,
    };
    const scanner = createSseScanner({ maxEventBytes: MAX_SSE_EVENT_BYTES });
    const seenMarkers = new Set();

    const scanFrame = (frame) => {
      for (const marker of ["MALFORMED_FUNCTION_CALL", "malformed function call", "malformed-function-call"]) {
        if (frame.raw.includes(marker)) seenMarkers.add(hashMarker(marker));
      }

      const parsed = frame.json();
      if (parsed === null || typeof parsed !== "object") return;
      const response = parsed.response ?? parsed;
      if (response.usageMetadata && !stats.finishReason) stats.finishReason = "STOP";
      for (const candidate of response.candidates ?? []) {
        if (candidate.finishReason) stats.finishReason = candidate.finishReason;
        for (const part of candidate.content?.parts ?? []) {
          if (part.functionCall && typeof part.functionCall.name === "string" && part.functionCall.name.trim()) {
            stats.toolCalls += 1;
          }
          if (
            part.thought === true ||
            (part.thoughtSignature && !part.functionCall && (part.text === undefined || part.text === ""))
          ) {
            stats.thoughtParts += 1;
          }
          if (typeof part.text === "string" && part.thought !== true && part.text.trim()) {
            stats.visibleChars += part.text.trim().length;
          }
        }
      }
    };

    return {
      push(chunk) {
        if (typeof chunk === "string") stats.bytes += chunk.length;
        else stats.bytes += chunk.byteLength ?? 0;
        for (const block of scanner.push(chunk)) {
          const frame = parseSseFrame(block);
          if (!frame.commentOnly) {
            stats.events += 1;
            scanFrame(frame);
          }
        }
      },
      flush() {
        for (const block of scanner.flush()) {
          const frame = parseSseFrame(block);
          if (!frame.commentOnly) {
            stats.events += 1;
            scanFrame(frame);
          }
        }
        streamCount += 1;
        const base = {
          url: redactUrl(url),
          ms: Math.round(performance.now() - startedAt),
          ...requestShape(bodyText),
          ...stats,
        };
        const found = [...seenMarkers];
        if (found.length > 0) {
          emit(sink, "malformed-function-call", { ...base, markers: found });
          return;
        }
        if (stats.finishReason !== undefined && stats.visibleChars === 0 && stats.toolCalls === 0 && stats.events > 0) {
          emit(sink, "empty-output", { ...base, thoughtOnly: stats.thoughtParts > 0 });
          return;
        }
        if (stats.events > 0 && stats.finishReason === undefined) {
          emit(sink, "incomplete-stream", base);
          return;
        }
        if (sampleEvery > 0 && streamCount % sampleEvery === 0) emit(sink, "stream", base);
      },
    };
  }

  return async (input, init, next) => {
    if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);
    const bodyText = requestBody(input, init);
    if (bodyText === undefined) return next(input, init);

    const response = await next(input, init);
    const startedAt = performance.now();

    if (!response.body) {
      response
        .clone()
        .text()
        .then((text) => {
          const inspector = createInspector(requestUrl(input), bodyText, startedAt);
          inspector.push(text);
          inspector.flush();
        })
        .catch(() => {});
      return response;
    }

    const inspector = createInspector(requestUrl(input), bodyText, startedAt);
    const tap = new TransformStream({
      transform(chunk, controller) {
        inspector.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        inspector.flush();
      },
    });
    return rebuildResponse(response, response.body.pipeThrough(tap));
  };
}

/* ------------------------------------------------------------------ */
/* Install.                                                            */
/* ------------------------------------------------------------------ */

/**
 * Install the Antigravity layers.
 * @param {Record<string, any>} config the feature settings
 * @param {{ addFetchHandler?: Function, extraHosts?: string[], log?: Function }} context
 * @returns {() => void} a disposer that removes every layer and closes every timer
 */
export async function install(config = {}, context = {}) {
  if (config?.enabled === false) return () => {};
  const add = context.addFetchHandler ?? addFetchHandler;
  // The daily hosts serve the same RPC as the canonical host. They are exact
  // names, never a suffix or substring rule.
  const extraHosts = [...(Array.isArray(context.extraHosts) ? context.extraHosts : []), DAILY_HOST, SANDBOX_HOST];
  const stateDbPath = context.paths?.stateDbPath ?? join(homedir(), ".omp", "omp-shims-state.sqlite");
  const logsDir = context.paths?.logsDir ?? join(homedir(), ".omp", "logs");
  const agentDbPath = context.paths?.agentDbPath;
  const log = context.log ?? (() => {});
  const disposers = [];
  const sinks = [];
  const closers = [];

  const closeAll = () => {
    for (const close of closers.reverse()) {
      try {
        close();
      } catch {}
    }
    for (const sink of sinks.reverse()) {
      try {
        sink.flush();
      } catch {}
      try {
        sink.close();
      } catch {}
    }
  };

  const addLayer = (handler, name, priority) => {
    try {
      const dispose = add(handler, { name, priority });
      if (typeof dispose === "function") disposers.push(dispose);
    } catch (error) {
      report(`antigravity: cannot install ${name}`, { error: messageOf(error) });
    }
  };

  if (config.capture) {
    const sink = createSink(config.captureOut ?? join(logsDir, "antigravity-streams.jsonl"), sinks);
    addLayer(
      createCaptureLayer({ config, extraHosts, sink }),
      "antigravity-capture",
      outboundPriority.antigravityCapture,
    );
  }

  if (config.continuation) {
    const sink = createSink(config.continuationOut ?? join(logsDir, "antigravity-continuation.jsonl"), sinks);
    const layer = createContinuationLayer({ config, extraHosts, sink });
    closers.push(layer.dispose);
    addLayer(layer.handler, "antigravity-continuation", outboundPriority.antigravityContinuation);
  }

  if (config.systemInstruction) {
    const force = config.forceSystemInstruction === true;
    addLayer(
      (input, init, next) => {
        if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);
        return rewriteCloudBody(next, input, init, (body) => rewriteSystemInstruction(body, force));
      },
      "antigravity-system-instruction",
      outboundPriority.antigravitySystemInstruction,
    );
  }

  if (config.routing) {
    const effort = config.effort || "high";
    const defaultLevel = EFFORT_LEVELS[String(effort).toLowerCase()] ?? "HIGH";
    const tieredPattern = compilePattern(config.tieredPattern, DEFAULT_TIERED_PATTERN);
    addLayer(
      (input, init, next) => {
        if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);
        return rewriteCloudBody(next, input, init, (body) => rewriteRouting(body, defaultLevel, tieredPattern));
      },
      "antigravity-routing",
      outboundPriority.antigravityRouting,
    );
  }

  if (config.accountRouting) {
    const sink = createSink(config.accountsOut ?? join(logsDir, "antigravity-accounts.jsonl"), sinks);
    const router = createAccountRouter({ config, extraHosts, sink, log, stateDbPath, agentDbPath });
    closers.push(() => router.close());
    addLayer(router.handler, "antigravity-account-routing", outboundPriority.antigravityAccountRouting);
  }

  // The sanitizer is not optional. It is the lowest Antigravity layer, so it
  // sees every body, including bodies rebuilt by a retry or a continuation.
  addLayer(
    async (input, init, next) => {
      if (!isCloudCodeRequest(input, init, extraHosts)) return next(input, init);
      return rewriteCloudBody(next, input, init, sanitizeCloudCodeBody);
    },
    "antigravity-enum-sanitizer",
    outboundPriority.antigravitySanitizer,
  );

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {}
    }
    closeAll();
  };
}
