// Plugin bridge: expose installed OMP plugins to the auth-gateway.
//
// The gateway builds its model table from providers it can see at startup, so
// plugin-provided providers (kiro, commandcode, ...) are absent and every request
// for them fails with `Unknown model`. This feature loads the installed plugins
// the same way the agent does and registers their providers through the
// registry's own public `registerProvider` method, so models, API adapters and
// the gateway's routing table all come from stock OMP code.
//
// Credentials are supplied in memory through the registry's public
// `authStorage.keys.setRuntime`, so no credential-database rows are written and
// nothing has to be maintained by hand across restarts or upgrades.
//
// Only public, stable surface is used: the `ModelRegistry` export and its
// documented methods. No minified identifiers are referenced, so this survives
// OMP upgrades.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { activePin } from "../lib/credential-pin.js";
import { stableIdentityOAuth } from "../lib/oauth-identity.js";
import {
  installMistralVibeResponseAdapter,
  MISTRAL_VIBE_PROVIDER_ID,
  mistralVibeProviderConfig,
} from "../lib/mistral-vibe-provider.js";

const require_ = createRequire(import.meta.url);
const PLUGIN_SOURCE = "omp-shims";

/**
 * Resolve a credential for a provider.
 *
 * Supported sources, in order: a literal value, an environment variable, a JSON
 * file (with a dotted path), or a SQLite query returning one text column. All
 * are declared in config, so no provider is hardcoded here.
 */
export function makeTokenResolver(tokenConfig) {
  const specs = tokenConfig ?? {};

  return function resolveToken(provider) {
    const spec = specs[provider];
    if (!spec) return undefined;

    if (typeof spec === "string") return nonEmpty(spec);
    if (spec.value) return nonEmpty(spec.value);

    if (spec.env) {
      const fromEnv = nonEmpty(process.env[spec.env]);
      if (fromEnv) return fromEnv;
    }

    if (spec.json) {
      const value = readJsonPath(spec.json.file, spec.json.path);
      if (value) return value;
    }

    if (spec.sqlite) {
      const value = readSqliteValue(spec.sqlite.file, spec.sqlite.query);
      if (value) return value;
    }

    return undefined;
  };
}

function nonEmpty(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  // An unresolved template placeholder is not a credential.
  if (trimmed === "" || (trimmed.startsWith("$") && !/^\$[0-9a-fA-F]{8,}/.test(trimmed))) return undefined;
  return trimmed;
}

function readJsonPath(file, path) {
  if (!file || !path) return undefined;
  if (!existsSync(file)) return undefined;
  try {
    let value = JSON.parse(readFileSync(file, "utf8"));
    for (const key of path.split(".")) {
      if (value === undefined || value === null) return undefined;
      value = value[key];
    }
    return typeof value === "string" ? nonEmpty(value) : undefined;
  } catch {
    return undefined;
  }
}

function readSqliteValue(file, query) {
  if (!file || !query) return undefined;
  const path = file.startsWith("~/") ? join(homedir(), file.slice(2)) : file;
  if (!existsSync(path)) return undefined;
  try {
    const { Database } = require_("bun:sqlite");
    const db = new Database(path, { readonly: true });
    try {
      const row = db.query(query).get();
      if (row) {
        const first = Object.values(row)[0];
        if (typeof first !== "string") return undefined;
        // Values are commonly JSON blobs holding the actual token.
        try {
          const parsed = JSON.parse(first);
          for (const candidate of Object.values(parsed)) {
            if (typeof candidate === "string") {
              const token = nonEmpty(candidate);
              if (token && token.length > 20) return token;
            }
          }
        } catch {}
        return nonEmpty(first);
      }
    } finally {
      db.close();
    }
  } catch {}
  return undefined;
}

/** Entry points a plugin manifest may declare, in resolution order. */
function entryPointsOf(packageDir, manifest) {
  const declared = [
    ...(manifest.omp?.extensions ?? []),
    ...(manifest.pi?.extensions ?? []),
    ...(manifest.extensions ?? []),
    manifest.main,
    "./index.js",
    "./index.mjs",
    "./dist/index.js",
  ];
  const seen = new Set();
  const entries = [];
  for (const entry of declared) {
    if (typeof entry !== "string" || seen.has(entry)) continue;
    seen.add(entry);
    const resolved = join(packageDir, entry);
    if (existsSync(resolved)) entries.push(resolved);
  }
  return entries;
}

