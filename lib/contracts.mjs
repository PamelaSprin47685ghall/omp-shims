// Shared contracts for every omp-shims module.
//
// This module has no project imports. Any module can load it without a cycle.
// It defines the values and helpers that all phases must share:
//   - the package version;
//   - the OMP no-auth marker;
//   - the install phases;
//   - the service process checks;
//   - the URL match rules;
//   - the request-scoped credential pin;
//   - the diagnostic writers.
//
// The module imports only "node:async_hooks".

import { AsyncLocalStorage } from "node:async_hooks";

/** The package version. Keep it equal to package.json. */
export const VERSION = "2.0.0";

/**
 * The credential marker for a keyless provider.
 * OMP defines the same value in packages/ai/src/auth-retry.ts.
 * A transport must not send this value in an authentication header.
 */
export const NO_AUTH_SENTINEL = "N/A";

/** The four phases of the shim install order. */
export const PHASES = Object.freeze({
  EDGE: "edge",
  OUTBOUND: "outbound",
  PROCESS: "process",
  BACKGROUND: "background",
});

/** The result of one service probe. */
export const PROBE_STATE = Object.freeze({
  ALIVE: "alive",
  DEAD: "dead",
  BUSY: "busy",
});

/** Cloud Code Assist host and streaming path. */
const CLOUD_CODE_HOST = "cloudcode-pa.googleapis.com";
const CLOUD_CODE_STREAM_PATH = "/v1internal:streamGenerateContent";

/** IPv4, bracketed IPv6, or bare IPv6. The URL parser keeps the brackets. */
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\]|[0-9a-f:]*:[0-9a-f:.]*)$/i;

/** Return argv as an array, so a caller can pass a malformed value. */
function commandArgs(argv) {
  return Array.isArray(argv) ? argv : [];
}

/** True when the gateway serves requests in this process. */
export function isGatewayProcess(argv = process.argv) {
  const args = commandArgs(argv);
  return args.includes("auth-gateway") && args.includes("serve");
}

/** True when the broker serves requests in this process. */
export function isBrokerProcess(argv = process.argv) {
  const args = commandArgs(argv);
  return args.includes("auth-broker") && args.includes("serve");
}

/** True when this process runs either long-lived service. */
export function isServiceProcess(argv = process.argv) {
  return isGatewayProcess(argv) || isBrokerProcess(argv);
}

/** Parse a URL string, URL object, or request-like object. Return null on failure. */
function parseUrl(value) {
  try {
    if (value instanceof URL) return value;
    if (typeof value === "string") return new URL(value);
    if (value && typeof value === "object" && typeof value.url === "string") return new URL(value.url);
  } catch {
    // A relative or malformed URL is not a match.
  }
  return null;
}

/** Iterate allowed hosts. Accept one string or any iterable of strings. */
function hostList(value) {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object" && Symbol.iterator in value) return [...value];
  return [];
}

/**
 * Normalize one allowed host entry.
 * A full URL entry keeps its hostname and tells if it also allows http.
 */
function normalizeHostEntry(entry) {
  const text = entry.trim().toLowerCase();
  if (text === "") return null;

  if (text.includes("://")) {
    try {
      const parsed = new URL(text);
      return { host: parsed.hostname, allowHttp: parsed.protocol === "http:" };
    } catch {
      return null;
    }
  }

  // A bracketed IPv6 host can contain a port after the closing bracket.
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end !== -1) return { host: text.slice(0, end + 1), allowHttp: false };
  }

  // Remove a port from a bare host.
  const colon = text.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(text.slice(colon + 1))) {
    return { host: text.slice(0, colon), allowHttp: false };
  }
  return { host: text, allowHttp: false };
}

/** Build a map of lowercase hostname to "also allows http". */
function allowedHostMap(allowedHosts) {
  const hosts = new Map();
  for (const entry of hostList(allowedHosts)) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeHostEntry(entry);
    if (!normalized?.host) continue;
    hosts.set(normalized.host, hosts.get(normalized.host) === true || normalized.allowHttp);
  }
  return hosts;
}

/**
 * Match an HTTPS URL against an exact set of hostnames.
 *
 * An http URL matches only when the caller passes `{ allowHttp: true }`, or
 * when the entry for the same hostname includes an explicit "http://" scheme.
 * The hostname comparison is exact and case-insensitive. It never uses a
 * substring match.
 *
 * @returns {{ matched: boolean, url: URL | null }}
 */
