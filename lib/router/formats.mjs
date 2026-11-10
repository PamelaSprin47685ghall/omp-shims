// Per-API request rewriting.
//
// The gateway speaks three inbound dialects. Each adapter knows where its
// dialect keeps the model, the reasoning effort, and the output-token limit, how
// it spells an error, and how its conversation reads as a canonical transcript.
// The router itself never touches a field name.
//
// This module also owns the Antigravity schema sanitizer. Some Antigravity
// tool schemas carry an empty `enum` array, an empty string entry, or a
// property name the provider rejects. The sanitizer touches only tool schemas
// in `request.tools` and top-level `tools`, so conversation history and every
// other field survive byte-identical.

import { verboseLog } from "../contracts.mjs";
import { chatTranscript, messagesTranscript, responsesTranscript } from "./canonical.mjs";

/** Content-part types that carry an image across the three dialects. */
const IMAGE_PART_TYPES = new Set(["image_url", "input_image", "image"]);

/** Effort levels Anthropic output_config accepts. */
const ANTHROPIC_OUTPUT_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** How a streamed event bears on an attempt that is still being judged. */
export const STREAM_EVENT = Object.freeze({
  ERROR: "error",
  PROGRESS: "progress",
  PREAMBLE: "preamble",
});

/** Responses event types that only the provider's answer can produce. */
const RESPONSES_PROGRESS = /^response\.(output|reasoning|content_part|function_call|completed|incomplete)/;

/** Anthropic event types that only the provider's answer can produce. */
const MESSAGES_PROGRESS = new Set(["content_block_start", "content_block_delta", "message_delta", "message_stop"]);

/** True when any message part anywhere in `value` is an image. */
export function containsImage(value) {
  const stack = [{ node: value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== "object") continue;
    visited += 1;
    if (visited > 200_000) return false;
    if (Array.isArray(node)) {
      if (depth >= 64) continue;
      for (const entry of node) stack.push({ node: entry, depth: depth + 1 });
      continue;
    }
    if (IMAGE_PART_TYPES.has(node.type)) return true;
    if (depth >= 64) continue;
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") stack.push({ node: child, depth: depth + 1 });
    }
  }
  return false;
}

