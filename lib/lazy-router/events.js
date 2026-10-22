// Structured router events: one JSON line per event in the router log, plus a
// concise stderr line (journald) for the events an operator watches.

import { appendJsonLine } from "../fetch-chain.js";

/** Events that also go to stderr; per-request chatter stays in the file. */
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

/**
 * @param {{out: string, report: (message: string, detail?: object) => void, now?: () => Date}} options
 * @returns {(event: string, detail?: object) => void}
 */
export function createEventLog({ out, report, now = () => new Date() }) {
  return function emit(event, detail = {}) {
    appendJsonLine(out, { ts: now().toISOString(), event, ...detail });
    if (CONSOLE_EVENTS.has(event)) report(`lazy-router ${event}`, detail);
  };
}

/** Upstream body fields worth logging: the effort and output-limit knobs of each provider API. */
const UPSTREAM_FIELDS = new Set([
  "model",
  "reasoning_effort",
  "reasoning",
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
  "maxOutputTokens",
  "thinkingConfig",
  "thinking",
  "output_config",
  "enable_thinking",
  "think",
  "num_predict",
]);

/** How deep to look for those fields (provider envelopes nest them, e.g. request.generationConfig). */
const UPSTREAM_FIELD_DEPTH = 3;

/** Pick the effort/limit fields out of an upstream JSON body, wherever they sit. */
export function summarizeUpstreamBody(text) {
  if (typeof text !== "string") return undefined;
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  const picked = {};
  const visit = (value, path, depth) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > UPSTREAM_FIELD_DEPTH) return;
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key;
      if (UPSTREAM_FIELDS.has(key)) picked[at] = child;
      else visit(child, at, depth + 1);
    }
  };
  visit(body, "", 0);
  return picked;
}
