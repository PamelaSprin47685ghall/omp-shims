# omp-shims Status Page v3 — S1 Manual Acceptance Requirements

- **Goal slug**: `status-page-v3`
- **Date**: 2026-11-10
- **Status**: S1 draft for owner confirmation. No code, build, deployment, test, or README change is part of this artifact.
- **Baseline**: `omp-shims` 2.0.0; the current server-rendered dashboard at `GET /`; a four-worker gateway (`omp-auth-gateway@{1..4}`) sharing `~/.omp/omp-shims-state.sqlite`.
- **Evidence root**: `docs/manual-acceptance/status-page-v3/evidence/CASE-XX/`.
- **Normative language**: MUST, MUST NOT, SHOULD. "User-visible" means observable in a browser or in the HTTP response without reading application source.

## 1. Problem statement and root causes

### 1.1 UI defects in the current page

The current page is assembled by `lib/router/status-page.mjs`, `lib/router/status-page/index.html`, `style.css`, `view.mjs`, and `client.mjs`. It is server-rendered under a strict CSP and serves assets from `/assets/lazy-status/*` with `no-store`. The audit found:

- `renderRoute()` returns `<article class="route">` that contains another `<div class="route">`, so every route is a card inside a card. The same `.route` class carries both the outer surface and the inner channel list.
- `renderOverview()` emits nine `.metric` cards with equal visual weight. `.overview` uses three columns, then two columns below 850px; nine items leave a half-empty row.
- The page body is 13px; many labels are 10–11px. The monospace stack has no CJK fallback, so Chinese text in mono contexts falls back unpredictably. `h1` uses `letter-spacing: -0.04em`, which crowds CJK glyphs.
- Tables are left-aligned with no caption, no `scope`, no tabular numbers, and no right-aligned numeric columns.
- `.tree` has no rules for `.leaf` or `.op`; a model leaf and a routing operation look alike.
- Healthy account chips use the neutral `.account` style; `.account.alive` does not exist. Dark link contrast is about 1.6:1 and muted text in light mode is about 4.43:1.
- Reset uses native `confirm()` and `prompt()`. The failure banner is a plain block: it is not sticky, has no live region, and can scroll out of view.
- There is no `<noscript>` notice and no `noindex` directive.

### 1.2 Refresh defects

- `client.mjs` `signature()` covers only period, next switch, catalog readiness, route health/load/reason, and totals. It omits `perf`, `cyclicSpeed`, `affinity`, the top-level global `inFlight`, token coverage, official value, `nextProbeAt`, and alternate-period data. A change in any omitted field does not trigger a page refresh; the displayed value stays frozen.
- A single global `inFlight` boolean guards refresh. If a fetch hangs, every later refresh returns immediately and the page stays frozen forever. There is no `AbortController` timeout.
- Refresh performs two independent requests, first status JSON and then server-rendered HTML. With four workers behind `SO_REUSEPORT`, the two requests can land on different workers and different snapshots. The page can splice a newer overview into an older routes section.
- `fetchPage()` hardcodes `/`, so the page breaks when mounted under a subpath.
- `applyPage()` replaces section children and preserves only the `value-details` open state. Focus, selection, open route details, and scroll position are lost. An old tab throws `界面结构不完整` when a section is renamed or removed.

### 1.3 Statistics defects, including multi-process causes

- `statusView().affinity` is hardcoded to `{}` (`lib/router/router.mjs:1276`), so the affinity metric always renders `—`.
- `ProviderConcurrencyProof` keeps `groups` and `verified` in process memory. `inFlight()` sums only the local process, and `snapshot()` returns only local verified values. The overview labels this "所有 worker" even though it is one worker.
- The shared `proof` table exists, but `setProof()` and `getProof()` are unused. A verified concurrency proof disappears when its worker restarts.
- `speed.observe()` is called only on `FAILURE.CLIENT_GONE` (`router.mjs:982-986`), so only censored samples feed the speed posterior. Healthy completed traffic never updates the prediction.
- `#perfMap()` loops over models and calls `perf.summary()` for each one. `perf.summary()` calls `store.perfWindow()` with one full-window `SELECT` per model. The status path and the routing path both do this.
- `perfWindow(period, sinceMinute)` uses `WHERE period = ? AND minute >= ?` with no upper bound. It includes a 31st bucket and any future bucket written by clock skew or another worker. Aggregation includes imputed samples in `totalMs`. Period attribution can differ between a request's start and the current period.
- `readTokenTotals()` performs three independent reads (`sumTotals`, `readMeta`, `selectTotals`) without one read transaction.
- Reset deletes totals and writes `since` in one transaction, but an in-flight request can commit usage after the reset. One request can be split across epochs or counted in the new epoch even though it started before reset.
- `addTotals` increments `complete` on every usage frame, not once per request. `createUsageTap()` only taps `text/event-stream`; non-SSE JSON responses and direct model calls are not counted. `measureDirect()` measures performance only.
- A read failure returns an empty totals object, so the page shows `0` instead of "unavailable". A `:memory:` store also returns empty data and is reported as if it were available.
- `#bench()` calls `health.markDead()` without checking its boolean result. `markDead()` can reject a stale fenced write, but the router still records local cooling metadata. Cooling `reason` and `nextProbeAt` live only in the local `cooling` map; another worker's cooldown is visible in health but not in the page's reason/next-probe cells.
- Capacity rows become stale after five minutes; another worker reaps them. When the store is unavailable, `InFlightTracker` falls back to a local map and can report local counts as if they were global. `heldOf()` and the page's capacity sum can disagree.
- Account channels are deduplicated by `${model}/${label}`. Two accounts with the same display label collapse into one; totals and availability then undercount. `catalogReady` is local to one worker, and `alternate` is computed but never rendered.

### 1.4 Policy and platform conflicts

- `CONTRIBUTING.md:79-80` says: "Pure ES modules. New source files use the `.mjs` extension. Do not add a build step or a second module format."
- `CHANGELOG.md:123-125` says: "The package is pure `.mjs` with no build step."
- Framework7-Svelte requires a build (Vite + Svelte + `framework7-svelte`) and produces JS/CSS assets. That is a real policy change, not a local detail.
- The current CSP has `style-src 'self'`. Framework7 `setColors()` creates a `<style>` element, and some components set inline `style=` attributes. Both are blocked by strict `style-src`. The project must either keep the strict policy and avoid those components, or explicitly relax the policy for this page.

## 2. Scope and non-goals

### In scope

- A clean-room rewrite of `GET /` with real Framework7 Svelte controls and the Framework7 Material Design (MD) visual language.
- Correct, explicitly scoped statistics for a four-worker gateway: global counters, per-worker detail, shared health/capacity/proof/affinity, and honest unavailable/stale states.
- A single-snapshot refresh model with timeouts, structural version handshake, focus/details preservation, and subpath support.
- Server-rendered initial HTML, a JavaScript-off readable state, and safe hydration.
- Accessibility, security, cache/deployment, reset UX, and rollback behavior.
- The narrow policy amendments needed for the build and the CSP decision.
- Manual acceptance cases and evidence for all of the above.

### Out of scope

- Changing routing, ranking, scoring, admission, or model-selection policy. The page observes the router; it does not decide routes.
- Rewriting the gateway, broker, credential store, provider adapters, or OMP host.
- A new authentication or authorization system. The reset action keeps the existing gateway token contract.
- Native mobile apps, a Framework7 iOS theme, or automatic platform theme switching.
- WebSocket/SSE push for the dashboard. Polling is sufficient for this goal.
- Historical analytics beyond the stated perf window, speed half-life, and token epoch.
- Billing accuracy. Official API value remains an estimate, not an invoice.
- Fixing unrelated OMP bugs or unrelated status JSON consumers.
- Production data migration. The status page reads existing state; schema changes must be additive and migration-safe.

## 3. Decisions (recommended)

