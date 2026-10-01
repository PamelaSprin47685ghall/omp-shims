// Inbound gateway request logging.
//
// Observational only: it wraps `Bun.serve` to record each request, then calls
// the original handler untouched. Files roll hourly and are swept by age, so
// the log directory stays bounded.
//
// Env:
//   OMP_SHIMS_TRAFFIC_LOG_DIR        default ~/.omp/gateway-logs
//   OMP_SHIMS_TRAFFIC_LOG_MAX_AGE_MS default 3600000 (1h)
//   OMP_SHIMS_TRAFFIC_LOG_BODY       set to 0 to omit request/response bodies

import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

/** Keys whose values are secrets and must never be written to disk. */
const REDACTED = new Set(["authorization", "x-api-key", "api-key", "cookie", "set-cookie", "proxy-authorization"]);

function safeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  try {
    for (const [key, value] of headers) out[key] = REDACTED.has(key.toLowerCase()) ? "<redacted>" : value;
  } catch {}
  return out;
}

function safeBody(body) {
  if (body === undefined || body === null) return undefined;
  const text = typeof body === "string" ? body : undefined;
  if (text === undefined) return `<${body.constructor?.name ?? typeof body}>`;
  if (text.length > 256_000) return text.slice(0, 256_000) + "…<truncated>";
  return text;
}

export function install(config) {
  const includeBodies = process.env.OMP_SHIMS_TRAFFIC_LOG_BODY !== "0";
  const dir = config.dir ?? process.env.OMP_SHIMS_TRAFFIC_LOG_DIR ?? join(homedir(), ".omp", "gateway-logs");
  const maxAgeMs = Number.parseInt(process.env.OMP_SHIMS_TRAFFIC_LOG_MAX_AGE_MS ?? String(config.maxAgeMs ?? 3_600_000), 10) || 3_600_000;
  const sweepMs = Number.parseInt(config.sweepMs ?? 300_000);

  try {
    require_("node:fs").mkdirSync(dir, { recursive: true });
  } catch {}

  function fileFor(date) {
    return join(dir, `gateway-${date.toISOString().slice(0, 13).replace("T", "-")}.jsonl`);
  }

  let queue = Promise.resolve();
  function write(entry) {
    // Serialize appends so concurrent requests cannot interleave partial lines.
    queue = queue
      .then(() => appendFile(fileFor(new Date()), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8"))
      .catch(() => {});
  }

  async function sweep() {
    try {
      const now = Date.now();
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".jsonl") && !name.endsWith(".log")) continue;
        const path = join(dir, name);
        try {
          if (now - (await stat(path)).mtimeMs > maxAgeMs) await unlink(path);
        } catch {}
      }
    } catch {}
  }
  const timer = setInterval(sweep, sweepMs);
  timer.unref?.();

  const originalServe = Bun?.serve;
  if (typeof originalServe !== "function") return;

  Bun.serve = function patchedServe(options) {
    const handler = options.fetch;
    if (typeof handler === "function") {
      options.fetch = async function loggedHandler(request, server) {
        const startedAt = Date.now();
        let requestBodyText;
        if (includeBodies && request.method !== "GET" && request.method !== "HEAD") {
          requestBodyText = await request
            .clone()
            .text()
            .catch(() => undefined);
        }
        write({
          event: "request",
          method: request.method,
          url: request.url,
          headers: safeHeaders(request.headers),
          body: includeBodies ? safeBody(requestBodyText) : undefined,
        });

        try {
          const response = await handler.call(this, request, server);
          write({
            event: "response",
            method: request.method,
            url: request.url,
            status: response?.status,
            ms: Date.now() - startedAt,
          });
          return response;
        } catch (error) {
          write({ event: "error", method: request.method, url: request.url, ms: Date.now() - startedAt, error: String(error?.stack ?? error) });
          throw error;
        }
      };
    }
    return originalServe.call(this, options);
  };
}
