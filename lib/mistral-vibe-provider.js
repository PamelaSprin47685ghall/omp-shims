// Mistral Vibe browser sign-in provider for OMP.
//
// Mistral Vibe's browser flow is PKCE-based, but its final exchange returns a
// normal long-lived Mistral API key. We keep that key in OMP's credential store
// and use the standard Mistral OpenAI-compatible chat endpoint for inference.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { posix } from "node:path";
import { requestBody, requestUrl, withRequestBody } from "./fetch-chain.js";

export const MISTRAL_VIBE_PROVIDER_ID = "mistral-vibe";
export const MISTRAL_VIBE_MODEL_ID = "mistral-vibe-cli-latest";
export const MISTRAL_VIBE_BROWSER_BASE = "https://console.mistral.ai";
export const MISTRAL_VIBE_AUTH_API_BASE = "https://console.mistral.ai/api";
export const MISTRAL_VIBE_API_BASE = "https://api.mistral.ai/v1";

const POLL_INTERVAL_MS = 3_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const MAX_POLL_RATE_LIMIT_BACKOFF_MS = 30_000;
const STATIC_KEY_EXPIRY = Date.UTC(9999, 11, 31, 23, 59, 59);
const WORKSPACE_API_KEY_DENIED = 9_004;

/**
 * Mistral's current chat stream can encode visible reasoning as structured
 * content blocks instead of OpenAI-compatible reasoning_content deltas:
 *
 *   content: [{ type: "thinking", thinking: [{ type: "text", text: "..." }] }]
 *
 * OMP's stock openai-completions transport already understands
 * reasoning_content, reasoning and reasoning_text, so normalize only this
 * Mistral-specific wire shape at the fetch boundary rather than forking the
 * transport. Unknown content block types are left untouched.
 */
function normalizeMistralMessage(delta) {
  if (!delta || !Array.isArray(delta.content)) return delta;

  let thinking = "";
  let content = "";
  for (const block of delta.content) {
    if (!block || typeof block !== "object") return delta;
    if (block.type === "thinking" && Array.isArray(block.thinking)) {
      for (const part of block.thinking) {
        if (part?.type === "text" && typeof part.text === "string") thinking += part.text;
        else if (part != null) return delta;
      }
      continue;
    }
    if (block.type === "text" && typeof block.text === "string") {
      content += block.text;
      continue;
    }
    return delta;
  }

  const normalized = { ...delta, content };
  if (
    thinking &&
    typeof delta.reasoning_content !== "string" &&
    typeof delta.reasoning !== "string" &&
    typeof delta.reasoning_text !== "string"
  ) {
    normalized.reasoning_content = thinking;
  }
  return normalized;
}

export function normalizeMistralVibeSse(text) {
  if (typeof text !== "string" || !text.includes("data:")) return text;
  return text.replace(/^(\s*data:\s*)(\{.*\})(\r?)$/gm, (line, prefix, payload, carriage) => {
    try {
      const event = JSON.parse(payload);
      if (!Array.isArray(event?.choices)) return line;
      let changed = false;
      const choices = event.choices.map((choice) => {
        if (!choice?.delta || !Array.isArray(choice.delta.content)) return choice;
        const delta = normalizeMistralMessage(choice.delta);
        if (delta === choice.delta) return choice;
        changed = true;
        return { ...choice, delta };
      });
      return changed ? prefix + JSON.stringify({ ...event, choices }) + carriage : line;
    } catch {
      return line;
    }
  });
}

function isMistralChatCompletion(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.hostname === "api.mistral.ai" || parsed.hostname.endsWith(".mistral.ai")) &&
      /\/v1\/chat\/completions\/?$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function rebuildResponse(response, body, url, preserveResponseUrl) {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  const wrapped = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return preserveResponseUrl?.(wrapped, response.url || url) ?? wrapped;
}

function normalizeMistralJsonBody(body) {
  if (!body || !Array.isArray(body.choices)) return body;
  let changed = false;
  const choices = body.choices.map((choice) => {
    if (!choice?.message || !Array.isArray(choice.message.content)) return choice;
    const message = normalizeMistralMessage(choice.message);
    if (message === choice.message) return choice;
    changed = true;
    return { ...choice, message };
  });
  return changed ? { ...body, choices } : body;
}

