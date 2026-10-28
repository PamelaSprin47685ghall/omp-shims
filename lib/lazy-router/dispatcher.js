// Runs one attempt through the gateway's own request handler and decides, as
// soon as the provider has answered with headers, whether it succeeded.
//
// The router never streams a byte to the client before that decision: until
// then the gateway's response (which may already be a 200 event stream) is held
// back. Once the attempt is good, the response is handed over untouched, so the
// success path streams exactly as the gateway produced it.

import { runPinned } from "../credential-pin.js";
import { ERROR_SNIPPET_CHARS, errorSnippet, VERDICT_SOURCE } from "./attempt.js";
import { readTrimmed } from "./credentials.js";
import { STREAM_EVENT } from "./formats.js";
import { SseScanner } from "./sse.js";

/** Origin used for requests the router makes on its own (probes, warm-up). */
const INTERNAL_ORIGIN = "http://127.0.0.1";

/** Gateway-side "abandon" status for an attempt that produced neither headers nor an error in time. */
const TIMEOUT_STATUS = 504;
const NETWORK_STATUS = 502;
const LATE_STREAM_ERROR_PROVIDERS = new Set(["qoder", "qoder-cn", "cline-pass", "ctyun"]);
const CLINE_RATE_LIMIT_TEXT = "User Provided API Key Rate Limit Exceeded";
const CTYUN_QUOTA_SENTINEL = "ctyun coding-plan quota exhausted";
const CTYUN_QUOTA_MARKERS = [
  "codingplan套餐的额度已用完",
  "请等待周期时间刷新",
  "请等待周期刷新",
];
const CTYUN_QUOTA_PREFIXES = [
  "您的codingplan套餐的额度已用完",
  "codingplan套餐的额度已用完",
  "请等待周期时间刷新",
  "请等待周期刷新",
];

function chatDeltaText(event) {
  return (event.data?.choices ?? [])
    .map((choice) => (typeof choice.delta?.content === "string" ? choice.delta.content : ""))
    .join("");
}

/**
 * Cline can surface an upstream quota rejection as ordinary assistant text.
 * Return "pending" while the first text still could be that sentinel so no
 * prefix leaks to the client before we know whether failover is safe.
 */
function clineRateLimitState(text) {
  const probe = text
    .trimStart()
    .replace(/^(?:(?:upstream|provider)\s+)?error\s*:\s*/i, "")
    .toLowerCase();
  const target = CLINE_RATE_LIMIT_TEXT.toLowerCase();
  if (probe.includes(target)) return "error";
  if (probe.length > 0 && target.startsWith(probe)) return "pending";
  return "clear";
}

/** CTYun can serialize an exhausted Coding Plan as ordinary assistant text. */
function ctyunQuotaState(text) {
  const probe = text.trimStart().replace(/\s+/g, "").toLowerCase();
  if (CTYUN_QUOTA_MARKERS.some((marker) => probe.includes(marker))) return "error";
  if (probe.length > 0 && CTYUN_QUOTA_PREFIXES.some((prefix) => prefix.startsWith(probe))) return "pending";
  return "clear";
}

function guardedTextState(provider, text) {
  if (provider === "cline-pass") return { state: clineRateLimitState(text), message: CLINE_RATE_LIMIT_TEXT };
  if (provider === "ctyun") return { state: ctyunQuotaState(text), message: CTYUN_QUOTA_SENTINEL };
  return { state: "clear", message: "" };
}

/** The verdict for an attempt whose provider never answered within the header timeout. */
const timedOut = () => ({
  ok: false,
  status: TIMEOUT_STATUS,
  source: VERDICT_SOURCE.TIMEOUT,
  message: "no upstream headers within the header timeout",
});

/**
 * @typedef {import("./attempt.js").Verdict} Verdict
 * @typedef {{verdict: Verdict, response?: Response, upstreamContacted: boolean}} Outcome
 */

/** Resolve after `ms` with `value`; the timer never holds the process open. */
function after(ms, value) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(value), ms);
    timer.unref?.();
  });
}