/** Read the installed plugin list from the plugins workspace manifest. */
function discoverPlugins(pluginsDir) {
  const manifestPath = join(pluginsDir, "package.json");
  if (!existsSync(manifestPath)) return [];

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return [];
  }

  const packages = [];
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (name === "omp-shims") continue;
    const packageDir = join(pluginsDir, "node_modules", name);
    if (!existsSync(packageDir)) continue;
    const entries = entryPointsOf(packageDir, readManifestSafe(join(packageDir, "package.json")));
    if (entries.length > 0) packages.push({ name, entries });
  }
  return packages;
}

function readManifestSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Minimal plugin host: collects providers and swallows interactive-only calls. */
function createPluginHost(onProvider) {
  return {
    on() {},
    registerCommand() {},
    registerProvider(id, providerConfig) {
      if (typeof id === "string" && providerConfig) onProvider(id, providerConfig);
    },
  };
}

/**
 * Adapt a provider's event stream to OMP's event contract.
 *
 * pi sends `text_end` / `thinking_end` with `content` as the block's text, while
 * OMP reads it as an array of content blocks and indexes into it directly
 * (`e.content.length`). Without this the gateway throws on the first text block.
 * Only the shape is corrected; the provider's own semantics are untouched.
 */
const PLACEHOLDER_KEYS = new Set([
  "$COMMAND_CODE_API_KEY",
  "COMMAND_CODE_API_KEY",
  "$COMMANDCODE_API_KEY",
  "COMMANDCODE_API_KEY",
]);

/**
 * Retry budget handed to a provider transport.
 *
 * Providers implement their own retry -- Command Code retries 429 and 5xx with
 * exponential backoff and honours Retry-After -- but default it to zero, and the
 * host does not pass a budget. The result is that a transient capacity error
 * reaches the caller on the first response instead of being retried. Supplying
 * the budget here turns on the provider's own implementation rather than
 * reimplementing it, and no provider source is touched.
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Qoder reports account/lane capacity exhaustion as an in-stream error instead
 * of an HTTP 429. OMP can rotate sibling credentials before any replay-unsafe
 * output, but only when the terminal error carries usage-limit semantics. Add a
 * machine-readable marker while preserving the provider's detailed message.
 */
export function normalizeQoderCapacityEvent(provider, event) {
  if (provider !== "qoder" && provider !== "qoder-cn") return event;
  if (event?.type !== "error") return event;
  const message = event?.error?.errorMessage;
  if (typeof message !== "string" || !message.includes("serviceAvailable:false")) return event;
  if (!message.includes("RESOURCE_LIMIT") && !/无可用容量|no spare capacity/i.test(message)) return event;
  if (/resource_exhausted/i.test(message)) return event;
  return {
    ...event,
    error: { ...event.error, errorMessage: `${message}\n[omp-shims:qoder-capacity resource_exhausted]` },
  };
}

function normalizeCommandCodeContext(context) {
  if (!context || !Array.isArray(context.messages)) return context;
  const messages = context.messages.map((message) => {
    if (message.role !== "assistant") return message;
    const thinking = message.reasoning_content ?? message.reasoning;
    if (typeof thinking !== "string" || thinking === "") return message;
    const content = Array.isArray(message.content) ? [...message.content] : [];
    if (!content.some((part) => part?.type === "thinking")) {
      content.unshift({ type: "thinking", thinking });
    }
    return { ...message, content };
  });
  return { ...context, messages };
}

