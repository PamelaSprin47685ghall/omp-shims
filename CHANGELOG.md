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
- `lazy-router`: a status page at `GET /` (public, self-contained, auto-refreshing),
  and `nextSwitch` / `alternate` (the other period's order) in the status JSON.
- `lib/credential-pin.js`: request-scoped credential pins that other features honour.
- `models-bridge`: expose custom providers and models declared in `models.yml` to the
  auth-gateway reverse proxy, supplying credentials in memory and making them routable.

### Changed

- `antigravity-account-routing`: Gemini 4 is no longer Ultra-only (default
  `ultraModelPattern` is now `opus|sonnet`), and requests pinned by `lazy-router`
  pass through untouched.
- With `lazy-router` enabled, OpenAI Codex uses HTTP/SSE instead of its WebSocket
  transport (`PI_CODEX_WEBSOCKET=0`), so per-request credential pins apply.

### Security

- Removed the hardcoded ClinePass API key and the built-in Antigravity account
  e-mail addresses. Configure them in `~/.omp/shims.json`
  (`cline-pin-upstream.apiKey` or `OMP_SHIMS_CLINE_API_KEY`;
  `antigravity-account-routing.ultraAccounts` / `proAccounts`).

### Fixed

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
