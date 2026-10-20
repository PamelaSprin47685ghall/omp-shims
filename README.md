# omp-shims

[![CI](https://github.com/PamelaSprin47685ghall/omp-shims/actions/workflows/ci.yml/badge.svg)](https://github.com/PamelaSprin47685ghall/omp-shims/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Portable compatibility shims for the Oh My Pi (OMP) auth-gateway, packaged as an OMP plugin.

The OMP auth-gateway is a long-running service that answers model requests on
behalf of every client on a machine. Out of the box it cannot serve providers
that come from plugins, and several upstreams (Antigravity / Cloud Code Assist,
ClinePass, ...) need their requests nudged before they work reliably. omp-shims
collects those fixes in one place. Each fix is an independent **feature** that can
be switched on or off without touching code, so the gateway behaves the same way
on every machine.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install](#install)
- [Configuration](#configuration)
- [CLI](#cli)
- [How it works](#how-it-works)
- [Diagnostics](#diagnostics)
- [Development](#development)
- [License](#license)

## Features

| Feature | Default | Purpose |
| --- | --- | --- |
| `plugin-bridge` | on | Loads installed OMP plugins and registers their providers with the gateway's model registry, so `kiro/*` and `commandcode/*` are served natively instead of returning `Unknown model`. |
| `models-bridge` | on | Exposes custom models declared in `models.yml` to the gateway's model registry and supplies credentials, so they can be reverse-proxied. |
| `vendor-shims` | on | Installs the `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` packages that pi provider plugins expect the host to provide, and routes their streaming to the host and to each provider's own transport. |
| `ipv6-first` | on | Connects over IPv6 when a host publishes AAAA records, falling back to IPv4 per address. |
| `antigravity-system-instruction` | on | Sends the Antigravity system prompt as a leading user turn; upstream answers a real `systemInstruction` with a bogus 429. |
| `antigravity-routing` | **off** | Routes Gemini 3.6/3.7/3.8 Flash to the upstream `-tiered` models with a thinking level. |
| `antigravity-continuation` | on | Recovers turns that end thought-only, malformed, or truncated, by replaying them as a real continuation. |
| `antigravity-capture` | on | Writes Antigravity stream diagnostics to a JSONL file. |
| `antigravity-account-routing` | on | Routes Antigravity requests across your configured accounts by tier (see [below](#antigravity-account-routing)). |
| `cline-pin-upstream` | on | Pins ClinePass `chat/completions` requests to a fixed upstream channel. |
| `tool-id-hash` | on | Prefixes every inbound tool-call id with a hash8, and restores the client's ids on the way out (see [below](#tool-call-id-collisions)). |
| `copilot-auto` | on | Negotiates GitHub Copilot `auto` routing and injects the required `Copilot-Session-Token` for gated models. |
| `kiro-credential-sync` | on | Copies kiro-cli's rotated token into the auth-broker credential store so its refresh sweep stops failing. Started by the services only. |
| `traffic-log` | **off** | Logs every inbound gateway request to hourly-rolling files (secrets in headers are redacted). |
| `lazy-router` | **off** | Adds `lazy/default`, `lazy/task` and `lazy/vision`: virtual models that pick the first healthy (provider, credential) unit from a peak-aware route table (see [below](#lazy-router)). |
| `native-loop-guard` | **off** | OMP's own thinking-loop guard. Off by default, because it aborts and retries the identical body; nothing here compensates loops. |

`plugin-bridge` supplies credentials in memory only. Two features do write to
OMP's agent database: `kiro-credential-sync` updates the existing `kiro`
credential row, and `antigravity-account-routing` asks the auth-broker to refresh
tokens that are about to expire. Providers OMP marks invalid (for example after a
failed token refresh) are left alone on purpose: fix those with `/login`.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer (OMP runs on Bun, and the shims use `Bun.serve`
  and `bun:sqlite`).
- An OMP installation with its auth-broker and auth-gateway.
- systemd, if you want to run the services with the provided unit templates.

## Install

The examples assume the package lives at `~/.omp/plugins/omp-shims` and is listed
in the plugins workspace manifest (`~/.omp/plugins/package.json`):

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git ~/.omp/plugins/omp-shims
cd ~/.omp/plugins
# add "omp-shims" to the "dependencies" of package.json, then:
bun install
```

An interactive `omp` session picks the plugin up through its `omp.extensions`
entry. The gateway and the broker load it through Bun's preload mechanism, so
they must be started with both entry points, in this order:

```
registry-capture.js   installs the host-export hook; must be first
preload.js            resolves config and installs the enabled features
```

### systemd units

Two units are provided: the broker (which owns credentials) and the gateway.
The CLI prints them with the paths for the current account filled in:

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js systemd omp-auth-broker \
  | sudo tee /etc/systemd/system/omp-auth-broker.service > /dev/null
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js systemd omp-auth-gateway \
  | sudo tee /etc/systemd/system/omp-auth-gateway.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now omp-auth-broker.service omp-auth-gateway.service
```

The templates in [`systemd/`](systemd) use `@OMP_BIN@` and `@SHIMS_PRELOAD@`
placeholders, which the CLI fills in from your home directory, so the printed
unit is installable as-is on any account. The raw environment line is also
available on its own:

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js env
```

Do not put provider API keys in the unit. Use `omp /login`, which writes to the
agent's credential store where the gateway already looks.

## Configuration

Settings live in `~/.omp/shims.json` (override the path with `OMP_SHIMS_CONFIG`).
They are resolved in this order, last wins:

1. built-in defaults ([`lib/config.js`](lib/config.js));
2. `~/.omp/shims.json`;
3. environment variables.

A feature entry may be a boolean or an object of settings:

```json
{
  "features": {
    "ipv6-first": true,
    "antigravity-routing": { "enabled": true, "effort": "high" },
    "antigravity-continuation": { "enabled": true, "maxContinuations": 3 },
    "traffic-log": { "enabled": true, "dir": "/var/log/omp-gateway" },
    "native-loop-guard": false
  }
}
```

Changes take effect when omp or the service restarts.

### Feature toggles

Every feature can be switched per process with an environment variable
(`on`/`off`, `1`/`0`, `true`/`false`, `yes`/`no`):

```sh
OMP_SHIMS_ANTIGRAVITY_CONTINUATION=off omp
```

| Feature | Environment variable |
| --- | --- |
| `ipv6-first` | `OMP_SHIMS_IPV6_FIRST` |
| `antigravity-system-instruction` | `OMP_SHIMS_ANTIGRAVITY_SYSTEM_INSTRUCTION` |
| `antigravity-routing` | `OMP_SHIMS_ANTIGRAVITY_ROUTING` |
| `antigravity-continuation` | `OMP_SHIMS_ANTIGRAVITY_CONTINUATION` |
| `antigravity-capture` | `OMP_SHIMS_ANTIGRAVITY_CAPTURE` |
| `antigravity-account-routing` | `OMP_SHIMS_ANTIGRAVITY_ACCOUNT_ROUTING` |
| `cline-pin-upstream` | `OMP_SHIMS_CLINE_PIN` |
| `plugin-bridge` | `OMP_SHIMS_PLUGIN_BRIDGE` |
| `models-bridge` | `OMP_SHIMS_MODELS_BRIDGE` |
| `vendor-shims` | `OMP_SHIMS_VENDOR_SHIMS` |
| `tool-id-hash` | `OMP_SHIMS_TOOL_ID_HASH` |
| `copilot-auto` | `OMP_SHIMS_COPILOT_AUTO` |
| `kiro-credential-sync` | `OMP_SHIMS_KIRO_CREDENTIAL_SYNC` |
| `traffic-log` | `OMP_SHIMS_TRAFFIC_LOG` |
| `lazy-router` | `OMP_SHIMS_LAZY_ROUTER` |
| `native-loop-guard` | `OMP_SHIMS_NATIVE_LOOP_GUARD` |

### Per-feature settings

| Feature | `shims.json` setting | Environment variable | Default |
| --- | --- | --- | --- |
| `ipv6-first` | `ttlMs` | `OMP_SHIMS_IPV6_TTL_MS` | `60000` |
| `antigravity-routing` | `effort` | `OMP_SHIMS_AG_EFFORT` | `high` |
| `antigravity-continuation` | `maxContinuations` | `OMP_SHIMS_AG_CONTINUE_MAX` | `3` |
| | `locationRetries` | `OMP_SHIMS_AG_LOCATION_RETRIES` | `3` |
| | `idleTimeoutMs` (0 = none) | `OMP_SHIMS_AG_IDLE_TIMEOUT_MS` | `0` |
| | `out` | `OMP_SHIMS_AG_DIAG_OUT` | `~/.omp/logs/antigravity-continuation.jsonl` |
| | | `OMP_SHIMS_AG_HASH_SALT` | built in |
| `antigravity-capture` | `out` | `OMP_SHIMS_AG_CAPTURE_OUT` | `~/.omp/logs/antigravity-streams.jsonl` |
| | `sampleEvery` (0 = failures only) | `OMP_SHIMS_AG_CAPTURE_SAMPLE` | `0` |
| `antigravity-account-routing` | `ultraAccounts`, `proAccounts`, `cooldownMs`, `ultraModelPattern`, `out` | `OMP_SHIMS_AG_ACCOUNTS_OUT` | none, none, `60000`, `opus\|sonnet`, `~/.omp/logs/antigravity-accounts.jsonl` |
| `cline-pin-upstream` | `host` | `OMP_SHIMS_CLINE_PIN_HOST` | `api.cline.bot` |
| | `upstream` | `OMP_SHIMS_CLINE_PIN_UPSTREAM` | `openai-compatible-private` |
| | `models` (comma list, empty = all) | `OMP_SHIMS_CLINE_PIN_MODELS` | empty |
| | `modelChannels` | | `deepseek-v4.1-flash → deepseek` |
| | `apiKey` | `OMP_SHIMS_CLINE_API_KEY` | none |
| `tool-id-hash` | | `OMP_SHIMS_TOOL_ID_SALT` | empty |
| `copilot-auto` | `apiVersion` | `OMP_SHIMS_COPILOT_API_VERSION` | `2026-08-01` |
| `kiro-credential-sync` | `dbPath` | `OMP_SHIMS_KIRO_SYNC_DB` | `~/.local/share/kiro-cli/data.sqlite3` |
| | `pollMs` | `OMP_SHIMS_KIRO_SYNC_POLL` | `60000` |
| `traffic-log` | `dir` | `OMP_SHIMS_TRAFFIC_LOG_DIR` | `~/.omp/gateway-logs` |
| | `maxAgeMs` | `OMP_SHIMS_TRAFFIC_LOG_MAX_AGE_MS` | `3600000` |
| | `sweepMs` | | `300000` |
| | | `OMP_SHIMS_TRAFFIC_LOG_BODY=0` omits bodies | bodies logged |
| `plugin-bridge` | `pluginsDir`, `plugins` (allow-list) | | `~/.omp/plugins`, all |
| `models-bridge` | `modelsPath` | `OMP_SHIMS_MODELS_PATH` | `~/.omp/agent/models.yml` |
| `vendor-shims` | `pluginsDir` | `OMP_SHIMS_VENDOR_SKIP=1` skips it | `~/.omp/plugins` |
| `lazy-router` | `routesFile`, `holidaysFile` | | bundled `lib/lazy-router/*.json` |
| | `probeIntervalMs`, `probeTimeoutMs` | | `1800000`, `90000` |
| | `headerTimeoutMs`, `providerHeaderTimeoutMs` | | `300000`, `{ "commandcode": 1800000 }` |
| | `statusPath` | | `/v1/lazy/status` |
| | `codexHttpTransport` (sets `PI_CODEX_WEBSOCKET=0`) | | `true` |
| | `out`, `logUpstreamBody` | | none, `false` |

### Plugin credentials

`plugin-bridge` can supply a token for each plugin provider it registers. Declare
them in the top-level `pluginBridge` section; nothing is hardcoded in the package.

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

Supported token sources: `value` (literal), `env`, `json` (a file plus a dotted
`path`), and `sqlite` (a file plus a query returning one text column). Omit a
provider entirely to let OMP resolve its own credential.

### Antigravity account routing

Models matching `ultraModelPattern` (Claude Opus and Sonnet by default; Gemini 4 is
open to Pro accounts)
are sent to the accounts in `ultraAccounts`; everything else goes to `proAccounts`
first and falls back to the Ultra accounts. Within a tier one account is used
until it returns 429, then it cools down and the next one takes over. Accounts are
read from OMP's `agent.db`, matched by e-mail address.

No accounts are built in, so list yours:

```json
{
  "features": {
    "antigravity-account-routing": {
      "ultraAccounts": ["ultra@example.com"],
      "proAccounts": ["pro-1@example.com", "pro-2@example.com"]
    }
  }
}
```

With no `ultraAccounts`, Ultra-only models use the gateway's own credential. With
no `proAccounts`, every account that is not an Ultra account counts as Pro.

### Lazy router

`lazy-router` publishes three virtual models in `/v1/models` (500k context, 64k
output; only `lazy/vision` accepts images). A request for one of them is routed to
the first healthy *unit* in its route table, where a unit is one provider plus one
credential. Units with a `credentialId` are pinned to that `agent.db` credential;
the others use the gateway's own credential.

- **Peak hours**: route tables differ between peak (Beijing time, Mon to Fri,
  09:00-12:00 and 14:00-18:00 on working days) and off-peak. Weekends, public
  holidays and adjusted make-up working days (调休) follow the bundled
  `holidays-cn.json`; years marked `"estimate"` are a best guess until the State
  Council publishes the official schedule.
- **Effort**: entries marked `capped` get `min(requested, medium)`, others `high`,
  stepped down to the nearest level the model supports. Effort and
  `max_tokens = 64000` are always sent explicitly, in each API format's own field.
- **Failure handling**: the verdict is taken on the upstream status, before a byte
  is streamed. A failed unit is probed with `Reply OK`; if the probe fails the
  unit+model cools down (re-probed every `probeIntervalMs`) and the next unit is
  tried at once; if the probe succeeds the same unit is retried once. When every
  unit fails, the last upstream error is returned. There is no load balancing: a
  unit that recovers takes its traffic back.
- **Observability**: the response carries `x-lazy-router-unit` and
  `x-lazy-router-model`; structured events go to stderr (and to `out` as JSONL);
  `GET /v1/lazy/status` (gateway token required) shows the clock, health and routes.

```json
{ "features": { "lazy-router": { "enabled": true } } }
```

The bundled `routes.json` names this deployment's units; point `routesFile` at
your own copy to change them. While the router is on, OpenAI Codex uses HTTP/SSE
instead of its pooled WebSocket so the credential pin applies
(`codexHttpTransport: false` opts out).

## CLI

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js status              # every feature and its state
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js disable antigravity-continuation
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js enable traffic-log
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js env                 # the BUN_OPTIONS line for a unit
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js systemd omp-auth-gateway
```

Inside an interactive omp session, `/omp-shims` shows the same status and
`/omp-shims <feature> on|off` toggles a feature.

## How it works

Features that touch provider traffic are layers around the global `fetch`
([`lib/fetch-chain.js`](lib/fetch-chain.js)). The first layer registered is the
outermost; a layer can rewrite the request, observe the response, or answer on
its own. The order lives in [`lib/bootstrap.js`](lib/bootstrap.js) and carries the
design: `antigravity-continuation` sits above the request rewrites and
`ipv6-first`, so its re-issued calls are rewritten and address-pinned exactly like
the first one.

Features that touch the gateway's inbound requests wrap `Bun.serve`
([`lib/inbound.js`](lib/inbound.js)). `plugin-bridge` and `vendor-shims` hook OMP's
exports through [`registry-capture.js`](registry-capture.js), which must be
preloaded before anything else.

Only public, stable OMP surface is used: the `ModelRegistry` export and its
documented methods, plus the plugin registration API. No minified identifiers are
referenced, so an OMP upgrade does not require changes here. `omp plugin update`
may rewrite `node_modules`; `vendor-shims` reinstalls the vendored packages on
every start.

### Tool-call id collisions

Some providers reject two tool calls whose ids share their first nine characters
when those nine are alphanumeric. Clients mint ids like `call_0000000000000001`
and `call_0000000000000002`, which collide, so the second call fails with a
stream that dies part-way through.

`tool-id-hash` prefixes every id in the inbound request with a hash8 derived from
the id, and walks the response to put the client's own ids back, so the client is
unaware anything happened. Two properties make the prefix safe:

- eight base64 characters carry 48 bits, so two distinct ids essentially never
  share a prefix; and
- the separator after the prefix is not alphanumeric, so even a stricter
  nine-character comparison never sees nine alphanumeric characters.

The transform is deliberately not idempotent: an id that merely looks hashed may
still be one a client minted. Every occurrence of the same id inside a request is
transformed identically, so a tool call and the result answering it always stay
paired. Set `OMP_SHIMS_TOOL_ID_SALT` to re-key ids.

## Diagnostics

All diagnostics go to stderr, never stdout: several omp subcommands parse stdout.

- `OMP_SHIMS_VERBOSE=1` logs what each feature does.
- `OMP_SHIMS_DEBUG_REGISTRY=1` makes `plugin-bridge` print what the registry
  resolved for each provider, the quickest way to explain a model that is
  registered but not served:

  ```
  [omp-shims] registry-state {"provider":"kiro","hasProvider":true,"concreteAuth":true,"models":20}
  ```

- `OMP_SHIMS_VENDOR_SKIP=1` skips installing the vendored packages when diagnosing
  module resolution.
- The Antigravity features write JSONL diagnostics under `~/.omp/logs/`.

## Development

```sh
git clone https://github.com/PamelaSprin47685ghall/omp-shims.git
cd omp-shims
bun install      # installs Biome, the only dev dependency
bun run check    # lint + format check
bun run format   # apply formatting
bun test         # run the test suite
```

The package is plain ES modules with no build step. Each feature is one file in
[`features/`](features) exporting `install(config, context)`; shared plumbing is in
[`lib/`](lib). See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a feature and
what a pull request needs, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
