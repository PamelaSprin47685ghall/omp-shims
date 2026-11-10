# Contributing to omp-shims

Thanks for helping. omp-shims is small on purpose: each fix is one independent,
switchable feature, and the shared plumbing stays minimal. Please keep changes in
that spirit.

## Setup

You need [Bun](https://bun.sh) 1.4.4 or newer.

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git
cd omp-shims
bun install
```

## Checks

Run these before opening a pull request. CI runs the same commands on Linux and
macOS.

```sh
bun run ci       # Biome check + bun test
bun run check    # Biome lint and format check
bun run format   # apply formatting
bun test         # test suite
bun run build:status-page        # rebuild the committed status-page assets
bun run build:status-page:check  # fail if the committed output is stale
```

The tests never touch your real `~/.omp`: the test setup points the config at a
temporary directory and clears every `OMP_SHIMS_*` variable.

## Contract-first workflow

A change starts with the contract, not the code:

1. **Name the feature and its phase.** Add one entry to `FEATURE_CATALOG` in
   `lib/config.mjs`. The entry carries the install phase (`edge`, `outbound`,
   `process`, `background`), a one-line summary, and the complete default
   settings. `DEFAULTS` and the CLI read the same entry, so do not add a second
   list.
2. **Define the port.** A feature receives one object from
   `lib/runtime.mjs`: `install(featureConfig, context)`, where `context` provides
   `addInboundMiddleware`, `addFetchHandler`, `preserveResponseUrl`,
   `extraHosts`, `tokens`, and `log`. Return a disposer (a function, a list, or
   an object with `dispose()`) when the feature installs a wrapper or a timer.
3. **Write the feature module.** One file in `features/<name>.mjs`. It must:
   - use the shared pipelines in `lib/inbound.mjs`, `lib/outbound.mjs`, and
     `lib/sse.mjs`, never wrap `Bun.serve` or `globalThis.fetch` again;
   - fall back to passing traffic through untouched when its own work fails;
   - write diagnostics to stderr only, through `context.log`;
   - respect a credential pin when it serves a request;
   - keep no global state that another feature can mutate.
4. **Add tests.** Put them under `test/`. Use the fake context and fake upstream
   responses in the shared helpers. Cover the disabled path as well as the
   enabled one.
5. **Document it.** Add the feature to the README feature table and settings
   section. Add a CHANGELOG entry that says what a user will notice.

A feature that needs a new setting adds it to its catalog `defaults`. A feature
that needs a new environment toggle does **not** add one: v2 keeps a fixed
allow-list (the 13 feature toggles plus three process variables). Put operational
settings in `~/.omp/shims.json`.

## Ground rules

- **Never break traffic.** A shim that fails must fall back to passing the
  request through untouched. Catch errors at the boundary and log them.
- **Diagnostics go to stderr**, never stdout: several omp subcommands parse
  stdout.
- **Public OMP surface only.** Hook documented exports and methods, never
  minified identifiers, so an OMP upgrade does not break the shims.
- **Public state is shared.** `lib/runtime.mjs` installs one context for all
  features. Add a port to that context instead of importing another feature.
- **No credentials or personal data in the code.** Accounts, keys, and tokens
  come from `~/.omp/shims.json`, the environment allow-list, or OMP's own
  credential store.
- **Keep features independent.** A feature must work, or cleanly do nothing,
  whatever else is enabled.
- **Pure ES modules at runtime.** New runtime source files use `.mjs`. One
  exception is the status page UI: `lib/router/status-page/app/**` is Svelte
  source compiled by Vite, and its output is committed under
  `lib/router/status-page/dist/`. The gateway never builds at startup or on a
  request. Run `bun run build:status-page` after changing the page source; CI
  fails on source/output drift.

## Configuration and migration

`lib/config.mjs` is the single source of truth for the v2 schema. It:

- merges defaults, the file, and the per-feature environment toggle;
- reports the winner in `sources`;
- rejects unknown top-level keys, feature names, `runtime` keys,
  `pluginBridge` keys, and v1 legacy keys;
- writes atomically with mode `0600`.

A schema change must also update:

- `scripts/migrate-v2.mjs` when a v1 key needs a v2 replacement;
- `bin/omp-shims.mjs` when `status`, `doctor`, or `uninstall` must know about the
  new file or table;
- the README and CHANGELOG.

Never reset a corrupt config to `{}`. Fail with a message that tells the user to
run `scripts/migrate-v2.mjs` when the file is from v1.

## Commits and pull requests

- Keep each pull request focused, and each commit a logical step with a message
  that explains *why*. [Conventional Commits](https://www.conventionalcommits.org)
  prefixes (`fix:`, `feat:`, `docs:`, ...) are appreciated.
- Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a
  user would notice.
- Call out any behaviour change in the pull request description.
- The pull request template asks for the feature name, the phase, the config
  keys, and the tests you ran.

## Reporting security issues

Please do not open a public issue for a vulnerability or a leaked credential;
see [SECURITY.md](SECURITY.md).
