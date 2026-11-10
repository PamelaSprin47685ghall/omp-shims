# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Status page v3.** The dashboard is now a Framework7 Svelte application with
  server-rendered content, one-snapshot refresh, global four-worker statistics,
  a shared token epoch, and a Framework7 reset dialog. `/` renders from one
  `statusView()` snapshot; `GET /v1/lazy/status` serves the same
  `StatusSnapshotV3` envelope. The page reports shared worker in-flight counts
  (M03/M04), capacity, health, concurrency proof, affinity hit rate, the
  30-minute complete/imputed perf window, and token totals for the current
  epoch. Token totals cover streamed, non-streamed JSON, and direct model calls
  (`含直连/非流式`) and are estimates, not billing.
- A token **epoch** model: a reset creates a new epoch, and a request that
  started before the reset writes only to its captured epoch. Resets are
  HTTPS-gated, bearer-authorized, idempotent by `resetId`, conflict-safe within
  two seconds, and atomic.
- `worker_load` heartbeats, per-minute `affinity_stat` counters, `token_epochs`,
  `token_totals`, and complete/imputed perf columns. The migration is
  expand-only: `PRAGMA user_version` stays `2`, the legacy `totals`/`since`
  mirror stays current, and the previous release opens the same database.
- `scripts/deploy-status-assets.mjs` copies current and retained hashed assets
  into `statusAssetDir` for rollback. It never moves or deletes, and keeps one
  manifest per build.
- An opt-in preload that re-enables OMP's paused `google-antigravity` provider:
  `antigravity-unpause.mjs` clears the catalog `disabled` flag and registers the
  built-in OAuth definition as a runtime provider with a structured `apiKey`.
  `index.mjs` imports it; the service units add it only when
  `OMP_SHIMS_ANTIGRAVITY_UNPAUSE` is true; `omp-shims antigravity-login` and
  `omp-shims antigravity-env` set the same preload for terminal commands.

### Changed

- The status page has a narrow build-time Vite/Svelte toolchain:
  `lib/router/status-page/app/**` compiles into committed
  `lib/router/status-page/dist/`. The gateway runtime remains build-free. Run
  `bun run build:status-page` after source changes; CI and the release workflow
  run `bun run build:status-page:check`.
- The theme is Material Design only; iOS users see Material Design, not a
  native iOS theme.
- The page CSP permits inline styles for Framework7 but still forbids inline
  scripts and `unsafe-eval`.
- The page is `noindex, nofollow`, uses `cache-control: no-store` for HTML, and
  serves hashed JS/CSS as `public, max-age=31536000, immutable`.
- New `lazy-router.statusBasePath` (default `""`) and `statusAssetDir` (default
  `null`) settings support `/ops/`-style subpaths and rollback asset retention.

- `tool-id-hash` is a clean-break rewrite. Every tool-call id now maps to a
  12-character short id derived from a SHA-256 digest of the whole original,
  stored in the `tool_ids` table of the shared `omp-shims-state.sqlite`. The
  mapping is the same for every gateway worker and survives a restart; a
  bounded 10,000-entry per-process cache serves both directions, `last_seen` is
  refreshed at most once a minute, rows expire after seven days, and the table
  is capped at 200,000 rows. Ids are no longer hashed into a prefix or
  truncated, and the `salt` setting is gone.
- A tool-id store failure fails open: the inbound body and the response pass
  through unchanged instead of failing the model request.

### Fixed

- `npm pack` now ships `antigravity-unpause.mjs`. The published v2 tarball
  omitted it while `index.mjs` imported it, so the plugin entry could not load
  from the package.
- The `lazy/pro` route keeps `google-antigravity/gemini-4-argon`. The published
  v2 preset renamed it to `gemini-4-carbon-medium`, a model the bundled price
  table does not list.
- A lazy-router attempt no longer drops `content-encoding` from a provider
  request whose body is already compressed. Codex tool requests reached the
  upstream as compressed bytes without their decoder and failed with `400 Bad
  Request`; the pinned account headers now leave the body encoding intact.