/** OpenAI Chat Completions: `reasoning_effort`, `max_completion_tokens`. */
const chat = {
  name: "openai-chat",
  conversation: (body) => body.messages,
  transcript: chatTranscript,
  readEffort: (body) => body.reasoning_effort,
  writeEffort(body, level) {
    if (level === undefined) delete body.reasoning_effort;
    else body.reasoning_effort = level;
  },
  writeMaxTokens(body, limit) {
    delete body.max_tokens;
    body.max_completion_tokens = limit;
  },
  requestUsage(body) {
    if (body.stream !== true) return;
    body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  },
  isOutputEvent({ data }) {
    return (data?.choices ?? []).some((choice) =>
      Boolean(
        choice.delta?.content ||
          choice.delta?.reasoning_content ||
          choice.delta?.reasoning ||
          choice.delta?.tool_calls?.length,
      ),
    );
  },
  errorBody: (message, type) => ({ error: { message, type } }),
  classifyEvent({ data }) {
    if (data?.error) return STREAM_EVENT.ERROR;
    const answered = (data?.choices ?? []).some(
      (choice) =>
        choice.finish_reason ||
        choice.delta?.content ||
        choice.delta?.reasoning_content ||
        choice.delta?.reasoning ||
        choice.delta?.tool_calls?.length,
    );
    return answered || data?.usage ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/** OpenAI Responses: `reasoning.effort`, `max_output_tokens`. */
const responses = {
  name: "openai-responses",
  conversation: (body) => body.input,
  transcript: responsesTranscript,
  readEffort: (body) => body.reasoning?.effort,
  writeEffort(body, level) {
    if (body.reasoning) {
      const reasoning = { ...body.reasoning };
      delete reasoning.effort;
      body.reasoning = reasoning;
    }
    if (level !== undefined) body.reasoning = { ...(body.reasoning ?? {}), effort: level };
  },
  writeMaxTokens(body, limit) {
    body.max_output_tokens = limit;
  },
  errorBody: (message, type) => ({ error: { message, type } }),
  isOutputEvent({ name, data }) {
    const type = data?.type ?? name ?? "";
    return /^response\.(output_text|reasoning_summary_text|reasoning_text|function_call_arguments)\.delta$/.test(type);
  },
  classifyEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "error" || type === "response.failed" || data?.error) return STREAM_EVENT.ERROR;
    return RESPONSES_PROGRESS.test(type ?? "") ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/**
 * Anthropic Messages: `output_config.effort` or `thinking`.
 * "none" disables thinking; "minimal" has no spelling, so it rides as "low".
 */
const messages = {
  name: "anthropic-messages",
  conversation: (body) => body.messages,
  transcript: messagesTranscript,
  readEffort(body) {
    if (body.output_config?.effort) return body.output_config.effort;
    if (body.thinking?.type === "disabled") return "none";
    if (body.thinking?.type === "enabled") return "high";
    return undefined;
  },
  writeEffort(body, level) {
    const outputConfig = { ...(body.output_config ?? {}) };
    delete outputConfig.effort;
    delete body.thinking;
    if (level === "none") {
      body.thinking = { type: "disabled" };
    } else if (level !== undefined) {
      outputConfig.effort = ANTHROPIC_OUTPUT_EFFORTS.has(level) ? level : "low";
    }
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;
    else delete body.output_config;
  },
  writeMaxTokens(body, limit) {
    body.max_tokens = limit;
  },
  errorBody: (message, type) => ({ type: "error", error: { type, message } }),
  isOutputEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "content_block_delta") return true;
    if (type !== "content_block_start") return false;
    const block = data?.content_block;
    return block?.type === "tool_use" || Boolean(block?.text);
  },
  classifyEvent({ name, data }) {
    const type = data?.type ?? name;
    if (type === "error") return STREAM_EVENT.ERROR;
    return MESSAGES_PROGRESS.has(type) ? STREAM_EVENT.PROGRESS : STREAM_EVENT.PREAMBLE;
  },
};

/** Inbound path to dialect adapter. */
export const FORMATS = Object.freeze({
  "/v1/chat/completions": chat,
  "/v1/responses": responses,
  "/v1/messages": messages,
});

/** The adapter for a request path, or undefined for a path the router does not serve. */
export function formatForPath(pathname) {
  return FORMATS[pathname];
}

/** The provider part of a provider-qualified model id. */
export function providerOf(model) {
  const slash = typeof model === "string" ? model.indexOf("/") : -1;
  return slash > 0 ? model.slice(0, slash) : undefined;
}

/**
 * A copy of the client body aimed at one candidate.
 * @param {object} format adapter
 * @param {object} body parsed client body, left untouched at the top level
 * @param {{model: string, effort: string|undefined, maxTokens: number}} target
 */
export function rewriteBody(format, body, { model, effort, maxTokens }) {
  const next = { ...body };
  next.model = model;
  format.writeEffort(next, effort);
  format.writeMaxTokens(next, maxTokens);
  format.requestUsage?.(next);
  if (providerOf(model) === "google-antigravity") sanitizeAntigravityBody(next);
  return next;
}

/**
 * The liveness probe: a minimal, non-streaming chat completion.
 * @param {{model: string, effort: string|undefined, maxTokens: number, prompt: string}} spec
 */
export function probeBody({ model, effort, maxTokens, prompt }) {
  const body = { model, stream: false, messages: [{ role: "user", content: prompt }] };
  chat.writeEffort(body, effort);
  chat.writeMaxTokens(body, maxTokens);
  if (providerOf(model) === "google-antigravity") sanitizeAntigravityBody(body);
  return body;
}

/* ------------------------------------------------------------------ */
/* Antigravity schema sanitizer.                                       */
/* ------------------------------------------------------------------ */

