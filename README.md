# omp-shims

Portable compatibility shims for the OMP auth-gateway, packaged as an OMP plugin.
Each feature is independent and can be switched on or off without touching code.

Install the plugin, drop in the systemd units from the README below, and the
gateway serves plugin providers and repairs the Antigravity request path the same
way on every machine.

## What it does

| Feature | Purpose |
| --- | --- |
| `plugin-bridge` | Loads installed OMP plugins and registers their providers with the auth-gateway's model registry, so `kiro/*` and `commandcode/*` are served natively instead of returning `Unknown model`. |
| `vendor-shims` | Installs the `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` packages that pi provider plugins expect the host to provide, and routes their streaming to the host and to each provider's own transport. |
| `ipv6-first` | Connects over IPv6 when a host publishes AAAA records, falling back to IPv4 per address. |
| `antigravity-system-instruction` | Sends the Antigravity system prompt as a leading user turn; upstream answers a real `systemInstruction` with a bogus 429. |
| `antigravity-routing` | Routes Gemini 3.6/3.7/3.8 Flash to the upstream `-tiered` models with a thinking level. |
| `antigravity-continuation` | Recovers turns that end thought-only, malformed, or truncated, by replaying them as a real continuation. |
| `antigravity-capture` | Writes Antigravity stream diagnostics to a JSONL file. |
| `traffic-log` | Logs every inbound gateway request to hourly-rolling files. |
| `native-loop-guard` | OMP's own thinking-loop guard. **Off by default** and not compensated here. |

Nothing in this package writes to OMP's credential database. Providers OMP marks
invalid (for example after a failed token refresh) are left alone on purpose: fix
those with `/login`.

## Install

```sh
cd ~/.omp/plugins
# add the dependency to the workspace manifest, then:
bun install
```

The plugin is loaded through Bun's preload mechanism, so the gateway must be
started with both entry points, in this order:

```
registry-capture.js   installs the host-export hook; must be first
preload.js            resolves config and installs the enabled features
```

## systemd units

Two units are required: the broker (which owns credentials) and the gateway.
Copy the templates and install them:

```sh
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js systemd omp-auth-broker \
  | sudo tee /etc/systemd/system/omp-auth-broker.service > /dev/null
bun ~/.omp/plugins/omp-shims/bin/omp-shims.js systemd omp-auth-gateway \
  | sudo tee /etc/systemd/system/omp-auth-gateway.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now omp-auth-broker.service omp-auth-gateway.service
```

The templates use `@OMP_BIN@` and `@SHIMS_PRELOAD@` placeholders, which the CLI
fills in from your home directory, so the printed unit is installable as-is on
any account. The raw environment line is also available on its own:

```sh
bun run ~/.omp/plugins/omp-shims/bin/omp-shims.js env
```

Do not put provider API keys in the unit. Use `omp /login`, which writes to the
agent's credential store where the gateway already looks.

## Configuration

Feature selection lives in `~/.omp/shims.json` (override the path with
`OMP_SHIMS_CONFIG`). Every feature defaults to on except `native-loop-guard` and
`traffic-log`.

```json
{
  "features": {
    "ipv6-first": { "enabled": true },
    "antigravity-routing": { "enabled": true, "effort": "high" },
    "antigravity-continuation": { "enabled": true, "maxContinuations": 3 },
    "traffic-log": { "enabled": true },
    "native-loop-guard": { "enabled": false }
  }
}
```

Toggle features with the CLI:

```sh
bun run ~/.omp/plugins/omp-shims/bin/omp-shims.js status
bun run ~/.omp/plugins/omp-shims/bin/omp-shims.js disable antigravity-continuation
bun run ~/.omp/plugins/omp-shims/bin/omp-shims.js enable traffic-log
```

Every feature can also be switched per-process with an environment variable,
which is convenient for testing one change without editing the config:

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
| `plugin-bridge` | `OMP_SHIMS_PLUGIN_BRIDGE` |
| `vendor-shims` | `OMP_SHIMS_VENDOR_SHIMS` |
| `native-loop-guard` | `OMP_SHIMS_NATIVE_LOOP_GUARD` |
| `traffic-log` | `OMP_SHIMS_TRAFFIC_LOG` |

Per-feature settings can also be given directly, for example
`OMP_SHIMS_AG_EFFORT=high`, `OMP_SHIMS_AG_CONTINUE_MAX=3`,
`OMP_SHIMS_AG_LOCATION_RETRIES=3`, `OMP_SHIMS_AG_CAPTURE_SAMPLE=25`.

## Credentials

`plugin-bridge` needs a token for each plugin provider it registers. Declare them
in the same file; nothing is hardcoded in the package.

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
path), and `sqlite` (a file plus a query returning one text column). Omit a
provider entirely to let OMP resolve its own credential.

These tokens are applied in memory. They do not touch the credential database.

## Upgrading

The shims hook only public, stable OMP surface: the `ModelRegistry` export and its
documented methods, plus the plugin registration API. No minified identifiers are
referenced, so an OMP upgrade does not require changes here.

`omp plugin update` may rewrite `node_modules`; the `vendor-shims` feature
reinstalls the vendored packages on every start, so nothing needs doing by hand.

## Diagnostics

```sh
OMP_SHIMS_VERBOSE=1 bun run ~/.omp/plugins/omp-shims/bin/omp-shims.js env
```

With `OMP_SHIMS_DEBUG_REGISTRY=1` the bridge prints what the registry resolved for
each provider, which is the quickest way to explain a model that is registered but
not served:

```
[omp-shims] registry-state {"provider":"kiro","hasProvider":true,"concreteAuth":true,"models":20}
```

`OMP_SHIMS_VENDOR_SKIP=1` skips installing the vendored packages when diagnosing
module resolution.