- A provider quota or credential failure can no longer reach the client as a
  raw `401`/`402`/`403`/`429`, a billing message, or a provider URL.
  `classifyFailure` now maps those account statuses to `QUOTA` or `CREDENTIAL`
  even when the transport never observed a provider contact, and only a
  malformed `400` (or a provider-confirmed `404`) is a `REQUEST`.
- A `429` keeps the quota label but uses the 30-second rate-limit cooldown, so
  a busy account is retried soon instead of being benched for 30 minutes.
- `isGatewayRequestRejection` no longer treats `401`/`402`/`403` as a client
  rejection, so a quota reply benches the candidate and the router continues
  with the next one.
- `#exhausted` and `#rejected` answer one deterministic `503`
  `lazy_router_unavailable`; the last upstream status, unit, model, and text
  stay internal.
- Custom-provider and extension fallbacks replace every non-2xx upstream body
  with a generic `502`/`503`.
- A direct model call (outside `lazy/*`) passes through a new response guard:
  a provider quota body becomes the same generic `503`.
- A provider quota or `429` failure that arrives as a thrown exception is
  classified as `QUOTA`/`CREDENTIAL`: lazy routes fail over, and a direct call
  answers a generic `503` instead of the provider text. A `200` event stream
  whose first frame carries a quota error is converted before the client sees
  it.

## [2.0.0] - 2026-11-09

Version 2 is a clean-break rewrite in pure ES modules. It keeps the same jobs as
v1, but the configuration format, the feature list, the service units, and the
state storage changed.

### Added

- The 13-feature catalog in `lib/config.mjs`: `gateway-compat`, `sse-heartbeat`,
  `reasoning-order`, `tool-id-hash`, `antigravity`, `copilot-auto`,
  `lazy-router`, `cline-pin-upstream`, `ipv6-first`, `plugin-bridge`,
  `models-bridge`, `traffic-log`, and `kiro-credential-sync`. Each feature
  declares its install phase, its summary, and its complete defaults.
- A strict v2 configuration format at `~/.omp/shims.json`:

  ```json
  { "version": 2, "stateDbPath": null, "runtime": {}, "features": {}, "pluginBridge": { "tokens": {} } }
  ```

  The loader rejects unknown top-level keys, unknown feature names, unknown
  `runtime` and `pluginBridge` keys, and v1 legacy feature names. A corrupt file
  is an error; it is never reset to `{}`.
- Per-feature environment overrides on top of the file
  (`OMP_SHIMS_<FEATURE>`), with `loadConfig().sources` reporting `default`,
  `file`, or `env` for each feature. The full allow-list is the 13 feature
  toggles plus `OMP_SHIMS_CONFIG`, `OMP_SHIMS_VERBOSE`, and
  `OMP_SHIMS_REUSE_PORT`.
- The `omp-shims` CLI in `bin/omp-shims.mjs`: `--version`, `--help`,
  `status [--json]`, `doctor`, `enable`, `disable`, `env`, `systemd [unit]`,
  `add-account`, `repair-identities`, and `uninstall`.
- `status` shows each feature's state and source. It reads unknown keys from the
  raw file, and it lists ignored legacy `OMP_SHIMS_*` variables without printing
  their values.
- `doctor` checks that the config is readable and owner-only (no group/other
  permission bits), validates the schema, runs `PRAGMA quick_check` and checks
  `user_version = 2` on the state database, and checks the host exports. It
  prints PASS/FAIL per check and exits 1 on a FAIL.
- `uninstall --dry-run` lists generated state. `--clean --yes` removes it and
  prints the exact `systemctl` and `bun remove` steps.
- `add-account` reads the token from a TTY with `stty -echo`, always restores the
  terminal settings, backs up `agent.db` with its WAL sidecars, and never prints
  the token.
