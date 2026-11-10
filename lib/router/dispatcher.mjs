// Runs one attempt through the gateway's own request handler and decides, as
// soon as the provider has answered with headers, whether it succeeded.
//
// The router never streams a byte to the client before that decision. Until
// then, the gateway's answer (which may already be a 200 event stream) is held.
// Once the attempt is good, the response is handed over untouched, so the
// success path streams exactly as the gateway produced it.
//
// Every timer is cleared in a finally block. A late stream is held under a hard
// deadline and a byte cap; a stream that exceeds either is abandoned, never
// buffered without limit.

import { readFileSync } from "node:fs";
import { withCredentialPin } from "../contracts.mjs";
import { copyBodyCache } from "../inbound.mjs";
import { createSseScanner, isEventStream, rebuildResponse } from "../sse.mjs";
import { quotaWording, readErrorVerdict, runAttempt, VERDICT_SOURCE } from "./attempt.mjs";
import { classifyThrownFailure, FAILURE } from "./failures.mjs";
import { STREAM_EVENT } from "./formats.mjs";

/** Origin used for requests the router makes on its own (probes). */
const INTERNAL_ORIGIN = "http://127.0.0.1";

const TIMEOUT_STATUS = 504;
const NETWORK_STATUS = 502;
const MAX_HELD_BYTES = 8 * 1024 * 1024;

/** The verdict for an attempt whose provider never answered within the deadline. */
const timedOut = () => ({
  ok: false,
  status: TIMEOUT_STATUS,
  source: VERDICT_SOURCE.TIMEOUT,
  message: "no upstream headers within the header timeout",
});

/** Map a thrown provider failure to the verdict the router benches on. */
function thrownFailure(kind) {
  if (kind === FAILURE.QUOTA) {
    return {
      ok: false,
      status: 429,
      source: VERDICT_SOURCE.UPSTREAM,
      message: "upstream 429 Too Many Requests",
      category: "quota",
    };
  }
  if (kind === FAILURE.CREDENTIAL) {
    return {
      ok: false,
      status: 401,
      source: VERDICT_SOURCE.CREDENTIAL,
      message: "upstream 401 Unauthorized",
    };
  }
  return {
    ok: false,
    status: NETWORK_STATUS,
    source: VERDICT_SOURCE.NETWORK,
    message: "upstream connection failed",
    category: "network",
  };
}

/** A promise that resolves with `value` after `ms`. The caller clears `timer`. */
function after(ms, value) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(value), ms);
  });
  return { promise, timer };
}