function wrapTransportEvents(transport, provider) {
  return function wrappedStreamSimple(model, context, options) {
    const nextContext = provider === "commandcode" ? normalizeCommandCodeContext(context) : context;
    const next = { ...options };
    // pi plugins pass `$ENV_KEY` placeholders for "resolve this yourself". OMP
    // would send the literal string as the bearer token, so drop it and let the
    // host resolve the real credential.
    if (PLACEHOLDER_KEYS.has(next.apiKey)) next.apiKey = undefined;
    // A request pinned to one account of a provider that signs its requests
    // with the token (see lib/lazy-router/credentials.js) gets that account's
    // token here, where the plugin receives its key.
    const pinnedSecret = activePin(provider)?.transportSecret;
    if (pinnedSecret) next.apiKey = pinnedSecret;
    if (next.maxRetries === undefined) next.maxRetries = DEFAULT_MAX_RETRIES;
    const stream = transport(model, nextContext, next);
    if (!stream || typeof stream.push !== "function") return stream;

    const originalPush = stream.push.bind(stream);
    stream.push = (event) => {
      event = normalizeQoderCapacityEvent(provider, event);
      if (event?.type !== "text_end" && event?.type !== "thinking_end") return originalPush(event);
      if (Array.isArray(event.content)) return originalPush(event);
      const { content, ...rest } = event;
      const text = typeof content === "string" ? content : (content?.text ?? "");
      const block =
        event.type === "thinking_end"
          ? { type: "thinking", thinking: text, thinkingSignature: event.thinkingSignature ?? "" }
          : { type: "text", text };
      return originalPush({ ...rest, content: [block] });
    };
    return stream;
  };
}