| ID | Decision | Recommendation | Why / acceptance consequence |
|---|---|---|---|
| D1 | Build and toolchain | **Option A**: Vite + Svelte + `framework7-svelte`, exact pinned versions; build output committed under `lib/router/status-page/dist/`; CI rebuilds and fails on diff | Satisfies the owner's "real Svelte controls" requirement and keeps install/run build-free. Requires a narrow amendment to `CONTRIBUTING.md:79-80` and `CHANGELOG.md:123-125`. Option B (F7 CSS only) does not satisfy the owner. Option C (precompiled vendor) is not reproducible and is rejected. |
| D2 | Framework7 theme | Pin the **MD** theme explicitly (`theme: 'md'`); no `auto`, no iOS theme on the web dashboard | One deterministic desktop/web design language. iOS users will see Material Design. The iOS/auto limitation must be documented before S2. |
| D3 | CSP for the status page | **Recommended**: keep `default-src 'none'`, `script-src 'self'`, `connect-src 'self'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`; relax only `style-src` to `'self' 'unsafe-inline'` for this page; never allow `unsafe-eval` or inline script | F7's default components and `setColors()` need inline styles; nonce-patching F7 is brittle and would undermine component authenticity. Compensate with full escaping, no user-controlled style values, no `{@html}` with user data, CSP reporting, and XSS cases. If the owner insists on strict `style-src`, the implementation MUST avoid `setColors()` and every component that writes a `style` attribute; CASE-01 may then need a different component set and CASE-11 must prove zero violations. |
| D4 | Data correctness model | Server-owned immutable snapshot; one shared-store read transaction for global values; explicit `snapshotId`, `generatedAt`, `answeredBy`, `buildVersion`, `epoch`; global values only from the shared store, per-worker values labeled "本 worker" | Removes the per-process/global lie and the two-fetch cross-worker splice. The page renders one view model; it does not recompute global totals in the browser. |
| D5 | Deployment and caching | Content-hashed assets with `cache-control: public, max-age=31536000, immutable`; HTML `no-store`; keep the previous release's assets for at least one release; version handshake; subpath-safe URLs; tested rollback | An old tab must not crash or silently display mixed versions. Rollback must not 404 assets that a live tab still references. |
| D6 | Reset UX and semantics | Framework7 Dialog with a password/token field, explicit consequence text, confirm/cancel, pending/error states; global token epoch; no native `prompt`/`confirm`; no token storage | Meets the operator workflow and makes reset atomic across four workers. The epoch is the only way to avoid splitting an in-flight request. |
| D7 | Statistics scope | Fix every page-visible metric in the data contract below, including proof, affinity, perf, speed, health, capacity, token coverage, and official value; count non-SSE and direct usage with an explicit scope label | The owner asked for correct stats under four workers, not only prettier charts. Direct/non-SSE inclusion is the recommended default; see Q5. |

### 3.1 Build policy amendment (D1)

The implementation MUST:

1. Pin exact versions of `svelte`, `vite`, `framework7`, and `framework7-svelte`; no CDN and no floating ranges at release.
2. Commit the built assets and keep the runtime free of Vite/Svelte. The gateway MUST NOT build on startup or on request.
3. Add a CI freshness check equivalent to: build from source, then fail if `git diff --exit-code -- lib/router/status-page/dist` is non-empty.
4. Amend `CONTRIBUTING.md` and `CHANGELOG.md` with a narrow exception: the status page may have a build-time toolchain; the rest of the package remains pure `.mjs` and build-free.
5. Include `lib/router/status-page/dist/` in the packaged files. No dev dependency may be required at runtime.

If the owner refuses the policy change, Option A is blocked. Option B does not satisfy "real Framework7 Svelte controls"; Option C is rejected.

### 3.2 CSP decision (D3)

The exact status-page header MUST be recorded as evidence. If D3 is accepted:

`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`

Additionally: no inline `<script>`, no `unsafe-eval`, no `javascript:` link, no user-controlled value written into a `style` attribute, and no `{@html}` for user or upstream data. A CSP report endpoint MAY be added; it must not receive secrets.

If strict `style-src 'self'` is kept instead, the evidence MUST show zero CSP violations in every browser and every CASE, and the implementation MUST NOT call `setColors()` or use a component that writes inline styles.

## 4. Data contract

### 4.1 Snapshot envelope and consistency

Every status response and the initial HTML MUST expose the same envelope:

- `snapshotId`: opaque and unique per server snapshot.
- `generatedAt`: ISO timestamp taken at the read transaction.
- `answeredBy`: worker identity, e.g. `hostname:pid` or worker instance name. It is diagnostic metadata, not a user-facing metric.
- `buildVersion`: content hash or release identifier.
- `epoch`: current token-totals epoch identifier and `since` timestamp.
- `store`: `{ mode: "sqlite" | "memory" | "unavailable", available: boolean }`.
- `workers`: per-worker rows for in-flight/capacity/health where the data is process-local or heartbeat-based.

Rules:

1. Global counters MUST be read in one shared-store read transaction. A response must never combine `sumTotals` from time T1 with `models` from T2.
2. The initial HTML and the status JSON for that render MUST carry the same `snapshotId`. If refresh still uses two requests, both MUST carry the same `snapshotId`; a mismatch MUST be rejected, not spliced.
3. The browser MUST NOT compute a global total from partial per-worker rows; the server owns global aggregation.
4. Live values are explicit about age. Any heartbeat/capacity row older than 5 seconds is marked stale or excluded from the live sum.
5. If the shared store is unavailable, global metrics are `—` with a visible reason. They are never `0` and never "available".
6. Per-worker values MUST be labeled "本 worker"; they MUST NOT be labeled "所有 worker" or "全局".

### 4.2 Displayed metrics, scope, window, reset, and labels

| ID | Display label (zh) | Value / source | Scope | Window | Reset semantics | Consistency and required label |
|---|---|---|---|---|---|---|
| M01 | 当前时段 | `peak` or `offPeak`, from policy clock | 全局 | now | never | Label the period in words; no raw enum alone. |
| M02 | 下次切换 | Next period boundary and relative time | 全局 | now | never | If no switch within 21 days, say so; do not show an empty value. |
| M03 | 全局在途上游请求 | Sum of live worker attempts currently open | 全局近似 | now; heartbeat age ≤5s | never | Label "全局近似 · 4 workers · 最旧 Ns"; if store unavailable, `—`. Must not be one process's proof counter. |
| M04 | 在途（按 worker） | One row per worker: count, last heartbeat, stale flag | 每 worker | now | never | Label each row with worker identity and age; stale rows are visibly marked. |
| M05 | 可用 / 冷却 / 繁忙账号通道 | Counts per `(provider, accountId, model)` channel from shared health | 全局 | current committed health | never | Label "可用 X · 冷却 Y · 繁忙 Z · 通道 N". Deduplicate by identity, never by display label. |
| M06 | Lazy 路由 / 实际模型 | Route count and distinct provider/model count | 全局 | current plan | never | Label "N 条路由 · M 个模型". |
| M07 | 路由前缀亲和命中率 | `hits / lookups` across all workers | 全局 | rolling 5 minutes | token reset does not affect | Label "近 5 分钟 · 命中 X / 查询 Y"; no lookups → `—`, not `0%`. |
| M08 | 累计未缓存输入 | Provider-reported uncached input tokens in current epoch | 全局 | since epoch | reset starts a new epoch | Label "自 <since> 起 · 已上报 X / Y 请求"; unknown is not zero. |
| M09 | 累计缓存输入 | Provider-reported cached input tokens | 全局 | since epoch | reset starts a new epoch | Same coverage label as M08. |
| M10 | 累计输出 | Provider-reported output tokens | 全局 | since epoch | reset starts a new epoch | Same coverage label as M08. |
| M11 | Token 上报覆盖率 | Per-metric observed requests / completed requests with usage | 全局 | since epoch | new epoch | Label each metric separately; `complete` means completed requests, not usage frames. |
| M12 | 累计官方 API 价格等效价值 | `sum(tokens × pinned official rate)` in USD and CNY | 全局 | since epoch | reset starts a new epoch | Label "按官方标价估算 · 非账单 · N/M 模型已定价 · 基准日 ..."; unpriced models are disclosed, never guessed. |
| M13 | 预测总耗时 | Speed posterior mean for the model | 全局 | 24h half-life; current period | never | Label "全局后验预测"; no sample → `—`. |
| M14 | RD | Rating deviation of the speed posterior | 全局 | 24h half-life | never | Label "RD"; explain it is uncertainty, not a rank. |
| M15 | 证据权重 | Effective posterior weight | 全局 | 24h half-life | never | Label "证据权重"; do not present it as a request count. |
| M16 | 右删失 | Censored observations contributing to the posterior | 全局 | 24h half-life | never | Label "右删失"; separate from complete samples. |
| M17 | 无错并发实证 | Global lower bound of verified concurrent completions for the model | 全局 | TTL (recommended 30 minutes) | token reset does not affect | Label "全局实证下界 · 有效至 ..."; absent → `—`. Must persist across workers and restarts. |
| M18 | 最近完整耗时 | Mean total duration over complete samples only | 全局 | 30 minutes, inclusive | never | Label "近 30 分钟 · 完整样本平均"; imputed samples are excluded from this mean and shown separately. |
| M19 | 30 分钟完整 / 删失样本 | `samples` and `imputedSamples` | 全局 | 30 minutes, inclusive | never | Label both counts; no sample → `—`. |
| M20 | 账号健康 | `alive` / `cooling` / `busy` per channel | 全局 | current committed health | never | Show text plus color; healthy is positively styled, not neutral. |
| M21 | 账号并发 | `held / maxInFlight` from shared capacity | 全局 | now; row age ≤5s | never | Label "全局 X/Y"; unlimited (`maxInFlight = 0`) shows "不限", not `0/0`. |
| M22 | 下次探测 | Shared health `until` or probe lease expiry | 全局 | current | never | Label "下次探测 ..."; must not come from a local cooling map. |
| M23 | 冷却原因 | Sanitized shared health reason | 全局 | current | never | Label the reason; no upstream body, credential, account id, or URL. |
| M24 | 目录就绪 | Per-worker catalog readiness and aggregate | 每 worker + 全局 | current | never | When false, show "目录加载中", not "no accounts"/"no capacity". |
| M25 | 另一时段预览 | `alternate` route view, if retained | 全局 | selected alternate period | never | If retained, label "另一时段预览"; otherwise remove the dead payload. |
| M26 | 共享状态 | `store.mode` and availability | 全局 | current | never | `:memory:` is shown as unavailable for global statistics, not as a working store. |
| M27 | 上次更新 / 快照 | `generatedAt`, `snapshotId`, `buildVersion` | n/a | now | never | Show relative last update; snapshot/build ids live in meta/JSON, not as user-facing telemetry. |