async function normalizeMistralResponse(response, url, preserveResponseUrl) {
  if (!response?.body) return response;
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const stream = new TransformStream({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const lastBreak = pending.lastIndexOf("\n");
        if (lastBreak === -1) return;
        const head = pending.slice(0, lastBreak + 1);
        pending = pending.slice(lastBreak + 1);
        controller.enqueue(encoder.encode(normalizeMistralVibeSse(head)));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(normalizeMistralVibeSse(pending)));
      },
    });
    return rebuildResponse(response, response.body.pipeThrough(stream), url, preserveResponseUrl);
  }

  if (!contentType.includes("application/json")) return response;
  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  const normalized = normalizeMistralJsonBody(payload);
  if (normalized === payload) return response;
  return rebuildResponse(response, JSON.stringify(normalized), url, preserveResponseUrl);
}

// Keep the derived key opaque: no prompt text or account credential is sent
// as a cache key. A process-local secret also prevents guessing short prompts
// from the digest. New processes start with cold cache affinity by design.
const cacheKeySecret = randomBytes(32);

/** Build one cache-routing key from the unchanged start of a conversation. */
export function mistralPromptCacheKey(body) {
  if (!body || typeof body.model !== "string" || !Array.isArray(body.messages)) return undefined;
  if (body.messages.length === 0) return undefined;
  const firstUser = body.messages.findIndex((message) => message?.role === "user");
  const first = body.messages.slice(0, firstUser < 0 ? 1 : firstUser + 1);
  if (!first.every((message) => message && typeof message.role === "string")) return undefined;
  const hmac = createHmac("sha256", cacheKeySecret);
  hmac.update(body.model);
  hmac.update("\0");
  hmac.update(JSON.stringify(first));
  if (Array.isArray(body.tools)) {
    hmac.update("\0");
    hmac.update(JSON.stringify(body.tools));
  }
  return "omp-" + hmac.digest("base64url");
}

