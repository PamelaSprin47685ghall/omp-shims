// pi-side compat entrypoint.
//
// pi's compat surface exposes `registerApiProvider`, which OMP does not export.
// Plugins probe for it to tell the two hosts apart, and register a custom api so
// their own transports are reachable from `streamSimple`. On OMP there is no host
// registry, so registrations land in the shim's own transport table.

export * from "./index.js";

let hostRegistry = null;

export function setHostRegistry(registry) {
  hostRegistry = registry ?? null;
}

/**
 * Deliberately NOT exported.
 *
 * pi plugins probe for `registerApiProvider` to tell pi from Oh My Pi, and
 * change their behaviour based on the answer: on pi they register a `$ENV_KEY`
 * placeholder for the provider, which Oh My Pi would then treat as a literal
 * config override that shadows the stored `/login` credential. Omitting the
 * export makes the probe fail, so the plugin takes its Oh My Pi path and leaves
 * credential resolution to the host.
 */
export function transcriptReadersFrom() {
  return {};
}
