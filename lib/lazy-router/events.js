// Structured router events: one JSON line per event in the router log, plus a
// concise stderr line (journald) for the events an operator watches.

import { appendJsonLine } from "../fetch-chain.js";
import { renameSync, statSync } from "node:fs";
import { span } from "../profile.js";

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
/** Rotate the router log once it passes this size; one generation is kept. */
const ROTATE_BYTES = Number.parseInt(process.env.OMP_SHIMS_LAZY_EVENT_LOG_MAX_BYTES ?? String(64 * 1024 * 1024), 10) || 0;
const ROTATE_CHECK_EVERY = 512;

export function createEventLog({ out, report, now = () => new Date() }) {
  // Check on the first event too: a log left oversized by an earlier process
  // must rotate at startup, not after another 512 events.
  let sinceCheck = ROTATE_CHECK_EVERY;
  const rotateIfNeeded = () => {
    if (ROTATE_BYTES <= 0 || out === undefined) return;
    sinceCheck += 1;
    if (sinceCheck < ROTATE_CHECK_EVERY) return;
    sinceCheck = 0;
    try {
      if (statSync(out).size < ROTATE_BYTES) return;
      renameSync(out, `${out}.1`);
    } catch {}
  };
  return function emit(event, detail = {}) {
    span("event-log", () => {
      appendJsonLine(out, { ts: now().toISOString(), event, ...detail });
      if (CONSOLE_EVENTS.has(event)) report(`lazy-router ${event}`, detail);
    });
    rotateIfNeeded();
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