export function matchHttpsHost(urlInput, allowedHosts, { allowHttp = false } = {}) {
  const url = parseUrl(urlInput);
  if (!url) return { matched: false, url: null };

  const hosts = allowedHostMap(allowedHosts);
  const hostname = url.hostname.toLowerCase();
  const schemeAllowed =
    url.protocol === "https:" || (url.protocol === "http:" && (allowHttp || hosts.get(hostname) === true));
  if (!schemeAllowed || !hosts.has(hostname)) return { matched: false, url: null };
  return { matched: true, url };
}

/** Read the Host header from a request-like object, when it exists. */
function requestHostHeader(input) {
  try {
    if (input && typeof input === "object" && input.headers && typeof input.headers.get === "function") {
      return input.headers.get("host") ?? undefined;
    }
  } catch {
    // A missing or unreadable header is not a match signal.
  }
  return undefined;
}

/** Lowercase a Host header and remove its port. */
function normalizeHostHeader(value) {
  if (typeof value !== "string") return "";
  const text = value.trim().toLowerCase();
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end !== -1) return text.slice(0, end + 1);
  }
  const colon = text.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(text.slice(colon + 1))) return text.slice(0, colon);
  return text;
}

/**
 * True for a Cloud Code Assist streaming request.
 *
 * The path must contain the streaming RPC path. The hostname must equal
 * "cloudcode-pa.googleapis.com" or one hostname in `extraHosts`.
 * An IP literal is accepted only in two cases:
 *   - the caller passes `{ allowIpLiteral: true }`; or
 *   - the request Host header is "cloudcode-pa.googleapis.com".
 * The second case supports an IPv6-first rewrite that replaces the host with
 * an IP address.
 */
export function isCloudCodeStreamUrl(
  urlInput,
  extraHosts = [],
  { allowHttp = false, allowIpLiteral = false, hostHeader } = {},
) {
  const url = parseUrl(urlInput);
  if (!url) return false;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return false;
  if (!url.pathname.includes(CLOUD_CODE_STREAM_PATH)) return false;

  const hostname = url.hostname.toLowerCase();
  const hosts = allowedHostMap([CLOUD_CODE_HOST, ...hostList(extraHosts)]);
  if (hosts.has(hostname)) return true;
  if (!IP_LITERAL.test(hostname)) return false;

  const requestHost = normalizeHostHeader(hostHeader ?? requestHostHeader(urlInput));
  return allowIpLiteral === true || requestHost === CLOUD_CODE_HOST;
}

/** Restore the URL of a response that was rebuilt. Return the same response. */
export function preserveResponseUrl(response, url) {
  if (!response || typeof url !== "string" || url === "") return response;
  try {
    Object.defineProperty(response, "url", { value: url, configurable: true, enumerable: true });
  } catch {
    // A frozen response keeps its original URL.
  }
  return response;
}

/** Request-scoped storage for the credential pin. */
const pinStorage = new AsyncLocalStorage();

/**
 * Run `fn` with `pin` visible to every async call it starts.
 * The pin has this shape: { provider, credentialId, accountId, secret, email, tier }.
 */
export function withCredentialPin(pin, fn) {
  return pinStorage.run(pin, fn);
}

/**
 * Return the active pin.
 * With no argument, return the pin for the current request.
 * With a provider, return the pin only when its provider matches.
 */
export function activePin(provider) {
  const pin = pinStorage.getStore();
  if (!pin) return undefined;
  return !provider || pin.provider === provider ? pin : undefined;
}

/** Append a JSON detail when the value is truthy. Never throw on a bad value. */
function detailSuffix(detail) {
  if (!detail) return "";
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ` ${String(detail)}`;
  }
}

/** Write one diagnostic line to stderr. Never write to stdout. */
export function report(message, detail) {
  console.error(`[omp-shims] ${message}${detailSuffix(detail)}`);
}

/** Write one diagnostic line to stderr only when OMP_SHIMS_VERBOSE is "1". */
export function verboseLog(message, detail) {
  if (process.env.OMP_SHIMS_VERBOSE === "1") report(message, detail);
}