### 4.3 Token reset and epoch semantics

1. Reset affects only token totals and official-value derivation (M08–M12). It MUST NOT change account health, affinity, speed, proof, capacity, or routing.
2. Reset creates a new epoch atomically. The current view MUST show only the current epoch's totals and coverage.
3. A request that starts before reset and completes after reset MUST belong to exactly one epoch — the epoch assigned at request start. It MUST NOT contribute part of its usage to the old epoch and part to the new epoch.
4. A read during reset MUST see either the complete old epoch or the complete new epoch, never a half-deleted totals table.
5. Concurrent resets: one wins; others MUST receive a deterministic success with the same resulting epoch or a documented `409`/idempotent success. No double reset.
6. Reset response MUST include the new `epoch`, `since`, and current totals. The UI MUST NOT report success before the server commits.
7. A failed reset (`503`, `401`, `403`, network) MUST leave totals unchanged and show a retryable error.
8. The UI MUST display "统计自 <since> 起" and the epoch identity in a non-intrusive diagnostic place.

### 4.4 Degradation states

- `store.mode = "memory"` or `available = false`: global metrics are `—`; banner says shared state is unavailable; per-worker values are labeled "本 worker"; no fake `0`, no "available".
- Read failure: retain the last good snapshot, label it with its `generatedAt`, show a sticky banner, and retry. Never replace last-good with zeros.
- Write failure on reset: `503`, error message, no optimistic success.
- Worker death: capacity rows are stale after 5 minutes; mark them stale, exclude them from the live sum, and reap. Do not count them as free capacity.
- Version mismatch: show a reload banner; do not splice incompatible sections; old tab must remain safe.
- Catalog not ready: show "目录加载中"; do not claim "暂无可用账号".
- No samples: `—` with an accessible "无数据" label; never `0 ms`, `0%`, or `0 tokens`.

### 4.5 Formatting and units

- Tokens: exact value below 1,000; `K`, `M`, `B` with one decimal above; exact value in `title` and screen-reader text. A nonzero total MUST NOT render as `0.0 M`.
- Percentages: one decimal; denominator visible in the label.
- Durations: milliseconds below 1s; seconds with one decimal from 1s; minutes/seconds above 60s. Exact value in `title`.
- Numbers: right-aligned and `font-variant-numeric: tabular-nums` in tables.
- Unknown: `—` plus accessible "无数据"; never `0`.
- Account identity: `(provider, accountId)` and `(provider, model)`; display labels are aliases and MUST NOT be used as identity keys. Duplicate labels must not merge rows.

## 5. Manual acceptance cases

### 5.0 Global scoring procedure (applies to every CASE)

**Baseline preconditions**

- **B0 — Four workers**: `omp-auth-gateway@{1..4}` active, `OMP_SHIMS_REUSE_PORT=1`, one shared `stateDbPath` (default `~/.omp/omp-shims-state.sqlite`), four listening PIDs on the gateway port. Evidence: `systemctl status`, `ss -ltnp`, four `MainPID`s, status JSON samples from all four `answeredBy` values.
- **B1 — Clean staging state**: a backed-up/restored staging database, a clean browser profile, and no production reset. Never run destructive reset on production totals.
- **B2 — Real browser**: Chromium (desktop and mobile emulation) plus Firefox; WebKit/Safari if available. Record browser and OS versions.
- **B3 — JS-off**: a separate browser profile or DevTools setting with JavaScript disabled.
- **B4 — Dark/light**: system or page theme forced both ways; record computed colors.
- **B5 — Mobile**: 320×800 and 390×844 touch viewports; desktop 768×1024 and 1440×900.
- **B6 — Synthetic fixtures**: route names containing HTML/XSS payloads, duplicate account display labels, a model with no perf/speed samples, a model with complete and imputed buckets, a limited unit, an unlimited unit, and known token usage. No real credentials, paid requests, emails, or API keys.
- **B7 — Read-only store access**: S4 can run `sqlite3` SELECTs against the staging database. No writes except through the product under test.
- **B8 — Evidence discipline**: screenshots or video for visual/interaction claims; DOM/computed-style snapshots; status JSON; DB query output; server/browser console; HTTP headers; logs. A claim without its named evidence scores zero.

**Scoring**

1. Each CASE has **five user checks (U1–U5)** and **five developer checks (D1–D5)**. Each check is worth at most **20 points**.
2. Each check lists 1–5 observable clauses. If a check has `k` clauses, its score is `round(20 × met_clauses / k)`, integer, half up. A clause is met only with the named evidence. A check with no evidence scores 0.
3. `user_score = U1 + U2 + U3 + U4 + U5`. It is the S4 auditor's subjective willingness-to-pay estimate for the external effect a software user would pay for, grounded in the observed clauses. It is not market data or fabricated user testimony.
4. `developer_score = D1 + D2 + D3 + D4 + D5`. It is the S4 auditor's subjective willingness-to-pay estimate for the internal quality a tool developer would pay for, grounded in the observed clauses.
5. `final_score = min(user_score, developer_score)`. **PASS at `final_score >= 80`; 79 and below FAIL.** Scores are integers. `100`, `80`, `79`, and `60` are all possible.
6. **Hard fail**: any listed hard-fail condition sets `user_score = developer_score = final_score = 0`, regardless of other checks. A hard fail is not offset by a high score elsewhere.
7. **Reproducibility**: two auditors with the same evidence must score within ±5. If they differ by more than 5, re-review the clauses; if still ambiguous, use the lower score. Do not average away a hard fail.
8. **Wow**: no separate threshold. Wow is expressed only by meeting the clauses at a high level; it cannot rescue a CASE below 80 or a hard fail.
9. **Minimum evidence**: every check must name at least one artifact. Automated tests may support evidence but never replace the manual observation required by the CASE. "Not executed" = 0.
10. **Scoring examples**:
    - **100**: every clause in all 10 checks is met with evidence.
    - **80 (PASS)**: U = 100; D = 20 + 20 + 20 + 20 + 0 = 80. The final is 80; PASS.
    - **79 (FAIL)**: U = 100; D = 20 + 20 + 20 + 15 + 4 = 79 (one 4-clause check met 3 clauses; one 5-clause check met 1 clause). The final is 79; FAIL.
    - **60 (FAIL)**: U = 80; D = 60; the final is 60; FAIL.

**CASE score block** (repeated in each case): `U = ΣU1–U5`, `D = ΣD1–D5`, `final = min(U, D)`, PASS ≥ 80, hard fail = 0.

---

### CASE-01 — Framework7 Svelte authenticity and default MD look

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Prove the page is a real Framework7 Svelte application with authentic MD components, not a hand-rolled lookalike.
- **前置条件 / Preconditions**: B0–B8; F7 kitchen-sink reference at the same pinned version; JS enabled; built assets from the committed build.
- **步骤 / Steps**:
  1. Open `/`; inspect the DOM and the F7 app instance. Record the F7 version and theme.
  2. Exercise App, Page, Navbar, Card, List, Accordion, Button, Toast, and the reset Dialog.
  3. Compare the page with the pinned F7 MD kitchen sink at 1440 and 320 for spacing, type scale, surfaces, navbar, and interaction states.
  4. Check dark mode and light mode.
  5. Hydrate a fresh load with cache disabled; confirm one App instance and one navbar.
- **可观察证据 / Observable evidence**: DOM snapshot with F7 classes and CSS variables; screenshots side by side with the kitchen sink; console log; network log showing self-hosted F7 assets; F7 version from the bundle.
- **一票否决 / Hard fail**: no real F7 app/components; CSS-only fake controls; two navbars after hydration; automatic theme switching; a runtime build or CDN dependency.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) the DOM contains Framework7's `.f7-app`, `.page`, and `.navbar` elements created by the F7 runtime; (b) the app reports `theme: md`; (c) mount produces no console error.
- **U2 (3 clauses)**: (a) Card, List, Accordion, Button, and Toast are F7 components; (b) Accordion expands/collapses via F7, Button has F7 pressed/disabled states, Toast appears/dismisses; (c) the reset action opens an F7 Dialog, not a native prompt.
- **U3 (3 clauses)**: (a) the 1440 layout visually matches F7 MD's spacing, type scale, surface/elevation, and navbar; (b) the 320 layout preserves the F7 mobile hierarchy; (c) no hand-built control imitates a native F7 control.
- **U4 (2 clauses)**: (a) dark mode uses F7 dark theme surfaces/text; (b) light mode uses F7 light theme surfaces/text; neither looks like a custom skin bolted on.
- **U5 (2 clauses)**: (a) every interactive element is a real button/link, not a clickable div; (b) hydration leaves exactly one App and one Navbar, with no duplicate event handling.

