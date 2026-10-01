// IPv6-first outbound fetch.
//
// Connects over IPv6 when the host publishes AAAA records and degrades to IPv4
// on failure. Preserves the canonical URL (Host header + TLS SNI are set from
// the original hostname) so upstream providers keep validating the certificate
// and the response keeps its hostname-form `url`.
//
// Env:
//   OMP_SHIMS_IPV6_TTL_MS   DNS cache TTL (default 60000)

const dns = require("node:dns/promises");

const IP_OR_LOCAL = /^(?:localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0|\[::1\])$/i;
const IP_LITERAL = /^[0-9.]+$|^\[?[0-9a-fA-F:]+\]?$/;

function urlOf(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input && typeof input === "object" && typeof input.url === "string" ? input.url : "";
}

export function install(config, { addFetchHandler, preserveResponseUrl }) {
  const ttlMs =
    Number.parseInt(process.env.OMP_SHIMS_IPV6_TTL_MS ?? String(config.ttlMs ?? 60_000), 10) || 60_000;
  const cache = new Map();

  async function resolve(hostname) {
    const now = Date.now();
    const cached = cache.get(hostname);
    if (cached && cached.expiresAt > now) return cached;

    let entry = null;
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      const v6 = [];
      const v4 = [];
      for (const address of addresses) {
        if (address.family === 6) v6.push(address.address);
        else if (address.family === 4) v4.push(address.address);
      }
      entry = { expiresAt: now + ttlMs, v6, v4 };
      cache.set(hostname, entry);
    } catch {
      entry = null;
    }
    return entry;
  }

  function withHostname(url, ip) {
    const target = new URL(url);
    target.hostname = ip.includes(":") ? (ip.startsWith("[") ? ip : `[${ip}]`) : ip;
    return target.toString();
  }

  return addFetchHandler(function (input, init, originalFetch) {
    const url = urlOf(input);
    if (!url.startsWith("http://") && !url.startsWith("https://")) return undefined;

    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return undefined;
    }
    if (IP_OR_LOCAL.test(hostname) || IP_LITERAL.test(hostname)) return undefined;

    const asRequestObject = !(typeof input === "string" || input instanceof URL);
    const upstream = this;

    return (async () => {
      const addresses = await resolve(hostname);
      if (!addresses || addresses.v6.length === 0) return originalFetch.call(upstream, input, init);

      const candidates = [...addresses.v6, ...addresses.v4];
      let lastError = null;

      for (let i = 0; i < candidates.length; i++) {
        const target = withHostname(url, candidates[i]);
        const isLast = i === candidates.length - 1;
        try {
          let response;
          if (asRequestObject && !init) {
            const request = new Request(target, input);
            request.headers.set("Host", hostname);
            response = await originalFetch.call(upstream, request, { tls: { serverName: hostname } });
          } else {
            const headers = init?.headers ? new Headers(init.headers) : new Headers();
            if (!headers.has("Host")) headers.set("Host", hostname);
            response = await originalFetch.call(upstream, target, {
              ...init,
              headers,
              tls: { ...(init?.tls ?? {}), serverName: hostname },
            });
          }
          // Bun drops `url` on responses we rebuild; keep the canonical hostname form.
          return preserveResponseUrl(response, url);
        } catch (error) {
          lastError = error;
          if (init?.signal?.aborted || input?.signal?.aborted) throw error;
          if (isLast) throw error;
        }
      }
      throw lastError ?? new Error(`Failed to connect to ${hostname}`);
    })();
  });
}