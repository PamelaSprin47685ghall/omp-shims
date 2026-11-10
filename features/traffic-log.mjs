// Inbound gateway traffic log.
//
// This feature is observational only. It adds the outermost inbound
// middleware and writes one JSONL record for each request event.
// Records go to one file per UTC hour. A periodic sweep removes old files.
//
// The log never changes a request or a response. A log failure is reported
// and the request continues.

import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isGatewayProcess, report } from "../lib/contracts.mjs";
import { addInboundMiddleware as addDefaultInboundMiddleware, middlewarePriority } from "../lib/inbound.mjs";
import { newRequestId, redactHeaders, redactUrl, Sink } from "../lib/telemetry.mjs";

export const name = "traffic-log";

/** The catalog phase. The runtime reads FEATURE_CATALOG, not this field. */
export const phase = "process";

const DEFAULT_MAX_AGE_MS = 3_600_000;
const DEFAULT_SWEEP_MS = 300_000;
const BODY_LIMIT_BYTES = 256 * 1024;

/** The install guard. One install per process. */
let active = null;

/** A disposer for a disabled feature. */
function noop() {}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Report one tagged error one time. Never throw from a report. */
function reportOnce(state, tag, message, error) {
  if (state.reported.has(tag)) return;
  state.reported.add(tag);
  try {
    report(message, { error: messageOf(error) });
  } catch {
    // A closed stderr pipe must not break a request.
  }
}

/** Return a positive finite number, or the fallback. */
function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** Select the log directory. The runtime supplies the logs root. */
function logDirectory(config, context) {
  const configured = config?.dir;
  if (typeof configured === "string" && configured !== "") return configured;
  const logsDir = context?.paths?.logsDir;
  return typeof logsDir === "string" && logsDir !== "" ? join(logsDir, "traffic") : null;
}

/** Return the configured age, or the default. */
function maxAgeFrom(config) {
  const configured = positiveNumber(config?.maxAgeMs, 0);
  if (configured > 0) return configured;
  return DEFAULT_MAX_AGE_MS;
}

/** Format one UTC hour as YYYY-MM-DD-HH. */
function hourStamp(date) {
  return date.toISOString().slice(0, 13).replace("T", "-");
}

/** True for a traffic-log file, including a size-rotated generation. */
function isLogFile(name) {
  return name.endsWith(".jsonl") || name.endsWith(".log") || /\.jsonl\.\d+$/.test(name);
}

/** Build the log path for one UTC hour. */
function sinkPath(dir, date) {
  return join(dir, `gateway-${hourStamp(date)}.jsonl`);
}

/** Drain a cloned body without keeping any bytes. */
async function drainReader(reader) {
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    // A canceled or broken clone has nothing left to drain.
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

/** Join kept chunks as UTF-8 text. */
function textOf(parts) {
  return Buffer.concat(parts.map((part) => Buffer.from(part))).toString("utf8");
}

/**
 * Read at most 256 KiB of the raw request body.
 * A compressed body is described by size, never decompressed here.
 * A larger body is drained after next() starts, so the clone never keeps more
 * than the bounded prefix.
 */
async function readLoggedBody(request) {
  const encoding = (request.headers.get("content-encoding") ?? "").trim().toLowerCase();
  const declaredHeader = request.headers.get("content-length");
  const declared = Number(declaredHeader);
  const hasDeclared = declaredHeader !== null && Number.isFinite(declared) && declared >= 0;

  if (encoding !== "" && encoding !== "identity") {
    return {
      text: hasDeclared ? `<compressed ${declared} bytes>` : "<compressed body>",
      drain: null,
    };
  }
  const reader = request.clone().body?.getReader();
  if (!reader) return { text: "", drain: null };
  const parts = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      reader.releaseLock();
      return { text: textOf(parts), drain: null };
    }
    const room = BODY_LIMIT_BYTES - bytes;
    if (room <= 0) {
      return { text: `${textOf(parts)}…<truncated>`, drain: () => drainReader(reader) };
    }
    const slice = value.byteLength > room ? value.subarray(0, room) : value;
    if (slice.byteLength > 0) {
      parts.push(slice);
      bytes += slice.byteLength;
    }
    if (slice.byteLength < value.byteLength) {
      return { text: `${textOf(parts)}…<truncated>`, drain: () => drainReader(reader) };
    }
  }
}

/** Close the current sink without waiting. Keep it tracked until close ends. */
function closeSink(state) {
  const sink = state.sink;
  state.sink = null;
  state.hour = null;
  if (sink === null) return;
  void sink
    .close()
    .catch(() => {})
    .finally(() => {
      state.sinks.delete(sink);
    });
}

