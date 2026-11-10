// Structured router events: one JSON line per event in the router log, plus a
// concise stderr line for the events an operator watches.
//
// The log rotates once it passes its size cap and keeps one generation. A log
// write never fails a request.

import { appendFileSync, renameSync, statSync } from "node:fs";

/** Events that also go to stderr. Per-request chatter stays in the file. */
const CONSOLE_EVENTS = new Set([
  "route",
  "served",
  "attempt-failed",
  "probe",
  "retry-same-unit",
  "retry-fresh-connection",
  "client-gone",
  "cooldown-enter",
  "cooldown-exit",
  "background-probe",
  "exhausted",
  "pin-unverified",
  "upstream-request",
]);

/** Rotate once the log passes this size. One generation is kept. */
const ROTATE_BYTES = 64 * 1024 * 1024;
const ROTATE_CHECK_EVERY = 512;

/**
 * Build the router's event writer.
 * @param {{out: string|null, report: (message: string, detail?: object) => void,
 *   now?: () => Date}} options
 * @returns {((event: string, detail?: object) => void) & {close?: () => void}}
 */
export function createEventLog({ out, report, now = () => new Date() }) {
  let sinceCheck = ROTATE_CHECK_EVERY;
  const rotateIfNeeded = () => {
    if (ROTATE_BYTES <= 0 || !out) return;
    sinceCheck += 1;
    if (sinceCheck < ROTATE_CHECK_EVERY) return;
    sinceCheck = 0;
    try {
      if (statSync(out).size < ROTATE_BYTES) return;
      renameSync(out, `${out}.1`);
    } catch {
      // A missing or busy file must not stop event logging.
    }
  };

  return function emit(event, detail = {}) {
    try {
      const line = `${JSON.stringify({ ts: now().toISOString(), event, ...detail })}\n`;
      if (out) appendFileSync(out, line);
      else process.stderr.write(line);
    } catch {
      // The event log is diagnostic; it never fails a request.
    }
    if (CONSOLE_EVENTS.has(event)) report(`lazy-router ${event}`, detail);
    rotateIfNeeded();
  };
}

/** Structural names worth logging. Everything else is message content. */
const STRUCTURAL_KEY =
  /^(?:model|reasoning_effort|max_tokens|max_completion_tokens|max_output_tokens|maxOutputTokens|enable_thinking|think|num_predict|type|effort|budget|budget_tokens|budgetTokens|thinkingBudget|thinking_budget|include_thoughts|includeThoughts)$/;

/** Content keys whose value is never logged, only counted or measured. */
const CONTENT_KEYS = new Set(["messages", "input", "contents", "system", "prompt", "parts", "text"]);

/** How deep to look for structural fields. */
const STRUCTURAL_DEPTH = 2;

/**
 * Pick only structural fields out of an upstream JSON body.
 *
 * The result carries the model, effort and output-limit knobs, the tool count,
 * and the byte size. It never carries message text, tool arguments, or any
 * other prompt content.
 */
export function summarizeUpstreamBody(text) {
  if (typeof text !== "string") return undefined;
  const bodyBytes = Buffer.byteLength(text);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { bodyBytes, nonJson: true };
  }

  const picked = {};
  let toolCount = 0;
  const visit = (value, path, depth) => {
    if (!value || typeof value !== "object" || depth > STRUCTURAL_DEPTH) return;
    if (Array.isArray(value)) {
      if (path === "tools" || path.endsWith(".tools")) toolCount += value.length;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (key === "tools" && Array.isArray(child)) {
        toolCount += child.length;
        continue;
      }
      if (CONTENT_KEYS.has(key)) continue;
      if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
        if (STRUCTURAL_KEY.test(key)) picked[at] = child;
        continue;
      }
      if (child && typeof child === "object") visit(child, at, depth + 1);
    }
  };
  visit(body, "", 0);
  return { ...picked, toolCount, bodyBytes };
}
