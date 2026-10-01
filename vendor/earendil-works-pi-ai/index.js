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

export function streamSimple(model, context, options) {
  const transport = model?.api ? transports.get(model.api) : undefined;
  if (transport) return transport(model, context, options);
  if (hostStream) return hostStream(model, context, options);

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
