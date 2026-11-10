// Telemetry helpers for omp-shims.
//
// This module imports only node builtins and the shared contracts.
// It redacts secrets, hashes account identifiers, and writes event logs.
// The Sink buffers records and rotates the file by size.

import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { report as reportDiagnostic } from "./contracts.mjs";

/** The value that replaces a secret. */
const REDACTED = "[redacted]";

/** Header names whose values are secret. Compare the names in lowercase. */
const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "copilot-session-token",
  "cookie",
  "set-cookie",
  "x-auth-token",
  "openai-api-key",
  "anthropic-api-key",
]);

/** Query parameter names whose values are secret. Compare in lowercase. */
const SECRET_QUERY = new Set(["key", "api_key", "access_token", "token", "sig", "signature"]);

/** The Sink flushes when the buffer reaches this size. */
const FLUSH_BYTES = 32 * 1024;

/** The Sink flushes after this many milliseconds. */
const FLUSH_MS = 200;

/** The default maximum size of one log file. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** List header entries from a Headers instance, a plain object, or a pair array. */
function headerEntries(headers) {
  if (!headers || typeof headers !== "object") return [];
  if (Array.isArray(headers)) return headers;
  if (typeof headers.entries === "function") {
    try {
      return [...headers.entries()];
    } catch {
      return [];
    }
  }
  return Object.entries(headers);
}

/**
 * Return a copy of the input headers with every secret value replaced.
 * The name match ignores case. The input can be a Headers instance,
 * a plain object, or an array of [name, value] pairs.
 */
export function redactHeaders(headers) {
  const pairs = [];
  for (const entry of headerEntries(headers)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const name = String(entry[0] ?? "").trim();
    if (name === "") continue;
    const raw = Array.isArray(entry[1]) ? entry[1].join(", ") : String(entry[1] ?? "");
    pairs.push([name, SECRET_HEADERS.has(name.toLowerCase()) ? REDACTED : raw]);
  }
  return Object.fromEntries(pairs);
}

/**
 * Return the URL with every secret query value replaced.
 * The function returns the input unchanged when parsing fails or the input
 * is not a string. The parameter name match ignores case.
 */
export function redactUrl(url) {
  if (typeof url !== "string") return url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let found = false;
  for (const name of new Set(parsed.searchParams.keys())) {
    if (!SECRET_QUERY.has(name.toLowerCase())) continue;
    parsed.searchParams.set(name, REDACTED);
    found = true;
  }
  return found ? parsed.toString() : url;
}

/**
 * Return "sha256:" plus the first 12 hex characters of the email hash.
 * The function trims and lowercases the input first. The raw email never
 * appears in the result. A non-string input hashes the empty string.
 */
export function hashEmail(email) {
  const text = typeof email === "string" ? email.trim().toLowerCase() : "";
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  return `sha256:${digest.slice(0, 12)}`;
}

/** True for a non-null object that is not an array. */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Build one record. The ts, event, and requestId fields always win. */
function buildRecord(event, detail, fallbackRequestId) {
  const data = isRecord(detail) ? detail : {};
  const record = { ...data };
  record.ts = new Date().toISOString();
  record.event = typeof event === "string" ? event : String(event);
  const requestId = data.requestId ?? fallbackRequestId;
  if (requestId !== undefined && requestId !== null && requestId !== "") {
    record.requestId = String(requestId);
  }
  return record;
}

/** Turn a record into one JSON line. Return a safe line on a bad value. */
function encodeRecord(record) {
  try {
    return `${JSON.stringify(record)}\n`;
  } catch {
    return `${JSON.stringify({ ts: record.ts, event: record.event, detail: "unserializable" })}\n`;
  }
}

/**
 * Write JSON event records to one file.
 *
 * The sink buffers records and flushes them every 200 ms or at 32 KiB.
 * It creates the directory with mode 0700 and the file with mode 0600.
 * It rotates the file at maxBytes and keeps `keep` older generations.
 * One I/O error disables the sink after one report. The sink never throws.
 */
