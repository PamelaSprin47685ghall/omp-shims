// pi-side compat entrypoint.
//
// The historical pi compat surface exposes `registerApiProvider`. OMP does not
// export it, and plugins probe for it to tell the two hosts apart. On pi they
// register a `$ENV_KEY` placeholder, which OMP would then treat as a literal
// config override that shadows the stored `/login` credential. Omitting the
// export makes the probe fail, so the plugin takes its OMP path and leaves
// credential resolution to the host. That absence is deliberate: do not add a
// re-export to satisfy a type import.
//
// Everything else is the same shim as the package root.

export * from "./index.mjs";