- `scripts/migrate-v2.mjs`: a one-shot, idempotent v1 to v2 migration with
  `--dry-run`, `--write`, `--config`, `--state-dir`, and `--backup-dir`.
- A single shared state database at the top-level `stateDbPath`
  (`~/.omp/omp-shims-state.sqlite` by default) with `user_version = 2`. It holds
  the router state and Antigravity account cooldowns, and replaces
  `lazy-router-health.sqlite`, `lazy-router-state.sqlite`, and
  `lazy-router-token-totals.sqlite`.
- `systemd/omp-auth-gateway@.service`: a multi-worker template with
  `OMP_SHIMS_REUSE_PORT=1`, an optional `EnvironmentFile=-/etc/omp-shims/%i.env`,
  and `UMask=0077`.
- One inbound pipeline (`lib/inbound.mjs`) that owns the only `Bun.serve` wrapper
  and one outbound pipeline (`lib/outbound.mjs`) that owns the only
  `globalThis.fetch` wrapper. Each surface is wrapped at most once; both
  pipelines support ordered handlers and error isolation, and both expose an
  idempotent `dispose()` that removes every handler and restores the original
  function while its own wrapper is still in place.
- One bounded SSE codec (`lib/sse.mjs`) for every stream reader.
- `registry-capture.mjs` captures the host exports through lazy getters, then
  restores the native `Object.defineProperty`. It is the only module that
  patches that function; no other module replaces a global function. Every timer
  calls `unref()`.
- One runtime credential adapter (`lib/credentials.mjs`) for `agent.db`. The CLI
  account importer (`lib/account-import.mjs`) is the only other writer:
  `add-account` inserts or updates one account, and `repair-identities` rewrites
  identity keys.
- `lib/contracts.mjs`: the shared package version, no-auth sentinel, phases,
  service probes, URL match rules, credential pin, and diagnostic writers.

### Changed

- The package is pure `.mjs` with no build step. `package.json` speaks
  `type: "module"`, points every entry and export at `.mjs`, and requires Bun
  `>= 1.4.4`.
- The five v1 Antigravity features are one `antigravity` feature with
  sub-switches (`systemInstruction`, `routing`, `continuation`, `capture`,
  `accountRouting`).
- The five v1 Antigravity defaults are preserved where they mattered: system
  instruction, continuation, and account routing are on; tier routing and stream
  capture are off.
- `lazy-router` uses one shared SQLite store instead of one file per state kind.
- `sse-heartbeat` is on by default (it was off in v1).
- `reasoning-order` keeps its buffer limit as `maxBufferBytes` in the config
  file; `sse-heartbeat` keeps its idle interval as `intervalMs`, and
  `tool-id-hash` keeps its salt as a setting instead of an environment
  variable.
- Every feature reads the same `FEATURE_CATALOG` defaults that `status`,
  `doctor`, and `/omp-shims` show.
- Features install in four phases; an interactive session skips the `edge` and
  `background` phases.
- `runtime.thinkingLoopGuard` replaces the v1 `native-loop-guard` feature.
- Feature settings that v1 read from sub-option environment variables now live in
  `shims.json`.
- All live policy moved out of code and into `presets/`: routes, peak windows,
  the client-only prefix, provider header timeouts, ranking weights, Antigravity
  patterns, Copilot negotiation values, ClinePass transport and model channels,
  adapter effort writers, vendor off-peak schedules, official rates, and the
  China holiday calendar. No concrete model id, model-family pattern, route
  prefix, provider/channel host, or API version remains in code.
- The systemd units run as the invoking account, use that account's home
  directory, contain no `/root` literals, and load both preload entries.
- CI runs Biome and `bun test` on Linux and macOS across Bun 1.4.4 and the
  latest release.
- The release workflow publishes from a `v*` tag after checking the tag against
  `package.json`, running `bun run ci`, and running `npm pack --dry-run`.

### Removed

- The v1 feature names `antigravity-system-instruction`, `antigravity-routing`,
  `antigravity-continuation`, `antigravity-capture`, and
  `antigravity-account-routing`.
