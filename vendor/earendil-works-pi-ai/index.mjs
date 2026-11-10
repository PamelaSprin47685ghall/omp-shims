// `@earendil-works/pi-ai` compatibility shim.
//
// pi provider plugins declare this package as an optional peer dependency and
// expect the host to supply it. Oh My Pi ships its own pi-ai under another
// name, so the import cannot resolve without this package. The shim supplies
// the small surface those plugins use and routes streaming to the transport the
// plugin registered with the host, so the provider's own code and OMP's own
// pipeline do the real work.
//
// `EventStream.end()` is a contract, not a courtesy: every call settles
// `result()`. A stream that ends without a final message rejects with a clear
// error instead of leaving an awaiting caller suspended forever.

const transports = new Map();

/**
 * The host's own streamSimple.
 *
 * Plugins import `streamSimple` for the provider's standard apis
 * (openai-completions, anthropic-messages, ...), which the host implements.
 * Delegating those here keeps the plugin on the host pipeline instead of a
 * reimplementation. Provider-specific apis stay with the plugin's transport.
 */
let hostStream = null;

export function setHostStream(fn) {
  hostStream = typeof fn === "function" ? fn : null;
}

export function registerTransport(api, streamSimple) {
  if (typeof api === "string" && api !== "" && typeof streamSimple === "function") {
    transports.set(api, streamSimple);
  }
}

export function hasTransport(api) {
  return transports.has(api);
}

/** The default completion test. A `done` or `error` event is terminal. */
function defaultIsComplete(event) {
  return event?.type === "done" || event?.type === "error";
}

/** The final message carried by a terminal event. */
function defaultExtractResult(event) {
  // OMP resolves both terminal events: `done` carries message, `error` carries
  // the failed AssistantMessage. Only fail() and a result-less end() reject.
  if (event?.type === "error") return event.error;
  return event?.message;
}

/** One error shared by every end() without a result. */
function endedWithoutResult() {
  return new Error("Stream ended without a final result");
}

export class EventStream {
  /**
   * @param {(event: any) => boolean} [isComplete]
   * @param {(event: any) => any} [extractResult]
   */
  constructor(isComplete = defaultIsComplete, extractResult = defaultExtractResult) {
    /** Events pushed while no consumer was waiting. */
    this.queue = [];
    /** Consumers waiting for the next event. */
    this.waiting = [];
    this.done = false;
    this.resultSettled = false;
    this.#failed = false;
    this.#error = undefined;
    this.isComplete = typeof isComplete === "function" ? isComplete : defaultIsComplete;
    this.extractResult = typeof extractResult === "function" ? extractResult : defaultExtractResult;

    const { promise, resolve, reject } = Promise.withResolvers();
    // An unobserved rejection from fail() must not crash the process. A caller
    // that awaits result() still receives the rejection.
    promise.catch(() => {});
    this.#final = promise;
    this.#resolve = resolve;
    this.#reject = reject;
  }

  #final;
  #resolve;
  #reject;
  #failed;
  #error;

  /** Resolve the final result once. */
  #settleResolve(value) {
    if (this.resultSettled) return;
    this.resultSettled = true;
    this.#resolve(value);
  }

  /** Reject the final result once. */
  #settleReject(error) {
    if (this.resultSettled) return;
    this.resultSettled = true;
    this.#failed = true;
    this.#error = error;
    this.#reject(error);
  }

  push(event) {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      try {
        this.#settleResolve(this.extractResult(event));
      } catch (error) {
        this.#settleReject(error);
      }
    }

    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve({ value: event, done: false });
    else this.queue.push(event);
  }

  /**
   * End the stream.
   *
   * With a result, `result()` resolves with it. Without one, `result()`
   * rejects, because a caller that awaits a result must never hang. If the
   * promise already settled, end() only closes the iterator.
   */
  end(result) {
    const wasDone = this.done;
    this.done = true;
    if (!this.resultSettled) {
      if (result !== undefined) this.#settleResolve(result);
      else this.#settleReject(endedWithoutResult());
    }
    if (!wasDone) {
      for (const waiter of this.waiting.splice(0)) {
        waiter.resolve({ value: undefined, done: true });
      }
    }
  }

  fail(error) {
    if (this.done) return;
    this.done = true;
    this.#settleReject(error ?? endedWithoutResult());
    for (const waiter of this.waiting.splice(0)) waiter.reject(error ?? endedWithoutResult());
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
      if (this.#failed) throw this.#error;
      if (this.done) return;
      const next = await new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
      if (next.done) return;
      yield next.value;
    }
  }
}

export class AssistantMessageEventStream extends EventStream {
  constructor(isComplete = defaultIsComplete, extractResult = defaultExtractResult) {
    super(isComplete, extractResult);
  }
}

export function createAssistantMessageEventStream() {
  return new AssistantMessageEventStream();
}

/**
 * Price usage with the model's flat per-million rates.
 *
 * The host owns dated and time-based pricing. This shim serves plugins that
 * only need the scalar card OMP exposes on every model.
 *
 * @param {{cost?: {input?: number, output?: number, cacheRead?: number, cacheWrite?: number}}} model
 * @param {{input?: number, output?: number, cacheRead?: number, cacheWrite?: number, cost?: object}} usage
 * @param {number} [timestamp] accepted for API compatibility; unused
 */
