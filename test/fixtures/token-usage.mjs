// Synthetic provider usage frames. No network and no credentials.

export const USAGE_SSE_FRAMES = [
  { message_start: { message: { usage: { input_tokens: 120, output_tokens: 0 } } } },
  { message_delta: { usage: { output_tokens: 30 } } },
  { message_delta: { usage: { input_tokens: 120, cache_read_input_tokens: 40, output_tokens: 40 } } },
];

export const USAGE_SSE_DUPLICATE = [
  { message_delta: { usage: { input_tokens: 120, output_tokens: 40 } } },
  { message_delta: { usage: { input_tokens: 120, output_tokens: 40 } } },
];

export const USAGE_JSON = {
  id: "msg_fixture",
  usage: { input_tokens: 120, cache_read_input_tokens: 40, output_tokens: 40 },
};

export const USAGE_OUTPUT_ONLY = { usage: { output_tokens: 7 } };
export const USAGE_EMPTY = { usage: {} };
export const USAGE_UNCACHED_ONLY = { usage: { input_tokens: 11 } };

/** An SSE body with the given payloads, `[DONE]` included when asked. */
export function sseBody(payloads, { done = true } = {}) {
  const body = payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");
  return `${body}${done ? "data: [DONE]\n\n" : ""}`;
}

/** A JSON response body. */
export function jsonBody(payload = USAGE_JSON) {
  return JSON.stringify(payload);
}

/** A large JSON body used to prove the tap keeps only a bounded tail. */
export function largeJsonBody(bytes = 80 * 1024) {
  const filler = "x".repeat(Math.max(0, bytes - 64));
  return `{"filler":"${filler}","usage":{"input_tokens":5,"output_tokens":6}}`;
}