/** Return the sink for the current UTC hour. Rotate on an hour change. */
function sinkFor(state) {
  if (state.disposed) return null;
  const now = new Date();
  const hour = hourStamp(now);
  if (state.sink !== null && state.hour === hour) return state.sink;

  closeSink(state);
  try {
    state.sink = new Sink({ path: sinkPath(state.dir, now) });
    state.hour = hour;
    state.sinks.add(state.sink);
  } catch (error) {
    state.sink = null;
    state.hour = null;
    reportOnce(state, "sink", "traffic-log cannot create the log sink", error);
  }
  return state.sink;
}

/** Queue one record. A log failure never affects the request. */
function emit(state, event, detail) {
  try {
    const sink = sinkFor(state);
    if (sink === null) return;
    void sink.emit(event, detail).catch(() => {});
  } catch (error) {
    reportOnce(state, "emit", "traffic-log cannot write a record", error);
  }
}

/** Remove old log files. A missing directory is not an error. */
async function sweep(state) {
  try {
    const names = await readdir(state.dir);
    const now = Date.now();
    for (const fileName of names) {
      if (!isLogFile(fileName)) continue;
      const path = join(state.dir, fileName);
      try {
        const info = await stat(path);
        if (now - info.mtimeMs > state.maxAgeMs) await unlink(path);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          reportOnce(state, `sweep:${fileName}`, "traffic-log cannot remove an old log", error);
        }
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      reportOnce(state, "sweep", "traffic-log sweep failed", error);
    }
  }
}

/** Build the middleware. It reads the request and never touches the response body. */
function createMiddleware(state) {
  return async function trafficLogMiddleware(request, _server, next) {
    if (state.disposed) return next();

    const startedAt = Date.now();
    const requestId = newRequestId();
    const method = request?.method ?? "GET";
    let url = request?.url ?? "";
    let headers;
    let body;
    let drain = null;

    try {
      url = redactUrl(request?.url ?? "");
      headers = redactHeaders(request?.headers);
      if (state.logBody && method !== "GET" && method !== "HEAD") {
        const logged = await readLoggedBody(request);
        body = logged.text;
        drain = logged.drain;
      }
    } catch (error) {
      reportOnce(state, "request", "traffic-log cannot read a request", error);
    }

    emit(state, "request", { requestId, method, url, headers, body });

    try {
      const pending = next();
      if (drain !== null) void drain().catch(() => {});
      const response = await pending;
      emit(state, "response", {
        requestId,
        method,
        url,
        status: response?.status,
        ms: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      emit(state, "error", {
        requestId,
        method,
        url,
        ms: Date.now() - startedAt,
        error: String(error?.stack ?? error),
      });
      throw error;
    }
  };
}

/**
 * Install the traffic log. Return a disposer.
 * A second call returns the same disposer.
 */
export async function install(config = {}, context) {
  if (active !== null) return active.disposer;
  if (config?.enabled === false || !isGatewayProcess()) return noop;

  const dir = logDirectory(config, context);
  if (dir === null) {
    report("traffic-log: context.paths.logsDir is missing; feature disabled");
    return noop;
  }

  const state = {
    dir,
    maxAgeMs: maxAgeFrom(config),
    sweepMs: positiveNumber(config?.sweepMs, DEFAULT_SWEEP_MS),
    logBody: config?.logBody === true,
    sink: null,
    hour: null,
    sinks: new Set(),
    disposed: false,
    reported: new Set(),
  };

  const addMiddleware =
    typeof context?.addInboundMiddleware === "function" ? context.addInboundMiddleware : addDefaultInboundMiddleware;

  let removeMiddleware;
  try {
    removeMiddleware = addMiddleware(createMiddleware(state), {
      name,
      priority: middlewarePriority.trafficLog,
    });
  } catch (error) {
    report("traffic-log failed to install", { error: messageOf(error) });
    return noop;
  }

  const timer = setInterval(() => {
    void sweep(state);
  }, state.sweepMs);
  timer.unref?.();

  let disposed = false;
  const disposer = () => {
    if (disposed) return undefined;
    disposed = true;
    clearInterval(timer);
    state.disposed = true;
    if (typeof removeMiddleware === "function") {
      try {
        removeMiddleware();
      } catch (error) {
        report("traffic-log failed to remove its layer", { error: messageOf(error) });
      }
    }
    active = null;
    const closings = [];
    for (const sink of state.sinks) closings.push(sink.close().catch(() => {}));
    state.sinks.clear();
    state.sink = null;
    state.hour = null;
    return closings.length === 0 ? undefined : Promise.all(closings);
  };

  active = { disposer };
  return disposer;
}