export function calculateCost(model, usage, timestamp) {
  void timestamp;
  if (!usage || typeof usage !== "object") return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const cost = usage.cost ?? (usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
  const rates = model?.cost ?? {};
  const rate = (key) => (Number.isFinite(rates[key]) ? rates[key] : 0);
  const tokens = (key) => (Number.isFinite(usage[key]) ? usage[key] : 0);
  cost.input = (rate("input") / 1_000_000) * tokens("input");
  cost.output = (rate("output") / 1_000_000) * tokens("output");
  cost.cacheRead = (rate("cacheRead") / 1_000_000) * tokens("cacheRead");
  cost.cacheWrite = (rate("cacheWrite") / 1_000_000) * tokens("cacheWrite");
  cost.total = cost.input + cost.output + cost.cacheRead + cost.cacheWrite;
  return cost;
}

/** The canonical effort order used by OMP's clamp. */
const THINKING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Clamp a requested level to one the model serves.
 *
 * Mirrors OMP's `clampThinkingLevelForModel`:
 *   - a served level stays;
 *   - an unserved level follows `thinking.effortMap` only when that target is
 *     itself served and maps to itself;
 *   - otherwise it climbs down to the nearest lower served level;
 *   - a non-reasoning model resolves to `undefined`.
 */
function clampThinkingLevelForModel(model, requested) {
  if (!model) return requested;
  if (!model.reasoning || requested === undefined) return undefined;

  const levels = Array.isArray(model.thinking?.efforts) ? model.thinking.efforts : [];
  if (levels.includes(requested)) return requested;

  const effortMap = model.thinking?.effortMap;
  const aliased = effortMap?.[requested];
  if (aliased !== undefined && levels.includes(aliased) && (effortMap?.[aliased] ?? aliased) === aliased) {
    return aliased;
  }

  const requestedIndex = THINKING_EFFORTS.indexOf(requested);
  if (requestedIndex === -1) return undefined;

  let clamped;
  for (const effort of levels) {
    if (THINKING_EFFORTS.indexOf(effort) > requestedIndex) break;
    clamped = effort;
  }
  return clamped ?? levels[0];
}

/**
 * Historical pi level clamp.
 *
 * `"off"` passes through. Every other level is clamped against the model's
 * baked metadata and falls back to `"off"` when the model serves no effort.
 */
export function clampThinkingLevel(model, level) {
  if (level === "off") return "off";
  return clampThinkingLevelForModel(model, level) ?? "off";
}

/**
 * Enumerate the levels a model supports.
 *
 * Historical pi-ai exported this from the package root; legacy `/thinking`
 * menus (for example `@companion-ai/feynman`) import it. A non-reasoning model
 * serves only `off`; a reasoning model serves `off` followed by its baked
 * effort ladder in catalog order.
 */
export function getSupportedThinkingLevels(model) {
  if (!model?.reasoning) return ["off"];
  return ["off", ...(Array.isArray(model.thinking?.efforts) ? model.thinking.efforts : [])];
}

const PROBE_PATHS = Object.freeze({
  "openai-responses": "/responses",
  "openai-completions": "/chat/completions",
});

/**
 * Ask a provider API whether the account may use it.
 *
 * Command Code answers 403 `upgrade_required` for plans without API access and
 * then serves the same request through `/alpha/generate`. Without a host
 * stream, that first call never happens and the fallback never fires. This
 * probe issues one minimal call through the transport's own fetch, with a hard
 * 10 second deadline so a stalled provider cannot hold startup open.
 *
 * @returns {Promise<"upgraded" | "unavailable">}
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

  const timeout = AbortSignal.timeout(10_000);
  let signal = timeout;
  if (options?.signal) {
    try {
      signal = AbortSignal.any([options.signal, timeout]);
    } catch {
      signal = timeout;
    }
  }

  let response;
  try {
    response = await fetchImpl(baseUrl + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return "unavailable";
  }
  try {
    await response.body?.cancel();
  } catch {}
  return response.status === 403 ? "upgraded" : "unavailable";
}

/** The host stream, read from the capture the moment a standard api is used. */
function hostStreamNow() {
  if (hostStream) return hostStream;
  const host = globalThis.__OMP_SHIMS_HOST__;
  const captured = host?.captured?.get?.("streamSimple") ?? host?.resolve?.("streamSimple");
  if (typeof captured === "function") {
    hostStream = captured;
    return hostStream;
  }
  return null;
}

function noTransportError(model) {
  return new Error(
    `No transport registered for api "${model?.api ?? "unknown"}". The provider plugin must be loaded before streaming.`,
  );
}

export function streamSimple(model, context, options) {
  const transport = model?.api ? transports.get(model.api) : undefined;
  if (transport) return transport(model, context, options);

  const host = hostStreamNow();
  if (host) return host(model, context, options);

  const stream = createAssistantMessageEventStream();
  if (PROBE_PATHS[model?.api]) {
    probeProviderApi(model, options).then((answer) => {
      if (answer === "unavailable") {
        stream.fail(noTransportError(model));
        return;
      }
      stream.end();
    });
    return stream;
  }

  // An internal transport lookup failure is not a provider response event:
  // reject result() instead of inventing an assistant error message.
  queueMicrotask(() => stream.fail(noTransportError(model)));
  return stream;
}

/** Historical full-options entrypoint. The shim has one dispatch path. */
export function stream(model, context, options) {
  return streamSimple(model, context, options);
}

/** Collect one streamed response into its final assistant message. */
export function complete(model, context, options) {
  return stream(model, context, options).result();
}

/** Collect one simple-options response into its final assistant message. */
export function completeSimple(model, context, options) {
  return streamSimple(model, context, options).result();
}