- The `vendor-shims` feature. The startup `rm -rf node_modules` copy race is
  gone; the vendored `@earendil-works/*` source still ships in `vendor/` and the
  host bridge maps it in-process through `Bun.plugin`.
- `native-loop-guard` as a feature. Use `runtime.thinkingLoopGuard`.
- The per-feature sub-option environment variables (`OMP_SHIMS_AG_*`,
  `OMP_SHIMS_TRAFFIC_LOG_DIR`, `OMP_SHIMS_LAZY_*_STATE_PATH`, ...).
- The profiler and `OMP_SHIMS_PROFILE`; per-stage CPU reporting is gone.
- `lazy-router.routing.excellentPrior` and `.mediumPrior` as ranking inputs. v2
  ranks with one continuous intelligence score; the preset and the loader keep
  the v1 values as inert provenance. `temperature` keeps the v1 default.
- The v1 separate state files, the `capacity` and `worker_heartbeat` rows, and
  the `attempt` table. Live workers no longer need a shared semaphore
  heartbeat, copied in-flight slots would leak capacity, and v2 computes
  concurrency proofs from shared attempt intervals instead of a table.
- The v1 `bin/omp-shims.js`, `preload.js`, `index.js`, and `registry-capture.js`
  entry points. `package.json` no longer points at them.

### Fixed

- `status` reports unknown config keys. v1 compared resolved keys against the
  catalog, so the list was always empty.
- Generated units contain a live `BUN_OPTIONS` preload line. v1 printed it as a
  comment, so a unit installed as-is ran without the shims.
- Generated units fill `User`, `HOME`, `WorkingDirectory`, `PATH`, and the `omp`
  binary from the invoking account instead of rewriting `/root` strings.
- `tool-id-hash` restores ids in typed streaming events, so a tool call and its
  result keep the same id in Chat, Responses, and Messages.
- `antigravity` continuation sanitizes a malformed terminal event without
  producing invalid JSON.
- `plugin-bridge` registers a provider once per registry, not once per
  `getAll()`.
- `models-bridge` reads `models.yml` once per registry refresh instead of on
  every lookup.
- Qoder logins with the placeholder e-mail no longer overwrite each other.
  Accounts are keyed by their account id.
- A client that closes its request no longer benches the unit serving it.
- A stale keep-alive connection is retried once on a fresh connection.
- An exhausted quota cools the unit without a wasted probe and fails over inside
  the same request.
- `traffic-log` no longer spins on a non-numeric `sweepMs` and fails soft outside
  Bun.
- Audit remediation: live policy literals moved to `presets/`; `lib/outbound.mjs`
  exports the same idempotent `dispose()` as inbound; the credential-writer
  contract names the CLI account importer as the only other writer of
  `auth_credentials`; and the four-worker blue-green rollout is documented in
  the README.

### Security

- Configuration and migration output are written through a temporary file and a
  rename with mode `0600`; the config directory is created `0700`.
- Service units set `UMask=0077`.
- Migration opens every v1 database `readonly` and copies inside one
  transaction. It writes the new config only after validation succeeds.
- Migration backs up the config and every source database (including `-wal` and
  `-shm`) before any write.
- `add-account` and `repair-identities` back up `agent.db` before a write and
  never echo the token.
- `doctor` FAILs when the config grants group or other permissions.
- No credentials, account addresses, or API keys are hardcoded. The v1 hardcoded
  ClinePass key and Antigravity account addresses stay removed; configure them in
  `shims.json`.
- `status` and `doctor` print environment variable names, never values.

## [1.0.0]

- Initial release: a portable omp-shims plugin with individually switchable
  compatibility features for the OMP auth-gateway.

[2.0.0]: https://github.com/PamelaSprin47685ghall/omp-shims/releases/tag/v2.0.0
[1.0.0]: https://github.com/PamelaSprin47685ghall/omp-shims/commit/00842f8