**Developer checks**

- **D1 (3 clauses)**: (a) `framework7` and `framework7-svelte` are exact-pinned; (b) assets are self-hosted under the page's asset prefix; (c) no CDN and no build at startup/request.
- **D2 (3 clauses)**: (a) the MD theme is explicit in configuration; (b) `auto`/iOS switching cannot occur; (c) the iOS limitation is documented before S2.
- **D3 (2 clauses)**: (a) component state uses F7 APIs/events, not manual class toggles; (b) no duplicate reimplementation of the same control in another component.
- **D4 (3 clauses)**: (a) one F7 App instance after hydration; (b) 100 refresh cycles leave one set of listeners; (c) no detached timers or growing listener counts.
- **D5 (2 clauses)**: (a) any F7 inline-style/`setColors()` usage is recorded against the D3 CSP decision; (b) the recorded CSP evidence matches the actual header and console.

---

### CASE-02 — Information hierarchy, layout, typography, and responsive behavior

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Replace the flat nine-card dashboard and nested cards with a clear hierarchy that works at 320, 768, and 1440 in light and dark mode.
- **前置条件 / Preconditions**: B0–B8; a route set with at least three routes and multiple channels; a 320px viewport; JS enabled.
- **步骤 / Steps**:
  1. Inspect route DOM for nested `.route`/`.card` surfaces.
  2. Count primary overview metrics above the route list; identify secondary metrics.
  3. Check 768 and 1440 grids for an orphan/half-empty row.
  4. Check 320 for page overflow, table overflow, and clipped controls.
  5. Measure computed font sizes, heading letter spacing, and CJK/mono rendering.
  6. Inspect tables for captions, `scope`, numeric alignment, and tabular numbers.
  7. Inspect tree leaf/op styling, healthy/cooling/busy chips, and empty states.
- **可观察证据 / Observable evidence**: screenshots at 320/768/1440 in light/dark; DOM/computed-style snapshots; `scrollWidth` vs `clientWidth`; table DOM; font metrics.
- **一票否决 / Hard fail**: nested route cards; 320px page overflow; nine equal primary metrics; essential text below 12px; numeric table columns unreadable or unlabeled.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (2 clauses)**: (a) no route is a card inside another card (`.route .route` and `.card .card` absent for route surfaces); (b) each route reads as one bounded surface with a header, strategy, and channels.
- **U2 (3 clauses)**: (a) at most four primary overview metrics are visually dominant; (b) the former nine equal cards are gone; (c) remaining metrics are in a secondary section or disclosure, not equal-weight peers.
- **U3 (3 clauses)**: (a) 320 has no horizontal page scroll and no clipped primary action; (b) 768 has no half-empty trailing card row; (c) 1440 uses the width without stretched empty columns.
- **U4 (4 clauses)**: (a) body text is at least 14px and labels at least 12px; (b) CJK is readable in UI text and the mono stack has a CJK fallback; (c) h1 has non-negative letter spacing; (d) tables use caption/scope, right-aligned tabular numbers, tree leaf/op are visually distinct, and healthy chips are positively styled.
- **U5 (2 clauses)**: (a) loading/empty/error states are distinct and explain the next step; (b) light and dark modes both preserve hierarchy and legibility.

**Developer checks**

- **D1 (2 clauses)**: (a) one semantic surface per route; no redundant wrapper for styling; (b) sections have headings and landmarks, not div soup.
- **D2 (3 clauses)**: (a) the overview grid uses auto-fit/minmax or explicit spans so no breakpoint leaves an orphan cell; (b) breakpoints are tested at 320/768/1440; (c) `alternate` is either rendered with a label or removed from the payload.
- **D3 (3 clauses)**: (a) tables use `<caption>` and `scope`; (b) numeric headers/cells are right-aligned with tabular numerals; (c) no div-based table for diagnostics.
- **D4 (2 clauses)**: (a) font sizes come from tokens, not scattered 10/11px literals; (b) the mono stack includes a CJK fallback and is used only for identifiers/numbers.
- **D5 (3 clauses)**: (a) long model/account labels wrap or truncate with a title, not overflow; (b) refresh does not shift layout; (c) no essential status is conveyed by color alone.

---

### CASE-03 — Server-rendered content, JavaScript-off readability, and hydration

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: The initial response is useful without JavaScript, and hydration adds behavior without blanking or shifting the page.
- **前置条件 / Preconditions**: B0–B8; JS disabled profile; slow 3G throttling; clean cache.
- **步骤 / Steps**:
  1. Fetch `/` with a non-browser client and inspect the initial HTML for all dynamic sections.
  2. Open the same URL with JavaScript disabled; screenshot and interact with static content.
  3. Hydrate with JS enabled on a slow connection; record CLS and console.
  4. Compare initial HTML values with hydrated DOM values and `snapshotId`.
  5. Confirm the reset control is disabled with an explanation when JS is off.
- **可观察证据 / Observable evidence**: raw HTML file; JS-off screenshot; CLS measurement; console log; DOM comparison; `snapshotId` in meta/JSON.
- **一票否决 / Hard fail**: blank page with JS off; dynamic content exists only after JS; hydration mismatch or duplicate App; CLS >0.25; no noscript notice.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) initial HTML contains the overview values; (b) initial HTML contains every route, channel, account status, and diagnostics row; (c) no placeholder-only shell is required for first paint.
- **U2 (3 clauses)**: (a) with JS off, the page is readable and navigable; (b) a `<noscript>` notice explains that live refresh and reset need JavaScript; (c) the reset control is disabled with an explanation, not a dead button.
- **U3 (3 clauses)**: (a) no blank screen before hydration; (b) no visible layout shift or FOUC; (c) exactly one navbar/App after hydration.
- **U4 (2 clauses)**: (a) no hydration warning/error in the console; (b) no CSP or asset error during load.
- **U5 (2 clauses)**: (a) initial and hydrated values are identical; (b) the initial and JSON snapshots share the same `snapshotId`.

**Developer checks**

- **D1 (2 clauses)**: (a) the initial HTML and the JSON use the same view model and renderer; (b) no separate client-only data path computes different values.
- **D2 (3 clauses)**: (a) no `window` access at module top level that breaks SSR; (b) F7 App initialization is client-only; (c) content does not depend on F7 JS to exist.
- **D3 (2 clauses)**: (a) `snapshotId` and `buildVersion` are present in meta/JSON; (b) the client reads them rather than guessing.
- **D4 (3 clauses)**: (a) no inline script; (b) CSS is external and CSP-compliant; (c) the header decision from D3 is reflected in the actual response.
- **D5 (2 clauses)**: (a) progressive enhancement covers reset/refresh; (b) no JS-off console errors.

---

### CASE-04 — Refresh correctness, timeouts, and snapshot consistency

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Every displayed field updates, the page cannot freeze, and one refresh never mixes workers or snapshots.
- **前置条件 / Preconditions**: B0–B8; ability to change perf, speed, affinity, proof, in-flight, coverage, official value, and next-probe state on the server; a hanging endpoint; offline mode.
- **步骤 / Steps**:
  1. Focus a control and open a disclosure; change each omitted field; wait at most two refresh cycles; record updates.
  2. Make the status request hang; verify timeout, banner, and recovery on the next cycle.
  3. Capture network requests; verify one snapshot per refresh and matching `snapshotId` if two requests remain.
  4. Hide/show the tab repeatedly; verify no request pileup and one in-flight guard.
  5. Go offline for 30 seconds; verify stale labeling and recovery.
  6. Rename/remove a section on the server; verify the old tab prompts reload rather than throwing.
- **可观察证据 / Observable evidence**: screen recording; network HAR; JSON/HTML snapshots; `snapshotId`; focus/open-state DOM; console; banner screenshots.
- **一票否决 / Hard fail**: permanent freeze; any displayed field never updates; two different snapshots mixed; lost focus/open details; old tab crash.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) perf/diagnostics values update when a new sample lands; (b) speed/RD/weight/censored, affinity, coverage, official value, and next-probe update within two cycles; (c) the top-level global in-flight updates without a full page reload.
- **U2 (3 clauses)**: (a) a hanging request aborts within 10 seconds; (b) a banner appears and the next cycle retries; (c) recovery is automatic and manual retry also works.
- **U3 (3 clauses)**: (a) refresh uses one snapshot; (b) if JSON and HTML remain separate, both carry the same `snapshotId` and a mismatch is rejected; (c) values never come from two different workers in one view.
- **U4 (2 clauses)**: (a) keyboard focus stays on the focused control after refresh; (b) open details, selections, and scroll position survive.
- **U5 (3 clauses)**: (a) offline/slow states are labeled stale with a timestamp; (b) the live indicator does not claim freshness while offline; (c) a changed server structure shows a reload prompt, not a crash.

