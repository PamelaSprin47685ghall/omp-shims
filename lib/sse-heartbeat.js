// SSE keep-alive comments for quiet event streams.
//
// A model that thinks for a long time can leave a streamed response silent for
// minutes. Proxies, NATs and client stacks on the way may treat that as a dead
// connection and cut it, which the client then reports as a truncated stream.
// An SSE comment line (": keep-alive") is ignored by every conforming parser
// but keeps bytes moving.
//
// The comment is only ever written between events: the stream's last forwarded
// bytes must end with a blank line, so an event is never split. Nothing is
// added before the response object exists (for the lazy router that is after
// its upstream verdict), nothing is buffered, and the wrapper reads from the
// source only when the client asks for more, so backpressure is preserved.

/** The comment written after an idle interval. */
export const KEEP_ALIVE = ": keep-alive\n\n";

/** Default idle interval before a keep-alive comment. */
export const DEFAULT_INTERVAL_MS = 15_000;

const KEEP_ALIVE_BYTES = new TextEncoder().encode(KEEP_ALIVE);
const LF = 0x0a;
const CR = 0x0d;
/** Longest event terminator we look for ("\r\n\r\n"). */
const TAIL_BYTES = 4;

/** True for a response that carries a server-sent event stream. */
export function isEventStream(response) {
  const type = response?.headers?.get("content-type") ?? "";
  return Boolean(response?.body) && type.toLowerCase().startsWith("text/event-stream");
}

/**
 * Tracks whether the bytes forwarded so far end on an event boundary
 * ("\n\n" or "\r\n\r\n"). Only the last few bytes are kept.
 */
export class BoundaryTracker {
  constructor() {
    // An untouched stream is between events.
    this.tail = [LF, LF];
  }

  /** @param {Uint8Array} chunk */
  push(chunk) {
    if (!chunk?.length) return;
    this.tail = [...this.tail, ...chunk.subarray(Math.max(0, chunk.length - TAIL_BYTES))].slice(-TAIL_BYTES);
  }

  get atBoundary() {
    const t = this.tail;
    const n = t.length;
    if (n >= 2 && t[n - 1] === LF && t[n - 2] === LF) return true;
    return n >= 4 && t[n - 4] === CR && t[n - 3] === LF && t[n - 2] === CR && t[n - 1] === LF;
  }
}

/**
 * Wrap an SSE body so that, while the client is waiting for data and the
 * source has been silent for `intervalMs` at an event boundary, a keep-alive
 * comment is written. The idle clock restarts on every forwarded chunk.
 *
 * @param {ReadableStream<Uint8Array>} source
 * @param {{intervalMs?: number, signal?: AbortSignal, onKeepAlive?: () => void}} [options]
 * @returns {ReadableStream<Uint8Array>}
 */
export function heartbeatStream(source, { intervalMs = DEFAULT_INTERVAL_MS, signal, onKeepAlive } = {}) {
  const reader = source.getReader();
  const boundary = new BoundaryTracker();
  /** @type {Promise<ReadableStreamReadResult<Uint8Array>>|null} */
  let pending = null;
  let timer = null;
  let finished = false;

  const stopTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const finish = () => {
    finished = true;
    stopTimer();
    signal?.removeEventListener("abort", onAbort);
  };
  function onAbort() {
    finish();
    reader.cancel(signal?.reason).catch(() => {});
  }
  signal?.addEventListener("abort", onAbort, { once: true });

  /** Resolve with "idle" after the interval, unless stopped first. */
  const idle = () =>
    new Promise((resolve) => {
      timer = setTimeout(() => {
        timer = null;
        resolve("idle");
      }, intervalMs);
      timer.unref?.();
    });

  return new ReadableStream(
    {
      async pull(controller) {
        pending ??= reader.read();
        try {
          while (true) {
            const next = boundary.atBoundary ? await Promise.race([pending, idle()]) : await pending;
            stopTimer();
            if (finished) return;
            if (next === "idle") {
              controller.enqueue(KEEP_ALIVE_BYTES.slice());
              onKeepAlive?.();
              return;
            }
            pending = null;
            if (next.done) {
              finish();
              controller.close();
              return;
            }
            if (!next.value?.length) {
              pending = reader.read();
              continue;
            }
            boundary.push(next.value);
            controller.enqueue(next.value);
            return;
          }
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      cancel(reason) {
        finish();
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

/** Response headers for a stream that must reach the client unbuffered and unaltered. */
export function streamingHeaders(headers) {
  const next = new Headers(headers);
  next.delete("content-length");
  next.set("x-accel-buffering", "no");
  const cache = next.get("cache-control");
  if (!cache) next.set("cache-control", "no-cache, no-transform");
  else if (!/\bno-transform\b/i.test(cache)) next.set("cache-control", `${cache}, no-transform`);
  return next;
}

/**
 * Give an SSE response keep-alive comments; any other response is returned
 * untouched.
 * @param {Response} response
 * @param {{intervalMs?: number, signal?: AbortSignal, onKeepAlive?: () => void}} [options]
 */
export function withHeartbeat(response, options = {}) {
  if (!isEventStream(response)) return response;
  return new Response(heartbeatStream(response.body, options), {
    status: response.status,
    statusText: response.statusText,
    headers: streamingHeaders(response.headers),
  });
}

/**
 * Wrap a Bun.serve request handler so every event stream it answers with gets
 * keep-alive comments. The handler's own decision (status, headers, failover)
 * is awaited first, so nothing is written before it.
 */
export function withSseHeartbeat(handler, options = {}) {
  return async function heartbeatHandler(request, server) {
    const response = await handler(request, server);
    return withHeartbeat(response, { ...options, signal: request.signal });
  };
}
