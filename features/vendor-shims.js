// Install vendored host-compatibility packages.
//
// pi provider plugins declare `@earendil-works/pi-ai` and
// `@earendil-works/pi-coding-agent` as optional peer dependencies, expecting the
// host to supply them. Oh My Pi ships its own pi-ai under a different name, so
// those imports fail to resolve and the plugin cannot load. This feature copies
// the shim packages from `vendor/` into the plugins workspace so resolution
// succeeds, and hands the pi-ai shim's transport registry to the plugin bridge so
// a plugin's `streamSimple` reaches the transport it registered with OMP.
//
// The packages are copied rather than linked, so an `omp plugin update` that
// rewrites node_modules leaves them intact; this feature recreates them on every
// start regardless.
//
// Env:
//   OMP_SHIMS_VENDOR_SKIP=1   skip installation

import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const vendorRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor");

/** Vendored directory name -> package name installed into node_modules. */
const PACKAGES = {
  "earendil-works-pi-ai": "@earendil-works/pi-ai",
  "earendil-works-pi-coding-agent": "@earendil-works/pi-coding-agent",
};

export async function install(config, context) {
  const log = context.log ?? (() => {});
  if (process.env.OMP_SHIMS_VENDOR_SKIP === "1") {
    log("vendor-shims: skipped");
    return;
  }

  const pluginsDir = config.pluginsDir ?? join(homedir(), ".omp", "plugins");
  const nodeModules = join(pluginsDir, "node_modules");
  let installed = 0;

  for (const [directory, name] of Object.entries(config.packages ?? PACKAGES)) {
    const source = join(vendorRoot, directory);
    if (!existsSync(source)) {
      log(`vendor-shims: vendored copy of ${name} is missing`);
      continue;
    }
    const target = join(nodeModules, name);
    try {
      // Always replace, so a hand-edited or stale copy cannot survive.
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true });
      installed++;
    } catch (error) {
      log(`vendor-shims: cannot install ${name}: ${error.message}`);
    }
  }

  if (installed > 0) log(`vendor-shims: installed ${installed} package(s) into ${nodeModules}`);

  // Hand the shim's dispatchers to the bridge. Provider transports are
  // registered there, and standard apis fall through to the host's own
  // streamSimple, so a plugin importing `streamSimple` from the shim reaches
  // real streaming instead of a reimplementation.
  try {
    const shim = await import(join(nodeModules, "@earendil-works/pi-ai", "index.js"));
    context.registerTransport = (api, streamSimple) => shim.registerTransport(api, streamSimple);
    context.hasTransport = (api) => shim.hasTransport(api);
    context.setHostStream = (fn) => shim.setHostStream(fn);

    // The host export is captured by registry-capture.js; wire it in as soon as
    // it resolves, and re-wire if it arrives later.
    const connect = (fn) => {
      if (typeof fn === "function") {
        shim.setHostStream(fn);
        log("vendor-shims: host streamSimple connected");
      }
    };
    const host = globalThis.__OMP_SHIMS_HOST__;
    if (host?.observe) host.observe("streamSimple", connect);
    connect(host?.captured?.get("streamSimple"));
    log("vendor-shims: transport registry connected");
  } catch (error) {
    log(`vendor-shims: transport registry unavailable: ${error.message}`);
  }
}