/** Tool keys that hold a function declaration list. */
const FUNCTION_DECLARATION_KEYS = ["functionDeclarations", "function_declarations"];

/** Declaration keys whose value is one parameter schema. */
const DECLARATION_SCHEMA_KEYS = ["parameters", "parametersJsonSchema", "parameters_json_schema"];
/** Tool keys whose value is one schema outside a function declaration. */
const TOOL_SCHEMA_KEYS = [
  "input_schema",
  "inputSchema",
  "response_schema",
  "responseSchema",
  "parameters",
  "parametersJsonSchema",
  "parameters_json_schema",
];
/** Tool keys that wrap one more object of schema keys. */
const TOOL_SCHEMA_WRAPPERS = ["custom"];

/** Keys whose value is one child schema. */
const SCHEMA_SINGLE_KEYS = new Set(["items", "additionalProperties", "additional_properties", "not", "contains"]);
/** Keys whose value is a list of child schemas. */
const SCHEMA_LIST_KEYS = new Set(["anyOf", "oneOf", "allOf", "any_of", "one_of", "all_of", "prefixItems"]);
/** Keys whose value maps a name to one child schema. */
const SCHEMA_MAP_KEYS = new Set(["properties", "$defs", "definitions"]);

/** Property names the Antigravity provider accepts. */
const PROPERTY_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Deepest schema nesting the sanitizer follows. */
const MAX_SCHEMA_DEPTH = 64;
/** Largest number of schema nodes one body may hold. */
const MAX_SCHEMA_NODES = 200_000;

/** True for a value that can carry child nodes. */
function isObject(value) {
  return Boolean(value) && typeof value === "object";
}

/** Keep only non-empty string entries in one schema enum; return the drop count. */
function sanitizeEnum(schema) {
  let dropped = 0;
  for (const key of ["enum", "enum_"]) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    const kept = value.filter((entry) => typeof entry === "string" && entry !== "");
    if (kept.length === value.length) continue;
    dropped += value.length - kept.length;
    if (kept.length === 0) delete schema[key];
    else schema[key] = kept;
  }
  return dropped;
}

/** Delete properties whose names the provider rejects; return the dropped names. */
function sanitizePropertyKeys(node) {
  const properties = node.properties;
  if (!isObject(properties) || Array.isArray(properties)) return [];
  const dropped = [];
  for (const key of Object.keys(properties)) {
    if (PROPERTY_KEY.test(key)) continue;
    delete properties[key];
    dropped.push(key);
  }
  if (dropped.length === 0) return dropped;
  if (Array.isArray(node.required)) {
    const gone = new Set(dropped);
    node.required = node.required.filter((name) => typeof name !== "string" || !gone.has(name));
  }
  return dropped;
}

/**
 * Remove invalid property names and empty or non-string `enum` entries from
 * one schema tree. Every drop is appended to `keyDrops` as
 * `{tool, path, droppedKeys}`.
 * Return the number of entries removed. The walk is iterative and depth
 * capped, so a hostile schema cannot overflow the stack; at the cap the walk
 * stops without deleting anything.
 */
function sanitizeSchemaTree(root, { tool = "", path = "schema", keyDrops = [] } = {}) {
  let dropped = 0;
  let visited = 0;
  const stack = [{ node: root, path, depth: 0 }];
  while (stack.length > 0 && visited < MAX_SCHEMA_NODES) {
    const { node, path: nodePath, depth } = stack.pop();
    if (!isObject(node) || Array.isArray(node)) continue;
    visited += 1;
    const droppedKeys = sanitizePropertyKeys(node);
    if (droppedKeys.length > 0) keyDrops.push({ tool, path: nodePath, droppedKeys });
    dropped += sanitizeEnum(node);
    if (depth >= MAX_SCHEMA_DEPTH) continue;

    for (const [key, value] of Object.entries(node)) {
      if (!isObject(value)) continue;
      if (SCHEMA_MAP_KEYS.has(key) && !Array.isArray(value)) {
        for (const [name, child] of Object.entries(value)) {
          if (isObject(child)) stack.push({ node: child, path: `${nodePath}.${key}.${name}`, depth: depth + 1 });
        }
      } else if (SCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          const child = value[index];
          if (isObject(child)) stack.push({ node: child, path: `${nodePath}.${key}[${index}]`, depth: depth + 1 });
        }
      } else if (SCHEMA_SINGLE_KEYS.has(key)) {
        if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index++) {
            const child = value[index];
            if (isObject(child)) stack.push({ node: child, path: `${nodePath}.${key}[${index}]`, depth: depth + 1 });
          }
        } else {
          stack.push({ node: value, path: `${nodePath}.${key}`, depth: depth + 1 });
        }
      }
    }
  }
  return dropped;
}

