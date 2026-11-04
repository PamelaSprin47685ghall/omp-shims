// `@earendil-works/pi-ai` compatibility shim, installed into the plugins
// workspace by omp-shims.
//
// pi provider plugins declare this as an optional peer dependency, expecting the
// host to provide it. Oh My Pi ships its own pi-ai under a different name, so
// the import fails and the plugin cannot load at all. This package supplies the
// surface those plugins use and routes streaming to the transport the plugin
// registered with OMP, so the provider's own code and OMP's own pipeline do all
// the real work.
//
// Installed as a real package (see ../install.js) rather than hand-edited into
// node_modules, so it is recreated after `omp plugin update`.

const transports = new Map();

/**
 * The host's own streamSimple, installed by the host-compatibility feature.
 *
 * Plugins written for pi import `streamSimple` for the provider's *standard*
 * apis (openai-completions, anthropic-messages, ...), which the host implements.
 * Delegating those here keeps the plugin on the host's pipeline instead of a
 * reimplementation, and leaves provider-specific apis to the plugin's transport.
 */
let hostStream = null;

export function setHostStream(fn) {
  hostStream = typeof fn === "function" ? fn : null;
}

export function registerTransport(api, streamSimple) {
  if (typeof api === "string" && typeof streamSimple === "function") transports.set(api, streamSimple);
}

export function hasTransport(api) {
  return transports.has(api);
}

export class EventStream {
  constructor(isCompleteFn = (event) => event?.type === "done" || event?.type === "error") {
    this.queue = [];
    this.waiting = [];
    this.done = false;
    this.error = undefined;
    this.isComplete = isCompleteFn;
    this.#final = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    this.#final.catch(() => {});
  }

  #final;
  #resolve;
  #reject;

  push(event) {
    if (this.done) return;
    if (this.isComplete(event)) {
      this.done = true;
      if (event.type === "error") this.#reject(event.error);
      else this.#resolve(event.message);
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.queue.push(event);
  }

  end() {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ value: undefined, done: true });
  }

  fail(error) {
    this.error = error;
    this.#reject(error);
    this.end();
  }

  result() {
    return this.#final;
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.queue.length > 0) {
        yield this.queue.shift();
        continue;
      }
      if (this.error !== undefined) throw this.error;
      if (this.done) return;
      const next = await new Promise((resolve) => this.waiting.push({ resolve }));
      if (next.done) return;
      yield next.value;
    }
  }
}

export class AssistantMessageEventStream extends EventStream {}

export function createAssistantMessageEventStream() {
  return new AssistantMessageEventStream();
}

export function calculateCost() {
  return 0;
}

export function clampThinkingLevel(model, level) {
  if (!level || level === "off") return "off";
  const map = model?.thinkingLevelMap;
  if (map && map[level] !== undefined && map[level] !== null) return level;
  const efforts = model?.thinking?.efforts;
  if (Array.isArray(efforts) && efforts.includes(level)) return level;
  return model?.thinking?.defaultLevel ?? "medium";
}

const HOST_APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

/**
 * Wire path each standard api appends to the model's baseUrl, for the plan
 * probe below.
 */
const PROBE_PATHS = Object.freeze({
  "openai-responses": "/responses",
  "openai-completions": "/chat/completions",
});

/**
 * Ask the provider API whether this account may use it at all.
 *
 * Command Code answers 403 `upgrade_required` for plans without API access.
 * The provider's own transport watches the outbound call for exactly that
 * answer and then serves the same request through `/alpha/generate`, which
 * every plan allows. When the host has no stream for a standard api (the
 * gateway bundle exports none), that call never happens, so the fallback never
 * fires and the request dies. This probe issues one minimal call through the
 * transport's own fetch, so the transport makes the same decision it would
 * have made with a host-supplied stream.
 *
 * @returns {Promise<"upgraded"|"unavailable">} upgraded: the transport has
 *   switched to generate; unavailable: no fallback is coming.
 */
async function probeProviderApi(model, options) {
  const path = PROBE_PATHS[model?.api];
  const baseUrl = typeof model?.baseUrl === "string" ? model.baseUrl.replace(/\/+$/, "") : "";
  if (!path || !baseUrl) return "unavailable";
  const fetchImpl = options?.fetch ?? fetch;
  const headers = { "content-type": "application/json" };
  if (options?.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
  const body = { model: model.id, max_output_tokens: 1 };
  body[model.api === "openai-responses" ? "input" : "messages"] =
    model.api === "openai-responses" ? "ping" : [{ role: "user", content: "ping" }];
  let response;
  try {
    response = await fetchImpl(baseUrl + path, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    return "unavailable";
  }
  try {
    await response.body?.cancel();
  } catch {}
  return response.status === 403 ? "upgraded" : "unavailable";
}

/** Host streamSimple, wired early or resolved from the capture the moment a standard api is used. */
function hostStreamNow() {
  if (hostStream) return hostStream;
  const host = globalThis.__OMP_SHIMS_HOST__;
  const captured = host?.captured?.get("streamSimple") ?? host?.resolve?.("streamSimple");
  if (typeof captured === "function") {
    hostStream = captured;
    return hostStream;
  }
  return null;
}

export function streamSimple(model, context, options) {
  const transport = model?.api ? transports.get(model.api) : undefined;
  if (transport) return transport(model, context, options);
  const host = hostStreamNow();
  if (host) return host(model, context, options);

  // No host stream: give the provider's transport the plan answer it needs to
  // fall back, then end quietly so it can serve the request itself.
  if (PROBE_PATHS[model?.api]) {
    const stream = createAssistantMessageEventStream();
    probeProviderApi(model, options).then((answer) => {
      if (answer === "unavailable") {
        stream.push({
          type: "error",
          reason: "error",
          error: new Error(
            `No transport registered for api "${model?.api ?? "unknown"}". The provider plugin must be loaded before streaming.`,
          ),
        });
        return;
      }
      stream.end();
    });
    return stream;
  }

  const stream = createAssistantMessageEventStream();
  queueMicrotask(() =>
    stream.push({
      type: "error",
      reason: "error",
      error: new Error(
        `No transport registered for api "${model?.api ?? "unknown"}". The provider plugin must be loaded before streaming.`,
      ),
    }),
  );
  return stream;
}