/** Preserve caller-supplied keys and otherwise add a stable opaque key. */
export function addMistralPromptCacheKey(text) {
  let body;
  try { body = JSON.parse(text); } catch { return undefined; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  if (Object.hasOwn(body, "prompt_cache_key")) return undefined;
  const prompt_cache_key = mistralPromptCacheKey(body);
  if (!prompt_cache_key) return undefined;
  return JSON.stringify({ ...body, prompt_cache_key });
}

/**
 * Official Vibe replays assistant reasoning as Mistral thinking chunks.
 * The OpenAI completion transport exposes that history as reasoning_content,
 * so translate it back before forwarding another turn to the Mistral API.
 */
export function replayMistralThinking(messages, { reasoningEffort } = {}) {
  if (!Array.isArray(messages)) return undefined;
  if (reasoningEffort === "none") return undefined;
  let modified = false;
  const mapped = messages.map((message) => {
    if (message?.role !== "assistant" || !message || typeof message !== "object") return message;
    const reason = [message.reasoning_content, message.reasoning, message.reasoning_text]
      .find((value) => typeof value === "string" && value.length > 0);
    if (!reason) return message;
    // An already native thinking chunk wins. Never repeat the same reasoning.
    if (Array.isArray(message.content) &&
      message.content.some((part) => part?.type === "thinking")) {
      const { reasoning_content, reasoning, reasoning_text, ...rest } = message;
      modified = true;
      return rest;
    }
    if (message.content != null && typeof message.content !== "string") return message;
    const chunks = [{ type: "thinking", thinking: [{ type: "text", text: reason }] }];
    if (message.content) chunks.push({ type: "text", text: message.content });
    const { reasoning_content, reasoning, reasoning_text, ...rest } = message;
    modified = true;
    return { ...rest, content: chunks };
  });
  return modified ? mapped : undefined;
}

/** Translate the request to Mistral's native content union, then set cache key. */
export function normalizeMistralRequestBody(text) {
  let body;
  try { body = JSON.parse(text); } catch { return undefined; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const messages = replayMistralThinking(body.messages, { reasoningEffort: body.reasoning_effort });
  const cacheKey = !Object.hasOwn(body, "prompt_cache_key") ? mistralPromptCacheKey(body) : undefined;
  if (!messages && !cacheKey) return undefined;
  return JSON.stringify({
    ...body,
    ...(messages ? { messages } : {}),
    ...(cacheKey ? { prompt_cache_key: cacheKey } : {}),
  });
}

function sendMistralRequest(input, init, next) {
  const body = requestBody(input, init);
  if (body !== undefined) {
    const updated = normalizeMistralRequestBody(body);
    if (updated === undefined) return next(input, init);
    const forwarded = withRequestBody(input, init, updated);
    const headers = new Headers(forwarded.init.headers);
    headers.delete("content-length");
    if (input instanceof Request) {
      return next(new Request(input, { ...init, headers, body: updated }));
    }
    return next(forwarded.target, { ...forwarded.init, headers });
  }
  // The transport can also call fetch(Request). Read only a clone, so a
  // parse failure leaves the original request available to the network.
  if (!(input instanceof Request) || init?.body != null || input.bodyUsed) return next(input, init);
  return input.clone().text().then(
    (text) => {
      const updated = normalizeMistralRequestBody(text);
      if (updated === undefined) return next(input, init);
      const headers = new Headers(init?.headers ?? input.headers);
      headers.delete("content-length");
      return next(new Request(input, { ...init, headers, body: updated }));
    },
    () => next(input, init),
  );
}

export function installMistralVibeResponseAdapter(context) {
  if (typeof context?.addFetchHandler !== "function") return;
  context.addFetchHandler((input, init, next) => {
    const url = requestUrl(input);
    if (!isMistralChatCompletion(url)) return next(input, init);
    return Promise.resolve(sendMistralRequest(input, init, next)).then((response) =>
      normalizeMistralResponse(response, url, context.preserveResponseUrl),
    );
  });
}

const digest = (text) => createHash("sha256").update(text).digest("hex");
const challengeOf = (verifier) => createHash("sha256").update(verifier, "ascii").digest("base64url");

function signalOf(callbacks) {
  return callbacks?.signal ?? callbacks?.abortSignal;
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error("Login cancelled");
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    // Keep the timer referenced: during `omp login` this poll sleep may be the
    // only live event-loop handle. Unref would let Bun exit before auth completes.
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.("abort", cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener?.("abort", cancelled, { once: true });
  });
}

function pollRateLimitDelayMs(response, streak, nowMs) {
  const exponential = Math.min(
    MAX_POLL_RATE_LIMIT_BACKOFF_MS,
    POLL_INTERVAL_MS * (2 ** Math.min(Math.max(1, streak), 4)),
  );
  let retryAfterMs = 0;
  const retryAfter = response.headers?.get?.("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1_000);
    else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) retryAfterMs = Math.max(0, retryAt - nowMs);
    }
  }
  return Math.min(
    MAX_POLL_RATE_LIMIT_BACKOFF_MS,
    Math.max(POLL_INTERVAL_MS, exponential, retryAfterMs),
  );
}

async function json(response, purpose) {
  if (!response.ok) throw new Error(`Mistral Vibe ${purpose} failed (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Mistral Vibe ${purpose} returned invalid JSON`);
  }
}

function validateReturnedUrl(value, base, purpose) {
  let url;
  let expected;
  try {
    url = new URL(value);
    expected = new URL(base);
  } catch {
    throw new Error(`Mistral Vibe ${purpose} returned an invalid URL`);
  }
  if (url.username || url.password || url.protocol !== "https:" || url.origin !== expected.origin) {
    throw new Error(`Mistral Vibe ${purpose} returned an untrusted URL`);
  }
  let path;
  let basePath;
  try {
    path = posix.normalize(decodeURIComponent(url.pathname || "/"));
    basePath = posix.normalize(decodeURIComponent(expected.pathname || "/")).replace(/\/$/, "");
  } catch {
    throw new Error(`Mistral Vibe ${purpose} returned an invalid URL`);
  }
  if (basePath && basePath !== "." && basePath !== "/" && path !== basePath && !path.startsWith(`${basePath}/`)) {
    throw new Error(`Mistral Vibe ${purpose} returned a URL outside the expected path`);
  }
  return url.toString();
}