/**
 * Continue a partly read body: replay the chunks already held back, then the
 * read that is still in flight (if any), then the rest of the stream.
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {Uint8Array[]} held
 * @param {Promise<{done: boolean, value?: Uint8Array}>|null} inFlight
 */
export function resumeStream(reader, held, inFlight) {
  let pending = inFlight;
  return new ReadableStream({
    start(controller) {
      for (const chunk of held) controller.enqueue(chunk);
    },
    async pull(controller) {
      const read = pending ?? reader.read();
      pending = null;
      const { done, value } = await read;
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export class GatewayDispatcher {
  /**
   * @param {{tokenPath: string, headerTimeoutMs: number}} options
   */
  constructor({ tokenPath, headerTimeoutMs }) {
    this.tokenPath = tokenPath;
    this.headerTimeoutMs = headerTimeoutMs;
    this.handler = null;
    this.server = null;
  }

  /** Attach the gateway's request handler (from the patched Bun.serve). */
  bind(handler, server) {
    this.handler = handler;
    this.server = server;
  }

  get ready() {
    return typeof this.handler === "function";
  }

  /** A request the router sends on its own behalf, authenticated with the gateway token. */
  internalRequest(path, body) {
    return new Request(`${INTERNAL_ORIGIN}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${readTrimmed(this.tokenPath)}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** Pass a request straight to the gateway (no attempt scope). */
  forward(request) {
    return this.handler(request, this.server);
  }

  /**
   * Serve `request` as `attempt` and decide its fate.
   * @param {import("./attempt.js").Attempt} attempt
   * @param {Request} request a fresh request (its body is consumed)
   * @param {{format: object, headerTimeoutMs?: number}} options  format: the dialect adapter (judges held events)
   * @returns {Promise<Outcome>}
   */
  async run(attempt, request, { format, headerTimeoutMs = this.headerTimeoutMs }) {
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const scoped = new Request(request, { signal });

    const pending = runPinned(attempt, () => this.handler(scoped, this.server));
    const settled = pending.then(
      (response) => ({ kind: "response", response }),
      (error) => ({ kind: "error", error }),
    );
    const deadline = after(headerTimeoutMs, { kind: "timeout" });
    const verdict = attempt.verdict.then((value) => ({ kind: "verdict", verdict: value }));

    const abandon = (failure) => {
      const final = attempt.fail(failure);
      controller.abort();
      pending.then((response) => response?.body?.cancel()).catch(() => {});
      return { verdict: final, upstreamContacted: attempt.contacted };
    };

    const first = await Promise.race([verdict, settled, deadline]);

    if (first.kind === "timeout") {
      return abandon(timedOut());
    }
    if (first.kind === "error") {
      return abandon({
        ok: false,
        status: NETWORK_STATUS,
        source: VERDICT_SOURCE.NETWORK,
        message: String(first.error?.message ?? first.error),
      });
    }
    if (first.kind === "verdict") {
      if (!first.verdict.ok) return abandon(first.verdict);
      // Upstream accepted: from here on the gateway owns the response.
      const next = await settled;
      if (next.kind === "error") {
        return abandon({
          ok: false,
          status: NETWORK_STATUS,
          source: VERDICT_SOURCE.NETWORK,
          message: String(next.error),
        });
      }
      return this.#judgeResponse(attempt, next.response, abandon, { format });
    }

    // The gateway answered before the provider did.
    return this.#judgeResponse(attempt, first.response, abandon, { verdict, deadline, format });
  }

  async #judgeResponse(attempt, response, abandon, waiting) {
    if (response.status !== 200) {
      const message = await errorSnippet(response);
      response.body?.cancel().catch(() => {});
      return abandon({ ok: false, status: response.status, source: VERDICT_SOURCE.GATEWAY, message });
    }
    const streaming = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    if (attempt.provider === "ctyun" && response.body && !streaming) {
      try {
        const text = await response.clone().text();
        if (ctyunQuotaState(text) === "error") {
          response.body.cancel().catch(() => {});
          return abandon({
            ok: false,
            status: NETWORK_STATUS,
            source: VERDICT_SOURCE.GATEWAY,
            message: CTYUN_QUOTA_SENTINEL,
          });
        }
      } catch {}
    }
    const guardAfterUpstreamOk = LATE_STREAM_ERROR_PROVIDERS.has(attempt.provider);
    if (!response.body || !streaming || !waiting?.format?.classifyEvent || (attempt.result?.ok && !guardAfterUpstreamOk)) {
      const verdict = attempt.result ?? { ok: true, status: 200, source: VERDICT_SOURCE.GATEWAY };
      return { verdict, response, upstreamContacted: attempt.contacted };
    }

    // Qoder and Cline can return HTTP 200 and only then fail inside SSE. Hold
    // those transports through the role preamble until genuine model output or
    // an error. Cline additionally has one known quota rejection that it can
    // serialize as ordinary assistant text; that sentinel is buffered below.
    // Other providers preserve the original header-time decision.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const scanner = new SseScanner();
    const held = [];
    let inFlight = reader.read();
    let gate = waiting.verdict && waiting.deadline ? waiting : null;
    let answered = false;
    let guardedText = "";
    while (!answered) {
      const chunk = inFlight.then(
        (read) => ({ kind: "chunk", read }),
        (error) => ({ kind: "read-error", error }),
      );
      const next = await Promise.race(gate ? [gate.verdict, gate.deadline, chunk] : [chunk]);
      if (next.kind === "timeout") {
        reader.cancel().catch(() => {});
        return abandon(timedOut());
      }
      if (next.kind === "verdict") {
        if (!next.verdict.ok) {
          reader.cancel().catch(() => {});
          return abandon(next.verdict);
        }
        if (!guardAfterUpstreamOk) break;
        // Provider headers succeeded, but an application-level stream error can
        // still arrive before model output. Keep guarding that gap.
        gate = null;
        continue;
      }
      if (next.kind === "read-error") {
        reader.cancel().catch(() => {});
        return abandon({
          ok: false,
          status: NETWORK_STATUS,
          source: VERDICT_SOURCE.STREAM,
          message: String(next.error?.message ?? next.error),
        });
      }
      if (next.read.done) {
        inFlight = null;
        break;
      }
      held.push(next.read.value);
      for (const event of scanner.push(decoder.decode(next.read.value, { stream: true }))) {
        const kind = waiting.format.classifyEvent(event);
        if (kind === STREAM_EVENT.ERROR) {
          reader.cancel().catch(() => {});
          const message = JSON.stringify(event.data?.error ?? event.data).slice(0, ERROR_SNIPPET_CHARS);
          return abandon({
            ok: false,
            status: NETWORK_STATUS,
            source: VERDICT_SOURCE.STREAM,
            message,
          });
        }
        const output =
          typeof waiting.format.isOutputEvent === "function"
            ? waiting.format.isOutputEvent(event)
            : kind === STREAM_EVENT.PROGRESS;
        if (output && (attempt.provider === "cline-pass" || attempt.provider === "ctyun")) {
          const delta = chatDeltaText(event);
          if (delta) {
            guardedText += delta;
            const guard = guardedTextState(attempt.provider, guardedText);
            if (guard.state === "error") {
              reader.cancel().catch(() => {});
              return abandon({
                ok: false,
                status: NETWORK_STATUS,
                source: VERDICT_SOURCE.STREAM,
                message: guard.message,
              });
            }
            if (guard.state === "pending") continue;
          }
        }
        if (output) answered = true;
      }
      inFlight = reader.read();
    }
    const rebuilt = new Response(resumeStream(reader, held, inFlight), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    const verdict = attempt.result ?? { ok: true, status: 200, source: VERDICT_SOURCE.STREAM };
    return { verdict, response: rebuilt, upstreamContacted: attempt.contacted };
  }
}
