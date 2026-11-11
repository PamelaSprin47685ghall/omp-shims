# omp-shims

[![CI](https://github.com/PamelaSprin47685ghall/omp-shims/actions/workflows/ci.yml/badge.svg)](https://github.com/PamelaSprin47685ghall/omp-shims/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Portable compatibility shims for the Oh My Pi (OMP) auth-gateway, packaged as an
OMP plugin. Version 2 is a clean-break rewrite in pure ES modules (`.mjs`).

The OMP auth-gateway is a long-running service that answers model requests for
every client on a machine. Out of the box it cannot serve providers that come
from plugins, and several upstreams (Antigravity / Cloud Code Assist, ClinePass,
...) need their requests nudged before they work reliably. omp-shims collects
those fixes in one place. Each fix is an independent **feature** that you can
switch without touching code, so the gateway behaves the same way on every
machine.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [Environment variables](#environment-variables)
- [CLI](#cli)
- [Migration from v1](#migration-from-v1)
- [systemd](#systemd)
- [How it works](#how-it-works)
- [Security](#security)
- [Diagnostics and logs](#diagnostics-and-logs)
- [Development](#development)
- [License](#license)

## Features

The catalog has exactly 13 features. Defaults come from
[`lib/config.mjs`](lib/config.mjs).

| Feature | Default | Purpose |
| --- | --- | --- |
| `gateway-compat` | on | Drop known optional JSON `null` fields at the inbound edge before request validation. |
| `sse-heartbeat` | on | Write an SSE keep-alive comment when a gateway event stream has been idle. |
| `reasoning-order` | on | Emit typed reasoning before visible body in Chat, Responses and Messages SSE. |
| `tool-id-hash` | on | Give every tool-call id a short stable id so upstream accepts long or colliding ids. |
| `antigravity` | on | Unified Antigravity shim: system instruction, tier routing, continuation recovery, capture, account routing. |
| `copilot-auto` | on | Negotiate GitHub Copilot Auto model routing and inject the required session token. |
| `lazy-router` | **off** | Serve `lazy/pro`, `lazy/weak`, `lazy/default`, `lazy/task`, and `lazy/paid` with online ranking and probe-driven failover, plus the `/` operations dashboard. |
| `cline-pin-upstream` | on | Pin ClinePass `chat/completions` to a fixed upstream channel. |
| `ipv6-first` | on | Resolve IPv6 first for outbound requests, falling back to IPv4 per address. |
| `plugin-bridge` | on | Expose installed OMP plugins to the auth-gateway model registry and supply credentials. |
| `models-bridge` | on | Expose custom models from `models.yml` to the auth-gateway model registry. |
| `traffic-log` | **off** | Log every inbound gateway request to a rolling hourly JSONL file. |
| `kiro-credential-sync` | on | Sync kiro-cli's rotated token into the auth-broker credential store. |

Features install in four phases, which also fixes their order in the request
path:

| Phase | Features |
| --- | --- |
| `edge` | `gateway-compat`, `sse-heartbeat`, `reasoning-order` |
| `outbound` | `tool-id-hash`, `antigravity`, `copilot-auto`, `lazy-router`, `cline-pin-upstream`, `ipv6-first` |
| `process` | `plugin-bridge`, `models-bridge`, `traffic-log` |
| `background` | `kiro-credential-sync` |

`lazy-router` and `traffic-log` install in the phases above, but each
self-disables outside the gateway process: virtual routes and inbound request
logging have no meaning in the broker or a plain session.

An interactive `omp` session installs only the `outbound` and `process` phases
(no server edge and no long-lived watchers). `preload.mjs` installs everything.

`antigravity` writes no tokens. `plugin-bridge` supplies credentials in memory
only. `kiro-credential-sync` updates the existing `kiro` credential row, and the
account-routing part of `antigravity` asks the auth-broker to refresh expiring
tokens. Routing state, including Antigravity account cooldowns, lives in the one
shared database named by the top-level `stateDbPath`.

## Requirements

- [Bun](https://bun.sh) **1.4.4 or newer**. OMP runs on Bun, and the shims use
  `Bun.serve`, `Bun.stdin`, and `bun:sqlite`.
- An OMP installation with its auth-broker and auth-gateway.
- Linux or macOS. The systemd templates apply to Linux only.
- systemd, if you run the services with the provided units.

## Install

The examples assume the package lives at `~/.omp/plugins/omp-shims` and is
listed in the plugins workspace manifest (`~/.omp/plugins/package.json`):

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git ~/.omp/plugins/omp-shims
cd ~/.omp/plugins
# add "omp-shims" to the "dependencies" of package.json, then:
bun install
```

An interactive `omp` session picks the plugin up through its `omp.extensions`
entry (`index.mjs`). The gateway and the broker load the package through Bun's
preload mechanism, with **both** entries and in this order:

```sh
registry-capture.mjs   installs the host-export hook; must come first
preload.mjs            resolves the config and installs the enabled features
```

Set one variable for both processes:

```sh
BUN_OPTIONS="--preload $PWD/registry-capture.mjs --preload $PWD/preload.mjs"
```

The installed service units already contain that line. The install path must
not contain whitespace: Bun's `BUN_OPTIONS` cannot quote a `--preload` path.

## Configuration

Settings live in `~/.omp/shims.json` (override the path with
`OMP_SHIMS_CONFIG`). The v2 format is strict:

```json
{
  "version": 2,
  "stateDbPath": null,
  "runtime": { "thinkingLoopGuard": false },
  "features": {
    "lazy-router": { "enabled": true },
    "antigravity": { "routing": true, "effort": "high" },
    "traffic-log": { "enabled": true, "dir": "/var/log/omp-gateway" }
  },
  "pluginBridge": { "tokens": {} }
}
```

Resolution order for each feature, last wins:

1. the built-in defaults in [`lib/config.mjs`](lib/config.mjs);
2. the entry in `shims.json`;
3. `OMP_SHIMS_<FEATURE>` (see [Environment variables](#environment-variables)).

A feature entry may be a boolean or an object. An object merges over its
defaults. A corrupt file is an error, never a silent reset. Unknown top-level
keys, unknown feature names, unknown feature settings, unknown `runtime` keys,
unknown `pluginBridge` keys, and v1 legacy feature names are rejected with their
full path. Only the declared open maps accept free keys:
`lazy-router.providerHeaderTimeoutMs`, `lazy-router.upstreamHosts`,
`lazy-router.maxInFlight`, `lazy-router.testFaults`, and
`cline-pin-upstream.modelChannels`. When the strict check fails,
`omp-shims status` still lists the unknown keys it found in the raw file.

`runtime.thinkingLoopGuard` controls OMP's own thinking-loop guard in a
long-lived service. The v2 default is `false`: the guard aborts a looping stream
and retries the identical body, which reproduces the loop. An interactive
session keeps the guard that OMP selected.

Changes take effect when `omp` or the service restarts. For a multi-worker
gateway, use the [zero-downtime rollout](#zero-downtime-worker-rollout) instead
of restarting workers in place.

### Feature settings

The tables list the settings that the v2 features read. Omitted values take the
default shown.

#### Edge and transport

| Feature | Setting | Default |
| --- | --- | --- |
| `gateway-compat` | `enabled` | `true` |
| `sse-heartbeat` | `enabled`, `intervalMs` | `true`, `15000` |
| `reasoning-order` | `enabled`, `maxBufferBytes` | `true`, `16777216` |
| `tool-id-hash` | `enabled` | `true` |
| `ipv6-first` | `enabled`, `ttlMs` | `true`, `60000` |

#### Antigravity

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the unified shim. |
| `systemInstruction` | `true` | Send the system prompt as a leading user turn. |
| `routing` | `false` | Route Flash models to the upstream `-tiered` variants. |
| `effort` | `"high"` | Thinking level when the caller asks for none. |
| `continuation` | `true` | Recover turns that end thought-only, malformed, or truncated. |
| `maxContinuations` | `3` | Extra continuations after the first turn. |
| `locationRetries` | `3` | Retries when upstream rejects the region. |
| `idleTimeoutMs` | `0` | Stream idle timeout; `0` disables it. |
| `capture` | `false` | Write stream diagnostics to a JSONL file. |
| `captureOut` | `null` | Capture file; `null` uses `~/.omp/logs/antigravity-streams.jsonl`. |
| `sampleEvery` | `0` | Capture every Nth stream; `0` records failures only. |
| `accountRouting` | `true` | Route by account tier. |
| `ultraAccounts`, `proAccounts` | `[]` | Account e-mail addresses per tier. |
| `cooldownMs` | `60000` | Account cooldown after a 429. |
| `ultraModelPattern` | `"gemini-4\|opus\|sonnet"` | Models reserved for Ultra accounts. |
| `accountsOut` | `null` | Account routing log. |
| `continuationOut` | `null` | Continuation diagnostics log. |

The account-routing part matches accounts in OMP's `agent.db` by e-mail
address. With no `ultraAccounts`, Ultra-only models use the gateway's own
credential. With no `proAccounts`, every account that is not an Ultra account
counts as Pro.

#### Paused Antigravity provider

OMP 18.18.6 hides `google-antigravity` behind a catalog `disabled` rule:
Google may restrict accounts that use Antigravity outside its own apps.
[`antigravity-unpause.mjs`](antigravity-unpause.mjs) clears that flag and
registers the provider's built-in OAuth definition as a runtime provider, so
stored credentials, `/login`, model discovery, and `omp token` work again. It
also builds the structured `apiKey` that the Google transport expects.

The plugin entry (`index.mjs`) imports the preload, so a plugin session always
re-enables the provider. Service units add it to `BUN_OPTIONS` only when
`OMP_SHIMS_ANTIGRAVITY_UNPAUSE` is true. For a terminal command:

```sh
omp-shims antigravity-login   # omp login google-antigravity with the preload
eval "$(omp-shims antigravity-env)"   # export BUN_OPTIONS for other commands
```

Re-enabling this provider can get an account banned. The preload is the only
module that touches OMP internals; it prints one line when it cannot find the
auth core and never fails the process that loaded it.

#### Provider features

| Feature | Setting | Default |
| --- | --- | --- |
| `copilot-auto` | `enabled`, `apiVersion` | `true`, `"2026-08-01"` |
| `cline-pin-upstream` | `enabled` | `true` |
| | `host` | `"api.cline.bot"` |
| | `baseURL` | `"https://api.cline.bot/api/v1"` |
| | `upstream` | `"openai-compatible-private"` |
| | `modelChannels` | `presets/cline.json` `modelChannels` |
| | `models` | `""` (all models) |
| | `apiKey` | `null` |
| `kiro-credential-sync` | `enabled`, `dbPath`, `pollMs` | `true`, kiro-cli default, `60000` |

Do not put API keys in a systemd unit. `cline-pin-upstream.apiKey` and
`pluginBridge.tokens` are the only places in this package that accept a
credential, and `~/.omp/shims.json` must stay readable by its owner only.

#### Plugin and model bridges

| Feature | Setting | Default |
| --- | --- | --- |
| `plugin-bridge` | `enabled` | `true` |
| | `pluginsDir` | `~/.omp/plugins` |
| | `plugins` | `null` (all installed plugins) |
| | `eagerTimeoutMs` | `15000` |
| `models-bridge` | `enabled` | `true` |
| | `modelsPath` | `~/.omp/agent/models.yml` |
| | `excludeProviders` | `[]` |

`plugin-bridge` can supply one token per plugin provider. Declare the tokens in
the top-level `pluginBridge` section:

```json
{
  "pluginBridge": {
    "tokens": {
      "kiro": {
        "sqlite": {
          "file": "~/.local/share/kiro-cli/data.sqlite3",
          "query": "SELECT value FROM auth_kv WHERE key = 'kirocli:social:token'"
        }
      },
      "commandcode": { "env": "COMMAND_CODE_API_KEY" }
    }
  }
}
```

Supported token sources: `value` (literal), `env`, `json` (a file and a dotted
`path`), and `sqlite` (a file and a query that returns one text column). Omit a
provider to let OMP resolve its own credential.

#### Traffic log

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch. |
| `dir` | `~/.omp/gateway-logs` | Output directory. |
| `maxAgeMs` | `3600000` | Delete files older than one hour. |
| `sweepMs` | `300000` | Sweep interval. |
| `logBody` | `false` | Include request bodies. |

Bodies can contain prompts and tool output. Keep `logBody` off unless you need
it, and treat the log directory as sensitive.

#### Lazy router

`lazy-router` is off by default. Its settings:

The bundled preset exposes five routes: `lazy/pro` (rating over the Kiro and
Antigravity Opus/Gemini 4 units), `lazy/weak` (a 250K-context text route),
`lazy/default` (Terra, Plus then Pro then API), `lazy/task` (a DeepSeek
rating across providers), and `lazy/paid` (Kuaipao Claude Sonnet 5.5 at medium
effort). There is no `rush/*` family and no `lazy/vision` route in v2.

| Setting | Default |
| --- | --- |
| `enabled` | `false` |
| `store` | `"sqlite"` |
| `routesFile`, `holidaysFile` | `null` (bundled presets) |
| `statusPath` | `"/v1/lazy/status"` |
| `statusBasePath` | `""` |
| `statusAssetDir` | `null` |
| `clientOnlyPrefix` | `"lazy/"` |
| `allowNonChatPassThrough` | `true` |
| `probeIntervalMs`, `probeTimeoutMs` | `1800000`, `90000` |
| `probePrompt`, `probeMaxTokens` | `"Reply OK"`, `32` |
| `tierRefreshMs`, `tierRecheckMs` | `21600000`, `60000` |
| `headerTimeoutMs` | `300000` |
| `providerHeaderTimeoutMs` | `{ "commandcode": 1800000 }` |
| `upstreamHosts` | `{}` |
| `codexHttpTransport` | `true` |
| `logUpstreamBody` | `false` |
| `maxInFlight` | `{}` |
| `affinityTtlMs`, `affinityMaxEntries`, `affinityMinPrefixBytes` | `300000`, `50000`, `1024` |
| `admissionWindowMs` | `300000` |
| `perfHistoryHalfLifeMs`, `perfHistoryWeightCap` | `86400000`, `8` |
| `out` | `null` (`~/.omp/logs/lazy-router.jsonl`) |
| `testFaults` | `{}` |
| `routing` | documented weights and constants |

The shared state database is the top-level `stateDbPath` setting. `null` or an
absent value means `~/.omp/omp-shims-state.sqlite`. It holds cooldowns,
admission windows, account cooldowns, performance history, speed statistics,
concurrency proofs, affinity prefixes, and the tool-call id mapping. Several
workers may share it. It also holds the v3 worker heartbeats
(`worker_load`), per-minute affinity counters (`affinity_stat`), and the token
epoch/totals tables (`token_epochs`, `token_totals`). A reset creates a new
epoch; old rows stay for diagnostics and are never mixed into the current view.

#### Status page

With `lazy-router` enabled, `GET /` serves the operations dashboard and
`GET /v1/lazy/status` serves the same data as one `StatusSnapshotV3` JSON
object. The page refreshes itself with one status request per cycle and stops
polling when the server build or schema changes. `<html class="md">` is fixed:
Material Design only, including on iOS. The page is `noindex, nofollow` and its
responses use `cache-control: no-store`.

The page has a narrow build-time exception to the pure-ESM rule:
`lib/router/status-page/app/**` is Svelte source compiled by Vite into the
committed `lib/router/status-page/dist/`. The gateway itself never builds at
startup or on a request. After changing the page source run:

```sh
bun run build:status-page        # rebuild dist (compiler stays a devDependency)
bun run build:status-page:check  # fail if the committed dist is stale
```

`bun run build:status-page:check` is the release gate; it builds into `.tmp/`
and never writes `dist`. Two clean builds produce the same manifest and asset
hashes. `package.json` explicitly ships `lib/router/status-page/dist/`, so
`npm pack` contains `manifest.json`, the SSR bundle, and every current and
retained asset.

The exact page CSP permits inline **styles** because Framework7 needs them, but
still forbids inline scripts and `unsafe-eval`:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

The dashboard reports global worker in-flight counts, shared capacity, shared
health, affinity hit rate, concurrency proof, and token totals for the current
epoch. Token totals include streamed, non-streamed JSON, and direct model
requests (`含直连/非流式`); they are estimates, not billing. The reset action
requires the gateway bearer token, HTTPS or a loopback peer, and clears only the
current token epoch.

**Subpath (`/ops/`).** Either set `features["lazy-router"].statusBasePath` in
`shims.json` (for example `"/ops"`) or let a trusted loopback proxy send
`X-Forwarded-Prefix`. The handler strips the prefix before matching `/`, the
asset prefix, the status path, and the reset path. nginx:

```nginx
location /ops/ {
  proxy_set_header X-Forwarded-Prefix /ops;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_pass http://127.0.0.1:8787/;
}
```

**Asset retention and rollback.** `statusAssetDir` (default `null`) is an
optional deployment directory for hashed assets from older releases. Copy the
current build there with:

```sh
bun scripts/deploy-status-assets.mjs --to /srv/omp/status-assets
```

The script only copies. It never moves or deletes assets, and it keeps an
immutable `manifests/<buildId>.json` for every release, so a tab opened before
an upgrade can still load its entry script. The deployment directory must be
root-owned and not writable by the web user; otherwise a compromised gateway
could replace its own JavaScript. To roll back, copy the previous
package's assets into the same directory (without deleting the newer ones),
switch the package, and restart the workers; do not drop database tables. The
expand migration leaves `PRAGMA user_version = 2` and the legacy totals mirror
in place, so the previous release opens the same database.
### Preset policy

Live policy is data, not code. The bundled presets live in
[`presets/`](presets):

| File | Contents |
| --- | --- |
| `routes.json` | Routes, `peakWindows`, `clientOnlyPrefix`, and `providerHeaderTimeouts`. |
| `ranking.json` | Every routing weight and constant, plus `excellentPrior`/`mediumPrior` v1 provenance. |
| `antigravity.json` | `tieredPattern` and `ultraModelPattern`. |
| `copilot.json` | `apiVersion` and `autoBootstrapModel`. |
| `cline.json` | ClinePass `host`, `baseURL`, `upstream`, and `modelChannels`. |
| `adapters.json` | `upstreamEffortWriter` per provider and `requiresAttemptTrust`. |
| `offpeak.json` | Vendor off-peak `schedules`. |
| `rates.json` | Official list `rates`, with their `asOf` date, used for API-equivalent pricing. |
| `holidays-cn.json` | Mainland China holiday calendar for peak detection. |

`lazy-router.routesFile` and `lazy-router.holidaysFile` accept your own
replacements. Other preset policy is package data; where a feature exposes the
setting, override it per feature in `shims.json`. Code contains no concrete
model id, model-family pattern, route prefix, provider/channel host, or API
version: all live policy is edited in presets or overridden per feature in
`shims.json`.

## Environment variables

v2 reads a small allow-list. Every other `OMP_SHIMS_*` variable is legacy; the
CLI reports it and the runtime ignores it.

Feature toggles accept `true`/`false`, `1`/`0`, `on`/`off`, and `yes`/`no`
(case-insensitive, trimmed). Any other value is ignored.

| Feature | Variable |
| --- | --- |
| `gateway-compat` | `OMP_SHIMS_GATEWAY_COMPAT` |
| `sse-heartbeat` | `OMP_SHIMS_SSE_HEARTBEAT` |
| `reasoning-order` | `OMP_SHIMS_REASONING_ORDER` |
| `tool-id-hash` | `OMP_SHIMS_TOOL_ID_HASH` |
| `antigravity` | `OMP_SHIMS_ANTIGRAVITY` |
| `copilot-auto` | `OMP_SHIMS_COPILOT_AUTO` |
| `lazy-router` | `OMP_SHIMS_LAZY_ROUTER` |
| `cline-pin-upstream` | `OMP_SHIMS_CLINE_PIN_UPSTREAM` |
| `ipv6-first` | `OMP_SHIMS_IPV6_FIRST` |
| `plugin-bridge` | `OMP_SHIMS_PLUGIN_BRIDGE` |
| `models-bridge` | `OMP_SHIMS_MODELS_BRIDGE` |
| `traffic-log` | `OMP_SHIMS_TRAFFIC_LOG` |
| `kiro-credential-sync` | `OMP_SHIMS_KIRO_CREDENTIAL_SYNC` |

Other supported variables:

| Variable | Meaning |
| --- | --- |
| `OMP_SHIMS_CONFIG` | Config file path. |
| `OMP_SHIMS_VERBOSE=1` | Log what each feature does. |
| `OMP_SHIMS_REUSE_PORT=1` | Let several gateway workers bind one address. |
| `OMP_SHIMS_ANTIGRAVITY_UNPAUSE=true` | Add the unpause preload to the service units' `BUN_OPTIONS`. |

Sub-option environment variables from v1 — `OMP_SHIMS_AG_*`,
`OMP_SHIMS_TRAFFIC_LOG_DIR`, `OMP_SHIMS_LAZY_*_PATH`,
`OMP_SHIMS_MODELS_PATH`, `OMP_SHIMS_VENDOR_SKIP` — are not read in v2. Put
those settings in `shims.json`. `omp-shims status` and `doctor` name every
legacy variable they see, without printing its value.

## CLI

Run the CLI with Bun:

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.mjs <command>
```

| Command | Purpose |
| --- | --- |
| `--version`, `-v` | Print the version. |
| `--help`, `-h`, `help` | Print usage. |
| `status [--json]` | Show every feature, its state, its source (`default`, `config`, `env`), ignored legacy env vars, and unknown keys in the raw file. |
| `doctor` | Check that the config is readable and owner-only (no group/other permission bits), validate the schema, run `PRAGMA quick_check` and `user_version` on the state database, and check host exports. Prints PASS/FAIL per check; exits 1 on a FAIL. |
| `enable <feature>` | Turn a feature on in the file. |
| `disable <feature>` | Turn a feature off in the file. |
| `env` | Print the systemd `BUN_OPTIONS` line. |
| `systemd [unit]` | Print a unit with the current account's paths: `omp-auth-gateway`, `omp-auth-gateway@`, or `omp-auth-broker`. |
| `add-account <provider> <plugin-package>` | Read a token from stdin without echo, back up `agent.db`, and add or update the account. |
| `antigravity-login` | Run `omp login google-antigravity` with the unpause preload in `BUN_OPTIONS`. |
| `antigravity-env` | Print the `BUN_OPTIONS` preload that re-enables `google-antigravity`. |
| `repair-identities <provider>` | Give accounts stored with a placeholder identity their own identity. |
| `uninstall [--dry-run\|--clean] [--yes]` | List generated state, or remove it with `--clean --yes`. |

`enable` and `disable` warn when `OMP_SHIMS_<FEATURE>` is set: the environment
wins over the file until you unset it.

The host-export check PASSes in a standalone CLI process, where the hook is not
installed by design. When `doctor` runs inside an `auth-gateway` or `auth-broker`
process, a missing `globalThis.__OMP_SHIMS_HOST__` is a FAIL.

`add-account` reads the token with `stty -echo` on a TTY and always restores
the terminal settings. It never prints the token. Before writing, it copies
`agent.db` (and its `-wal`/`-shm` sidecars) to
`agent.db.bak-<UTC timestamp>`.

`uninstall --clean --yes` removes only files this package generated: the config,
the state database and its sidecars, and the known log files and traffic-log
directory. It prints the exact `systemctl` and `bun remove` steps; it never
touches `agent.db`.

Inside an interactive `omp` session, `/omp-shims` shows the same status and
`/omp-shims <feature> on|off` toggles a feature.

## Migration from v1

The migration script is one-shot and idempotent. A dry run is the default.

```sh
# Stop both services first so no v1 database is being written.
sudo systemctl stop 'omp-auth-gateway@*' omp-auth-gateway.service omp-auth-broker.service

bun ~/.omp/plugins/omp-shims/scripts/migrate-v2.mjs --dry-run
bun ~/.omp/plugins/omp-shims/scripts/migrate-v2.mjs --write
bun ~/.omp/plugins/omp-shims/bin/omp-shims.mjs doctor
```

Options: `--config PATH`, `--state-dir PATH`, `--backup-dir PATH`.

What the migration does:

- Merges the five v1 `antigravity-*` features into `features.antigravity`.
- Drops `features.vendor-shims`. There is no v2 feature with that job.
- Drops `features.native-loop-guard` and writes its enabled value to
  `runtime.thinkingLoopGuard`.
- Carries `lazy-router.routing.excellentPrior` and `.mediumPrior` into the v2
  routing block as inert provenance, and keeps the v1 `temperature` value. v2
  ranks with the continuous intelligence weights.
- Drops the v1 per-database paths (`healthDbPath`, `tokenTotalsPath`,
  `perfStatePath`, `speedStatePath`, `concurrencyProofStatePath`) and writes the
  merged database path to the top-level `stateDbPath`.
- Keeps `pluginBridge.tokens` and every other key.
- Merges `lazy-router-health.sqlite`, `lazy-router-state.sqlite`, and
  `lazy-router-token-totals.sqlite` into `omp-shims-state.sqlite` with the
  canonical v2 schema and `PRAGMA user_version = 2`, including rows still in the
  WAL. It maps health as `cooling -> dead`, `until = 0` (until a probe
  succeeds), and fills the v2 `reason_rank`, `fencing_token`, and lease columns.
  It splits each v1 `totals.model` at the first `/` into the v2 `provider` and
  `model` columns. It copies live affinity rows only. It creates `capacity`
  empty and does not copy `worker_heartbeat` or `attempt`: v2 has no attempt
  table, and copied in-flight slots would leak capacity.
- Reads every v1 database with `readonly: true`, copies inside one transaction,
  and skips a table that a source does not contain.
- Backs up the config and every v1 database (with `-wal` and `-shm`) under
  `~/.omp/omp-shims-backup-<timestamp>` before writing.
- Validates the new config with `validateConfig`; on failure it exits 1 and
  writes nothing.
- Writes the new config `0600` through a temporary file and a rename.

Run the script a second time: it reports `already v2` and changes nothing.

After the migration, replace the installed units (the new templates add
`UMask=0077` and the `omp-auth-gateway@` multi-worker unit), then start the
services:

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.mjs systemd omp-auth-broker \
  | sudo tee /etc/systemd/system/omp-auth-broker.service > /dev/null
bun ~/.omp/plugins/omp-shims/bin/omp-shims.mjs systemd omp-auth-gateway \
  | sudo tee /etc/systemd/system/omp-auth-gateway.service > /dev/null
bun ~/.omp/plugins/omp-shims/bin/omp-shims.mjs systemd omp-auth-gateway@ \
  | sudo tee /etc/systemd/system/omp-auth-gateway@.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now omp-auth-broker.service omp-auth-gateway.service
```

The v1 files stay on disk after the write. Remove them only after `doctor`
passes and the gateway serves traffic.

## systemd

Two single-instance units and one template are provided:

- `omp-auth-broker.service` owns credentials and listens on `127.0.0.1:8765`.
- `omp-auth-gateway.service` serves `127.0.0.1:4000` and wants the broker.
- `omp-auth-gateway@.service` is the multi-worker template. Every instance sets
  `OMP_SHIMS_REUSE_PORT=1`, so the kernel spreads new connections across
  workers. An optional `/etc/omp-shims/%i.env` file can override settings per
  instance.

All units run as the invoking account, use the account's home directory, set
`UMask=0077`, and load both preload entries. `@OMP_USER@`, `@OMP_HOME@`,
`@OMP_BIN_DIR@`, `@OMP_BIN@`, and `@SHIMS_PRELOAD@` are placeholders; the CLI
fills them from the current account. The `env` command prints the preload line
alone.

To run four workers:

```sh
sudo systemctl enable --now omp-auth-gateway@{1..4}
```

`OMP_SHIMS_REUSE_PORT` is read by the gateway process only. Keep the broker as
one instance.

Do not put provider API keys in a unit. Use `omp /login`; it writes to the
agent credential store where the gateway already looks.

### Zero-downtime worker rollout

Never `systemctl restart` a gateway worker in place for a code change: the
restart drops that worker's listener, and restarting every worker drops them
all. Use a blue-green rotation instead. Start a replacement worker, wait until
it is healthy, then stop one old worker. Keep at least four listeners at all
times.

Run this `wait_healthy` check before every stop, and stop the old worker only
when it passes:

```sh
wait_healthy() {
  local id=$1 unit="omp-auth-gateway@$1" pid attempt
  for attempt in $(seq 1 30); do
    if systemctl is-active --quiet "$unit"; then
      pid=$(systemctl show -p MainPID --value "$unit")
      if [ -n "$pid" ] && [ "$pid" != 0 ] &&
        ss -ltnp 'sport = :4000' | grep -q "pid=$pid," &&
        curl -fsS -o /dev/null http://127.0.0.1:4000/healthz; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}
```

The helper retries once per second for up to 30 seconds.

For a four-worker baseline (`@1` to `@4`), the proven sequence is:

```sh
(
  sudo systemctl start omp-auth-gateway@5 && wait_healthy 5 && sudo systemctl stop omp-auth-gateway@1 || exit 1
  sudo systemctl start omp-auth-gateway@6 && wait_healthy 6 && sudo systemctl stop omp-auth-gateway@2 || exit 1
  sudo systemctl start omp-auth-gateway@7 && wait_healthy 7 && sudo systemctl stop omp-auth-gateway@3 || exit 1
  sudo systemctl start omp-auth-gateway@8 && wait_healthy 8 && sudo systemctl stop omp-auth-gateway@4 || exit 1
  sudo systemctl start omp-auth-gateway@1 && wait_healthy 1 && sudo systemctl stop omp-auth-gateway@5 || exit 1
  sudo systemctl start omp-auth-gateway@2 && wait_healthy 2 && sudo systemctl stop omp-auth-gateway@6 || exit 1
  sudo systemctl start omp-auth-gateway@3 && wait_healthy 3 && sudo systemctl stop omp-auth-gateway@7 || exit 1
  sudo systemctl start omp-auth-gateway@4 && wait_healthy 4 && sudo systemctl stop omp-auth-gateway@8 || exit 1
  sudo systemctl reset-failed omp-auth-gateway@5 omp-auth-gateway@6 omp-auth-gateway@7 omp-auth-gateway@8
)
```

The invariant is: before a stop, five listeners answer; after the stop, four;
after the next start, five again. It never falls below four. A listener here is
an active `omp-auth-gateway@` unit whose `MainPID` owns a listening socket on
the gateway port.

The rollout observed 345 `/healthz` samples with 0 failures and a listener
minimum of 4. That is empirical evidence from one rollout, not a mathematical
guarantee. A worker is stopped only after its replacement is healthy, but a
request already in flight on the stopped worker still needs a graceful drain. A
strict zero-loss guarantee requires draining connections before exit.

## How it works

The package wraps the two request-path global surfaces, once each:

- **Inbound** ([`lib/inbound.mjs`](lib/inbound.mjs)) wraps `Bun.serve` and runs
  ordered middleware. It also caches each request body, so several layers share
  one read and one parse.
- **Outbound** ([`lib/outbound.mjs`](lib/outbound.mjs)) wraps `globalThis.fetch`
  and runs ordered handlers. A broken handler is reported and skipped; the call
  continues inward.

Both pipelines expose an idempotent `dispose()`. It removes every registered
handler and restores the original function, but only while the pipeline's own
wrapper is still in place, so a later replacement is never overwritten. No other
module replaces a global function.

[`lib/runtime.mjs`](lib/runtime.mjs) installs enabled features in phase order,
collects a disposer from each, and stops them in reverse order. A feature that
fails to load is reported and skipped: one broken feature must not stop OMP.

[`registry-capture.mjs`](registry-capture.mjs) runs before everything else. It
captures the host exports (`ModelRegistry`, `streamSimple`,
`registerOAuthProvider`) through lazy getters, then restores the native
`Object.defineProperty`. Every timer calls `unref()`, so a short-lived CLI
process is never kept alive.

Credentials have one runtime path: [`lib/credentials.mjs`](lib/credentials.mjs)
opens `agent.db`, reads it read-only for lookups, and writes only the rotated
`kiro` row and its change revision. The CLI account importer
([`lib/account-import.mjs`](lib/account-import.mjs)) is the only other writer of
`auth_credentials`: `add-account` inserts or updates one account, and
`repair-identities` rewrites identity keys. No other module opens the table.

[`lib/sse.mjs`](lib/sse.mjs) is the only event-stream codec: one frame parser,
one incremental scanner that accepts any chunk split, one bounded transform,
and one response rebuilder.

[`lib/tool-id-store.mjs`](lib/tool-id-store.mjs) is the only owner of the
`tool_ids` table. It opens the shared state database with WAL, keeps one
bounded cache in each direction, and prunes expired rows without ever failing a
request.

Only public OMP surface is used: the `ModelRegistry` export and its documented
methods, plus the plugin registration API. No minified identifiers are
referenced.

### Tool-call id shortening

Some providers reject two tool calls whose ids share their first nine
characters when those nine are alphanumeric. Clients mint ids like
`call_0000000000000001` and `call_0000000000000002`, which collide, so the
second call fails with a stream that dies part-way through. Long client ids can
also exceed the 64-character limit that OpenAI-style endpoints accept.

`tool-id-hash` gives every distinct id a 12-character short id: `t_` plus ten
base64url characters of a SHA-256 digest of the whole original. The request
body is rewritten, and the response is walked to put the client's own ids back,
so the client is unaware anything happened. The original is never truncated.

The mapping is a `tool_ids` table in the shared
`~/.omp/omp-shims-state.sqlite`, so every gateway worker and every later
process sees the same short for the same original. A deterministic short needs
one upsert per new id. Each process keeps a bounded 10,000-entry cache in both
directions, and a row's `last_seen` is written at most once a minute. Rows
older than seven days are pruned, and the table is capped at 200,000 rows.

Only id fields are touched: `tool_call_id`, `tool_use_id`, `toolUseId`,
`toolCallId`, `toolCallID`, `toolId`, `call_id`, `callId`, tool-call and
tool-use block ids, `function_call.id`, `function_call_output.call_id`, and the
same shapes nested under `item` or `content`. Arguments, names, and unknown ids
are never rewritten, and a response value that is not a minted short passes
through unchanged. A failure to open or write the store leaves the inbound body
and the response byte-identical: the feature fails open instead of failing a
model request.

## Security

- `~/.omp/shims.json` may hold `pluginBridge.tokens` and
  `cline-pin-upstream.apiKey`. The loader writes it atomically with mode `0600`,
  and `doctor` FAILs when group or other permissions are set.
- The service units set `UMask=0077`. Files the services create under
  `~/.omp` are owner-only.
- Migration output (`shims.json`, `omp-shims-state.sqlite`) is written `0600`;
  backups are `0600` inside a `0700` directory.
- `add-account` and `repair-identities` back up `agent.db` first and never
  print a token.
- Diagnostics go to stderr, never stdout. The CLI prints environment variable
  names, never values.
- `traffic-log` records request metadata. Its default omits bodies. If you
  enable `logBody`, the files contain prompts and tool output; protect the
  directory as you protect the config.
- No credentials, account addresses, or API keys are hardcoded in the package.
  Configure them in `shims.json`, the credential store, or the environment.

Report a vulnerability privately; see [SECURITY.md](SECURITY.md).

## Diagnostics and logs

All diagnostics go to stderr, never stdout.

- `OMP_SHIMS_VERBOSE=1` logs what each feature does.
- `omp-shims doctor` checks the config, permissions, schema, state database,
  and host exports.
- `omp-shims status --json` gives scripts the same state plus ignored legacy
  environment variables and unknown config keys.

Generated files:

| Path | Contents |
| --- | --- |
| `~/.omp/omp-shims-state.sqlite` | One shared state database (`user_version = 2`): routing state, worker heartbeats, affinity counters, token epochs/totals, and tool-call id mappings. |
| `lib/router/status-page/dist/` | Committed status-page build output. Never edit by hand; run `bun run build:status-page`. |
| `~/.omp/logs/lazy-router.jsonl` | Router events. Rotates at 64 MiB, one generation kept. |
| `~/.omp/logs/antigravity-continuation.jsonl` | Continuation diagnostics. |
| `~/.omp/logs/antigravity-streams.jsonl` | Antigravity capture output. |
| `~/.omp/logs/antigravity-accounts.jsonl` | Antigravity account routing log. |
| `~/.omp/gateway-logs/` | Hourly traffic-log files (off by default). |

The CLI removes these files with `uninstall --clean --yes`.

## Development

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git
cd omp-shims
bun install      # installs Biome, the only dev dependency
bun run ci       # Biome check + the test suite
bun run check    # Biome lint + format check
bun run format   # apply formatting
bun test         # run the test suite
```

The package has no build step. Each feature is one file in
[`features/`](features) exporting `install(config, context)`; shared plumbing is
in [`lib/`](lib). See [CONTRIBUTING.md](CONTRIBUTING.md) for the contract-first
workflow and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