function sanitizeTenantApiBase(value) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.host || url.username || url.password) return undefined;
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.split("/").includes("..")) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}/v1`;
  } catch {
    return undefined;
  }
}

async function whoAmI(apiKey, fetchImpl, signal) {
  try {
    const response = await fetchImpl(`${MISTRAL_VIBE_BROWSER_BASE}/api/vibe/whoami`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal,
    });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body && typeof body === "object" ? body : undefined;
  } catch {
    return undefined;
  }
}

/** Execute Vibe's browser sign-in and return an OMP OAuth-shaped credential. */
export async function loginMistralVibe(callbacks = {}, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const verifier = options.verifier ?? randomBytes(64).toString("base64url");
  const signal = signalOf(callbacks);
  const challenge = challengeOf(verifier);

  callbacks.onProgress?.("Starting Mistral Vibe browser sign-in…");
  const startResponse = await fetchImpl(`${MISTRAL_VIBE_AUTH_API_BASE}/vibe/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code_challenge: challenge, code_challenge_method: "S256" }),
    signal,
  });
  const start = await json(startResponse, "sign-in start");
  if (typeof start.process_id !== "string" || typeof start.sign_in_url !== "string" || typeof start.poll_url !== "string") {
    throw new Error("Mistral Vibe sign-in start returned an incomplete payload");
  }
  const signInUrl = validateReturnedUrl(start.sign_in_url, MISTRAL_VIBE_BROWSER_BASE, "sign-in start");
  const pollUrl = validateReturnedUrl(start.poll_url, MISTRAL_VIBE_AUTH_API_BASE, "sign-in start");
  const expiresAt = Date.parse(start.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error("Mistral Vibe sign-in attempt is already expired");

  callbacks.onAuth?.({
    url: signInUrl,
    instructions: "Open this URL and sign in with your Mistral account. OMP will continue automatically after approval.",
  });
  callbacks.onProgress?.("Waiting for browser sign-in…");

  let exchangeToken;
  let consecutivePollFailures = 0;
  let pollRateLimitStreak = 0;
  while (now() < expiresAt) {
    if (signal?.aborted) throw abortError(signal);
    let response;
    try {
      response = await fetchImpl(pollUrl, { headers: { accept: "application/json" }, signal });
    } catch (error) {
      if (signal?.aborted) throw abortError(signal);
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw new Error("Mistral Vibe sign-in polling failed repeatedly");
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, expiresAt - now())), signal);
      continue;
    }
    if (response.status === 410) throw new Error("Mistral Vibe browser sign-in expired");
    if (response.status === 429) {
      pollRateLimitStreak += 1;
      const remaining = Math.max(0, expiresAt - now());
      const retryDelay = pollRateLimitDelayMs(response, pollRateLimitStreak, now());
      callbacks.onProgress?.("Mistral Vibe sign-in is rate limited; retrying with backoff…");
      await sleep(Math.min(retryDelay, remaining), signal);
      continue;
    }
    pollRateLimitStreak = 0;
    if (!response.ok) {
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw new Error(`Mistral Vibe sign-in polling failed repeatedly (HTTP ${response.status})`);
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, expiresAt - now())), signal);
      continue;
    }
    consecutivePollFailures = 0;
    const state = await response.json();
    if (state.status === "completed") {
      if (typeof state.exchange_token !== "string" || !state.exchange_token) throw new Error("Mistral Vibe sign-in completed without an exchange token");
      exchangeToken = state.exchange_token;
      break;
    }
    if (state.status === "expired") throw new Error("Mistral Vibe browser sign-in expired");
    if (state.status === "denied") throw new Error("Mistral Vibe browser sign-in was denied");
    if (state.status === "error") throw new Error(typeof state.message === "string" && state.message ? state.message : "Mistral Vibe browser sign-in failed");
    if (state.status !== "pending") throw new Error("Mistral Vibe browser sign-in returned an unknown state");
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, expiresAt - now())), signal);
  }
  if (!exchangeToken) throw new Error("Mistral Vibe browser sign-in timed out");

  callbacks.onProgress?.("Exchanging sign-in for a Mistral API key…");
  const exchangeResponse = await fetchImpl(`${MISTRAL_VIBE_AUTH_API_BASE}/vibe/sign-in/${encodeURIComponent(start.process_id)}/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ exchange_token: exchangeToken, code_verifier: verifier }),
    signal,
  });
  if (exchangeResponse.status === 403) {
    let body;
    try { body = await exchangeResponse.json(); } catch {}
    if (body?.error_code === WORKSPACE_API_KEY_DENIED) {
      throw new Error("This Mistral workspace cannot create a Vibe API key. Sign in again and select another workspace, or contact your administrator.");
    }
  }
  const exchanged = await json(exchangeResponse, "sign-in exchange");
  if (typeof exchanged.api_key !== "string" || !exchanged.api_key) throw new Error("Mistral Vibe sign-in exchange returned no API key");

  const profile = await whoAmI(exchanged.api_key, fetchImpl, signal);
  const apiEndpoint = sanitizeTenantApiBase(profile?.api_base) ?? MISTRAL_VIBE_API_BASE;
  const stableId = typeof profile?.customer_id === "string" && profile.customer_id
    ? `customer-${profile.customer_id}`
    : `key-${digest(exchanged.api_key).slice(0, 24)}`;
  callbacks.onProgress?.("Mistral Vibe login successful.");
  return {
    access: exchanged.api_key,
    refresh: "static-api-key",
    expires: STATIC_KEY_EXPIRY,
    accountId: `${MISTRAL_VIBE_PROVIDER_ID}:${stableId}`,
    apiEndpoint,
  };
}

function refreshStaticCredential(credential) {
  return Promise.resolve({ ...credential, expires: STATIC_KEY_EXPIRY });
}

function thinkingForModel(id) {
  if (/^zai-glm-5-3(?:$|-)/.test(id)) {
    return { mode: "effort", efforts: ["low", "high", "max"], defaultLevel: "high", requiresEffort: true };
  }
  if (id === MISTRAL_VIBE_MODEL_ID || /^(?:mistral-medium-(?:latest|3-5)|mistral-small-latest|mistral-large-4(?:-0)?)$/.test(id)) {
    return { mode: "effort", efforts: ["none", "high"], defaultLevel: "high", requiresEffort: false };
  }
  return undefined;
}

function staticVibeModel() {
  return {
    id: MISTRAL_VIBE_MODEL_ID,
    name: "Mistral Medium 3.5 (Vibe)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262_144,
    maxTokens: 64_000,
    thinking: thinkingForModel(MISTRAL_VIBE_MODEL_ID),
  };
}

function modelFromCard(card) {
  if (!card || typeof card !== "object" || typeof card.id !== "string" || !card.id || card.archived === true) return undefined;
  if (card.capabilities?.completion_chat !== true) return undefined;
  const contextWindow = Number(card.max_context_length);
  const thinking = thinkingForModel(card.id);
  return {
    id: card.id,
    name: typeof card.name === "string" && card.name ? card.name : card.id,
    reasoning: Boolean(thinking),
    input: card.capabilities?.vision === true ? ["text", "image"] : ["text"],
    ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
    ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { maxTokens: Math.min(64_000, Math.max(4_096, Math.floor(contextWindow / 4))) } : { maxTokens: 32_000 }),
    ...(thinking ? { thinking } : {}),
  };
}

export async function fetchMistralVibeModels(apiKey, options = {}) {
  const fallback = [staticVibeModel()];
  if (typeof apiKey !== "string" || !apiKey || apiKey.startsWith("$")) return fallback;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const signal = options.signal;
  const profile = await whoAmI(apiKey, fetchImpl, signal);
  const apiBase = sanitizeTenantApiBase(profile?.api_base) ?? MISTRAL_VIBE_API_BASE;
  try {
    const response = await fetchImpl(apiBase + "/models", {
      headers: { authorization: "Bearer " + apiKey, accept: "application/json" },
      signal,
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const cards = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const seen = new Set([MISTRAL_VIBE_MODEL_ID]);
    const models = [...fallback];
    for (const card of cards) {
      const model = modelFromCard(card);
      if (!model || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
    return models;
  } catch {
    return fallback;
  }
}

function modelsForCredential(models, credential) {
  const baseUrl = sanitizeTenantApiBase(credential?.apiEndpoint?.replace(/\/v1\/?$/, "")) ?? credential?.apiEndpoint ?? MISTRAL_VIBE_API_BASE;
  return models.map((model) => model.provider === MISTRAL_VIBE_PROVIDER_ID ? { ...model, baseUrl } : model);
}

/** Fresh provider config: the host may mutate registered model objects. */
export function mistralVibeProviderConfig() {
  return {
    baseUrl: MISTRAL_VIBE_API_BASE,
    api: "openai-completions",
    models: [staticVibeModel()],
    fetchDynamicModels: fetchMistralVibeModels,
    oauth: {
      name: "Mistral Vibe (browser sign-in)",
      login: loginMistralVibe,
      refreshToken: refreshStaticCredential,
      getApiKey: (credential) => credential?.access,
      modifyModels: modelsForCredential,
    },
  };
}
