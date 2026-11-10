# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `antigravity-unpause.js`: opt-in preload that re-enables the
  `google-antigravity` provider paused by OMP 18.18.6 (a catalog `disabled` auth
  rule hides the provider and rejects its credentials). It removes the catalog
  flag and registers the built-in OAuth definition as a runtime provider;
  `omp-shims antigravity-login` runs `omp login google-antigravity` with the
  preload. Re-enabling the provider can get the account banned.
- `profile`: opt-in per-stage CPU attribution for the gateway request path
  (`OMP_SHIMS_PROFILE=1`), one aggregate line per window; off by default.
- `lazy-router`: `OMP_SHIMS_REUSE_PORT=1` lets several gateway workers bind the
  same address, so the kernel spreads new connections and each connection keeps
  its worker (and its prompt-cache affinity).
- `lazy-router`: cooldowns are shared between workers through
  `~/.omp/lazy-router-health.sqlite` (`OMP_SHIMS_LAZY_HEALTH_DB_PATH`). State
  changes are written through, each worker mirrors rows written by the others,
  and a probe runs only in the worker that wins the row's lease.
- `lazy-router`: in-flight limits, admission windows and Antigravity account
  cooldowns are shared between workers through
  `~/.omp/lazy-router-state.sqlite` (`OMP_SHIMS_LAZY_STATE_DB_PATH`). The
  semaphore is per worker with a heartbeat and stale-row reaping; a store
  failure degrades to per-worker accounting instead of rejecting traffic.
- `lazy-router`: the perf window, cyclic speed statistics, concurrency proofs
  and affinity prefixes are shared through the same store (eventual
  consistency: write-through plus a 2 s refresh). Speed rows are per worker and
  summed on read; affinity falls back to the shared table only on a local miss.
  Concurrency proofs are computed from shared attempt intervals: the verified
  number is the largest count of successful attempts that were *emitting tokens*
  at the same instant across every worker, not the largest per-worker cohort.
  The interval starts at the first output token, so time spent waiting for it
  (queueing, prompt processing) never counts as concurrency.
- `lazy-router`: the status page shows the gateway-wide in-flight request count
  (open upstream attempts across live workers) as its first metric.
- `lazy-router`: the Mistral Vibe per-key model cap is 60 concurrent requests
  (was 20).
- `lazy-router`: the router event log rotates at 64 MiB
  (`OMP_SHIMS_LAZY_EVENT_LOG_MAX_BYTES`, one generation kept) instead of growing
  without bound.

### Changed

- Performance, request path: a request body is read and parsed once and shared
  by every inbound layer (optional-null normalization, tool-id hashing, the
  router, the provider fallbacks) instead of four to five times. `rewriteBody`
  shallow-copies the body instead of `structuredClone`-ing a multi-megabyte
  transcript. Measured on a 1.2 MB transcript: 204 ms → 116 ms CPU per request,
  RSS 1.5–2.2 GB → ~1.0 GB.
- Performance, tool-id-hash: a body with no tool-call id is left untouched, ids
  are re-serialised once (not twice), and the SSE restore path forwards chunks
  with no minted id (`_h`) as raw bytes without decoding or parsing them.
- Performance, `lazy-router`: token-usage walks run only for events that carry
  a usage container; the perf window is written 5 s after the last sample
  instead of synchronously on every answer; recorded affinity prefixes round
  down to a 16 KiB grid, which bounds the number of digests a lookup computes.
- Performance, `gateway-compat` and `copilot-auto`: both work on the shared
  parsed body, and the Copilot rewrite parses only bodies that name an auto
  model.


- `lazy-router`: add `lazy/weak`, a text-only 250K-context / 32K-output route for Command Code Laguna S, Command Code Glyph Cluster Free, Mistral Small, and OpenCode Iceman Contributor Free.
- `mistral-vibe`: browser PKCE login, account-scoped dynamic model discovery, and OpenAI-compatible transport for Vibe subscription models, including 1M-context GLM 5.3 Flash and Mistral Large 4.
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
- `lazy-router`: route entries can fix an effort level, and the attempt layer can
  translate that level into provider-specific request fields when needed.
- `vendor-shims`: a provider plugin that streams through a standard api
  (`openai-responses`, `openai-completions`) no longer dies when the host
  exports no `streamSimple` for it (the gateway bundle exports none). The shim
  issues one minimal call to the model's Provider API through the transport's
  own fetch, so a `403 upgrade_required` reaches the transport and it falls back
  to `/alpha/generate` as designed; any other answer still reports the missing
  transport. Command Code `reflection/beam:free` works again on Go plans.
- `lazy-router`: provider-plugin crashes and Qoder's reformatted quota codes now
  cool the failing unit instead of probing it. Qoder answers 110/113/116/117/
  118/119/122 as English `code N` after its plugin rewrites the error, and the
  table only matched the Chinese `错误码 110`; plugin crashes such as
  `e.content.length` would have been re-probed into the same crash. Both bench
  at once and the request moves to the next unit.
