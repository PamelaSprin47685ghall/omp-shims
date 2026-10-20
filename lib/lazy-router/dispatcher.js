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
      return this.#judgeResponse(attempt, next.response, abandon);
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
    if (!waiting || attempt.result?.ok || !response.body) {
      const verdict = attempt.result ?? { ok: true, status: 200, source: VERDICT_SOURCE.GATEWAY };
      return { verdict, response, upstreamContacted: attempt.contacted };
    }

    // The gateway opens a 200 event stream (and sends a role chunk) before it
    // has heard from the provider. Hold the stream back until the provider's
    // verdict arrives, or, for transports the attempt layer cannot see (a
    // provider talking over a WebSocket), until the first event that only the
    // provider can produce. An error event fails the attempt either way.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const scanner = new SseScanner();
    const held = [];
    let inFlight = reader.read();
    let answered = false;
    while (!answered) {
      const chunk = inFlight.then((read) => ({ kind: "chunk", read }));
      const next = await Promise.race([waiting.verdict, waiting.deadline, chunk]);
      if (next.kind === "timeout") {
        reader.cancel().catch(() => {});
        return abandon(timedOut());
      }
      if (next.kind === "verdict") {
        if (next.verdict.ok) break;
        reader.cancel().catch(() => {});
        return abandon(next.verdict);
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
            status: attempt.result?.status ?? NETWORK_STATUS,
            source: VERDICT_SOURCE.STREAM,
            message,
          });
        }
        if (kind === STREAM_EVENT.PROGRESS) answered = true;
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
