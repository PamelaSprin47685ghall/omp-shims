// ClinePass: pin chat/completions to fixed upstream channels.
//
// Cline has two routing pipelines behind one host, and each accepts a
// different spelling of the pin:
//
//   direct  (OpenRouter)   -> top-level `provider.only`
//   planner (Vercel AI GW) -> `providerOptions.gateway.only`
//
// Which pipeline a model uses is decided by Cline and can change. Both
// spellings are written, and Cline keeps the one it understands.
//
// The channel table and the default host, baseURL and upstream pin live in
// presets/cline.json. Configuration may override one model at a time through
// `modelChannels`. The code contains no model names. The configured baseURL
// supplies the exact origin and path prefix; the host is always compared by
// matchHttpsHost(), never by substring.
//
// Credentials come from CredentialRepository, so a re-login takes effect
// without a restart and the key never lives in the shim configuration.

import { matchHttpsHost, report } from "../lib/contracts.mjs";
import { CredentialRepository } from "../lib/credentials.mjs";
import {
  addFetchHandler,
  outboundPriority,
  readOutboundBodyText,
  requestBody,
  requestUrl,
  withRequestBody,
} from "../lib/outbound.mjs";
import clinePolicy from "../presets/cline.json" with { type: "json" };

export const name = "cline-pin-upstream";
export const phase = "outbound";

const KEY_CACHE_MS = 30_000;

/** Trim one trailing slash. */
function trimSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Resolve the origin and the chat path from config.
 * `baseURL` wins; `host` is the fallback for a bare host.
 */
function matchTarget(config) {
  const host = config.host || clinePolicy.host;
  const raw = config.baseURL || `https://${host}`;
  let base;
  try {
    base = new URL(raw);
  } catch {
    return undefined;
  }
  const prefix = trimSlash(base.pathname === "/" ? "" : base.pathname);
  const expectedPath = `${prefix}/chat/completions`;
  // Only the effective origin is trusted. A second hostname would widen the
  // set beyond what the configured baseURL says.
  const hosts = [base.hostname];
  const allowHttp = base.protocol === "http:";
  return { hosts, allowHttp, expectedPath };
}

/** True when the URL is the configured Cline chat endpoint. */
export function isClineChatUrl(url, target) {
  if (!target) return false;
  const { matched, url: parsed } = matchHttpsHost(url, target.hosts, { allowHttp: target.allowHttp });
  if (!matched || !parsed) return false;
  return parsed.pathname === target.expectedPath;
}

/** Normalize one channel entry to a non-empty string list. */
function channelList(entry) {
  if (typeof entry === "string") return entry === "" ? [] : [entry];
  if (Array.isArray(entry)) return entry.filter((value) => typeof value === "string" && value !== "");
  if (entry && typeof entry === "object" && Array.isArray(entry.only)) {
    return entry.only.filter((value) => typeof value === "string" && value !== "");
  }
  return [];
}

/** Rewrite one body with the channel pins. Return a new body or undefined. */
export function rewriteClineBody(bodyText, { modelChannels, defaultUpstream, modelFilter }) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  if (modelFilter.length > 0 && !modelFilter.includes(parsed.model)) return undefined;

  const model = typeof parsed.model === "string" ? parsed.model : "";
  const stripped = model.startsWith("cline-pass/") ? model.slice("cline-pass/".length) : model;
  const configured = modelChannels[model] ?? modelChannels[stripped];
  const only = configured === undefined ? channelList(defaultUpstream) : channelList(configured);
  if (only.length === 0) return undefined;

  // A pin the caller already set is more specific than ours.
  const callerOnly = parsed.provider?.only ?? parsed.providerOptions?.gateway?.only;
  if (!Array.isArray(callerOnly) || callerOnly.length === 0) {
    parsed.provider = { ...(parsed.provider ?? {}), only };
    parsed.providerOptions = {
      ...(parsed.providerOptions ?? {}),
      gateway: { ...(parsed.providerOptions?.gateway ?? {}), only },
    };
  }

  return JSON.stringify(parsed);
}

/**
 * Install the ClinePass layer.
 * @param {Record<string, any>} config the feature settings
 * @param {{ addFetchHandler?: Function, log?: Function }} context
 * @returns {() => void} a disposer
 */
export async function install(config, context = {}) {
  if (config?.enabled === false) return () => {};
  const add = context.addFetchHandler ?? addFetchHandler;
  const log = context.log ?? (() => {});
  const target = matchTarget(config);
  if (!target) {
    report("cline-pin-upstream: the configured baseURL is not a URL; the layer is off");
    return () => {};
  }

  const defaultUpstream = config.upstream || clinePolicy.upstream;
  const modelChannels = { ...clinePolicy.modelChannels, ...(config.modelChannels ?? {}) };
  const modelFilter = String(config.models || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const agentDbPath = context.paths?.agentDbPath;
  const repository = new CredentialRepository({ agentDbPath });

  let cachedKey;
  let cachedAt = 0;

  /** Read the ClinePass key once per short window. */
  async function apiKey() {
    if (typeof config.apiKey === "string" && config.apiKey !== "") return config.apiKey;
    if (config.apiKey && typeof config.apiKey === "object") {
      const key = repository.resolveTokenSpec(config.apiKey);
      if (typeof key === "string" && key !== "") return key;
    }

    if (Date.now() - cachedAt < KEY_CACHE_MS) return cachedKey;
    try {
      const accounts = await repository.listAccounts("cline-pass");
      const account = accounts.find((entry) => entry && entry.disabled !== true && entry.id !== undefined);
      const credential = account ? await repository.resolve("cline-pass", { id: account.id }) : undefined;
      const key = credential?.secret;
      cachedKey = typeof key === "string" && key.trim() !== "" ? key.trim() : undefined;
    } catch (error) {
      log(`cline-pin-upstream: cannot resolve the credential: ${error?.message ?? error}`);
      cachedKey = undefined;
    }
    cachedAt = Date.now();
    return cachedKey;
  }

  /** Rewrite a body and re-issue the call. A streamed body is always replayed. */
  async function rewriteAndForward(input, init, next) {
    const inline = requestBody(input, init);
    let original = inline;
    let replayed = false;
    if (original === undefined) {
      original = await readOutboundBodyText(input, init);
      if (original === undefined) return next(input, init);
      replayed = true;
    }

    const rewritten = rewriteClineBody(original, { modelChannels, defaultUpstream, modelFilter });
    if (rewritten === undefined && !replayed) return next(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // The rewritten body is plain JSON. Its old length and encoding are stale.
    headers.delete("content-length");
    headers.delete("content-encoding");
    if (!headers.has("Authorization")) {
      const key = await apiKey();
      if (key) headers.set("Authorization", `Bearer ${key}`);
    }
    if (!headers.has("HTTP-Referer")) headers.set("HTTP-Referer", "https://cline.bot");
    if (!headers.has("X-Title")) headers.set("X-Title", "Cline");

    const { target: targetUrl, init: nextInit } = withRequestBody(input, init, rewritten ?? original);
    nextInit.headers = headers;
    return next(targetUrl, nextInit);
  }

  const dispose = add(
    (input, init, next) => {
      const url = requestUrl(input);
      if (!isClineChatUrl(url, target)) return next(input, init);
      return rewriteAndForward(input, init, next);
    },
    { name: "cline-pin-upstream", priority: outboundPriority.clinePinUpstream },
  );

  return () => {
    try {
      if (typeof dispose === "function") dispose();
    } catch {}
    try {
      repository.close();
    } catch {}
  };
}
