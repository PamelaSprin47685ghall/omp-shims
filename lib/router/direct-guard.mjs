// Client-facing guard for a direct (non-route) model call.
//
// A direct model id bypasses the Lazy Router candidate pool, so the compiled
// gateway owns the provider call. Its failure response is still the provider's
// body. A quota or billing failure must never reach the client in that shape:
// it names the provider, links a billing page, and leaks account state.
//
// The guard reads only a bounded prefix and only for account-status replies.
// A genuine request error keeps its original response. The upstream status is
// reported internally and replaced by one deterministic client answer.

import { rebuildResponse, streamingHeaders } from "../sse.mjs";
import { quotaWording } from "./attempt.mjs";

/** Statuses that can carry an exhausted-account answer. */
const QUOTA_STATUS = new Set([401, 402, 403, 429]);

/** The largest prefix inspected for quota wording, in bytes. */
const MAX_SNIPPET_BYTES = 16 * 1024;

/** A thrown provider failure that names an exhausted account. */
const QUOTA_ERROR = /quota|resource[_\s-]?exhausted|billing|payment required|retry[_\s-]?delay|maxdelayms|exhausted/i;
const CREDENTIAL_ERROR = /unauthorized|forbidden|invalid_grant|credential|api key/i;

/** The provider status carried by a thrown error, or 0. */
function statusOf(error) {
  for (const value of [error?.status, error?.statusCode, error?.code]) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 400) return status;
  }
  const match = /\b(401|402|403|429)\b/.exec(String(error?.message ?? error));
  return match ? Number(match[1]) : 0;
}

/**
 * Replace a thrown provider quota failure with one deterministic client
 * failure. A failure that is not an account-status reply returns undefined so
 * the caller can keep its normal error path.
 *
 * @param {unknown} error
 * @param {{report?: (event: string, detail: object) => void}} [options]
 * @returns {Response | undefined}
 */
export function sanitizeDirectError(error, { report = () => {} } = {}) {
  const status = statusOf(error);
  const text = String(error?.message ?? error);
  const quota = QUOTA_STATUS.has(status) || QUOTA_ERROR.test(text);
  const credential = status === 401 || status === 403 || CREDENTIAL_ERROR.test(text);
  if (!quota && !credential) return undefined;
  report("direct upstream quota error sanitized", { status });
  return Response.json(
    {
      error: {
        type: "lazy_router_unavailable",
        message: "no healthy candidate could serve this request",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/** Read at most MAX_SNIPPET_BYTES from a cloned body. */
async function readSnippet(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_SNIPPET_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, MAX_SNIPPET_BYTES - size);
      chunks.push(part);
      size += part.byteLength;
      if (part.byteLength < value.byteLength) break;
    }
  } catch {
    // A body that fails while inspected is treated as unreadable.
  }
  try {
    await reader.cancel();
  } catch {
    // The clone is already abandoned.
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Replace a provider quota body with one deterministic client failure.
 * Any other response passes through untouched.
 *
 * @param {Response} response the downstream gateway answer
 * @param {{report?: (event: string, detail: object) => void}} [options]
 * @returns {Promise<Response>}
 */
export async function sanitizeDirectResponse(response, { report = () => {} } = {}) {
  if (!(response instanceof Response)) return response;
  if (response.status === 200 && (response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return sanitizeDirectStream(response, { report });
  }
  if (!QUOTA_STATUS.has(response.status)) return response;

  let quota = response.status === 402;
  if (!quota) {
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream")) {
      // Inspect a clone so a non-quota response stays readable for the client.
      quota = quotaWording(await readSnippet(response.clone()));
    }
  }
  if (!quota) return response;

  response.body?.cancel().catch(() => {});
  report("direct upstream quota response sanitized", { status: response.status });
  return Response.json(
    {
      error: {
        type: "lazy_router_unavailable",
        message: "no healthy candidate could serve this request",
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/** Replay the prefix already read, then continue the untouched reader. */
function replay(prefix, reader, done) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of prefix) controller.enqueue(chunk);
      if (done) controller.close();
    },
    async pull(controller) {
      if (done) return;
      const next = await reader.read();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * A provider can answer 200 and only then stream an error event. Read the
 * prefix until the first visible or error event, so an account failure never
 * reaches the client as a successful response.
 */
async function sanitizeDirectStream(response, { report }) {
  const reader = response.body.getReader();
  const prefix = [];
  const decoder = new TextDecoder();
  let text = "";
  let done = false;
  try {
    let size = 0;
    while (size < MAX_SNIPPET_BYTES) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      prefix.push(next.value);
      size += next.value.byteLength;
      text += decoder.decode(next.value, { stream: true });
      const blocks = text.split("\n\n");
      if (blocks.length < 2) continue;
      for (const block of blocks.slice(0, -1)) {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed?.error) {
          const safe = sanitizeDirectError(new Error(parsed.error.message ?? ""), { report });
          if (safe) {
            await reader.cancel().catch(() => {});
            return safe;
          }
          continue;
        }
        const choice = parsed?.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content || delta?.tool_calls?.length || delta?.reasoning_content || delta?.reasoning) {
          return rebuildResponse(response, replay(prefix, reader, false), {
            headers: streamingHeaders(response.headers),
          });
        }
      }
    }
  } catch {
    // A failed inspection keeps the response readable through the prefix.
  }
  return rebuildResponse(response, replay(prefix, reader, done), {
    headers: streamingHeaders(response.headers),
  });
}
