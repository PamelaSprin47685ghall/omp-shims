# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `lazy-router`: `lazy/default`, `lazy/task` and `lazy/vision` virtual models that
  route each request to the first healthy (provider, credential) unit of a
  peak-aware route table, with explicit effort and `max_tokens`, probe-based
  cooldown and failover, background recovery probes, and `GET /v1/lazy/status`.
  Off by default.
- `lazy-router`: route entries select accounts by tier (`plus`, `pro`, `ultra`, ...)
  instead of naming credentials. Tiers are read at runtime (Codex plan claim,
  Antigravity paid tier) and new logins join their tier without a config change.
  Units are labelled `provider:tier#n`.
- `lazy-router`: `GET /v1/lazy/status` is public and shows only unit labels,
  models, health, sanitized cooldown reasons and next probe times.
- `lazy-router`: a status page at `GET /` (public, server-rendered, auto-refreshing,
  same-origin assets under `/assets/lazy-status/`), and `nextSwitch` / `alternate`
  (the other period's order) in the status JSON, which lists only units that can
  serve each route.
- `sse-heartbeat`: SSE `: keep-alive` comments between events after an idle
  interval (default 15 s) on every gateway event stream, plus
  `X-Accel-Buffering: no` / `Cache-Control: no-transform`. Gateway process only;
  off by default.
- `lazy-router`: a route entry can fix its effort level (`"effort": "low"`). The
  Command Code `minimax-m3.1-flash:free` entries think at `low`; its trait
  correction marks it reasoning-capable (low/medium/high), and the attempt layer
  writes `params.reasoning_effort` into the provider body, which the plugin would
  otherwise drop.
- `lib/credential-pin.js`: request-scoped credential pins that other features honour.
- `models-bridge`: expose custom providers and models declared in `models.yml` to the
  auth-gateway reverse proxy, supplying credentials in memory and making them routable.
- `lazy-router`: prefix-cache affinity. Requests are reduced to a canonical
  transcript (the same bytes for the same conversation in Chat, Responses and
  Messages); after serving, the digest of its first half is recorded against the
  unit for 5 minutes, and a request starting with a recorded prefix tries that
  unit first (longest match wins).
- `lazy-router`: per-unit `maxInFlight` (routes.json or shims.json; 0 = unlimited),
  counted at the outbound fetch layer until each provider call's body ends, and
  cache-aware admission: a limited unit takes only requests whose cached share is
  in the best `maxInFlight / N` of its last 5 minutes. `ollama-cloud` is limited
  to 3 per key.
- `lazy-router`: the status JSON and page show the in-flight load of limited units
  and the affinity map's size and hit rate.

### Changed

- `lazy-router`: `ollama-cloud/glm-5.3-flash` now comes before
  `cline-pass/glm-5.3-flash` in `lazy/default`, so its slots fill first and the
  overflow goes to ClinePass.
- `antigravity-account-routing`: Gemini 4 is Ultra-only again (default
  `ultraModelPattern` is `gemini-4|opus|sonnet`): Pro accounts list it but cannot
  serve it. Requests pinned by `lazy-router` pass through untouched.
- `lazy-router`: the bundled tables apply the same split. The `gemini-4-argon`
  entry takes Ultra accounts only; the `gemini-3.8-flash` entries take Pro
  accounts first, then Ultra.
- With `lazy-router` enabled, OpenAI Codex uses HTTP/SSE instead of its WebSocket
  transport (`PI_CODEX_WEBSOCKET=0`), so per-request credential pins apply.

### Security

- Removed the hardcoded ClinePass API key and the built-in Antigravity account
  e-mail addresses. Configure them in `~/.omp/shims.json`
  (`cline-pin-upstream.apiKey` or `OMP_SHIMS_CLINE_API_KEY`;
  `antigravity-account-routing.ultraAccounts` / `proAccounts`).

### Fixed

- `plugin-bridge`: a registry is populated once and again after each `refresh()`,
  instead of on every `getAll()`. The lazy-router catalog now also recognises the
  live registry from `getAvailable` and `registerProvider`, which it had relied on
  the per-read registration to trigger.
- Qoder logins no longer overwrite each other: the plugin stores the placeholder
  e-mail `user@qoder.com.cn` for accounts without one, and OMP keyed every login
  on it. Logins and refreshes now carry `accountId` = the Qoder user id
  (`lib/oauth-identity.js`), so each account is its own row and lazy-router unit.
- `lazy-router`: Qoder signs each request with the account token, so a pinned
  Qoder unit hands its account's token to the plugin transport instead of
  swapping headers on the wire (`TRANSPORT_PINNED_PROVIDERS`).

### Added

- `omp-shims add-account <provider> <plugin-package>` (token on stdin) and
  `omp-shims repair-identities <provider>`.

- `lazy-router`: a client that closes its request no longer benches the unit
  serving it (a `499` used to put healthy units into a 30-minute cooldown), and
  the router stops there instead of probing, retrying and failing over for
  nobody.
- `lazy-router`: a provider call that dies on a stale keep-alive connection
  before any answer is retried at once on a fresh connection instead of after a
  probe.
- `lazy-router`: an exhausted quota (`402`, `insufficient_quota`, Qoder `错误码 110`, ...)
  cools the unit without a wasted probe and fails over within the same request.
- `plugin-bridge`: registration lines are logged when a provider's state changes,
  not on every registry pass (several hundred lines an hour), and the
  `syncExtensionSources` wrapper is installed once per registry instead of
  being restacked on every pass.

- `models-bridge`: `ModelRegistry.getAll()` no longer re-reads models.yml,
  re-registers every provider and stacks another `syncExtensionSources` wrapper on
  each call. A registry is populated once and again after each `refresh()`. Under
  frequent lookups the stacked wrappers made the gateway spin at 100% CPU.
- `lazy-router`: model lookups share one registry listing per 5 seconds.

- Generated systemd units now contain a live `BUN_OPTIONS` preload line; it was
  printed commented out, so units installed as-is ran without the shims.
- `tool-id-hash`: Anthropic `tool_result` blocks now get the same id as the
  `tool_use` they answer.
- `antigravity-continuation`: sanitizing a malformed terminal event no longer
  produces invalid JSON (`"finishMessage"` is blanked instead of removed).
- `OMP_SHIMS_CLINE_PIN_HOST`, `OMP_SHIMS_CLINE_PIN_UPSTREAM`,
  `OMP_SHIMS_CLINE_PIN_MODELS`, `OMP_SHIMS_CLINE_API_KEY` and `OMP_SHIMS_AG_EFFORT`
  now take effect and override `shims.json`; before, they were ignored.
- Interactive `omp` sessions share one feature context, so `plugin-bridge` sees
  the transport registry published by `vendor-shims`.
- `traffic-log` no longer spins on a non-numeric `sweepMs`, and fails soft
  outside Bun.
- Removed a duplicated `tool-id-hash` key from the built-in defaults.

### Changed

- The minimum Bun version is now 1.2.0, the oldest release the test suite passes
  on.
- `preload.js` and `index.js` share one bootstrap (`lib/bootstrap.js`).
- Bare CommonJS `require()` calls replaced by ES module imports.

### Added

- `copilot-auto`: GitHub Copilot Auto model negotiation and dynamic `Copilot-Session-Token`
  injection for gated models (`mai-code`, `gpt-5.6-luna`, etc.).
- Test suite (`bun test`), Biome lint/format config, GitHub Actions CI.
- README rewrite with complete configuration reference, CONTRIBUTING, SECURITY,
  issue and pull request templates, `.editorconfig`.

## [1.0.0]

- Initial release: portable omp-shims plugin.

[Unreleased]: https://github.com/PamelaSprin47685ghall/omp-shims/compare/00842f8...HEAD
[1.0.0]: https://github.com/PamelaSprin47685ghall/omp-shims/commit/00842f8