- `lazy-router`: rolling per-model serving performance. Every streamed answer —
  routed or a direct model id — is measured for first-token latency (request to
  the first event only the model can produce, not the gateway's own preamble)
  and generation speed (the provider's own output-token total over the time
  those tokens took), plus the average total request duration, which counts
  every measured answer, streamed or delivered whole. Sums live in one-minute
  buckets over a 30-minute window,
  so a long answer weighs what it should and a fixed model recovers inside the
  window. `GET /v1/lazy/status` exposes them as `perf`, the page shows two
  three columns per route row plus a per-model table, and chat streams now ask for
  `stream_options.include_usage` so the token totals exist to measure. A model
  with more than 100 samples in the window and an average total duration above
  10 s (`degradeMinSamples` / `degradeTotalMs`) is marked degraded: its rows
  turn red, and the router tries every healthy unit in table order before any
  degraded one. A prefix-affinity match still outranks the rule, so a warm prefix
  keeps its unit even while that model is red. The verdict is latched for 30
  minutes (`degradeHoldMs`), so a model near the ceiling cannot flap between the
  two groups; after the period the window decides again and a still-slow model is
  latched for another period.
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

### Removed

- The hand-written `mistral-vibe` provider, transport, browser login and gateway
  fallback. OMP now ships a native `mistral` provider (`/login mistral`); its
  official `openai-completions` transport handles Mistral's structured
  `thinking` content through `mistral-reasoning-content-parts`. Lazy routes now
  use `mistral/*`, and the shim no longer overrides the provider's error
  classification or response stream.

### Changed

- `lazy-router`: `mistral-vibe/zai-glm-5-3-flash` is the first medium-tier fallback in `lazy/default`; `xai-oauth/grok-4.7` is no longer routed by Lazy.
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

- `lazy-router`: Responses and Messages requests to a native Mistral model now
  carry the caller's reasoning effort (`reasoning.effort`, `output_config.effort`,
  or an explicit thinking budget). They previously sent none, so the model never
  produced thinking on the typed routes while `/v1/chat/completions` did.
- `mistral-vibe`: the response adapter now recognises the original host in the
  `Host` header when `ipv6-first` rewrote the URL to an address literal. Without
  it the adapter never matched, so Mistral's structured `thinking` content was
  not normalized on the typed routes and visible text became `[object Object]`.
- `lazy-router`: the Chat→Messages/Responses bridge keeps reasoning. Messages
  streams `thinking` and `signature_delta` blocks, Responses streams a
  `reasoning` item with `response.reasoning_summary_text.*` events, and both
  non-streaming responses carry the reasoning item. Previously Messages
  streaming dropped it and Responses reported it only in the terminal event,
  without an id.
- `lazy-router`: bridged responses mint protocol-shaped ids (`resp_`, `msg_`,
  `rs_`, `fc_`) instead of reusing the chat completion's `chatcmpl-`/`shim_`
  ids, so the id prefix no longer changes with the serving provider.
- `lazy-router`: thinking replayed through the Chat bridge is written as
  `reasoning_content` (the only field `openai-chat-server` turns into a
  thinking block), and Mistral's replayed thinking survives an OMP split
  reasoning item.
- `lazy-router`: `responses-wire` keeps reasoning in both directions
  (`responsesAsChat`, `chatAsResponses`, `responsesSseAsChat`), including
  `encrypted_content` and the client's `include` list.
- `tool-id-hash`: restore ids in typed streaming events
  (`content_block.id`, `item.call_id`) and hash Responses `call_id` pairs, so a
  tool call and its result keep the same id in Messages and Responses.

- `mistral-vibe`: replayed thinking matches the official Vibe CLI
  `_message_payload`: `{type:"thinking", thinking:[{type:"text", text}]}` plus
  a following text chunk. The CLI does not send `signature` or `closed`.
- `mistral-vibe`: Responses and Messages no longer have their own item mapper.
  OMP's `parseRequest` turns either dialect into its context, the existing
  Mistral chat transport serves that context, and OMP's `encodeResponse` /
  `encodeStream` write the caller's protocol back.
- `lazy-router`: an OpenCode Go monthly usage limit (`GoUsageLimitError`,
  including a 200 stream that only later emits the error) cools that unit at
  once and the request moves to the next unit, instead of being returned
  downstream.
- `mistral-vibe`: the stock-host Mistral fallback drops the OpenAI `user`
  field before calling Mistral, which rejects it with `422 extra_forbidden`.
- `mistral-vibe`: preserve Mistral structured `thinking` content blocks by normalizing them to the OpenAI-compatible `reasoning_content` field before OMP parses chat completions, for both SSE and non-streaming JSON responses.
- `plugin-bridge`: preload async provider plugins before OMP startup and synchronously override built-in providers before the first `ModelRegistry.getAll()`, so Command Code models such as `stealth/glyph-cluster:free` use the plugin `commandcode-custom` transport instead of a stale native provider.
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