**Developer checks**

- **D1 (2 clauses)**: (a) the change detector covers every field in the data contract; (b) an automated field inventory fails when a rendered field is omitted from the signature/version.
- **D2 (3 clauses)**: (a) every fetch has an `AbortController` timeout; (b) the in-flight guard is per request and always cleared; (c) visibility/offline/backoff are handled without interval leaks.
- **D3 (2 clauses)**: (a) one request returns the complete view model; or (b) two requests are bound by `snapshotId` and rejected on mismatch.
- **D4 (3 clauses)**: (a) no overlapping refreshes; (b) exponential backoff or equivalent after failure; (c) one timer set after 100 cycles.
- **D5 (2 clauses)**: (a) structural/version mismatch is caught and surfaced; (b) the old tab does not throw or splice incompatible sections.

---

### CASE-05 — Multi-worker in-flight and capacity

- 路径：并发
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Global in-flight and per-unit capacity are correct across four workers and honest about stale/dead workers.
- **前置条件 / Preconditions**: B0–B8; a limited unit (`maxInFlight > 0`) and an unlimited unit; ability to kill one worker; DB access.
- **步骤 / Steps**:
  1. Generate eight concurrent requests to a limited unit; sample status repeatedly.
  2. Compare global in-flight and each per-worker row with `SELECT unit, worker, held FROM capacity`.
  3. Kill a worker while it holds slots; wait and inspect stale/reap behavior.
  4. Check unlimited units; duplicate account labels; catalog-not-ready state.
  5. Hit the page 40 times; group by `answeredBy`; compare global values.
- **可观察证据 / Observable evidence**: DB outputs; status JSON; load log; worker PIDs; screenshots; 40-sample table by `answeredBy`.
- **一票否决 / Hard fail**: a per-process count labeled all workers; displayed sum differs from DB; overlimit; stale rows counted as live; duplicate accounts double-counted.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) global in-flight equals the sum of live per-worker rows within ±1; (b) it is labeled approximate/global; (c) it is not one worker's proof counter.
- **U2 (3 clauses)**: (a) per-worker detail is visible; (b) each row shows worker identity and age; (c) stale rows are marked.
- **U3 (4 clauses)**: (a) capacity sum equals the DB sum; (b) no unit exceeds `maxInFlight`; (c) unlimited shows "不限"; (d) duplicate labels do not merge/duplicate units.
- **U4 (2 clauses)**: (a) a dead worker's rows become stale and are excluded from the live count within 5 minutes; (b) capacity recovers without showing phantom slots.
- **U5 (2 clauses)**: (a) all four workers show the same global values within the freshness bound; (b) `catalogReady=false` shows loading, not "no accounts".

**Developer checks**

- **D1 (2 clauses)**: (a) global in-flight comes from a shared heartbeat/capacity source; (b) no process-local value is labeled global.
- **D2 (3 clauses)**: (a) stale detection is bounded at 5 seconds for live rows and 5 minutes for capacity reaping; (b) stale rows are explicit; (c) no silent inclusion.
- **D3 (3 clauses)**: (a) identity is `(provider, accountId, model)`; (b) display labels are aliases only; (c) counts are distinct.
- **D4 (2 clauses)**: (a) capacity scope (unit vs unit/model) is consistent between page and DB; (b) one aggregate query per snapshot, no per-unit N+1.
- **D5 (2 clauses)**: (a) store unavailable → "—", not local-as-global; (b) tests cover 1/2/4 workers and worker death.

---

### CASE-06 — Global concurrency proof and affinity hit rate

- 路径：并发
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Verified concurrency is a global lower bound that survives workers/restarts, and affinity statistics are real, aggregated, and correctly denominated.
- **前置条件 / Preconditions**: B0–B8; controlled overlapping cohorts on at least two workers; known prefix digests; DB access; restart permission.
- **步骤 / Steps**:
  1. Generate overlapping successful cohorts on workers A and B; record per-worker and page values.
  2. Restart all workers; check proof persistence and TTL.
  3. Drive 20 affinity lookups: 10 with a matching digest, 10 without; compare hit rate to DB counters.
  4. Verify the denominator label and the no-lookup state.
  5. Reset token totals; confirm affinity/proof unchanged.
- **可观察证据 / Observable evidence**: `proof` table rows; status JSON; cohort logs; affinity counter rows; page screenshots; restart timestamps.
- **一票否决 / Hard fail**: affinity hardcoded/always `—`; proof lost on restart; per-process proof labeled global; denominator unlabeled or wrong.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (2 clauses)**: (a) the displayed proof equals the maximum verified cohort across live workers; (b) it is labeled a global lower bound, not a per-worker count.
- **U2 (3 clauses)**: (a) proof survives a full worker restart; (b) it expires at the documented TTL; (c) after expiry it shows `—`, not a stale value.
- **U3 (2 clauses)**: (a) the affinity hit rate matches the controlled 10/20 case within ±1%; (b) the label shows hits and lookups over the stated 5-minute window.
- **U4 (2 clauses)**: (a) no lookups → `—`, not `0%`; (b) token reset does not change affinity or proof.
- **U5 (2 clauses)**: (a) per-worker detail or a clear aggregate is available; (b) no account id, key, or digest content is exposed.

**Developer checks**

- **D1 (3 clauses)**: (a) proof uses the shared `proof` table with a monotonic `MAX` upsert; (b) read path is global; (c) local memory is only a cache.
- **D2 (3 clauses)**: (a) affinity lookups/hits are counted at the actual lookup decision; (b) counters are shared/aggregated across workers; (c) no double count on retry.
- **D3 (2 clauses)**: (a) the window and denominator are explicit in code and label; (b) reset/period semantics are documented.
- **D4 (2 clauses)**: (a) proof TTL and cleanup are bounded; (b) no unbounded proof/affinity rows.
- **D5 (2 clauses)**: (a) JSON and page show the same values; (b) multi-worker tests cover aggregation and restart.

---

### CASE-07 — Token totals, coverage, epoch reset, and formatting

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Token counters are one consistent snapshot, count requests correctly, cover non-SSE/direct usage, and never show impossible or fake values.
- **前置条件 / Preconditions**: B0–B8; clean epoch; controlled SSE, non-SSE JSON, and direct requests with known usage; a long in-flight request; DB access.
- **步骤 / Steps**:
  1. Send known usage: SSE `100/50/20`, JSON `10/5/2`, direct `7/3/1`; compare totals and coverage.
  2. Send one SSE request with two usage frames; verify `complete` increases by one.
  3. Start a long request, reset, then let it finish; inspect both epochs.
  4. Run 100 reads during writes; verify no partial snapshot.
  5. Send output-only/unknown-input usage; verify it is not shown as a valid zero-input total.
  6. Check K/M/B formatting and exact tooltips.
  7. Force a read failure and a `:memory:` store; verify unavailable, not zero.
- **可观察证据 / Observable evidence**: DB totals/coverage/epoch rows; status JSON; request/usage logs; reset responses; screenshots; 100-read comparison.
- **一票否决 / Hard fail**: output-without-input displayed as valid; reset splits a request; `complete` counts frames; read failure shows `0`; approved non-SSE/direct usage silently omitted.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) totals equal the known sums; (b) each metric shows its own observed/total coverage; (c) the epoch `since` is visible and correct.
- **U2 (2 clauses)**: (a) `complete` increases once per completed request; (b) a multi-frame SSE response is not double-counted.
- **U3 (3 clauses)**: (a) non-SSE JSON usage is counted; (b) direct model usage is counted; (c) the scope label says "含直连/非流式" (or the approved exclusion).
- **U4 (3 clauses)**: (a) reset creates a new epoch; (b) an in-flight pre-reset request is not split; (c) concurrent resets yield one deterministic winner.
- **U5 (3 clauses)**: (a) K/M/B formatting is correct and exact values are available; (b) unknown input is labeled unknown, not zero; (c) a read failure/memory store shows unavailable, not `0`.

**Developer checks**

- **D1 (2 clauses)**: (a) totals, coverage, and metadata are read in one transaction; (b) no three-SELECT skew.
- **D2 (3 clauses)**: (a) usage is captured once per request from the final usage; (b) SSE and JSON/direct paths share the same accounting rule; (c) no frame-level `complete`.
- **D3 (3 clauses)**: (a) reset is atomic; (b) epoch is assigned at request start; (c) the current view filters to the current epoch.
- **D4 (2 clauses)**: (a) partial/unknown usage is represented explicitly; (b) validation flags impossible combinations without inventing input.
- **D5 (2 clauses)**: (a) read/write failure surfaces unavailable; (b) tests cover reset races, frames, non-SSE, and direct.

---

### CASE-08 — Performance window, speed posterior, and query shape

