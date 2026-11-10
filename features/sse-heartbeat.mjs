// Keep a quiet event stream alive between events.
//
// A long-thinking model can leave an SSE response silent for minutes. A proxy,
// NAT, or client stack can treat that silence as a dead connection. One SSE
// comment line keeps bytes moving, and every conforming parser ignores it.
//
// The comment is written only when the bytes forwarded so far end on an event
// boundary. An event is never split. The timer starts when the client asks for
// more data, so backpressure is unchanged. It stops on end, error, cancel, and
// request abort.
//
// The response is rebuilt through lib/sse.mjs so its `.url` survives and the
// stale body headers go. `X-Accel-Buffering: no` and a no-cache directive are
// added when the upstream did not set them.

import { isGatewayProcess, report } from "../lib/contracts.mjs";
import { addInboundMiddleware, middlewarePriority } from "../lib/inbound.mjs";
import { isEventStream, rebuildResponse, streamingHeaders } from "../lib/sse.mjs";

export const name = "sse-heartbeat";
export const phase = "edge";

/** The comment written after an idle interval. */
export const KEEP_ALIVE = ": keep-alive\n\n";

/** Default idle interval before a keep-alive comment. */
export const DEFAULT_INTERVAL_MS = 15_000;

const encoder = new TextEncoder();
const KEEP_ALIVE_BYTES = encoder.encode(KEEP_ALIVE);
const LF = 0x0a;
const CR = 0x0d;
const TAIL_BYTES = 4;

/**
 * Track whether the forwarded bytes end on an event boundary.
 * The tracker keeps only the last four bytes.
 */
function createBoundary() {
  // A stream that has sent nothing is between events.
  let tail = [LF, LF];
  return {
    push(chunk) {
      if (!chunk?.length) return;
      tail = [...tail, ...chunk.subarray(Math.max(0, chunk.length - TAIL_BYTES))].slice(-TAIL_BYTES);
    },
    get atBoundary() {
      const n = tail.length;
      if (n >= 2 && tail[n - 1] === LF && tail[n - 2] === LF) return true;
      return n >= 4 && tail[n - 4] === CR && tail[n - 3] === LF && tail[n - 2] === CR && tail[n - 1] === LF;
    },
  };
}

/**
 * Wrap one event-stream body with keep-alive comments.
 * The timer is cleared on every exit path.
 */
function heartbeatStream(source, { intervalMs, signal, onKeepAlive } = {}) {
  const reader = source.getReader();
  const boundary = createBoundary();
  let pending = null;
  let timer = null;
  let finished = false;

  const stopTimer = () => {
    clearTimeout(timer);
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

/** Add keep-alive comments to an SSE response. Other responses pass through. */
function withHeartbeat(response, options) {
  if (!isEventStream(response)) return response;
  try {
    return rebuildResponse(response, heartbeatStream(response.body, options), {
      headers: streamingHeaders(response.headers),
    });
  } catch (error) {
    report("sse-heartbeat rewrite failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return response;
  }
}

/** One installed layer per process. */
let active;

export async function install(config, context = {}) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) return;
  if (active) return active;

  const add = context.addInboundMiddleware ?? addInboundMiddleware;
  const log = context.log ?? (() => {});
  const intervalMs = Number(config?.intervalMs) > 0 ? Number(config.intervalMs) : DEFAULT_INTERVAL_MS;

  const dispose = add(
    async (request, _server, next) => {
      const response = await next();
      return withHeartbeat(response, { intervalMs, signal: request.signal });
    },
    { name, priority: middlewarePriority.sseHeartbeat },
  );

  active = () => {
    active = undefined;
    dispose();
  };
  log("sse-heartbeat: enabled", { intervalMs });
  return active;
}
