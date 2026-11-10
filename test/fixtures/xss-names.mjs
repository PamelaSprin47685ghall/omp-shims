// Hostile strings for the snapshot and SSR escaping tests.
//
// Every value is inert text. Nothing here executes; the tests only prove that
// the snapshot keeps it as data and that the page escapes it on the way out.

export const SCRIPT_TAG = "<script>alert('xss')</script>";
export const IMG_ONERROR = `"><img src=x onerror="alert(1)">`;
export const TEMPLATE_BREAK = "</template><script>alert('template')</script>";
export const SRCSET_BREAK = `'><svg/onload=alert(1)>`;
export const JAVASCRIPT_URL = "javascript:alert(document.cookie)";
export const DATA_URL = "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
export const PROTOCOL_RELATIVE_URL = "//evil.example/path";
export const QUOTE_BREAK = `" onmouseover="alert(1)`;
export const UNICODE_LINE_SEPARATOR = "线\u2028分隔\u2029行";
export const SURROGATE_PAIR = "emoji 😀 and CJK 状态页";
export const EMAIL = "operator@example.com";
export const CREDENTIAL = "sk-live-0123456789abcdef";
export const UPSTREAM_URL = "https://upstream.example/v1/messages?key=secret";
export const CONTROL_CHARS = "冷却\u0000原因\u0007\n带\t控制符";
export const LONG_REASON = `429 ${"限流".repeat(90)}`;
export const SAFE_SOURCE_URL = "https://example.com/official-pricing";

/** Reasons that must never reach HTML, JSON, or logs verbatim. */
export const HOSTILE_REASONS = [
  SCRIPT_TAG,
  IMG_ONERROR,
  TEMPLATE_BREAK,
  `${EMAIL} 触发 ${CREDENTIAL} 的 ${UPSTREAM_URL}`,
  CONTROL_CHARS,
  QUOTE_BREAK,
  LONG_REASON,
];

/** Labels and model names used in one mixed fixture. */
export const HOSTILE_LABELS = [SCRIPT_TAG, IMG_ONERROR, TEMPLATE_BREAK, UNICODE_LINE_SEPARATOR];

/** Field names a local model fixture may carry that must not appear in a snapshot. */
export const RAW_IDENTITY_KEYS = [
  "accountId",
  "account_id",
  "unitKey",
  "unit_key",
  "health.key",
  "digest",
  "credential",
  "apiKey",
  "e-mail",
];