- 路径：边界
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: The 30-minute window is exact, imputed samples are separated, period attribution is stable, and the page does not issue one query per model.
- **前置条件 / Preconditions**: B0–B8; seeded `perf` buckets at minute-31, -30, -29, current, and future; complete and imputed samples; a period boundary; query tracing.
- **步骤 / Steps**:
  1. Seed buckets and refresh; record which buckets appear.
  2. Count SQL queries for one status snapshot; verify a batch, not N+1.
  3. Compare the displayed mean with complete-only and imputed-inclusive calculations.
  4. Start a request before a period switch and finish after; verify attribution.
  5. Generate 20 healthy completions; verify speed posterior changes; generate a client-gone; verify only censored increments.
  6. Remove all samples; verify `—`.
- **可观察证据 / Observable evidence**: seeded rows; status JSON; SQL trace/query count; screenshots; speed table before/after; logs.
- **一票否决 / Hard fail**: 31st/future bucket included; imputed sample in the main mean; one query per model; period mismatch; healthy traffic never updates speed.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) the window includes exactly the current minute and the previous 29; (b) minute-31 and future buckets are excluded; (c) the label says "近 30 分钟".
- **U2 (3 clauses)**: (a) complete and imputed samples are shown separately; (b) the main mean uses complete samples only; (c) the counts match the seeded rows.
- **U3 (2 clauses)**: (a) a boundary-crossing request is attributed to its start period; (b) the sample is not lost or duplicated across periods.
- **U4 (3 clauses)**: (a) healthy completions increase speed evidence and change the prediction; (b) a client-gone increments censored only; (c) no sample shows `—`.
- **U5 (2 clauses)**: (a) one batch query serves all models per snapshot; (b) with 50 models the status response stays responsive.

**Developer checks**

- **D1 (3 clauses)**: (a) `perfWindow` has an upper bound; (b) exactly 30 buckets are selected; (c) the minute index supports the query.
- **D2 (2 clauses)**: (a) one query for all models in the status path; (b) no per-model SELECT in the request path.
- **D3 (2 clauses)**: (a) aggregation excludes imputed from `totalMs`; (b) counts remain separate.
- **D4 (2 clauses)**: (a) the sample period is captured at request start; (b) perf and speed use the same rule.
- **D5 (2 clauses)**: (a) speed observes healthy completions; (b) client-gone is the only censored path, and rows merge across workers.

---

### CASE-09 — Shared health, cooling, probing, and fencing

- 路径：异常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Every worker sees the same health reason/deadline/next probe; no probe runs early; a stale fenced write cannot create a local cooldown.
- **前置条件 / Preconditions**: B0–B8; two workers can probe the same `(unit, model)`; clock/log access; health DB access.
- **步骤 / Steps**:
  1. Bench a key on worker A with a `quota` reason and a 10-minute `until`; read worker B's page/JSON.
  2. Attempt a probe on worker B before `until`; check the upstream log and health row.
  3. Run two probes concurrently; verify one claim.
  4. Force a stale fenced `markDead` rejection; verify `#bench` does not record local cooling.
  5. Check a busy key is not counted as cooling.
  6. Wait for `until`; verify one probe and a shared recovery.
  7. Restart a worker; verify reason/until persist.
- **可观察证据 / Observable evidence**: health rows; probe logs with timestamps; status JSON from all workers; event logs; screenshots; restart evidence.
- **一票否决 / Hard fail**: reason/next-probe local-only; probe before `until`; duplicate probes; rejected `markDead` still shown as cooling; busy counted as cooling.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (2 clauses)**: (a) all workers show the same reason and `until`; (b) all workers show the same next-probe time.
- **U2 (3 clauses)**: (a) no upstream probe occurs before `until`; (b) concurrent probes produce one upstream call; (c) logs prove both.
- **U3 (2 clauses)**: (a) a rejected stale write is surfaced as stale, not silently ignored; (b) it does not create a local cooling entry.
- **U4 (2 clauses)**: (a) `busy` is labeled busy and not cooling; (b) busy does not shorten a real cooldown.
- **U5 (2 clauses)**: (a) after `until`, one probe runs and all workers see the result; (b) a worker restart does not erase the shared reason/until.

**Developer checks**

- **D1 (2 clauses)**: (a) health is read/written through the shared store; (b) local mirrors are caches only.
- **D2 (2 clauses)**: (a) `nextProbeAt` comes from `until`/probe lease; (b) no local `cooling` map is authoritative.
- **D3 (3 clauses)**: (a) `claimProbe` lease prevents duplicates; (b) fencing rejects stale writes; (c) a false return is handled.
- **D4 (2 clauses)**: (a) reasons are sanitized; (b) reason ranking preserves a stronger cooldown.
- **D5 (2 clauses)**: (a) multi-worker tests cover claim/fence; (b) no race allows two probes or an early probe.

---

### CASE-10 — Degradation visibility and recovery

- 路径：降级
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Memory fallback, read/write failure, and version mismatch are visible and honest; the banner is sticky/live; recovery works; no fake `0`.
- **前置条件 / Preconditions**: B0–B8; `store: "memory"` configuration; read/write fault injection; an old-build worker; DB lock; a scrolled page.
- **步骤 / Steps**:
  1. Start with a memory store; inspect metrics, labels, and banner.
  2. Force a read failure; inspect last-good/stale labeling and retry.
  3. Force a reset write failure; verify `503` and no success.
  4. Run one old-build worker; inspect mismatch banner and reload path.
  5. Lock the DB; inspect rendering and recovery.
  6. Scroll down; verify the banner remains visible and announced.
  7. Recover; verify the banner clears and values return.
- **可观察证据 / Observable evidence**: status JSON; screenshots; banner DOM/ARIA; logs; reset responses; worker versions; DB state.
- **一票否决 / Hard fail**: memory/read failure shown as `0`/available; false reset success; banner out of view or not announced; secrets/stack traces in the error.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) memory mode is shown as unavailable for global stats; (b) metrics are `—`, not `0`; (c) the page says "本 worker" where applicable.
- **U2 (3 clauses)**: (a) a read failure keeps the last good snapshot with its time; (b) the banner explains the failure; (c) retry recovers without a fake zero.
- **U3 (2 clauses)**: (a) a version-mismatched worker is visible; (b) the page offers reload and does not crash.
- **U4 (3 clauses)**: (a) the banner is sticky at the top while scrolled; (b) it uses a live region/alert role; (c) a retry control is reachable.
- **U5 (2 clauses)**: (a) recovery clears the banner and restores correct values; (b) no secret, account id, URL, or stack trace is exposed.

**Developer checks**

- **D1 (2 clauses)**: (a) store availability is in the view model; (b) `:memory:` is false for global availability.
- **D2 (2 clauses)**: (a) read errors return unavailable/last-good, not empty zeros; (b) stale time is carried.
- **D3 (2 clauses)**: (a) reset failure returns `503`; (b) the UI does not optimistically clear totals.
- **D4 (2 clauses)**: (a) a build/version handshake detects mismatched workers; (b) old tabs are safe.
- **D5 (2 clauses)**: (a) banner a11y is correct and does not auto-hide critical errors; (b) tests cover memory/read/write/mismatch.

---

### CASE-11 — Security, CSP, reset authorization, and leakage

- 路径：安全
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: The page is not an XSS surface, the CSP decision is real, reset is authenticated and HTTPS-gated, and no secret/account data leaks.
- **前置条件 / Preconditions**: B0–B8; XSS fixtures in route/account/model fields; invalid token; non-loopback HTTP; CSP report/console; secret-scan fixture.
- **步骤 / Steps**:
  1. Inject `<img src=x onerror=alert(1)>` and `javascript:` URLs; inspect DOM and console.
  2. Read the CSP header and test every CASE with the console open.
  3. Check `noindex` meta and `X-Robots-Tag`.
  4. Attempt reset over HTTP on a non-loopback host; attempt 401/403/200 with a test token.
  5. Search HTML, JSON, console, logs, and storage for fixture secrets/emails/keys/upstream URLs.
  6. Verify frame-ancestors, nosniff, referrer, and link `rel`.
- **可观察证据 / Observable evidence**: payload screenshots/DOM; CSP header; console; reset responses; storage inspection; header dump; secret-scan output.
- **一票否决 / Hard fail**: XSS executes; token in URL/storage/log; unauthenticated/HTTP reset; missing CSP; leaked secret/account/upstream URL.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) every payload renders as text, not an element; (b) no script runs; (c) attributes and URLs are escaped.
- **U2 (3 clauses)**: (a) the actual CSP header matches the D3 decision; (b) no inline script and no `unsafe-eval`; (c) zero CSP violations in every CASE.
- **U3 (2 clauses)**: (a) `noindex` meta and `X-Robots-Tag` are present; (b) the page is not indexable.
- **U4 (3 clauses)**: (a) reset over non-loopback HTTP is refused; (b) an invalid token gets 401; (c) a valid token is sent only in the Authorization header, not URL/DOM/storage.
- **U5 (3 clauses)**: (a) no email/account id/key/token appears in HTML/JSON/logs; (b) only `https:` source links are rendered; (c) links use `rel="noopener noreferrer"`.