export class Sink {
  constructor({ path, reportToStderr = false, maxBytes = DEFAULT_MAX_BYTES, keep = 2, requestId = null } = {}) {
    if (typeof path !== "string" || path === "") throw new TypeError("Sink requires a log path");
    this.path = path;
    this.reportToStderr = reportToStderr === true;
    this.maxBytes = Number.isFinite(maxBytes) ? maxBytes : DEFAULT_MAX_BYTES;
    this.keep = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 2;
    this.requestId = requestId;
    this.buffer = [];
    this.bufferedBytes = 0;
    this.bytes = 0;
    this.fd = null;
    this.broken = false;
    this.reported = false;
    this.closed = false;
    this.closing = false;
    this.timer = null;
    this.chain = Promise.resolve();

    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      try {
        this.bytes = statSync(path).size;
      } catch {
        this.bytes = 0;
      }
      this.openFile();
    } catch (error) {
      this.fail(error);
    }
    if (!this.broken) {
      this.timer = setInterval(() => {
        void this.flush();
      }, FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Add one record to the buffer. Resolve after the record is queued. */
  emit(event, detail) {
    if (this.broken || this.closed || this.closing) return Promise.resolve();
    const line = encodeRecord(buildRecord(event, detail, this.requestId));
    this.buffer.push(line);
    this.bufferedBytes += Buffer.byteLength(line);
    if (this.reportToStderr) {
      try {
        process.stderr.write(line);
      } catch {
        // A closed stderr pipe must not stop the file sink.
      }
    }
    if (this.bufferedBytes >= FLUSH_BYTES) return this.flush();
    return Promise.resolve();
  }

  /** Write the pending buffer after earlier writes. Wait for the write. */
  flush() {
    if (this.broken) return this.chain;
    if (this.bufferedBytes === 0) return this.chain;
    const run = this.chain.then(() => {
      this.writePending();
    });
    this.chain = run.catch((error) => {
      this.fail(error);
    });
    return this.chain;
  }

  /** Flush the buffer, stop the timer, and close the file descriptor. */
  close() {
    if (this.closing) return this.chain;
    this.closing = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const done = this.flush().then(() => {
      this.closed = true;
      if (this.fd !== null) {
        try {
          closeSync(this.fd);
        } catch {
          // The descriptor is unusable already.
        }
        this.fd = null;
      }
    });
    this.chain = done;
    return done;
  }

  /** Open the log file. The constructor or a flush calls this method. */
  openFile() {
    if (this.fd !== null) return;
    this.fd = openSync(this.path, "a", 0o600);
  }

  /** Write the current buffer. Rotate first when the write exceeds maxBytes. */
  writePending() {
    if (this.broken || this.closed) return;
    if (this.buffer.length === 0) return;
    const chunk = this.buffer.join("");
    const size = Buffer.byteLength(chunk);
    this.buffer = [];
    this.bufferedBytes = 0;
    if (this.maxBytes > 0 && this.bytes > 0 && this.bytes + size > this.maxBytes) {
      this.rotate();
    }
    this.openFile();
    writeSync(this.fd, chunk);
    this.bytes += size;
  }

  /** Move path to path.1, path.1 to path.2, and drop the oldest generation. */
  rotate() {
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // The descriptor is unusable already.
      }
      this.fd = null;
    }
    for (let index = this.keep; index >= 1; index -= 1) {
      const target = `${this.path}.${index}`;
      if (index === this.keep) {
        try {
          unlinkSync(target);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      const source = index === 1 ? this.path : `${this.path}.${index - 1}`;
      try {
        renameSync(source, target);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    this.bytes = 0;
    this.openFile();
  }

  /** Disable the sink after one I/O error and report the error once. */
  fail(error) {
    this.broken = true;
    this.buffer = [];
    this.bufferedBytes = 0;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.fd !== null) {
      try {
        closeSync(this.fd);
      } catch {
        // The descriptor is unusable already.
      }
      this.fd = null;
    }
    if (this.reported) return;
    this.reported = true;
    try {
      reportDiagnostic("telemetry sink disabled", {
        path: this.path,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Report must not throw from the sink.
    }
  }
}

/**
 * Build a synchronous event writer.
 *
 * With no `out` path, the writer sends one JSON line to stderr.
 * With an `out` path, it appends one JSON line and creates the directory
 * with mode 0700. The writer never throws. A `report` callback gets one
 * short human line for each written event.
 */
export function createEventLog({ out = null, report: reportLine } = {}) {
  let failed = false;
  return function emit(event, detail) {
    const line = encodeRecord(buildRecord(event, detail));
    let wrote = true;
    try {
      if (out === null || out === undefined) {
        process.stderr.write(line);
      } else {
        mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
        appendFileSync(out, line, { mode: 0o600 });
      }
    } catch (error) {
      wrote = false;
      if (!failed) {
        failed = true;
        if (typeof reportLine === "function") {
          try {
            reportLine("telemetry event log failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          } catch {
            // The reporter must not throw from the writer.
          }
        }
      }
    }
    if (wrote && typeof reportLine === "function") {
      try {
        reportLine(`telemetry ${typeof event === "string" ? event : "event"}`);
      } catch {
        // The reporter must not throw from the writer.
      }
    }
  };
}

/**
 * Return a short random request id.
 * The id is 12 lowercase hexadecimal characters.
 */
export function newRequestId() {
  return randomBytes(6).toString("hex");
}