export async function install(config, context) {
  const log = context.log ?? (() => {});
  installMistralVibeResponseAdapter(context);
  const pluginsDir = config.pluginsDir ?? join(homedir(), ".omp", "plugins");
  // Token specs are provider-agnostic and live outside `features`, so they are
  // merged in from the top-level `pluginBridge` section by the bootstrap.
  const resolveToken = makeTokenResolver(context.tokens ?? config.tokens);
  const only = config.plugins ? new Set(config.plugins) : null;

  const packages = discoverPlugins(pluginsDir).filter((pkg) => !only || only.has(pkg.name));
  if (packages.length === 0) log("plugin-bridge: no external plugins found", { pluginsDir });
  else log(`plugin-bridge: discovered ${packages.length} plugin(s) in ${pluginsDir}`);

  // One registration pass per registry at a time; `populated` registries
  // already hold the plugins, so the hot getAll path skips them and only
  // refresh(), which may rebuild the provider list, registers again.
  const inFlight = new WeakMap();
  const populated = new WeakSet();
  /** registry → the plugin sources its syncExtensionSources keeps (wrapped once). */
  const keptSources = new WeakMap();
  // The gateway rebuilds its registry every few seconds and every rebuild
  // re-registers the plugins; report each provider's state once, and again
  // only when it changes, so the journal is not flooded with repeats.
  const lastReported = new Map();
  const logOnChange = (subject, message) => {
    if (lastReported.get(subject) === message) return;
    lastReported.set(subject, message);
    log(message);
  };
  const tokens = new Map();
  // Plugin OAuth registrations, bridged into the host's runtime OAuth registry
  // as soon as each plugin registers a provider. The auth-broker's refresh path
  // resolves OAuth providers through that registry only, so a plugin provider
  // without an entry fails every refresh ("Unknown OAuth provider") and each
  // request pays the failed-refresh retry before falling back.
  const registeredOauth = new Set();
  const pendingOauth = new Map();
  // Providers collected during eager plugin init. getAll() is synchronous, so
  // it cannot await plugin loading; this cache lets it replace any built-in
  // provider before returning the very first model snapshot.
  const preparedProviders = new Map();
  const internalProviders = [{ id: MISTRAL_VIBE_PROVIDER_ID, config: mistralVibeProviderConfig() }];

  let oauthBridgeUnavailableLogged = false;

  function registerOauthConfig(registerOauth, id, oauth) {
    if (registeredOauth.has(id)) {
      pendingOauth.delete(id);
      return;
    }
    try {
      registerOauth({ ...oauth, id, sourceId: `${PLUGIN_SOURCE}:oauth` });
      registeredOauth.add(id);
      pendingOauth.delete(id);
      logOnChange(`oauth:${id}`, `plugin-bridge: registered OAuth provider ${id}`);
    } catch (error) {
      log(`plugin-bridge: registerOAuthProvider(${id}) failed: ${error.message}`);
    }
  }

  /** Flush OAuth providers queued before the host export left its TDZ. */
  function flushPendingOauth(registerOauth) {
    if (typeof registerOauth !== "function") return;
    for (const [id, oauth] of pendingOauth) registerOauthConfig(registerOauth, id, oauth);
  }

  /**
   * Register one plugin OAuth config into the host's runtime OAuth registry.
   * The auth-broker does not construct a ModelRegistry, so if the host export
   * is still in TDZ during eager plugin init we must retain this config until
   * registry-capture announces registerOAuthProvider later.
   */
  function bridgeOauth(id, pluginOauth) {
    if (registeredOauth.has(id)) return;
    const oauth = stableIdentityOAuth(id, pluginOauth);
    pendingOauth.set(id, oauth);
    const registerOauth = globalThis.__OMP_SHIMS_HOST__?.captured?.get("registerOAuthProvider");
    if (typeof registerOauth !== "function") {
      if (!oauthBridgeUnavailableLogged) {
        oauthBridgeUnavailableLogged = true;
        log("plugin-bridge: host registerOAuthProvider unavailable; OAuth registration deferred");
      }
      return;
    }
    registerOauthConfig(registerOauth, id, oauth);
  }

  function prepareProvider(id, providerConfig) {
    if (!providerConfig?.streamSimple && !providerConfig?.models) return undefined;
    const config = { ...providerConfig };
    if (config.oauth) config.oauth = stableIdentityOAuth(id, config.oauth);
    if (typeof config.streamSimple === "function") {
      config.streamSimple = wrapTransportEvents(config.streamSimple, id);
      if (config.api) context.registerTransport?.(config.api, config.streamSimple);
    }
    return config;
  }

  /** Register already-loaded plugin providers synchronously before getAll(). */
  function registerPreparedInto(registry) {
    for (const [id, prepared] of preparedProviders) {
      try {
        registry.registerProvider(id, prepared.config, prepared.source);
      } catch (error) {
        log("plugin-bridge: registerProvider(" + id + ") failed: " + error.message);
      }
    }
  }

  /**
   * Load the plugins once at install time so their OAuth configs reach the
   * runtime registry immediately. The broker's refresh sweep and the
   * `auth-gateway check` probe never construct a ModelRegistry, so waiting
   * for a registry refresh would leave the OAuth bridge unapplied there.
   * registerInto re-runs the same init per registry instance; the plugin
   * modules are cached by the module loader, so the double init is cheap.
   */
  const eagerInit = (async () => {
    for (const { id, config: providerConfig } of internalProviders) {
      if (providerConfig.oauth) bridgeOauth(id, providerConfig.oauth);
    }
    for (const pkg of packages) {
      for (const entry of pkg.entries) {
        let module;
        try {
          module = await import(entry);
        } catch (error) {
          log(`plugin-bridge: cannot import ${entry}: ${error.message}`);
          continue;
        }
        const init = module.default ?? module;
        if (typeof init !== "function") continue;
        try {
          await init(
            createPluginHost((id, providerConfig) => {
              if (providerConfig?.oauth && typeof providerConfig.oauth === "object") {
                bridgeOauth(id, providerConfig.oauth);
              }
              const prepared = prepareProvider(id, providerConfig);
              if (!prepared) return;
              preparedProviders.set(id, {
                config: prepared,
                source: PLUGIN_SOURCE + ":" + pkg.name,
              });
              tokens.set(id, resolveToken(id));
            }),
          );
        } catch (error) {
          log(`plugin-bridge: ${pkg.name} threw during eager init: ${error.message}`);
        }
      }
    }
  })();
  eagerInit.catch(() => {});

  async function registerInto(registry) {
    if (inFlight.has(registry)) return inFlight.get(registry);

    const task = (async () => {
      const sources = new Set();
      const discoverableProviders = new Set();
      for (const { id, config: providerConfig } of internalProviders) {
        try {
          registry.registerProvider(id, mistralVibeProviderConfig(), `${PLUGIN_SOURCE}:internal`);
          if (providerConfig.oauth) bridgeOauth(id, providerConfig.oauth);
          sources.add(`${PLUGIN_SOURCE}:internal`);
          if (typeof providerConfig.fetchDynamicModels === "function") discoverableProviders.add(id);
          logOnChange(`provider:${id}`, `plugin-bridge: registered ${id} (${providerConfig.models?.length ?? 0} models) from omp-shims`);
        } catch (error) {
          log(`plugin-bridge: registerProvider(${id}) failed: ${error.message}`);
        }
      }
      for (const pkg of packages) {
        for (const entry of pkg.entries) {
          let module;
          try {
            module = await import(entry);
          } catch (error) {
            log(`plugin-bridge: cannot import ${entry}: ${error.message}`);
            continue;
          }
          const init = module.default ?? module;
          if (typeof init !== "function") continue;

          const before = tokens.size;
          try {
            await init(
              createPluginHost((id, providerConfig) => {
                if (!providerConfig?.streamSimple && !providerConfig?.models) {
                  log(`plugin-bridge: ignoring ${id} from ${pkg.name} (no models or transport)`);
                  return;
                }
                try {
                  // OMP consumes the provider's events directly, so a pi-shaped
                  // transport is adapted before it is handed over.
                  const config = prepareProvider(id, providerConfig);
                  if (!config) return;
                  registry.registerProvider(id, config, `${PLUGIN_SOURCE}:${pkg.name}`);
                  if (providerConfig.oauth && typeof providerConfig.oauth === "object")
                    bridgeOauth(id, providerConfig.oauth);
                  sources.add(`${PLUGIN_SOURCE}:${pkg.name}`);
                  if (typeof providerConfig.fetchDynamicModels === "function") discoverableProviders.add(id);
                  tokens.set(id, resolveToken(id));
                  logOnChange(
                    `provider:${id}`,
                    `plugin-bridge: registered ${id} (${providerConfig.models?.length ?? 0} models) from ${pkg.name}`,
                  );
                } catch (error) {
                  log(`plugin-bridge: registerProvider(${id}) failed: ${error.message}`);
                }
              }),
            );
          } catch (error) {
            log(`plugin-bridge: ${pkg.name} threw during init: ${error.message}`);
          }
          if (tokens.size > before) break; // this package already contributed
        }
      }

      // Keep our sources alive: the registry clears registrations for any source
      // missing from the enabled set, which would silently drop the plugins again.
      // Wrapped once per registry; later passes only add to the kept set.
      const sync = registry.syncExtensionSources?.bind(registry);
      if (typeof sync === "function" && sources.size > 0) {
        const kept = keptSources.get(registry);
        if (kept) for (const source of sources) kept.add(source);
        else {
          const keep = new Set(sources);
          keptSources.set(registry, keep);
          registry.syncExtensionSources = (enabled) => {
            const merged = enabled instanceof Set ? new Set(enabled) : new Set(enabled ?? []);
            for (const source of keep) merged.add(source);
            return sync(merged);
          };
        }
      }

      // Credentials are supplied in memory through the key store, so nothing is
      // written to the credential database and nothing has to be re-applied by
      // hand after a restart or an upgrade.
      //
      // setConfig rather than setRuntime: a provider config that carries a literal
      // "$PROVIDER_API_KEY" placeholder is treated as an unresolved config
      // override, and a runtime key does not displace it. setConfig is the call
      // that the provider's own placeholder resolves against.
      const keys = registry.authStorage?.keys;
      if (keys && typeof keys.setConfig === "function") {
        for (const [provider, token] of tokens) {
          if (!token) {
            logOnChange(`key:${provider}`, `plugin-bridge: no credential configured for ${provider}`);
            continue;
          }
          try {
            keys.setConfig(provider, token);
            logOnChange(`key:${provider}`, `plugin-bridge: credential supplied for ${provider}`);
          } catch (error) {
            log(`plugin-bridge: setConfig(${provider}) failed: ${error.message}`);
          }
        }
      } else {
        log("plugin-bridge: registry has no authStorage.keys.setConfig; credentials left to OMP");
      }

      // registerProvider installs fetchDynamicModels managers, but discovery is
      // deferred until refreshDiscoverableProviders. The gateway refresh that
      // led here already finished before plugin providers were registered, so
      // drive their first credential-aware catalog refresh now.
      if (discoverableProviders.size > 0 && typeof registry.refreshDiscoverableProviders === "function") {
        try {
          await registry.refreshDiscoverableProviders(discoverableProviders, "online-if-uncached");
        } catch (error) {
          log(`plugin-bridge: dynamic model discovery failed: ${error.message}`);
        }
      }

      if (process.env.OMP_SHIMS_DEBUG_REGISTRY === "1") {
        for (const [provider] of tokens) {
          const state = { provider };
          try {
            state.hasProvider = registry.hasProvider?.(provider);
            state.concreteAuth = registry.hasConcreteAuth?.(provider);
            const providerModels = registry.getProviderModels?.(provider) ?? [];
            state.models = providerModels.length;
            state.providerApi = registry.getRegisteredProviderConfig?.(provider)?.api;
            state.modelApis = [...new Set(providerModels.map((model) => model.api).filter(Boolean))].sort();
            state.hasNativeProvider = Boolean(registry.getRegisteredNativeProvider?.(provider));
            state.keySource = keys?.source?.(provider);
            state.available = registry.getAvailableForProviders?.(new Set([provider]), "chat")?.length;
          } catch (error) {
            state.error = error.message;
          }
          console.error(`[omp-shims] registry-state ${JSON.stringify(state)}`);
        }
      }
    })().finally(() => {
      populated.add(registry);
      inFlight.delete(registry);
    });

    inFlight.set(registry, task);
    return task;
  }

  // `refresh` is where the gateway materializes its model table, so registering
  // here means the route table is built from the plugins in the same pass.
  const hooks = new WeakSet();

  function hookRegistryClass(ModelRegistryClass) {
    const proto = ModelRegistryClass?.prototype;
    if (!proto || hooks.has(proto)) return;
    hooks.add(proto);

    for (const method of ["refresh", "getAll"]) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function (...args) {
        // `getAll` is sync: run registration eagerly so the caller sees plugins
        // on its very first call, and let any async tail settle on its own.
        if (method === "getAll") {
          if (!populated.has(this)) registerPreparedInto(this);
          const res = original.apply(this, args);
          if (!populated.has(this)) registerInto(this).catch(() => {});
          return res;
        }
        // Async refresh: run original refresh first so built-in models load,
        // then run registerInto(this) so plugin providers override built-in ones.
        return Promise.resolve(original.apply(this, args)).then(() => registerInto(this));
      };
    }

    for (const method of ["getAvailable", "getAvailableForProviders"]) {
      const origMethod = proto[method];
      if (typeof origMethod !== "function") continue;
      proto[method] = function (...args) {
        const res = origMethod.apply(this, args);
        if (!Array.isArray(res)) return res;
        const hasCopilot = res.some((m) => m.provider === "github-copilot");
        const hasAuto = res.some((m) => m.provider === "github-copilot" && m.id === "auto");
        if (hasCopilot && !hasAuto) {
          return [
            {
              id: "auto",
              name: "Copilot Auto",
              provider: "github-copilot",
              api: "openai-completions",
              reasoning: true,
              contextWindow: 1050000,
              maxTokens: 128000,
              input: ["text", "image"],
            },
            ...res,
          ];
        }
        return res;
      };
    }

    log("plugin-bridge: hooked ModelRegistry refresh/getAll");
  }

  // Do not let OMP continue startup until plugin configs and transports are
  // prepared. This makes PROCESS_FEATURES load order real, including the async
  // vendor-shims -> plugin-bridge dependency.
  await eagerInit;

  // The capture lives in its own preloaded module so it can install itself
  // before this file's static imports are evaluated.
  const host = globalThis.__OMP_SHIMS_HOST__;
  if (!host?.observe) {
    log("plugin-bridge: host capture unavailable (is registry-capture.js preloaded first?)");
    return;
  }
  host.observe("registerOAuthProvider", flushPendingOauth);
  flushPendingOauth(host.captured?.get("registerOAuthProvider"));
  host.observe("ModelRegistry", hookRegistryClass);
  // The class may already have been announced before this feature loaded.
  hookRegistryClass(host.captured?.get("ModelRegistry"));
  log("plugin-bridge: observing ModelRegistry");
}
