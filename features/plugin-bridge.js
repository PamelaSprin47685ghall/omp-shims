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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

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

function wrapTransportEvents(transport) {
  return function wrappedStreamSimple(model, context, options) {
    const next = { ...options };
    // pi plugins pass `$ENV_KEY` placeholders for "resolve this yourself". OMP
    // would send the literal string as the bearer token, so drop it and let the
    // host resolve the real credential.
    if (PLACEHOLDER_KEYS.has(next.apiKey)) next.apiKey = undefined;
    if (next.maxRetries === undefined) next.maxRetries = DEFAULT_MAX_RETRIES;
    const stream = transport(model, context, next);
    if (!stream || typeof stream.push !== "function") return stream;

    const originalPush = stream.push.bind(stream);
    stream.push = (event) => {
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

export function install(config, context) {
  const log = context.log ?? (() => {});
  const pluginsDir = config.pluginsDir ?? join(homedir(), ".omp", "plugins");
  // Token specs are provider-agnostic and live outside `features`, so they are
 // merged in from the top-level `pluginBridge` section by the bootstrap.
  const resolveToken = makeTokenResolver(context.tokens ?? config.tokens);
  const only = config.plugins ? new Set(config.plugins) : null;

  const packages = discoverPlugins(pluginsDir).filter((pkg) => !only || only.has(pkg.name));
  if (packages.length === 0) {
    log("plugin-bridge: no installed plugins found", { pluginsDir });
    return;
  }
  log(`plugin-bridge: discovered ${packages.length} plugin(s) in ${pluginsDir}`);

  // Providers registered per registry instance, so a rebuild re-registers once.
  const registered = new WeakMap();
  const tokens = new Map();

  async function registerInto(registry) {
    if (registered.has(registry)) return;
    registered.set(registry, true);

    const sources = new Set();
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
                const config = { ...providerConfig };
                if (typeof config.streamSimple === "function") {
                  config.streamSimple = wrapTransportEvents(config.streamSimple);
                  // Let the vendored pi-ai shim dispatch to this provider, for
                  // the case where a plugin streams through its own
                  // `streamSimple` import instead of OMP's pipeline.
                  if (config.api) context.registerTransport?.(config.api, config.streamSimple);
                }
                registry.registerProvider(id, config, `${PLUGIN_SOURCE}:${pkg.name}`);
                sources.add(`${PLUGIN_SOURCE}:${pkg.name}`);
                tokens.set(id, resolveToken(id));
                log(`plugin-bridge: registered ${id} (${providerConfig.models?.length ?? 0} models) from ${pkg.name}`);
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
    const sync = registry.syncExtensionSources?.bind(registry);
    if (typeof sync === "function" && sources.size > 0) {
      registry.syncExtensionSources = function (enabled) {
        const merged = enabled instanceof Set ? new Set(enabled) : new Set(enabled ?? []);
        for (const source of sources) merged.add(source);
        return sync(merged);
      };
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
          log(`plugin-bridge: no credential configured for ${provider}`);
          continue;
        }
        try {
          keys.setConfig(provider, token);
          log(`plugin-bridge: credential supplied for ${provider}`);
        } catch (error) {
          log(`plugin-bridge: setConfig(${provider}) failed: ${error.message}`);
        }
      }
    } else {
      log("plugin-bridge: registry has no authStorage.keys.setConfig; credentials left to OMP");
    }

    if (process.env.OMP_SHIMS_DEBUG_REGISTRY === "1") {
      for (const [provider] of tokens) {
        const state = { provider };
        try {
          state.hasProvider = registry.hasProvider?.(provider);
          state.concreteAuth = registry.hasConcreteAuth?.(provider);
          state.models = registry.getProviderModels?.(provider)?.length;
          state.keySource = keys?.source?.(provider);
          state.available = registry.getAvailableForProviders?.(new Set([provider]), "chat")?.length;
        } catch (error) {
          state.error = error.message;
        }
        console.log(`[omp-shims] registry-state ${JSON.stringify(state)}`);
      }
    }
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
        const result = registerInto(this);
        // `getAll` is sync: run registration eagerly so the caller sees plugins
        // on its very first call, and let any async tail settle on its own.
        if (method === "getAll") {
          result.catch(() => {});
          return original.apply(this, args);
        }
        return result.then(() => original.apply(this, args));
      };
    }
    log("plugin-bridge: hooked ModelRegistry refresh/getAll");
  }

  // The capture lives in its own preloaded module so it can install itself
  // before this file's static imports are evaluated.
  const host = globalThis.__OMP_SHIMS_HOST__;
  if (!host?.observe) {
    log("plugin-bridge: host capture unavailable (is registry-capture.js preloaded first?)");
    return;
  }
  host.observe("ModelRegistry", hookRegistryClass);
  // The class may already have been announced before this feature loaded.
  hookRegistryClass(host.captured?.get("ModelRegistry"));
  log("plugin-bridge: observing ModelRegistry");
}