**Developer checks**

- **D1 (3 clauses)**: (a) all dynamic text/attributes use escaping; (b) no `{@html}` with user/upstream data; (c) no user-controlled style values.
- **D2 (2 clauses)**: (a) CSP is least-privilege and scoped to the page; (b) the style relaxation, if any, is documented and tested.
- **D3 (3 clauses)**: (a) token is memory-only and cleared; (b) no token logging; (c) constant-time comparison remains server-side.
- **D4 (2 clauses)**: (a) URL schemes are allowlisted; (b) `rel` and target are safe.
- **D5 (2 clauses)**: (a) security headers are present; (b) tests cover XSS, token, URL, and headers.

---

### CASE-12 — Accessibility and inclusive interaction

- 路径：无障碍
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: The page is usable with keyboard, screen reader, zoom, reduced motion, touch, and both color schemes; contrast meets the audit targets.
- **前置条件 / Preconditions**: B0–B8; 320/768/1440; 200% zoom; keyboard only; screen reader (NVDA/VoiceOver) if available; reduced motion; touch emulation.
- **步骤 / Steps**:
  1. Measure contrast for body, muted, links, chips, table text, dark/light.
  2. Tab through all controls; open/close Accordion; open/close Dialog; Escape.
  3. Inspect `aria-live`, table caption/scope, button names, and focus indicators.
  4. Measure touch target sizes.
  5. Enable reduced motion; measure animation.
  6. Zoom to 200%; reflow at 320.
  7. Inspect CJK/mono rendering.
- **可观察证据 / Observable evidence**: computed contrast values; screenshots; keyboard recording; accessibility tree; touch bounding boxes; reduced-motion screenshots; zoom screenshots.
- **一票否决 / Hard fail**: body/link contrast <4.5:1; keyboard trap; no visible focus; 320 overflow; touch targets <44×44.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) normal text and links are ≥4.5:1 in both themes; (b) the former muted 4.43:1 and dark link 1.6:1 cases are fixed; (c) large text is ≥3:1.
- **U2 (3 clauses)**: (a) every control is reachable by Tab; (b) Accordion works with Enter/Space; (c) Dialog traps focus and returns it on close; focus is always visible.
- **U3 (3 clauses)**: (a) banner/update regions are announced; (b) tables have caption and scoped headers; (c) icon-only buttons have accessible names.
- **U4 (2 clauses)**: (a) touch targets are ≥44×44; (b) reduced motion removes nonessential animation.
- **U5 (2 clauses)**: (a) 200% zoom and 320 reflow preserve content/actions; (b) CJK text is readable with no tofu or clipped glyphs.

**Developer checks**

- **D1 (2 clauses)**: (a) semantic HTML/landmarks; (b) no div-as-button.
- **D2 (2 clauses)**: (a) focus management across refresh/dialog/accordion; (b) no focus loss.
- **D3 (2 clauses)**: (a) contrast tokens are shared; (b) computed tests cover both themes.
- **D4 (2 clauses)**: (a) table caption/scope and numeric headers; (b) status is not color-only.
- **D5 (2 clauses)**: (a) automated axe/manual checks are recorded; (b) keyboard and screen-reader paths pass.

---

### CASE-13 — Deployment, caching, subpath, old tabs, and rollback

- 路径：部署
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: A clean build deploys with immutable assets, old tabs survive, subpath mounting works, and rollback is safe.
- **前置条件 / Preconditions**: B0–B8; two releases; hashed assets; a reverse proxy at `/ops/`; an open old tab; CI; package inspection.
- **步骤 / Steps**:
  1. Build twice; compare output hashes; inspect asset headers and HTML `no-store`.
  2. Open v3 in a tab; deploy a new build; refresh the old tab; inspect version handshake.
  3. Roll back to the previous release; open a new tab and an old tab.
  4. Serve under `/ops/`; test assets, status path, reset path.
  5. Modify source without rebuilding; run CI; expect failure.
  6. Inspect the package for `dist` and runtime dependencies.
- **可观察证据 / Observable evidence**: build logs/hashes; HTTP headers; screenshots; HAR; proxy config; CI output; `npm pack`/package listing.
- **一票否决 / Hard fail**: old tab crashes; current assets 404; hardcoded `/`; build not committed/freshness check absent; rollback broken.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) asset URLs are content-hashed; (b) assets are `immutable`; (c) HTML is `no-store`.
- **U2 (2 clauses)**: (a) an old tab after deploy shows a reload prompt or continues safely; (b) it does not crash or splice incompatible sections.
- **U3 (2 clauses)**: (a) rollback works in a new tab; (b) the previous release's assets remain available for old tabs.
- **U4 (3 clauses)**: (a) `/ops/` serves the page; (b) assets/status/reset paths work under the prefix; (c) no hardcoded root URL.
- **U5 (2 clauses)**: (a) a version mismatch is visible; (b) no mixed-version UI.

**Developer checks**

- **D1 (4 clauses)**: (a) deterministic build; (b) committed output; (c) CI fails on source/output drift; (d) `CONTRIBUTING.md` and `CHANGELOG.md` carry the narrow build exception.
- **D2 (2 clauses)**: (a) N-1 asset retention; (b) 404 triggers a safe reload path.
- **D3 (2 clauses)**: (a) relative/base-aware URLs; (b) subpath test in CI or manual matrix.
- **D4 (3 clauses)**: (a) `dist` is packaged; (b) no runtime build; (c) exact dependency pins.
- **D5 (2 clauses)**: (a) rollback tested; (b) cache headers do not poison a rollback.

---

### CASE-14 — Reset UX, authentication, and global epoch

- 路径：正常
- PASS threshold: 80/100
- 评分细则：U 为用户侧付费意愿估计（ΣU1–U5），D 为开发者侧付费意愿估计（ΣD1–D5），按 §5.0 的子句比例计分；final=min(U,D)；PASS ≥80；硬失败=0。
- **目标 / Purpose**: Reset is a deliberate, accessible F7 dialog; it authenticates correctly; all workers switch one epoch; no request is split.
- **前置条件 / Preconditions**: B0–B8; HTTPS or loopback; valid/invalid token; an in-flight long request; two rapid reset attempts.
- **步骤 / Steps**:
  1. Open reset; inspect the F7 Dialog, consequence text, token field, confirm/cancel.
  2. Cancel/Escape; verify no request and focus return.
  3. Submit an invalid token; inspect the error and token handling.
  4. Submit a valid token; verify pending state, success toast, new epoch, and all-worker agreement.
  5. Reset while a long request is in flight; inspect both epochs.
  6. Double-submit; verify idempotency/409.
  7. Try over non-loopback HTTP; verify refusal.
- **可观察证据 / Observable evidence**: dialog screenshots/DOM; network requests; reset responses; epoch in JSON; DB rows; in-flight request logs; focus trace.
- **一票否决 / Hard fail**: native `prompt`/`confirm`; token stored; split request; partial reset; false success; HTTPS bypass.
- **Scoring**: U = ΣU1–U5; D = ΣD1–D5; final = min(U,D); PASS ≥80; any hard fail = 0.

**User checks**

- **U1 (3 clauses)**: (a) reset opens an F7 Dialog; (b) it has consequence text and a token field; (c) confirm/cancel are clear and accessible.
- **U2 (2 clauses)**: (a) cancel/Escape sends no request; (b) focus returns to the trigger.
- **U3 (3 clauses)**: (a) an invalid token shows a clear error; (b) HTTPS is required outside loopback; (c) the token is not stored or shown after use.
- **U4 (4 clauses)**: (a) success shows a toast and the new epoch; (b) all workers show the same `since`; (c) only token totals reset; (d) health/affinity/speed/proof remain.
- **U5 (3 clauses)**: (a) a pre-reset in-flight request is not split; (b) double-submit does not double-reset; (c) a network failure is retryable and not reported as success.

**Developer checks**

- **D1 (2 clauses)**: (a) dialog pending/error state is real; (b) no optimistic success.
- **D2 (3 clauses)**: (a) auth/CSRF contract is preserved; (b) token is memory-only and cleared; (c) no logging.
- **D3 (3 clauses)**: (a) epoch transition is atomic; (b) all workers read the new epoch; (c) current view filters old epoch.
- **D4 (2 clauses)**: (a) concurrent resets are deterministic; (b) the API documents 401/403/409/503.
- **D5 (2 clauses)**: (a) error tests cover invalid token, network, write failure; (b) no secret in errors/logs.

---

## 6. Open questions for the owner