/**
 * Continue a partly read body: replay the chunks already held back, then the
 * read that is still in flight (if any), then the rest of the stream.
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

/** Read the gateway token from disk, or an empty string. */
export function readTrimmed(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

export class GatewayDispatcher {
  /**
   * @param {{tokenPath: string, headerTimeoutMs: number,
   *   maxHeldBytes?: number, readToken?: () => string}} options
   */
  constructor({ tokenPath, headerTimeoutMs, maxHeldBytes = MAX_HELD_BYTES, readToken }) {
    this.tokenPath = tokenPath;
    this.headerTimeoutMs = headerTimeoutMs;
    this.maxHeldBytes = maxHeldBytes;
    this.readToken =
      typeof readToken === "function" ? readToken : () => (this.tokenPath ? readTrimmed(this.tokenPath) : "");
    this.handler = null;
    this.server = null;
  }

  /** Attach the gateway's request handler from the inbound middleware. */
  bind(handler, server) {
    this.handler = handler;
    this.server = server;
  }

  /** True when the dispatcher can reach the gateway. */
  get ready() {
    return typeof this.handler === "function";
  }

  /** A request the router sends on its own behalf, authenticated with the gateway token. */
  internalRequest(path, body) {
    const token = this.readToken();
    const url = new URL(`${INTERNAL_ORIGIN}${path}`);
    if (url.origin !== INTERNAL_ORIGIN) {
      throw new Error("lazy-router: internal request escaped the loopback origin");
    }
    return new Request(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** Pass a request straight to the gateway, with no attempt scope. */
  forward(request) {
    return this.handler(request, this.server);
  }

  /**
   * Serve `request` as `attempt` and decide its fate.
   * @param {object} attempt
   * @param {Request} request a fresh request; its body is consumed
   * @param {{format?: object, headerTimeoutMs?: number,
   *   onOutput?: () => void}} [options]
   * @returns {Promise<{verdict: object, response?: Response, upstreamContacted: boolean}>}
   */
  async run(attempt, request, { format, headerTimeoutMs = this.headerTimeoutMs, onOutput } = {}) {
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    const scoped = copyBodyCache(request, new Request(request, { signal }));
    const pending = Promise.resolve(
      runAttempt(attempt, () => {
        const call = () => this.handler(scoped, this.server);
        // A pinned attempt is also the request-scoped credential pin that other
        // outbound layers read through contracts.activePin().
        return attempt.credentialId === undefined ? call() : withCredentialPin(attempt, call);
      }),
    );
    const settled = pending.then(
      (response) => ({ kind: "response", response }),
      (error) => ({ kind: "error", error }),
    );

    const deadline = after(headerTimeoutMs, { kind: "timeout" });
    try {
      const verdict = attempt.verdict.then((value) => ({ kind: "verdict", verdict: value }));
      const first = await Promise.race([verdict, settled, deadline.promise]);

      if (first.kind === "timeout") {
        return this.#abandon(attempt, controller, pending, timedOut());
      }
      if (first.kind === "error") {
        return this.#abandon(attempt, controller, pending, thrownFailure(classifyThrownFailure(first.error)));
      }
      if (first.kind === "verdict") {
        if (!first.verdict.ok) return this.#abandon(attempt, controller, pending, first.verdict);
        const next = await settled;
        if (next.kind === "error") {
          return this.#abandon(attempt, controller, pending, thrownFailure(classifyThrownFailure(next.error)));
        }
        return await this.#judgeResponse(attempt, next.response, controller, pending, {
          format,
          deadline: deadline.promise,
          onOutput,
        });
      }

      // The gateway answered before the provider did.
      return await this.#judgeResponse(attempt, first.response, controller, pending, {
        verdict,
        deadline: deadline.promise,
        format,
        onOutput,
      });
    } finally {
      clearTimeout(deadline.timer);
    }
  }

  /** Stop the attempt and return its failing verdict. */
  #abandon(attempt, controller, pending, failure) {
    const final = attempt.fail(failure);
    controller.abort();
    pending.then((response) => response?.body?.cancel()).catch(() => {});
    return { verdict: final, upstreamContacted: attempt.contacted };
  }

  async #judgeResponse(attempt, response, controller, pending, waiting) {
    if (response.status !== 200) {
      const error = await readErrorVerdict(response);
      response.body?.cancel().catch(() => {});
      return this.#abandon(attempt, controller, pending, {
        ok: false,
        status: response.status,
        source: VERDICT_SOURCE.GATEWAY,
        message: error.message,
        category: error.category,
      });
    }

    const streaming = isEventStream(response);
    if (!response.body || !streaming || typeof waiting.format?.classifyEvent !== "function") {
      const verdict = attempt.result ?? { ok: true, status: 200, source: VERDICT_SOURCE.GATEWAY };
      return { verdict, response, upstreamContacted: attempt.contacted };
    }

    // Hold a 200 event stream until genuine model output or an error. A
    // provider can answer 200 and only then fail inside SSE; the client must
    // not receive a prefix that then has to be retried elsewhere.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const scanner = createSseScanner();
    const held = [];
    let heldBytes = 0;
    let inFlight = reader.read();
    let gate = waiting.deadline ? { verdict: waiting.verdict, deadline: waiting.deadline } : null;
    let answered = false;
    let sawOutput = false;

    while (!answered) {
      const chunk = inFlight.then(
        (read) => ({ kind: "chunk", read }),
        (error) => ({ kind: "read-error", error }),
      );
      const races = gate ? [gate.deadline, chunk] : [chunk];
      if (gate?.verdict) races.push(gate.verdict);
      const next = await Promise.race(races);

      if (next.kind === "timeout") {
        reader.cancel().catch(() => {});
        return this.#abandon(attempt, controller, pending, timedOut());
      }
      if (next.kind === "verdict") {
        if (!next.verdict.ok) {
          reader.cancel().catch(() => {});
          return this.#abandon(attempt, controller, pending, next.verdict);
        }
        // Provider headers succeeded, but a stream error can still arrive
        // before model output. Keep guarding that gap.
        gate = { deadline: waiting.deadline };
        continue;
      }
      if (next.kind === "read-error") {
        reader.cancel().catch(() => {});
        return this.#abandon(attempt, controller, pending, {
          ok: false,
          status: NETWORK_STATUS,
          source: VERDICT_SOURCE.STREAM,
          message: "upstream stream failed",
          category: "network",
        });
      }
      if (next.read.done) {
        inFlight = null;
        break;
      }

      held.push(next.read.value);
      heldBytes += next.read.value?.byteLength ?? 0;
      if (heldBytes > this.maxHeldBytes) {
        reader.cancel().catch(() => {});
        return this.#abandon(attempt, controller, pending, {
          ok: false,
          status: NETWORK_STATUS,
          source: VERDICT_SOURCE.STREAM,
          message: `upstream stream exceeded the ${this.maxHeldBytes}-byte hold limit`,
        });
      }

      let events;
      try {
        events = scanner.push(decoder.decode(next.read.value, { stream: true }));
      } catch (error) {
        reader.cancel().catch(() => {});
        return this.#abandon(attempt, controller, pending, {
          ok: false,
          status: NETWORK_STATUS,
          source: VERDICT_SOURCE.STREAM,
          message: String(error?.message ?? error),
        });
      }
      for (const event of events) {
        const kind = waiting.format.classifyEvent(event);
        if (kind === STREAM_EVENT.ERROR) {
          reader.cancel().catch(() => {});
          const raw = JSON.stringify(event.data?.error ?? event.data);
          return this.#abandon(attempt, controller, pending, {
            ok: false,
            status: NETWORK_STATUS,
            source: VERDICT_SOURCE.STREAM,
            message: "upstream stream reported an error",
            category: quotaWording(raw) ? "quota" : "stream",
          });
        }
        const output =
          typeof waiting.format.isOutputEvent === "function"
            ? waiting.format.isOutputEvent(event)
            : kind === STREAM_EVENT.PROGRESS;
        if (output) {
          if (!sawOutput) {
            sawOutput = true;
            waiting.onOutput?.();
          }
          answered = true;
        }
      }
      inFlight = reader.read();
    }

    const body = resumeStream(reader, held, inFlight);
    const verdict = attempt.result ?? { ok: true, status: 200, source: VERDICT_SOURCE.STREAM };
    return {
      verdict,
      response: rebuildResponse(response, body),
      upstreamContacted: attempt.contacted,
    };
  }
}