/** Sanitize every direct and wrapper-nested schema of one tool entry. */
function sanitizeToolSchemas(tool, { tool: toolName, containerPath, toolIndex, keyDrops }) {
  let changed = false;
  const walk = (schema, path) => {
    const before = keyDrops.length;
    if (sanitizeSchemaTree(schema, { tool: toolName, path, keyDrops }) > 0 || keyDrops.length > before) {
      changed = true;
    }
  };
  for (const key of TOOL_SCHEMA_KEYS) {
    const schema = tool[key];
    if (!isObject(schema) || Array.isArray(schema)) continue;
    walk(schema, `${containerPath}[${toolIndex}].${key}`);
  }
  for (const wrapperKey of TOOL_SCHEMA_WRAPPERS) {
    const wrapper = tool[wrapperKey];
    if (!isObject(wrapper) || Array.isArray(wrapper)) continue;
    for (const key of TOOL_SCHEMA_KEYS) {
      const schema = wrapper[key];
      if (!isObject(schema) || Array.isArray(schema)) continue;
      walk(schema, `${containerPath}[${toolIndex}].${wrapperKey}.${key}`);
    }
  }
  return changed;
}

/**
 * Filter every tool schema enum in one Antigravity body.
 * Return true when at least one enum changed.
 *
 * Only `request.tools` and top-level `tools` are visited. Each tool's function
 * declaration schemas and its own `custom`/direct schema keys are cleaned.
 * Conversation history, the tools array itself and every other field stay
 * untouched, so a clean body can be sent byte-identical.
 */
export function sanitizeAntigravityBody(body) {
  if (!isObject(body)) return false;
  let changed = false;
  const keyDrops = [];
  for (const [containerPath, tools] of [
    ["request.tools", body.request?.tools],
    ["tools", body.tools],
  ]) {
    if (!Array.isArray(tools)) continue;
    for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
      const tool = tools[toolIndex];
      if (!isObject(tool) || Array.isArray(tool)) continue;
      const toolName =
        typeof tool.custom?.name === "string" ? tool.custom.name : typeof tool.name === "string" ? tool.name : "";
      if (sanitizeToolSchemas(tool, { tool: toolName, containerPath, toolIndex, keyDrops })) changed = true;
      for (const key of FUNCTION_DECLARATION_KEYS) {
        const declarations = tool[key];
        if (!Array.isArray(declarations)) continue;
        for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex++) {
          const declaration = declarations[declarationIndex];
          if (!isObject(declaration) || Array.isArray(declaration)) continue;
          const declarationName =
            typeof declaration.name === "string" && declaration.name !== "" ? declaration.name : toolName;
          for (const schemaKey of DECLARATION_SCHEMA_KEYS) {
            const schema = declaration[schemaKey];
            if (!isObject(schema) || Array.isArray(schema)) continue;
            const before = keyDrops.length;
            if (
              sanitizeSchemaTree(schema, {
                tool: declarationName,
                path: `${containerPath}[${toolIndex}].${key}[${declarationIndex}].${schemaKey}`,
                keyDrops,
              }) > 0 ||
              keyDrops.length > before
            ) {
              changed = true;
            }
          }
        }
      }
    }
  }
  if (keyDrops.length > 0) verboseLog("antigravity: dropped invalid tool property keys", { drops: keyDrops });
  return changed;
}