1. **Q1 — Build policy change.** D1 recommends Option A and a narrow amendment to `CONTRIBUTING.md:79-80` and `CHANGELOG.md:123-125`. If this is refused, the goal is blocked: Option B does not satisfy the owner's Svelte requirement and Option C is rejected.
2. **Q2 — F7 theme pin.** Confirm MD-only for desktop/web, with iOS users seeing Material Design. If a native iOS look is required, that is a separate goal.
3. **Q3 — CSP relaxation.** Confirm `style-src 'self' 'unsafe-inline'` for this page, or require strict `style-src 'self'` and accept a narrower component set. This must be decided before S2 because it changes CASE-01 and CASE-11.
4. **Q4 — Statistics scope.** Confirm all metrics M01–M27 are in scope, or name the subset. The recommended scope is every page-visible metric plus shared proof/affinity.
5. **Q5 — Direct/non-SSE token usage.** Recommend counting it with the label "含直连/非流式". If excluded, the label and CASE-07 U3 must change; silent omission is not acceptable.
6. **Q6 — Reset epoch display.** Confirm the current epoch is shown and old epochs are either hidden or available only in a diagnostic view. Confirm that reset never touches health/affinity/speed/proof.
7. **Q7 — Affinity denominator/window.** Recommend: lookups with at least two candidates and at least one digest, rolling 5 minutes, hits when an eligible unit moves to the front. Confirm or change before S2.
8. **Q8 — Proof TTL.** Recommend 30 minutes, matching the proof's maximum lifetime. Confirm; a shorter TTL may make the lower bound flicker.
9. **Q9 — Browser matrix.** Confirm Chromium + Firefox + WebKit (or Safari) and whether iOS Safari is in scope. The page must at least be readable on WebKit.
10. **Q10 — S4 environment.** Confirm a staging four-worker gateway with synthetic accounts can be used. Production data and paid requests are not acceptable evidence sources.
11. **Q11 — Asset retention.** Confirm retaining the previous release's hashed assets for at least one release. If storage is constrained, define the old-tab 404 behavior.
12. **Q12 — Official value basis.** Confirm official list prices, current reference rates, and "not a bill" labeling. Historical tokens have no request timestamps; peak/off-peak pricing cannot be reconstructed.

## 7. S4 evidence plan

### 7.1 Environment

- Four workers: `omp-auth-gateway@{1..4}` active, `OMP_SHIMS_REUSE_PORT=1`, shared state DB. Record `systemctl status`, PIDs, and `ss -ltnp`.
- Staging state DB: back up, restore a copy, and point the staging config at it. Do not run destructive reset on production.
- Build under test: record git commit, `buildVersion`, F7/Svelte/Vite versions, Bun version, OS, browser versions.
- Synthetic fixtures: XSS route/account names, duplicate labels, limited/unlimited units, complete/imputed perf buckets, known token usage. No real credentials or paid traffic.
- Load: `curl` loops or an existing load generator; record request start/end and worker identity.
- DB: read-only `sqlite3` queries for `capacity`, `proof`, `health`, `perf`, `speed`, `totals`, `metadata`, `affinity`.

### 7.2 Browsers and viewports

- Chromium desktop 1440×900 and 768×1024.
- Chromium mobile emulation 320×800 and 390×844, touch.
- Firefox desktop for CSP/DOM/hydration.
- WebKit/Safari if available; otherwise record the gap and mark affected checks unverified (0, not pass).
- JS-off profile, dark/light, reduced motion, 200% zoom, screen reader if available.

### 7.3 Evidence artefacts

- Screenshots and screen recordings per CASE, full page and focused state.
- Raw initial HTML, DOM snapshot, computed-style dump, accessibility tree.
- Status JSON samples with `snapshotId`, `answeredBy`, `buildVersion`, `epoch`, `store`.
- HAR/network log, request timing, timeout/offline evidence.
- DB query outputs: capacity sums, proof rows, health rows, perf buckets, speed rows, totals/coverage, metadata since.
- Server/browser console and logs; CSP/security header dump.
- Four-worker proof: service status, PIDs, listener table, and samples grouped by `answeredBy`.
- Build/deploy evidence: build hashes, asset headers, CI freshness output, rollback screenshots, subpath HAR.

Naming: `CASE-XX_<subject>_<viewport>_<theme>.<ext>`; DB dumps as `CASE-XX_<table>.txt`. Every screenshot must include the viewport/browser context; crop only after keeping the full-frame original.

### 7.4 Per-CASE must-have evidence

| CASE | Minimum artefacts beyond the common set |
|---|---|
| 01 | F7 DOM/version, kitchen-sink comparison, component interaction video |
| 02 | 320/768/1440 light/dark screenshots, computed fonts, table DOM, overflow metrics |
| 03 | Raw HTML, JS-off screenshots, CLS trace, hydration console |
| 04 | HAR with one snapshot, timeout/offline video, focus/open-state trace |
| 05 | Capacity DB sums, worker kill/reap timeline, 40 samples by `answeredBy` |
| 06 | `proof` rows before/after restart, affinity counters, 10/20 hit-rate log |
| 07 | Totals/coverage/epoch rows, SSE/JSON/direct usage logs, 100-read comparison |
| 08 | Seeded perf rows, query count/trace, complete/imputed calculation, speed before/after |
| 09 | Health rows, probe timestamps, fence rejection log, two-worker screenshots |
| 10 | Memory/read/write failure states, mismatch banner, sticky/live DOM, recovery |
| 11 | XSS payloads, CSP header, reset 401/HTTPS, secret scan |
| 12 | Contrast values, keyboard video, a11y tree, touch boxes, zoom/reduced-motion |
| 13 | Build hashes, asset headers, old-tab/rollback video, subpath HAR, CI output |
| 14 | Dialog video, reset responses, epoch JSON/DB, in-flight reset log, double-submit |

### 7.5 Report

S4 writes `docs/manual-acceptance/status-page-v3/report.md` from its own execution. For each CASE it records: U1–U5 and D1–D5 clause evidence, `user_score`, `developer_score`, `final_score`, hard-fail status, and the PASS/FAIL decision. Any unexecuted path is 0 and is listed as such. Automated test results may be attached but never substitute for the manual evidence above.

## 8. Traceability from the audit to this document

| Audit finding | Covered by |
|---|---|
| Nested `.route` cards | CASE-02 U1/D1 |
| Nine equal metrics; half-empty 2-col row | CASE-02 U2/U3/D2 |
| 320px overflow | CASE-02 U3/D5; CASE-12 U5 |
| 10–13px fonts; no CJK mono; h1 negative tracking | CASE-02 U4/D4; CASE-12 U5 |
| Tables lack alignment/caption/scope | CASE-02 U4/D3; CASE-12 U3 |
| Tree leaf/op no CSS | CASE-02 U4 |
| Healthy chips neutral | CASE-02 U4; CASE-12 D4 |
| Dark link 1.6:1; muted 4.43:1 | CASE-12 U1/D3 |
| Native `prompt`/`confirm` reset | CASE-14 U1/D1 |
| Banner not sticky/live | CASE-10 U4/D5 |
| No `<noscript>` | CASE-03 U2 |
| No `noindex` | CASE-11 U3 |
| Signature omits perf/speed/affinity/in-flight/coverage/value/nextProbe | CASE-04 U1/D1 |
| Global in-flight guard freezes page | CASE-04 U2/D2 |
| Two fetches cross workers | CASE-04 U3/D3 |
| No AbortController timeout | CASE-04 U2/D2 |
| `fetchPage` hardcodes `/` | CASE-13 U4/D3 |
| Focus/details lost | CASE-04 U4 |
| Old tab breaks on section change | CASE-13 U2/D5 |
| `affinity` hardcoded `{}` | CASE-06 U3/U4/D2 |
| Per-process proof/in-flight labeled all workers | CASE-05 U1/D1; CASE-06 U1/D1 |
| `proof` table unused | CASE-06 D1 |
| Speed observes only client-gone | CASE-08 U4/D5 |
| One perf SELECT per model | CASE-08 U5/D2 |
| `perfWindow` no upper bound | CASE-08 U1/D1 |
| Imputed samples in `totalMs` | CASE-08 U2/D3 |
| Period attribution mismatch | CASE-08 U3/D4 |
| `readTokenTotals` three SELECTs | CASE-07 D1 |
| Reset splits in-flight request | CASE-07 U4/D3; CASE-14 U5/D3 |
| `complete` counts usage frames | CASE-07 U2/D2 |
| Non-SSE/direct not counted | CASE-07 U3/D2 |
| Read failure/memory fallback shows 0/available | CASE-10 U1/U2/D1/D2 |
| `markDead` local fence; `#bench` ignores false | CASE-09 U3/D3 |
| Cooling reason/nextProbe local | CASE-09 U1/D2 |
| Capacity 5-min stale/local fallback | CASE-05 U4/D2; CASE-10 |
| Units keyed by `${model}/${label}` | CASE-05 U3/D3 |
| `catalogReady` local | CASE-05 U5/D5 |
| `alternate` computed but unused | CASE-02 D2; data contract M25 |
| Strict CSP vs F7 inline styles | D3; CASE-11 U2/D2 |
| Pure `.mjs`/no-build policy | D1; CASE-13 D1/D4; Q1 |
