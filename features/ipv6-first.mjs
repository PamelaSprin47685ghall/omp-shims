// IPv6-first outbound fetch.
//
// Resolve a hostname to its AAAA and A records. Try each literal address in
// order: every IPv6 address first, then every IPv4 address. The Host header
// and TLS SNI keep the original hostname, so the peer certificate and the
// response URL stay canonical.
//
// The layer passes through when the host has no global IPv6 address. It also
// passes through for localhost, loopback, 0.0.0.0, and IP literals.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { report } from "../lib/contracts.mjs";
import {
  preserveResponseUrl as keepResponseUrl,
  outboundPriority,
  addFetchHandler as registerFetchHandler,
} from "../lib/outbound.mjs";

export const name = "ipv6-first";
export const phase = "outbound";

const DEFAULT_TTL_MS = 60_000;
const MAX_HOST_CACHE = 512;

/** The live disposer. A second install returns it and registers nothing. */
let active = null;

/** Return a positive finite number, or undefined. */
function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/** Return the cache lifetime from config, or the default. */
function ttlFrom(config) {
  return positive(config?.ttlMs) ?? DEFAULT_TTL_MS;
}

/** Return one error message. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Remove a bracket pair from an IPv6 URL hostname. */
function unbracket(hostname) {
  if (hostname.startsWith("[") && hostname.endsWith("]")) return hostname.slice(1, -1);
  return hostname;
}

/** True for a link-local IPv6 address. */
function isLinkLocal(address) {
  return address.toLowerCase().startsWith("fe80:");
}

/** Return true when one interface has a global IPv6 address. */
function scanGlobalIPv6() {
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const iface of list ?? []) {
        if (iface.internal) continue;
        if (iface.family !== 6 && iface.family !== "IPv6") continue;
        if (isLinkLocal(iface.address)) continue;
        return true;
      }
    }
  } catch {
    // An unavailable interface table means no IPv6 route.
  }
  return false;
}

/** Cache the interface scan for the TTL. */
function interfaceProbe(ttlMs) {
  let expiresAt = 0;
  let found = false;
  return function hasGlobalIPv6() {
    const now = Date.now();
    if (now < expiresAt) return found;
    found = scanGlobalIPv6();
    expiresAt = now + ttlMs;
    return found;
  };
}

/** Accept family 4/6 or "IPv4"/"IPv6". */
function isFamily(family, number, text) {
  return family === number || family === text;
}

/** Cache the address records of one hostname for the TTL. */
function addressResolver(ttlMs) {
  const entries = new Map();
  return async function resolve(hostname) {
    const now = Date.now();
    const cached = entries.get(hostname);
    if (cached && cached.expiresAt > now) return cached;

    let records;
    try {
      records = await lookup(hostname, { all: true });
    } catch {
      return undefined;
    }

    const entry = { v6: [], v4: [], expiresAt: now + ttlMs };
    for (const record of records ?? []) {
      if (isFamily(record.family, 6, "IPv6")) entry.v6.push(record.address);
      else if (isFamily(record.family, 4, "IPv4")) entry.v4.push(record.address);
    }
    entries.set(hostname, entry);
    // Bound the cache. Expired hostnames go first, then the oldest hostname.
    if (entries.size > MAX_HOST_CACHE) {
      const cutoff = Date.now();
      for (const [key, value] of entries) {
        if (value.expiresAt <= cutoff) entries.delete(key);
      }
      while (entries.size > MAX_HOST_CACHE) {
        entries.delete(entries.keys().next().value);
      }
    }
    return entry;
  };
}

/** Parse the request URL and return the parts this layer needs. */
function parseTarget(input) {
  let url;
  try {
    if (typeof input === "string") url = new URL(input);
    else if (input instanceof URL) url = new URL(input.href);
    else if (input && typeof input === "object" && typeof input.url === "string") url = new URL(input.url);
    else return null;
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const hostname = unbracket(url.hostname).toLowerCase();
  if (hostname === "" || hostname === "localhost") return null;
  // A true IP literal and 0.0.0.0 resolve no name and need no rewrite.
  if (isIP(hostname) !== 0) return null;
  return { url, hostname };
}

/** Return the rewritten URL string for one address. */
function addressUrl(url, address) {
  const target = new URL(url.href);
  target.hostname = address.includes(":") ? `[${address}]` : address;
  return target.toString();
}

/** True for a method that never carries a body. */
function isBodyless(method) {
  const upper = String(method).toUpperCase();
  return upper === "GET" || upper === "HEAD";
}

/** True when the caller already aborted the request. */
function isAborted(input, init) {
  if (init?.signal?.aborted) return true;
  return Boolean(input && typeof input === "object" && input.signal?.aborted);
}

/**
 * Build the next() arguments for one address.
 *
 * The (Request, init) shape gets an explicit init. Spreading an init over a
 * Request would drop the body and downgrade the call to GET.
 */
function buildAttempt(input, init, parsed, address) {
  const targetUrl = addressUrl(parsed.url, address);
  const serverName = parsed.hostname;

  if (typeof input === "string" || input instanceof URL) {
    const headers = new Headers(init?.headers);
    headers.set("host", parsed.url.host);
    return {
      input: targetUrl,
      init: {
        ...init,
        headers,
        tls: { ...(init?.tls ?? {}), serverName },
      },
    };
  }

  const request = input;
  const method = init?.method ?? request.method;
  const headers = new Headers(init?.headers ?? request.headers);
  headers.set("host", parsed.url.host);

  // Clone the source request for each attempt, so a fallback still has a body.
  const substitutesBody = init?.body !== undefined;
  const body = substitutesBody ? init.body : request.clone().body;
  const outgoing = {
    method,
    headers,
    signal: init?.signal ?? request.signal,
    redirect: init?.redirect ?? request.redirect,
    duplex: init?.duplex ?? request.duplex,
    credentials: init?.credentials ?? request.credentials,
    mode: init?.mode ?? request.mode,
    cache: init?.cache ?? request.cache,
    tls: { ...(init?.tls ?? {}), serverName },
  };
  if (body !== undefined && body !== null && !isBodyless(method)) outgoing.body = body;
  if (substitutesBody) {
    // The init body replaces the request body. Headers that describe the old
    // bytes are stale, whether or not the new body is sent.
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
  }
  return { input: targetUrl, init: outgoing };
}

/** Build the fetch handler for one install. */
function createHandler({ resolve, hasGlobalIPv6, preserveResponseUrl }) {
  return async function ipv6First(input, init, next) {
    let parsed;
    let records;
    try {
      parsed = parseTarget(input);
      if (!parsed) return next(input, init);
      if (!hasGlobalIPv6()) return next(input, init);
      records = await resolve(parsed.hostname);
    } catch (error) {
      // A setup failure must not change the call. Report it and pass through.
      report("ipv6-first setup failed", { error: messageOf(error) });
      return next(input, init);
    }

    if (!records) return next(input, init);
    const candidates = [...records.v6, ...records.v4];
    if (candidates.length === 0) return next(input, init);

    let lastError;
    let reachedNetwork = false;

    for (const address of candidates) {
      let attempt;
      try {
        attempt = buildAttempt(input, init, parsed, address);
      } catch (error) {
        // An internal preparation failure is no network failure. Try the next
        // address, or pass through when no attempt reached the network.
        report("ipv6-first could not rewrite the request", { error: messageOf(error) });
        continue;
      }

      reachedNetwork = true;
      let response;
      try {
        response = await next(attempt.input, attempt.init);
      } catch (error) {
        lastError = error;
        if (isAborted(input, init)) throw error;
        continue;
      }

      // A failure after the response arrived must not retry the call.
      try {
        return preserveResponseUrl(response, parsed.url.href);
      } catch {
        return response;
      }
    }

    if (!reachedNetwork) return next(input, init);
    throw lastError ?? new Error(`ipv6-first found no reachable address for ${parsed.hostname}`);
  };
}

/** Install the handler. Return an idempotent disposer. */
export async function install(config, context) {
  if (config?.enabled === false) return;
  if (active) return active;

  const ttlMs = ttlFrom(config);
  const addHandler = context?.addFetchHandler ?? registerFetchHandler;
  const preserve = context?.preserveResponseUrl ?? keepResponseUrl;

  const handler = createHandler({
    resolve: addressResolver(ttlMs),
    hasGlobalIPv6: interfaceProbe(ttlMs),
    preserveResponseUrl: preserve,
  });

  const remove = addHandler(handler, { name, priority: outboundPriority.ipv6First });
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (active === dispose) active = null;
    remove();
  };

  active = dispose;
  return dispose;
}
