# omp-shims Status Page v3 — S2 Development Guide

- **Goal slug**: `status-page-v3`
- **Date**: 2026-11-10
- **Status**: S2 draft for owner confirmation. This guide describes an implementation; it does not implement it.
- **Inputs**: the confirmed S1 requirements at `docs/manual-acceptance/status-page-v3/requirements.md` and the owner decisions D1–D6.
- **Normative language**: MUST, MUST NOT, SHOULD. A path without a leading `/` is relative to the repository root.
- **Review rule**: every claim about current behaviour below is grounded in the files named in §2. Claims marked `[INFERENCE]` are design inferences, not observations.

---

## 0. Decisions, invariants, and scope

### 0.1 Confirmed decisions

| ID | Decision | Consequence for this guide |
|---|---|---|
| D1 | Vite + Svelte + `framework7-svelte`; exact pins; build output committed under `lib/router/status-page/dist/`; CI rebuilds and fails on drift; runtime remains build-free | §7.1–§7.5; `CONTRIBUTING.md` and `CHANGELOG.md` amendments |
| D2 | Fixed Framework7 Material Design theme | `<App theme="md">`; no `auto`, no iOS app theme |
| D3 | Status-page CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'` | §6.1; no inline script, no `unsafe-eval` |
| D4 | Correct every page-visible statistic M01–M27, including direct/non-SSE token usage with explicit scope labels | §3.2–§3.9 |
| D5 | Hashed immutable assets; HTML `no-store`; version handshake; subpath-safe; N-1 asset retention; tested rollback | §5.6, §7.5–§7.8 |
| D6 | Framework7 Dialog reset; global token epoch; no native `prompt`/`confirm` | §4.6, §3.7 |

S2 adopts the S1 recommended defaults for the remaining open questions: affinity window 5 minutes and a hit only when an eligible unit moves to the front (Q7); proof TTL 30 minutes (Q8); previous-release asset retention (Q11); official list prices from `presets/rates.json` with "not a bill" labelling (Q12); current epoch visible in a diagnostic disclosure (Q6).

These are S2 implementation defaults, not silent answers. Changing a window, TTL, denominator, or retention rule is a contract change: update the metric labels, the data contract, and the affected CASE evidence together.

### 0.2 Non-negotiable invariants

1. **I1 — One snapshot per response.** One `statusView()` call produces exactly one `StatusSnapshotV3`. The initial HTML, its embedded `<template id="status-snapshot">`, and the JSON for that render carry the same `snapshotId`.
2. **I2 — One view model.** The server owns all aggregation and formatting. The browser MUST NOT sum routes, units, workers, tokens, capacity, or proof into a global value.
3. **I3 — One refresh request.** The browser refreshes with one `GET` of the status JSON. It MUST NOT fetch the server-rendered HTML during refresh. If a future change reintroduces a second request, both responses MUST carry the same `snapshotId` and a mismatch MUST be rejected.
4. **I4 — Runtime is build-free.** `node_modules`, Vite, Svelte, and `framework7-svelte` are build-time only. The gateway imports a committed ESM SSR bundle and reads committed assets. No build runs at startup or on a request.
5. **I5 — CSP is exact.** The header in §6.1 is the only CSP for this page. Inline `<script>`, `unsafe-eval`, and event-handler attributes are forbidden.
6. **I6 — Reset is an epoch transition.** A request captures its token epoch at request start. Reset only changes the current token epoch; it never changes health, capacity, affinity, speed, or proof.
7. **I7 — Unknown is not zero.** Missing, unobserved, stale-excluded, or unavailable values render as `—` with accessible text "无数据"; they are never `0`, `0%`, `0 ms`, or `0 tokens`.
8. **I8 — Identity is not a label.** Channel identity is `(provider, accountId, model)` server-side. The wire form uses `unitRef` (an opaque hash) plus `model`; display labels are aliases and never identity keys.
9. **I9 — MD only.** `<html class="md">` and `theme: "md"` are fixed. Automatic iOS switching is forbidden.
10. **I10 — Typography floor.** Body text at least 14px, labels at least 12px, no negative heading letter-spacing, CJK fallback in the mono stack.

### 0.3 Out of scope

No routing, ranking, admission, scoring, or model-selection policy change. The statistics fixes (healthy-completion speed observation, affinity counters, shared proof, fenced health writes) restore the existing observation and health semantics; they do not add a new selection rule or weight. No authentication redesign. No WebSocket/SSE push. No billing accuracy. No production data migration. No unrelated status JSON consumers.

---

## 1. Architecture

### 1.1 Runtime topology

```
Browser
  │ GET /[base]                      (HTML, no-store)
  ▼
features/lazy-router.mjs
  │ resolve base path, strip it from pathname
  ▼
lib/router/status-page.mjs
  ├─ router.statusView()             one StatusSnapshotV3
  │    └─ store.readStatusData()     one shared-store read transaction
  ├─ dist/server/status-page.ssr.mjs renderStatusDocument(snapshot, assets)
  │    └─ Svelte SSR of StatusApp
  └─ HTML: SSR body + inert snapshot template + hashed CSS/JS links
  │
  │ GET /assets/lazy-status/<hashed> (immutable)
  ▼
manifest.json + dist/assets + optional retained asset directory

Browser (JS on)
  ├─ parse <template id="status-snapshot">
  ├─ hydrate(Root, { target: #status-root })
  ├─ GET [base]/v1/lazy/status      one JSON snapshot per cycle
  └─ Svelte updates the existing DOM in place
```

There is no client-side router, no second data path, and no client-side global aggregation.

### 1.2 Build-time Svelte SSR and runtime import

The Svelte compiler MUST run only in `scripts/build-status-page.mjs`, through Vite:

1. **Client build**: `lib/router/status-page/app/client.js` → `dist/assets/status-page.<hash>.js` + `dist/assets/status-page.<hash>.css`.
2. **SSR build**: `lib/router/status-page/app/ssr.js` → `dist/server/status-page.ssr.mjs`, a single ESM file with `svelte/internal/server`, `framework7`, and `framework7-svelte` bundled (`ssr.noExternal`). It MUST have no bare import of `svelte`, `framework7`, or `framework7-svelte`.
3. **Manifest**: `dist/manifest.json` records `buildId`, the entry, the CSS files, current asset names, and previous-release asset names.

`lib/router/status-page.mjs` imports the SSR bundle statically:

```js
import { renderStatusDocument } from "./status-page/dist/server/status-page.ssr.mjs";
```

The SSR bundle exports only pure functions and contains compiled component code. It does not read source `.svelte` files, does not invoke Vite, and does not require a `node_modules` Svelte package at runtime.

`app/ssr.js` MUST install the Framework7 Svelte plugin before rendering:

```js
import Framework7 from "framework7";
import Framework7Svelte from "framework7-svelte";
import { render } from "svelte/server";
import StatusApp from "./StatusApp.svelte";

Framework7.use(Framework7Svelte);

export function renderStatusDocument(snapshot, options) {
  const ssr = render(StatusApp, {
    props: {
      snapshot,
      nowMs: Date.parse(snapshot.generatedAt),
      connection: { state: "server", lastGoodAt: snapshot.generatedAt, error: null },
      jsReady: false,
    },
  });
  return assembleDocument(ssr, snapshot, options);
}
```

The plugin install is mandatory: without it, `app.Framework7` is undefined and SSR of `<App>` fails with `undefined is not a constructor` (observed in a local Vite SSR smoke build with `framework7-svelte@9.3.0`).

`app/client.js` performs the same install before `hydrate`: `import Framework7 from "framework7"; import Framework7Svelte from "framework7-svelte"; Framework7.use(Framework7Svelte);`. Installing only in the SSR bundle would leave the client without `app.Framework7`.

### 1.3 Hydration transport without an inline script

The initial document contains no inline script and no inline JSON assignment. It contains:

```html
<html lang="zh-CN" class="md">
<div id="status-root" data-snapshot-id="snap_..."><!-- SSR body of StatusApp --></div>
<template id="status-snapshot">{escaped JSON}</template>
<script type="module" src="[base]/assets/lazy-status/status-page.<hash>.js"></script>
```

Rules:

1. `JSON.stringify(snapshot)` MUST replace `<` with `\u003c`, U+2028 with `\u2028`, and U+2029 with `\u2029`. This prevents `</template>` and script-comment injection without changing the parsed value.
2. The template content is inert. It is not executed by the HTML parser and does not need `script-src`.
3. `client.js` reads `document.getElementById("status-snapshot").content.textContent`, parses it, and hydrates `Root` into `#status-root`. The parsed object is the only initial prop source.
4. `client.js` removes the template after a successful parse. A parse failure leaves the SSR content visible and appends a visible `role="alert"` error node; it MUST NOT blank the page.
5. `#status-root` exists in the SSR HTML and wraps exactly the `<App>` root. `hydrate` targets `#status-root`, not `document.body`, so the App tree is identical on both sides.
6. `<meta name="status-build">`, `<meta name="status-snapshot">`, `<meta name="lazy-status-path">`, and `<meta name="lazy-reset-path">` carry non-secret bootstrap values. URLs are absolute paths including the base path.
7. The shell sets `<html lang="zh-CN" class="md">` and `<meta name="color-scheme" content="light dark">`. F7 CSS selectors require the `.md` class; setting it in the SSR shell prevents an unstyled first paint and does not change the fixed MD theme.

`Root.svelte` is a reactive adapter with no DOM wrapper:

```svelte
<script>
  let { initialSnapshot } = $props();
  let snapshot = $state(initialSnapshot);
  let nowMs = $state(Date.parse(initialSnapshot.generatedAt));
  let connection = $state({ state: "server", lastGoodAt: initialSnapshot.generatedAt, error: null });
  let jsReady = $state(false);

  export function apply(next) { snapshot = next; }
  export function setConnection(next) { connection = next; }
  export function tick(at) { nowMs = at; }
  export function setReady() { jsReady = true; }
</script>

<StatusApp {snapshot} {nowMs} {connection} {jsReady} />
```

`hydrate(Root, …)` returns these exports in Svelte 5.57 (verified from the installed type declaration and a happy-dom smoke hydration). Server and client initialise `nowMs` from `snapshot.generatedAt`, not from `Date.now()`, so relative-time text matches during hydration.

### 1.4 JavaScript-off completeness and CLS

- The SSR body MUST contain every overview value, every route, every channel, every unit status, the diagnostics table, the reset explanation, and the snapshot banner state. There is no placeholder shell.
- `<noscript>` MUST explain that live refresh and reset need JavaScript. The reset button is rendered `disabled` with an `aria-describedby` explanation, and becomes enabled only after `Root.setReady()` runs on mount.
- No component may fetch data on mount to fill initial content. Hydration adds behaviour only.
- No `{#key}` around sections, route cards, or tables. Keyed `{#each}` uses stable IDs (`route.id`, `channel.id`, `unit.unitRef`, `model`).
- The navbar height is reserved by F7 CSS (`--f7-navbar-height`); banners are sticky overlays or occupy a reserved slot. A late banner MUST NOT push the first viewport.
- Fonts are system fonts; no web-font swap. CSS is linked in `<head>` before `<body>`.
- Target CLS ≤ 0.1; `> 0.25` is an S1 hard fail. Evidence: PerformanceObserver trace during a cold load with cache disabled and slow 3G.

---

## 2. File plan

### 2.1 New files

| Path | Purpose |
|---|---|
| `lib/router/status-page/snapshot.mjs` | Pure `StatusSnapshotV3` builder: metrics M01–M27, formatting, notices, `unitRef`, URL allowlist, JSON-template escaping. No DB, no DOM. |
| `lib/router/status-page/format.mjs` | Server formatting helpers: tokens, percentages, durations, counts, exact-title strings, `—` rules. |
| `lib/router/status-page/app/StatusApp.svelte` | Root F7 `App theme="md"` + `Page` + `Navbar` + sections. |
| `lib/router/status-page/app/Root.svelte` | Client reactive adapter; exports `apply`, `setConnection`, `tick`, `setReady`. |
| `lib/router/status-page/app/client.js` | Read template/metas, hydrate, start refresh, wire reset. |
| `lib/router/status-page/app/ssr.js` | Build-time SSR entry; installs the F7 Svelte plugin; exports `renderStatusDocument`. |
| `lib/router/status-page/app/vite.config.mjs` | Client build: Svelte plugin, CSS handling, hashed entry/asset names, no inlining. |
| `lib/router/status-page/app/vite.ssr.config.mjs` | SSR build: `ssr: "ssr.js"`, `noExternal` for Svelte/F7, stable output name, no CSS assets. |
| `lib/router/status-page/app/styles.css` | F7 variable overrides, layout, typography, contrast tokens, reduced motion. |
| `lib/router/status-page/app/lib/Overview.svelte` | Exactly four primary metric groups. |
| `lib/router/status-page/app/lib/PrimaryMetric.svelte` | One primary group (label, value, detail, exact title, `—` state). |
| `lib/router/status-page/app/lib/SecondaryMetrics.svelte` | Secondary metrics and disclosures. |
| `lib/router/status-page/app/lib/RoutesSection.svelte` | Route list, headings, empty/loading states. |
| `lib/router/status-page/app/lib/RouteCard.svelte` | One route surface; no nested card. |
| `lib/router/status-page/app/lib/ChannelRow.svelte` | Model channel metrics and units. |
| `lib/router/status-page/app/lib/UnitList.svelte` | F7 `List`/`ListItem` rows for units; health/capacity/probe. |
| `lib/router/status-page/app/lib/StrategyTree.svelte` | Composition tree; leaf/op distinct. |
| `lib/router/status-page/app/lib/DiagnosticsSection.svelte` | Diagnostics heading, window label, empty state. |
| `lib/router/status-page/app/lib/DiagnosticsTable.svelte` | Semantic table with caption/scope/tabular numbers. |
| `lib/router/status-page/app/lib/TokenTotalsCard.svelte` | M08–M12, scope label, coverage, official value, epoch `since`. |
| `lib/router/status-page/app/lib/WorkersSection.svelte` | M04 per-worker table and M03 detail. |
| `lib/router/status-page/app/lib/CapacityTable.svelte` | M21 per-unit capacity; unlimited "不限"; stale badge. |
| `lib/router/status-page/app/lib/HealthTable.svelte` | M20/M22/M23 shared health rows. |
| `lib/router/status-page/app/lib/Banner.svelte` | Sticky/live banner; `role="alert"` for errors, `role="status"` for info. |
| `lib/router/status-page/app/lib/StatusBadge.svelte` | Text+colour badges for alive/cooling/busy/stale/loading. |
| `lib/router/status-page/app/lib/EmptyState.svelte` | "无数据" / "目录加载中" / "没有候选通道". |
| `lib/router/status-page/app/lib/relative.js` | Relative time formatting shared by components. |
| `lib/router/status-page/app/lib/refresh.js` | One-request refresh loop, timeout, backoff, visibility/offline. |
| `lib/router/status-page/app/lib/reset-dialog.js` | F7 Dialog construction, token handling, pending/error states. |
| `lib/router/status-page/dist/manifest.json` | Committed build manifest. |
| `lib/router/status-page/dist/server/status-page.ssr.mjs` | Committed SSR bundle. |
| `lib/router/status-page/dist/assets/*` | Committed hashed JS/CSS assets. |
| `scripts/build-status-page.mjs` | Deterministic two-build pipeline, manifest, retention, `--check`. |
| `scripts/deploy-status-assets.mjs` | Copy current/retained hashed assets into the shared deployment asset directory. |
| `test/status-page-snapshot-v3.test.mjs` | Snapshot/metric/format/identity/escaping tests. |
| `test/status-page-security-v3.test.mjs` | CSP, XSS, URL, template-JSON, no-`{@html}`, no-native-dialog tests. |
| `test/status-page-build-v3.test.mjs` | Manifest, asset existence, SSR bundle import/render, no bare imports, deterministic naming. |
| `test/router-token-epoch-v3.test.mjs` | Epoch capture, reset atomicity, idempotency, coverage, non-SSE/direct. |
| `test/router-perf-window-v3.test.mjs` | 30-bucket bound, imputed separation, batch query. |
| `test/router-status-v3.test.mjs` | `statusView()` envelope, M01–M27 presence, shared health/capacity/proof/affinity. |

### 2.2 Changed files

| Path | Change |
|---|---|
| `lib/router/status-page.mjs` | Replace template string rendering with snapshot SSR; static import of the SSR bundle; manifest loader; hashed asset resolver; base-path handling; exact CSP/headers; `noindex`; 404 for unknown page assets; `HEAD`. |
| `lib/router/router.mjs` | `statusView()` builds one snapshot from one store read; batch perf; shared health reason/probe; capacity from rows; proof from store; affinity counters; speed on success; request-start token epoch; one-shot usage taps; direct/non-SSE accounting; remove local `cooling` as status source. |
| `lib/router/state-store.mjs` | Additive v3 tables/columns; idempotent migration; `readStatusData` read transaction; `worker_load`; `affinity_stat`; `token_epochs`/`token_totals`; perf complete/imputed columns; perf batch; capacity/health/proof row readers; epoch reset. |
| `lib/router/perf.mjs` | Exact 30-bucket window with upper bound; batch summaries; complete-only mean; separate imputed counts; usage-agnostic observation unchanged. |
| `lib/router/cyclic-speed.mjs` | Add `snapshotFromRows(speedRows, at)` so the status path computes every model's posterior from the same read transaction; the routing path keeps `predict()`. |
| `lib/router/provider-concurrency-proof.mjs` | Shared `proof` store wiring, monotonic `MAX` upsert, 30-minute TTL, shared snapshot; local map is cache only. |
| `lib/router/affinity.mjs` | Record rolling 5-minute lookup/hit counters at the actual lookup decision; keep digest storage unchanged. |
| `lib/router/health.mjs` | Expose shared row read (`state`, `until`, `reason`, `updatedAt`, `probeLeaseUntil`); `markDead`/`markAlive` false is authoritative; local mirror is cache only. |
| `lib/router/capacity.mjs` | No policy change; document that status reads shared rows through the store, not `inFlight()` per candidate. |
| `features/lazy-router.mjs` | Start/stop worker heartbeat; pass `statusBasePath`/`statusAssetDir`; secure HTTPS-gated reset; reset idempotency; request-start token epoch for direct requests; pass build version. |
| `lib/config.mjs` | Add `lazy-router.statusBasePath` (default `""`) and `lazy-router.statusAssetDir` (default `null`); validate both. |
| `package.json` | Add exact dev dependencies and build scripts; keep `files` including `lib/`. |
| `bun.lock` | Exact resolved graph for the pinned toolchain. |
| `.gitignore` | Ignore the temporary `.tmp/` build directory; keep committed `dist/` tracked. |
| `biome.json` | Exclude `lib/router/status-page/dist/**` from lint/format. |
| `.github/workflows/ci.yml` | Add `status-page` job: install, build/check, `git diff --exit-code -- lib/router/status-page/dist`. |
| `.github/workflows/release.yml` | Run `bun run build:status-page:check` before `npm pack`/publish. |
| `CONTRIBUTING.md` | Narrow build exception for the status page; build commands. |
| `CHANGELOG.md` | Unreleased entry: v3 page, global stats, build exception, CSP style exception, `noindex`, reset dialog. |
| `README.md` | Document `statusBasePath`, `statusAssetDir`, the `/ops/` proxy header, and the build command. |
| `test/router-status-v2.test.mjs` | Keep the `releaseWhenSettled` and usage-tap coverage; remove the old page/SSR assertions that v3 replaces. |
| `test/router-state-v2.test.mjs` | Migration compatibility and new table assertions. |
| `test/router-perf-v2.test.mjs` | 30-bucket and imputed expectations. |
| `test/router-affinity-v2.test.mjs` | Counter aggregation. |
| `test/router-capacity-v2.test.mjs` | Stale/live rows and heartbeat. |
| `test/router-health-v2.test.mjs` | Shared reason/next probe; false `markDead`. |
| `test/router-e2e-v2.test.mjs` | Snapshot envelope and refresh shape. |
| `test/config-v2.test.mjs` | New config keys and validation. |

### 2.3 Deleted files

| Path | Reason |
|---|---|
| `lib/router/status-page/view.mjs` | Replaced by `snapshot.mjs` and the Svelte view model. |
| `lib/router/status-page/client.mjs` | Replaced by `app/client.js` + `app/lib/refresh.js`. |
| `lib/router/status-page/index.html` | Replaced by generated SSR document. |
| `lib/router/status-page/style.css` | Replaced by F7 CSS + `app/styles.css`. |

---

## 3. Data contracts and schema migrations

### 3.1 Snapshot envelope

`StatusSnapshotV3` is the only status payload. `statusView()` returns it; the page SSR consumes it; the JSON endpoint returns it.

```js
{
  schemaVersion: 3,
  snapshotId: "snap_<16 hex>",        // opaque, unique per statusView()
  generatedAt: "2026-11-10T...Z",     // clock value at read-transaction start
  answeredBy: "host:pid",             // diagnostic only; not user-facing telemetry
  buildVersion: "sha256-<12 hex>",    // manifest.buildId
  epoch: { id: "epoch_...", since: "2026-11-10T...Z" | null },
  store: { mode: "sqlite"|"memory"|"unavailable", available: true|false, reason: null|string },
  period: {
    id: "peak"|"offPeak",
    label: "高峰时段"|"闲时时段",
    nextSwitch: { at: ISO, period: "peak"|"offPeak", label: "闲时 · 2 小时 10 分后" } | null
  },
  catalog: { ready: boolean, workerReady: boolean, aggregateReady: boolean },
  overview: {
    primary: [
      { key: "period",  metricIds: ["M01", "M02"] },
      { key: "inFlight", metricIds: ["M03"], detailMetricIds: ["M04"] },
      { key: "channels", metricIds: ["M05"] },
      { key: "tokens",   metricIds: ["M08", "M09", "M10", "M11", "M12"] }
    ],
    secondary: [
      { key: "routeSummary", metricIds: ["M06", "M07"] },
      { key: "routeDiagnostics", metricIds: ["M13","M14","M15","M16","M17","M18","M19"] },
      { key: "capacity", metricIds: ["M21"] },
      { key: "health", metricIds: ["M20","M22","M23"] },
      { key: "catalog", metricIds: ["M24"] },
      { key: "store", metricIds: ["M26"] },
      { key: "meta", metricIds: ["M27"] }
    ]
  },
  metrics: { M01: Metric, ..., M12: Metric, M24: Metric, M25: Metric, M26: Metric, M27: Metric },
  routes: [RouteView],
  diagnostics: { windowMinutes: 30, available: boolean, reason: null|string, rows: [DiagnosticRow] },
  workers: [WorkerView],
  capacity: { available: boolean, reason: null|string, rows: [CapacityRow], liveCount: number, staleCount: number },
  health: { available: boolean, reason: null|string, rows: [HealthRow] },
  proof: { available: boolean, ttlMinutes: 30, byModel: { [model]: { verified: number, until: ISO } } },
  affinity: { available: boolean, windowMinutes: 5, hits: number, lookups: number, hitRate: number|null },
  tokenTotals: TokenTotalsView,
  notices: [Notice]
}
```

`Metric`:

```js
{
  id: "M03",
  label: "全局在途上游请求",
  value: "7",                    // already formatted; never a client-side sum
  exact: "7",                    // title/aria exact text
  unit: "count"|"tokens"|"ms"|"percent"|"usd"|"text",
  scope: "global"|"global_approx"|"worker"|"per_worker"|"per_model"|"per_unit"|"n/a",
  window: "now"|"5m"|"30m"|"epoch"|"current",
  available: boolean,
  reason: null|string,           // "共享状态不可用", "目录加载中", "无数据"
  detail: string,                // coverage, denominator, worker count, age
  tone: "normal"|"positive"|"warning"|"muted",
  coverage: { observed: number, complete: number } | null
}
```

`snapshotId` MUST be generated after the read transaction but from a monotonic source; tests inject `idFactory`. `buildVersion` MUST come from `dist/manifest.json`, not `package.json`. `answeredBy` MUST be `store.worker` or `${hostname()}:${pid}`.

`TokenTotalsView`:

```js
{
  available: boolean,
  mode: "sqlite"|"memory"|"unavailable",
  scope: { includesNonSse: true, includesDirect: true, label: "含直连/非流式" },
  epoch: { id: string, since: ISO|null },
  totals: { uncachedInput: number|null, cachedInput: number|null, output: number|null },
  coverage: { complete: number, uncachedInput: number, cachedInput: number, output: number },
  officialValue: {
    currency: "USD",
    valueUsd: number,
    pricedModels: number,
    totalModels: number,
    unpricedModels: number,
    models: [{ model, priced, valueUsd, source, basis, perMillion? }],
    ratesAsOf: string,
    note: string
  } | null,
  models: [{ provider, model, uncachedInput, cachedInput, output, complete }]
}
```

When `available:false`, `totals` fields are `null`, not `0`, and `officialValue` is `null`.

`metrics` holds only snapshot-wide metrics: M01–M12, M24, M25, M26, M27. Metrics whose value is repeated per row live at the row they describe: M04 on each `WorkerView`; M13–M19 on each `ChannelView.perf`; M20–M23 on each `UnitView.metrics`. Every metric ID still exists exactly once per applicable context, and the field-inventory test asserts that placement.

The embedded `<template id="status-snapshot">` is the JSON for the initial render. The HTML root also carries `data-snapshot-id` equal to that template's `snapshotId`. A separately requested `GET /v1/lazy/status` is a new render and will normally have a newer `snapshotId`; this is not a mixed snapshot. CASE-03 U5(b) compares the HTML's `data-snapshot-id` and meta tag with the embedded template, not with a later independent endpoint response. The browser never combines the initial HTML with a later JSON response.

`workers` carries the heartbeat-based per-worker values (in-flight, catalog readiness, build/schema version). Per-unit capacity and health rows live in `capacity.rows` and `health.rows`; `CapacityRow` carries its `worker`, while health is shared state and carries `updatedAt` instead of a process owner.

### 3.2 Metric mapping M01–M27

| ID | Label | Source and scope | Window | Value / unavailable rule |
|---|---|---|---|---|
| M01 | 当前时段 | `period.id`; global | now | `period.label`; never a raw enum |
| M02 | 下次切换 | `nextSwitch` computed by policy clock; global | now | `nextSwitch.label`; if null, "21 天内无时段切换" |
| M03 | 全局在途上游请求 | Sum `worker_load.in_flight` for rows with age ≤ 5s; `global_approx` | now | `—` if store unavailable or no live row; detail "全局近似 · N workers · 最旧 Xs"; MUST NOT use proof counter |
| M04 | 在途（按 worker） | `workers[]` rows; `per_worker` | now | Each row shows worker, count, heartbeat age, stale flag; stale rows are excluded from M03 |
| M05 | 可用 / 冷却 / 繁忙账号通道 | Distinct `(unitRef, model)` among channels present in the current routes, using shared health; `global` | current health | "可用 X · 冷却 Y · 繁忙 Z · 通道 N"; if catalog not ready, "目录加载中" and `available:false` |
| M06 | Lazy 路由 / 实际模型 | Route count and distinct models; global | current plan | "N 条路由 · M 个模型" |
| M07 | 路由前缀亲和命中率 | `affinity_stat` 5-minute sums; global | 5m | `hits/lookups` one decimal; no lookups → `—`, not `0%`; detail "近 5 分钟 · 命中 X / 查询 Y" |
| M08 | 累计未缓存输入 | Current epoch `token_totals.uncached_input`; global | epoch | Display tokens; if `seen_uncached=0`, `—`; detail "自 <since> 起 · 已上报 X / Y 请求 · 含直连/非流式" |
| M09 | 累计缓存输入 | Same, `cached_input`; global | epoch | Same coverage rule |
| M10 | 累计输出 | Same, `output`; global | epoch | Same coverage rule |
| M11 | Token 上报覆盖率 | `coverage` per metric: seen / complete; global | epoch | One row each for M08/M09/M10; `complete` counts completed requests with usage, never frames |
| M12 | 累计官方 API 价格等效价值 | `officialApiEquivalent()` over current epoch rows; global | epoch | USD + CNY; label "按官方标价估算 · 非账单 · N/M 模型已定价 · 基准日 <asOf>"; unpriced models listed, never guessed; `—` if store unavailable |
| M13 | 预测总耗时 | `CyclicSpeed.predict(model)`; global posterior | 24h half-life, current period | Formatted duration; no prediction → `—`; detail "全局后验预测" |
| M14 | RD | Posterior `rd`; global | 24h half-life | Two decimals; detail "RD · 不确定性，不是排名" |
| M15 | 证据权重 | Posterior `weight`; global | 24h half-life | Number; detail "证据权重"; never presented as request count |
| M16 | 右删失 | Posterior `censored`; global | 24h half-life | Number; detail "右删失"; separate from complete samples |
| M17 | 无错并发实证 | Shared `proof` row for model; global | TTL 30m | `verified`; detail "全局实证下界 · 有效至 <until>"; absent/expired → `—` |
| M18 | 最近完整耗时 | Perf complete-only mean; global | 30m inclusive | "近 30 分钟 · 完整样本平均"; imputed excluded; no complete sample → `—` |
| M19 | 30 分钟完整 / 删失样本 | Perf `completeN` and `imputedN`; global | 30m inclusive | Numeric counts, never a percentage-only summary; complete and imputed are separate |
| M20 | 账号健康 | `health` table state; global | current health | `alive`→可用 positive, `cooling`→冷却 warning, `busy`→繁忙 accent; text + colour |
| M21 | 账号并发 | Shared `capacity` row for the unit/model scope; global | now; age ≤ 5s | "全局 held/max"; unlimited (`max=0`) → "不限"; stale → badge, not counted live |
| M22 | 下次探测 | Shared health `until` or `probe_lease_until`; global | current | `—` when alive with no lease; detail "下次探测 ..." |
| M23 | 冷却原因 | Sanitized shared health `reason`; global | current | Text; no upstream body, URL, credential, account id |
| M24 | 目录就绪 | `worker_load.catalog_ready` and aggregate; per worker + global | current | false → "目录加载中"; aggregate false if any live worker not ready |
| M25 | 另一时段预览 | Removed payload | n/a | Metric record `available:false`, `reason:"未保留该时段预览"`; no alternate route computation |
| M26 | 共享状态 | `store.mode` / `available`; global | current | `sqlite`/available, `memory`/unavailable for global, `unavailable` with reason; never shows memory as working |
| M27 | 上次更新 / 快照 | `generatedAt`, `snapshotId`, `buildVersion`; n/a | now | Relative last update in footer; IDs in diagnostic disclosure/meta, not primary telemetry |

Metric rules:

- M08–M10 availability is per metric. A total of `0` with `seen=0` is unknown and MUST render `—`.
- M11 denominator is `coverage.complete`, the count of completed requests with at least one usage value; not SSE frames.
- M12 denominator is models with usage in the current epoch, not the entire catalog.
- M17 is read from the shared table; the local `ProviderConcurrencyProof` map is only a cache.
- M20–M23 read the shared `health` table; local cooling metadata is never authoritative.
- M25 is removed; do not compute `alternate` routes in `statusView()`.

### 3.3 Route, channel, unit, worker, capacity, health, proof, diagnostic rows

```js
RouteView = {
  id: "lazy/pro",
  title: "…",
  state: "alive"|"loading"|"cooling"|"empty",
  available: 3,
  totalUnits: 5,
  strategy: "按总耗时评分 · 带温度探索",
  graph: NodeView | null,          // model leaves and operation nodes
  channels: [ChannelView]
}

ChannelView = {
  id: "lazy/pro|provider/model",
  model: "provider/model",
  effort: "high" | "—",
  available: 2,
  totalUnits: 3,
  perf: {
    M13: Metric, M14: Metric, M15: Metric, M16: Metric,
    M17: Metric, M18: Metric, M19: Metric
  },
  units: [UnitView]
}

UnitView = {
  unitRef: "u_<16 hex>",           // sha256(provider + "\0" + accountId) prefix
  displayName: "provider:plus#2",  // alias only
  provider: "provider",
  model: "provider/model",
  health: "alive"|"cooling"|"busy"|"unknown",
  healthLabel: "可用"|"冷却"|"繁忙"|"待检查",
  metrics: { M20: Metric, M21: Metric, M22: Metric, M23: Metric },
  capacity: { held: 2, max: 4, scope: "unit"|"unit_model", stale: false, updatedAt: ISO } | null,
  reason: null|string,             // sanitized shared reason
  nextProbeAt: null|ISO,
  coolingSince: null|ISO,
  stale: boolean                  // capacity/heartbeat row older than 5s; health age alone is not stale
}

WorkerView = {
  worker: "host:pid",
  answeredBy: "host:pid",
  buildVersion: "sha256-...",
  viewSchema: 3,
  inFlight: 2,
  catalogReady: true,
  heartbeatAt: ISO,
  ageMs: 1200,
  stale: false,
  scope: "global"|"worker",
  metric: Metric                    // M04
}

CapacityRow = {
  unitRef: "u_...",
  displayName: "…",
  provider: "provider",
  model: "provider/model" | null,
  scope: "unit"|"unit_model",
  held: 2,
  max: 4,
  worker: "host:pid",
  updatedAt: ISO,
  ageMs: 1000,
  stale: false
}

HealthRow = {
  unitRef: "u_...",
  displayName: "…",
  provider: "provider",
  model: "provider/model",
  state: "alive"|"dead"|"busy",
  health: "alive"|"cooling"|"busy",
  reason: null|string,
  until: null|ISO,
  probeLeaseUntil: null|ISO,
  nextProbeAt: null|ISO,
  updatedAt: ISO,
  ageMs: number
}

DiagnosticRow = {
  model: "provider/model",
  completeSamples: number,
  imputedSamples: number,
  legacyMixedSamples: number,
  meanTotalMs: number|null,
  meanTotalText: "1.2 s"|"—",
  exact: "1234 ms"|"无数据",
  ttftSamples: number,
  speedSamples: number,
  tokensPerSecond: number|null
}

Notice = {
  level: "info"|"warning"|"error",
  code: "store_unavailable"|"memory_store"|"catalog_loading"|"worker_stale"|
        "version_mismatch"|"snapshot_stale"|"reset_conflict",
  title: "…",
  message: "…",
  action: "retry"|"reload"|null
}
```

`unitRef` MUST be stable across restarts and MUST NOT be reversible to the account id without the database. The raw `accountId`, `unitKey`, `health.key`, `capacity.unit`, e-mail, credential, and digest content MUST NOT appear in HTML or JSON.

Health normalisation: a shared row with `state="dead"` or `state="busy"` and `until <= now` is treated as `alive` for the snapshot; its old reason and next-probe time are not displayed. A unit with no health row is `alive`. `busy` is never labelled cooling.

### 3.4 Snapshot builder pseudocode

```js
// lib/router/status-page/snapshot.mjs
export function buildSnapshot(input) {
  const generatedAt = new Date(input.now).toISOString();
  const metrics = buildSnapshotMetrics(input);      // M01–M12, M24–M27
  const routes = input.routes.map((route) => toRouteView(route, metrics, input));
  const diagnostics = buildDiagnostics(input.perfRows, input.nowMinute);
  const workers = buildWorkers(input.workerRows, input);
  const capacity = buildCapacity(input.capacityRows, input);
  const health = buildHealth(input.healthRows, input);
  const proof = buildProof(input.proofRows, input.now);
  const affinity = buildAffinity(input.affinityStats);
  const tokenTotals = buildTokenTotals(input.tokenTotals);
  const notices = buildNotices(input);
  return {
    schemaVersion: 3,
    snapshotId: input.idFactory(),
    generatedAt,
    answeredBy: input.answeredBy,
    buildVersion: input.buildVersion,
    epoch: input.epoch,
    store: input.store,
    period: input.period,
    catalog: input.catalog,
    overview: {
      primary: [
        { key: "period", metricIds: ["M01", "M02"] },
        { key: "inFlight", metricIds: ["M03"], detailMetricIds: ["M04"] },
        { key: "channels", metricIds: ["M05"] },
        { key: "tokens", metricIds: ["M08", "M09", "M10", "M11", "M12"] },
      ],
      secondary: [
        { key: "routeSummary", metricIds: ["M06", "M07"] },
        { key: "routeDiagnostics", metricIds: ["M13","M14","M15","M16","M17","M18","M19"] },
        { key: "capacity", metricIds: ["M21"] },
        { key: "health", metricIds: ["M20","M22","M23"] },
        { key: "catalog", metricIds: ["M24"] },
        { key: "store", metricIds: ["M26"] },
        { key: "meta", metricIds: ["M27"] },
      ],
    },
    metrics,
    routes,
    diagnostics,
    workers,
    capacity,
    health,
    proof,
    affinity,
    tokenTotals,
    notices,
  };
}
```

`buildSnapshotMetrics` MUST create M01–M12 and M24–M27 exactly once. `toRouteView` MUST create M13–M19 on every channel and M20–M23 on every unit; `buildWorkers` MUST create M04 on every worker row. A field-inventory test walks the whole snapshot and asserts every ID M01–M27 appears in its documented context. A metric that is intentionally removed (M25) still has a snapshot-wide record with `available:false` and a reason.

### 3.5 Shared-store read transaction

`LazyRouter.statusView()` MUST perform one shared-store read transaction before building the snapshot:

```js
const now = this.now();
const minute = Math.floor(now / 60_000);
const data = this.store.readStatusData({
  now,
  period: this.#periodAt(new Date(now)),
  perfSinceMinute: minute - 29,     // inclusive: 30 buckets, including current
  perfUntilMinute: minute,
  affinitySinceMinute: minute - 4,  // inclusive: 5 buckets
  workerSince: now - 5 * 60_000,
  healthSince: now - 7 * 24 * 60 * 60_000,
});
```

`StateStore.readStatusData()` MUST:

1. Return `{ available:false, mode, reason }` immediately when `db === null`.
2. Wrap every read in one SQLite read transaction (`db.transaction(() => { ... })()`), so the epoch, totals, models, health, capacity, workers, proof, affinity, perf, and speed rows all belong to one database view.
3. Read the current epoch id from `metadata.token_epoch`, then the epoch row and its `token_totals` rows in the same transaction.
4. Return raw rows; formatting and stale classification belong to `snapshot.mjs`. `CyclicSpeed.snapshotFromRows(speedRows, now)` merges local and shared statistics from those rows; the status path MUST NOT issue a second `readSpeedRows()` query.
5. Return `available:false` with a sanitized reason on a read error; never return zero-filled totals.

The JSON endpoint (`LazyRouter.status()`) MUST return HTTP 503 with `{ error: "store_unavailable", snapshotId, generatedAt, buildVersion }` when `store.mode === "sqlite" && store.available === false` due to a read error. The initial HTML may render an unavailable snapshot so a first-time visitor sees the reason. The browser treats a 503 as a failed refresh and keeps its last good snapshot.

### 3.6 SQLite schema expansion for an existing `user_version = 2` file

This release uses an **expand** migration. `PRAGMA user_version` stays `2` so a code rollback to the previous release still opens the file. A later release may contract and bump the version after the N-1 window.

`StateStore.#install()` MUST run, in order:

1. The existing `STATE_SCHEMA` and `PRAGMA user_version = 2`.
2. `migrateStatusV3(db)`, which is idempotent and guarded by `PRAGMA table_info` / `CREATE TABLE IF NOT EXISTS`.
3. `ensureTokenEpoch(db, now)`.
4. Write `metadata.state_features = 'status-v3'` only after every step succeeds.

```sql
CREATE TABLE IF NOT EXISTS worker_load (
  worker TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  pid INTEGER NOT NULL,
  build_version TEXT NOT NULL,
  view_schema INTEGER NOT NULL,
  in_flight INTEGER NOT NULL DEFAULT 0,
  catalog_ready INTEGER NOT NULL DEFAULT 0,
  epoch TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS worker_load_updated ON worker_load (updated_at);

CREATE TABLE IF NOT EXISTS affinity_stat (
  minute INTEGER PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  lookups INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_epochs (
  id TEXT PRIMARY KEY,
  since TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_totals (
  epoch TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  uncached_input INTEGER NOT NULL DEFAULT 0,
  cached_input INTEGER NOT NULL DEFAULT 0,
  output INTEGER NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  seen_uncached INTEGER NOT NULL DEFAULT 0,
  seen_cached INTEGER NOT NULL DEFAULT 0,
  seen_output INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (epoch, provider, model)
);
CREATE INDEX IF NOT EXISTS token_totals_epoch ON token_totals (epoch);

CREATE INDEX IF NOT EXISTS perf_period_minute ON perf (period, minute);
```

Perf columns (each guarded by `PRAGMA table_info(perf)`):

```sql
ALTER TABLE perf ADD COLUMN complete_ms REAL NOT NULL DEFAULT 0;
ALTER TABLE perf ADD COLUMN complete_log REAL NOT NULL DEFAULT 0;
ALTER TABLE perf ADD COLUMN complete_log_sq REAL NOT NULL DEFAULT 0;
ALTER TABLE perf ADD COLUMN complete_n INTEGER NOT NULL DEFAULT 0;
ALTER TABLE perf ADD COLUMN imputed_ms REAL NOT NULL DEFAULT 0;
ALTER TABLE perf ADD COLUMN legacy_mixed INTEGER NOT NULL DEFAULT 0;
```

Backfill:

```sql
UPDATE perf
SET complete_ms = total_ms,
    complete_log = total_log,
    complete_log_sq = total_log_sq,
    complete_n = MAX(0, total_n - imputed_n)
WHERE complete_n = 0 AND total_n > 0 AND imputed_n = 0;

UPDATE perf
SET legacy_mixed = 1
WHERE imputed_n > 0 AND complete_n = 0;
```

Existing rows with `imputed_n > 0` cannot be split after the fact. They are marked `legacy_mixed=1` and excluded from the complete-only mean; their `imputed_n` remains visible as "升级前混合桶". New rows carry accurate complete/imputed columns.

Token backfill:

```sql
INSERT OR IGNORE INTO token_epochs (id, since, created_at)
VALUES (
  'legacy',
  COALESCE((SELECT value FROM metadata WHERE name = 'since'), :nowIso),
  :now
);

INSERT OR IGNORE INTO token_totals
  (epoch, provider, model, uncached_input, cached_input, output, complete,
   seen_uncached, seen_cached, seen_output, updated_at)
SELECT 'legacy', provider, model, uncached_input, cached_input, output, complete,
       seen_uncached, seen_cached, seen_output, :now
FROM totals;

INSERT OR IGNORE INTO metadata (name, value) VALUES ('token_epoch', 'legacy');
INSERT OR IGNORE INTO metadata (name, value) VALUES ('token_epoch_since',
  (SELECT value FROM metadata WHERE name = 'since'));
```

`ensureTokenEpoch` MUST create an epoch for a fresh database with `since = now` and the id `epoch_<ms>_<random>`, never `legacy`. If `metadata.token_epoch` is absent but `token_epochs` contains `legacy`, adopt `legacy`.

Migration must be tested against a copy of a real v2 file: open, close, reopen; `PRAGMA user_version` remains 2; old tables still accept the old statements; `git`-tracked test fixture is synthetic, never a real credential database.

### 3.7 Token epoch and request accounting

**Epoch capture.** `LazyRouter.serve()` captures `const epoch = this.store.captureTokenEpoch()` before the first upstream attempt. `lazyRouterHandler` captures the epoch before `downstream()` for direct model requests and passes it to `measureDirect()`. A request that starts before a reset and finishes after it writes only to its captured epoch.

**Current epoch.** `readStatusData()` reads `metadata.token_epoch` in the same transaction as the totals. The page shows only that epoch. Old epoch rows remain for diagnostics and are never mixed into the current totals.

**Usage capture once.**

- `createUsageTap(response, { onUsage, mode })` MUST call `onUsage` exactly once, at clean stream end, with the final merged usage object.
- Each upstream attempt carries an opaque `requestId` (random, not an account id). The tap keeps a per-request `observed` flag; a duplicate frame, retry, or `onUsage` call for the same `requestId` cannot add a second usage record. The id is for correlation and duplicate suppression only; it is not written to `token_totals`, so the aggregate table remains bounded.
- SSE mode: merge the last provider usage frame; do not emit per frame.
- JSON mode: retain a bounded tail (64 KiB), parse at end; do not buffer the whole body.
- Aborted or errored responses do not count as completed; `complete` does not increment.
- SSE and JSON/direct paths use the same `tokenAccounting()` and the same `addTokenTotals(epoch, provider, model, usage)` rule.

**One write, two tables.** `addTokenTotals` runs one transaction:

```sql
INSERT INTO token_totals (epoch, provider, model, uncached_input, cached_input, output,
  complete, seen_uncached, seen_cached, seen_output, updated_at)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
ON CONFLICT(epoch, provider, model) DO UPDATE SET
  uncached_input = token_totals.uncached_input + excluded.uncached_input,
  cached_input = token_totals.cached_input + excluded.cached_input,
  output = token_totals.output + excluded.output,
  complete = token_totals.complete + 1,
  seen_uncached = token_totals.seen_uncached + excluded.seen_uncached,
  seen_cached = token_totals.seen_cached + excluded.seen_cached,
  seen_output = token_totals.seen_output + excluded.seen_output,
  updated_at = excluded.updated_at;
```

The same transaction MUST also mirror the value into the legacy `totals` table and `metadata.since` for N-1 code compatibility. The legacy mirror uses the same one-request semantics, so its `complete` count is also once per request, not once per frame.

**Direct and non-SSE.** `measureDirect(model, response, startedAt, signal, epoch)` MUST:

1. Capture the period from `startedAt` (`#periodAt(new Date(startedAt))`).
2. Wrap the response with the same perf and usage taps used by router-served traffic.
3. Derive `provider` from the model prefix (`provider/model`), never from a display label.
4. Pass the request-start epoch.
5. Keep the response body byte-identical.

The direct path also increments the worker's `openUpstream` counter before `downstream()` and decrements it when the response settles. The heartbeat publishes `concurrencyProof.inFlight() + openUpstream`, so M03 covers direct and non-SSE upstream requests. The proof counter alone is never M03.

The snapshot `tokenTotals.scope` is `{ includesNonSse: true, includesDirect: true, label: "含直连/非流式" }`. If the owner ever narrows the scope, the label and M08–M11 must change together; silent omission is forbidden.

**Coverage.** `complete` increments once per completed request with at least one usage value. `seen_uncached`, `seen_cached`, `seen_output` increment once per request when that metric is present. A request with output only produces `complete=1, seen_uncached=0`; M08 is `—`, not `0`.

### 3.8 Reset protocol

`POST [base]/v1/lazy/token-totals/reset`

Request headers: `authorization: Bearer <gateway token>`, `content-type: application/json`, `x-lazy-reset: token-totals`.
Request body: `{ "resetId": "<uuid>" }`.

Server order:

1. Method must be POST, else `405` with `allow: POST`.
2. HTTPS gate: allow `https:` or a direct loopback peer without forwarding headers; behind a proxy require `x-forwarded-proto: https`. Otherwise `403 { error: "https_required" }`.
3. `x-lazy-reset` and JSON content type must match, else `401`.
4. `adminTokenMatches(request, tokenPath)` unchanged (constant-time server-side).
5. `store.resetTokenTotals({ resetId })` runs one write transaction:
   - If `metadata.last_reset_id === resetId`, return the current epoch with `{ idempotent: true }`; no new epoch.
   - If `now - last_reset_at < 2000`, return `{ conflict: true, epoch }`; the route responds `409 { error: "reset_conflict", epoch }`.
   - Otherwise create `epoch_<now>_<random>`, insert `token_epochs`, set `metadata.token_epoch`, `token_epoch_since`, `last_reset_id`, `last_reset_at`, clear legacy `totals`, and set legacy `metadata.since`.
   - Old epoch rows are retained; the current view filters by the new epoch.
6. Response `200 { ok: true, epoch, tokenTotals }` only after the transaction commits. On store failure `503 { error: "counter_unavailable" }`. Never optimistic success.

Concurrent resets: SQLite serializes the write transaction. The `last_reset_id` check makes a retry idempotent; the 2-second guard turns a near-simultaneous second reset into `409`. The UI disables the submit button while pending and treats `409` as "another reset won; refreshing".

Rollback and mixed versions: during the N-1 window a v2 worker may still be running. `worker_load` exposes its build version, the page shows `version_mismatch`, and reset is disabled. Do not run a v2 reset while any v3 worker is serving: v2 clears only the legacy mirror, so the v3 epoch would diverge. The operational sequence is stop v2 workers, confirm one live build version, then allow reset. A code rollback to v2 reads the dual-written legacy `totals` and `metadata.since`; it ignores `token_epochs`/`token_totals`. The expand migration never drops v2 tables.

### 3.9 Query bounds and shared-state rules

| Data | Bound / rule |
|---|---|
| Perf window | Inclusive `BETWEEN minute-29 AND minute`; exactly 30 buckets; no future bucket, no 31st bucket; `perf_period_minute` covers `(period, minute)` |
| Perf batch | One `SELECT` for all models per snapshot and per routing decision; never `summary()` per model |
| Imputed samples | Excluded from the complete mean; counts and `imputed_ms` shown separately |
| Affinity window | Inclusive 5 minute buckets; hits/lookups at the lookup decision; no digest content exposed |
| Affinity storage | Existing digest TTL + `maxEntries` stays; `affinity_stat` is minute-bucketed and pruned after 10 minutes; no account/digest content in the counter rows |
| Worker liveness | Heartbeat ≤ 5s is live; 5s–5min is stale and excluded from M03; > 5min is reaped |
| Capacity liveness | Row age ≤ 5s is live; older is stale; reaping at 5min; stale rows never counted as free capacity |
| Proof | Shared `proof` table, `MAX(verified)` and `MAX(until)`, TTL 30min; one `SELECT` for all models |
| Health | Shared rows only for reason/until/next probe; local mirrors are caches. Existing `reasonRank` rules remain: a weaker `busy` write cannot shorten or erase a stronger dead cooldown |
| Token epoch | Epoch and totals read in one transaction; request-start epoch; reset atomic |
| `:memory:` store | `store.mode="memory"`, global metrics `—`; per-worker values labelled "本 worker" |

`StateStore.prune()` also deletes `worker_load` rows older than 5 minutes, `affinity_stat` rows older than 10 minutes, and token epochs/totals older than 90 days except the current epoch. Pruning runs on the existing store maintenance interval, not on the request path.

The heartbeat writes one `worker_load` row per worker every 2 seconds (`setInterval(...).unref()`), updates on install, and deletes the row on graceful dispose. The current worker is synthesised into `workers[]` if its first heartbeat has not landed, with `scope:"worker"` until the shared row exists. A worker that dies without disposal becomes stale after 5 seconds and is reaped after 5 minutes.

A capacity row is a lease: `reserveSlot`, `releaseSlot`, and the store's periodic `touchHeld` update `updated_at`. A lease older than 5 seconds is not part of the live count; a lease older than 5 minutes is reaped. When the store is unavailable, `InFlightTracker` may use its local map for routing, but the snapshot labels that value "本 worker" and M03/M21 remain `—`; local counts are never published as global.

When `store.mode` is `"memory"` or `"unavailable"`, every shared-state metric that depends on the store (M03, M05, M07–M23 except M06) renders `—` with a reason. M04 and the current worker's catalog readiness remain visible as "本 worker"; M06 is derived from the local route plan and remains valid.

### 3.10 Formatting and units

| Kind | Rule |
|---|---|
| Tokens | Exact below 1,000; `K`, `M`, `B` with one decimal above; exact value in `title` and `.sr-only` text. A nonzero total MUST NOT render as `0.0 M`: if rounding at the chosen unit would produce `0.0`, step down one unit. |
| Percent | One decimal; the denominator is always visible in the label or detail; no denominator → `—`. |
| Duration | Milliseconds below 1s; seconds with one decimal from 1s; minutes/seconds above 60s; exact milliseconds in `title`. |
| Counts | `Intl.NumberFormat("zh-CN")`; no scientific notation; tabular numerals in tables. |
| Currency | USD value from `officialApiEquivalent`; CNY at the fixed display rate `1 USD = 6.6620 CNY`; label "估算 · 非账单"; never a converted value without the USD original in the title/detail. |
| Unknown | `—` plus accessible "无数据"; never `0`, `0%`, `0 ms`, or `0 tokens`. |
| Identity | Channel identity is `(provider, accountId, model)`; `unitRef` is the wire identity; display labels are aliases and must not merge rows. |

---

## 4. Component tree, layout, and interaction

### 4.1 Framework7 component tree

```
<App theme="md" name="omp-status">                    framework7-svelte App
  <Page>
    <Navbar title="Lazy · 路由观测">
      right: live indicator + "刷新" Button (F7 Button)
    </Navbar>
    <Banner />                                        role="alert"/"status"
    <main>
      <h1 class="sr-only">Lazy 路由观测</h1>
      <Overview>
        <PrimaryMetric key="period" />                F7 Card + CardContent
        <PrimaryMetric key="inFlight">                F7 Card + CardContent
          <WorkersDisclosure />                       F7 Accordion (M04)
        </PrimaryMetric>
        <PrimaryMetric key="channels" />              F7 Card + CardContent
        <PrimaryMetric key="tokens">                  F7 Card + CardContent
          <TokenTotalsCard />                         M08–M12
        </PrimaryMetric>
      </Overview>
      <SecondaryMetrics />                            M06, M07, M13–M19, M20–M27
      <RoutesSection>
        <RouteCard>                                   F7 Card; one surface per route
          <CardContent>
            <StrategyTree />                          semantic <ul>, leaf/op classes
            <ChannelRow>                              F7 List + ListItem
              <UnitList />                            F7 List + ListItem
            </ChannelRow>
            <Accordion>                               F7 Accordion
              <AccordionItem title="诊断与并发">       M13–M19, M21–M23
            </Accordion>
          </CardContent>
        </RouteCard>
      </RoutesSection>
      <DiagnosticsSection>
        <DiagnosticsTable />                          semantic <table>
      </DiagnosticsSection>
      <ResetAction />                                 F7 Button + F7 Dialog + F7 Toast
      <SnapshotMeta />                                disclosure: snapshotId/buildVersion/answeredBy
    </main>
  </Page>
</App>
```

F7 requirements:

- `App`, `Page`, `Navbar`, `Card`, `List`, `ListItem`, `Accordion`, `AccordionItem`, `Button`, `Toast`, and `Dialog` MUST be the real `framework7-svelte`/Framework7 implementations. No CSS-only lookalike and no clickable `div`.
- `theme="md"` on `App`; `framework7/framework7.css` loaded; `<html class="md">` server-rendered.
- No nested `Card`. A route card contains lists, accordions, and tables, never another `.card`.
- `TokenTotalsCard`, `WorkersSection`, `HealthTable`, and `CapacityTable` are content inside the surrounding Card/section; they MUST NOT render another `Card`.
- The reset flow uses `f7.dialog.create()`; toasts use `f7.toast.create()`. Native `prompt()`/`confirm()` are forbidden.

### 4.2 Information hierarchy

Exactly four primary groups, in this order:

1. **当前时段 / 下次切换** (M01–M02).
2. **全局在途上游请求** (M03) with M04 disclosure.
3. **账号通道** (M05).
4. **累计 Token** (M08–M12) with coverage, official value, and `since`.

Everything else is secondary or a disclosure: M06, M07, M13–M19 in the diagnostics/route detail; M20–M24 in health/probe/capacity tables; M26 in the banner; M27 in the footer disclosure.

Layout:

- 1440: four primary cards in one row; routes full width; diagnostics table full width.
- 768: two primary columns (2×2, no orphan); routes full width.
- 320: one column; no page horizontal scroll; tables inside `.table-wrap { overflow-x: auto }`; primary actions not clipped.
- Secondary metrics use `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))`; a breakpoint MUST NOT leave a half-empty trailing row.
- Route cards use one surface, a header, a strategy strip, and channel rows. No `.route .route` or `.card .card`.
- The strategy tree uses two distinct presentations: `.tree-leaf` is a monospace model identifier with a small model icon/dot; `.tree-op` is a sans-serif operation label with a numbered step marker. A model leaf and a routing operation MUST NOT share the same font, weight, and colour.

Typography:

- Body 14px minimum; labels 12px minimum; table 13px; mono only for identifiers, numbers, durations, and tokens.
- `--status-font`: `Inter, system-ui, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`.
- `--status-mono`: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK SC", "Sarasa Mono SC", monospace`.
- `h1` letter-spacing `0`; no negative tracking. CJK line-height 1.6.
- `font-variant-numeric: tabular-nums` on all numeric cells and metric values.

### 4.3 Visual states

| State | Presentation | Accessibility |
|---|---|---|
| Loading | SSR content remains; navbar live indicator "刷新中"; no skeleton after first paint | `aria-busy="true"` on the live region |
| Empty route | "这个组合当前没有候选通道" + next step "检查模型目录或账号健康" | `role="status"` |
| No samples | `—` + `.sr-only` "无数据" | never `0 ms`/`0%` |
| Catalog loading | "目录加载中" | not "暂无可用账号" |
| Store unavailable | Sticky banner; global metrics `—`; per-worker "本 worker" | `role="alert"`, `aria-live="assertive"` |
| Stale worker/capacity | Badge "已过期 Ns"; excluded from live totals | text + colour |
| Version mismatch | Sticky reload banner; refresh stops | `role="alert"`, reload Button |
| Reset pending | Dialog buttons disabled; text "正在重置…" | `aria-busy="true"` |
| Reset error | Dialog stays open; message; retry | `role="alert"` |
| Reset success | Toast + M08–M12 update; no optimistic zero | `role="status"` |

### 4.4 Responsive, themes, and CJK

- Light tokens: `--status-bg:#f4f6fa`, `--status-surface:#ffffff`, `--status-text:#1b1b1f` (17.17:1), `--status-muted:#5f6368` (6.05:1), `--status-link:#0b57d0` (6.39:1 on white, 5.90:1 on `#f4f6fa`), `--status-positive:#197753`, `--status-warning:#99631a`.
- Dark tokens: `--status-bg:#121212`, `--status-surface:#1e1e1e`, `--status-text:#e8eaed` (15.54:1), `--status-muted:#bdc1c6` (10.35:1), `--status-link:#a8c7fa` (10.90:1), `--status-positive:#7dd6a9`, `--status-warning:#fdd663`.
- F7 adds `.dark` on `<html>` from `prefers-color-scheme`; custom tokens follow `.dark` and `@media (prefers-color-scheme: dark)` so the first paint is readable even before F7 mounts.
- Status is never colour-only: every badge has text; healthy is positively styled, not neutral.
- CJK: no tofu; `overflow-wrap:anywhere` on long model/account labels; titles carry the full value; `word-break:keep-all` for short Chinese headings.
- 200% zoom: no clipped content; `rem`-based spacing; max-width containers.

### 4.5 Focus, keyboard, and announcements

- Skip link "跳到主要内容" is the first focusable element; target `#routes-heading` or `<main>` with `tabindex="-1"`.
- Every control is a real `<button>`/`<a>`; F7 `Button` and `ListItem` are fine. No div-as-button.
- Accordion: Enter toggles; Space toggles via a keydown handler on the F7 accordion toggle; `aria-expanded` reflects the `opened` state; focus stays on the toggle.
- Dialog: F7 traps focus, Escape cancels, focus returns to the reset trigger.
- Focus after refresh: Svelte updates in place. If the focused node disappeared, move focus to the nearest section heading (`tabindex="-1"`) and announce "当前项已移除".
- `aria-live`: errors `assertive`, routine updates `polite`; do not announce every 10-second poll.
- Tables: `<caption>` (visible or `.sr-only`), `<th scope="col">`, model `<th scope="row">`, numeric headers right-aligned.
- Touch targets: minimum 44×44 CSS px; F7 ListItem min-height 48px; buttons 44px.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` disables nonessential F7 transitions and smooth scrolling.
- Icon-only controls have `aria-label` and a visible tooltip/title.

### 4.6 Reset dialog

`app/lib/reset-dialog.js` builds a static content string (no user/upstream data) and calls `f7.dialog.create`:

```js
const content = `
  <div class="status-reset">
    <p>重置只清空累计 Token 统计与上报次数；评分、账号健康、路由前缀亲和、并发实证都不受影响。</p>
    <label for="status-reset-token">Gateway 管理 Token</label>
    <input id="status-reset-token" type="password" autocomplete="off"
           spellcheck="false" aria-describedby="status-reset-help">
    <p id="status-reset-help">Token 只用于本次请求，不保存、不写日志。</p>
    <p class="status-reset-error" role="alert" hidden></p>
  </div>`;
```

The dialog has title "重置累计 Token 统计", cancel and reset buttons, `closeByBackdrop: false`, and `destroyOnClose: true`. On reset click: `preventDefault()`, read and immediately clear the input, validate non-empty, HTTPS check, `fetch(resetPath, …)`, keep the dialog open on error, close on success. The token lives only in a local `const` for the request; it is never stored, logged, put in a URL, or rendered after submit. A separate `aria-live` status node announces success/failure; the F7 Toast is visual reinforcement.

---

## 5. Refresh protocol

### 5.1 Shape

`app/lib/refresh.js` exports `startRefresh({ initialSnapshot, statusPath, onSnapshot, onConnection, onVersionMismatch })` and returns `{ retryNow, stop }`. `Banner.svelte` renders an F7 `Button` labelled "重试" when the current notice has `action:"retry"`; it calls `retryNow()`, which clears the backoff timer and runs one cycle immediately.

```js
const REFRESH_MS = 10_000;
const TIMEOUT_MS = 8_000;
const MAX_BACKOFF_MS = 120_000;

let timer = null;
let controller = null;
let inFlight = false;
let failures = 0;
let stopped = false;
let currentId = initialSnapshot.snapshotId;

async function cycle() {
  if (stopped || inFlight || document.visibilityState === "hidden") return;
  if (!navigator.onLine) {
    onConnection({ state: "offline", lastGoodAt: currentGeneratedAt(), error: null });
    schedule(REFRESH_MS);
    return;
  }
  inFlight = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(statusPath, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (next.schemaVersion !== 3 || next.buildVersion !== initialSnapshot.buildVersion) {
      stop();
      onVersionMismatch(next);
      return;
    }
    failures = 0;
    if (next.snapshotId !== currentId) {
      currentId = next.snapshotId;
      onSnapshot(next);
    }
    onConnection({ state: "live", lastGoodAt: next.generatedAt, error: null });
    schedule(REFRESH_MS);
  } catch (error) {
    failures += 1;
    onConnection({
      state: error.name === "AbortError" ? "timeout" : "stale",
      lastGoodAt: currentGeneratedAt(),
      error: error.name === "AbortError" ? "刷新超时" : "刷新暂时失败",
    });
    schedule(Math.min(MAX_BACKOFF_MS, REFRESH_MS * 2 ** (failures - 1)) * jitter());
  } finally {
    clearTimeout(timeout);
    controller = null;
    inFlight = false;
  }
}
```

### 5.2 Rules

1. **One request per cycle.** `inFlight` is per tab. No interval pileup; `schedule` clears the previous timer.
2. **Timeout.** Every fetch has an `AbortController` and an 8-second timer; the S1 limit is 10 seconds. A timeout aborts and schedules a retry.
3. **Backoff.** 10s → 20s → 40s → 80s → 120s, with ±20% jitter, reset on success. No request while offline.
4. **Visibility.** On `visibilitychange` to `hidden`, clear the timer. On visible, run one immediate cycle. Do not abort an in-flight request solely because the tab hid; let it settle.
5. **Offline/online.** `offline` shows "离线，显示上次快照"; `online` triggers one immediate cycle and resets backoff.
6. **Manual retry.** The banner's "重试" Button clears the pending timer and runs one cycle immediately; it remains reachable while the page is scrolled and while the refresh is backing off.
7. **Snapshot check.** Apply only when `schemaVersion === 3` and `buildVersion === initialSnapshot.buildVersion`. A same-`snapshotId` response updates only "last checked"/relative time; no section churn.
8. **No splice.** Never fetch HTML during refresh. Never merge values from two responses.
9. **Focus/details.** Keyed each blocks by stable IDs; `openItems` is a `Set` of `AccordionItem` IDs in `Root`. Refresh keeps the same IDs open and drops only removed IDs. No `{#key}` around sections.
10. **Scroll.** In-place updates only. Do not scroll to top on refresh. If the focused node is removed, restore focus to the section heading.
11. **Subpath.** `statusPath` comes from `<meta name="lazy-status-path">` (absolute, including base path). No `fetch("/")` or hardcoded root.
12. **Structural mismatch.** A missing required field, a non-array `routes`, a missing `metrics.M03`, or a schema mismatch is a structural error: keep the last good snapshot, show the reload banner, stop applying further responses.
13. **Old tab.** A tab from the previous release compares `buildVersion`; on mismatch it shows "页面已更新，请刷新" with a reload Button and stops polling. A v2 tab that predates this handshake keeps its old content and shows its own refresh-failure banner; the v3 server must not present v2 section IDs, so the old client cannot partially splice v3 markup.

Because every refresh replaces the whole snapshot, there is no partial change detector to omit a field. `test/status-page-snapshot-v3.test.mjs` keeps an explicit field inventory: snapshot-wide metrics must appear in `metrics` and in exactly one primary or secondary group (M25 is the documented removed-payload exception and appears in `metrics` only); M04 must appear on every `WorkerView`; M13–M19 on every `ChannelView.perf`; M20–M23 on every `UnitView.metrics`; every other field must be read by a component or listed as diagnostic-only. Adding a snapshot field without a binding fails the test.

### 5.3 Relative time

One `setInterval(..., 1000)` updates `nowMs` in `Root`; it does not fetch. Derived text uses `<time datetime="...">` with an absolute title. This timer is independent of the refresh timer and is cleared on `pagehide`.

### 5.4 Error text

No stack trace, URL, account id, or upstream body is shown. User text: "刷新暂时失败，页面保留上次成功的状态；将自动重试。" / "刷新超时，正在重试。" / "离线，显示上次快照。" / "页面已更新，请刷新。"

---

## 6. Security, CSP, and accessibility

### 6.1 CSP and headers

Exact status-page response headers:

```
content-security-policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
cache-control: no-store
x-content-type-options: nosniff
referrer-policy: no-referrer
x-robots-tag: noindex, nofollow
```

Asset responses:

```
cache-control: public, max-age=31536000, immutable
x-content-type-options: nosniff
content-type: text/javascript; charset=utf-8 | text/css; charset=utf-8
```

No inline `<script>`, no `unsafe-eval`, no `javascript:` URL, no user-controlled `style` attribute, no `{@html}` with user or upstream data. F7's `setColors()` creates a `<style>` element and some components emit inline `style` attributes; this is the documented reason for `style-src 'unsafe-inline'` and MUST be recorded in CASE-11 evidence. The page MUST NOT call `setColors()` with user input.

### 6.2 XSS and URL rules

- All dynamic text and attributes go through Svelte interpolation. Server-side string assembly uses `escapeHtml` for every non-SSR value.
- Source links: parse with `new URL(value)`, allow only `https:`, and render `<a href={safe} target="_blank" rel="noopener noreferrer">`. Anything else renders as text.
- Cooling reasons are sanitized twice: at write time by `sanitizedReason()`, and at snapshot time by `sanitizeStatusReason()` (strip control characters, collapse whitespace, truncate to 120 characters, replace `http://`/`https://` runs, e-mail-like strings, and credential-like `sk-…` tokens with `[redacted]`). A reason that becomes empty renders `—`.
- `frame-ancestors 'none'`, `form-action 'none'`, `base-uri 'none'`.
- `<meta name="robots" content="noindex, nofollow">` plus `X-Robots-Tag`.
- No secret, e-mail, account id, upstream URL, or stack trace in HTML/JSON/logs. The snapshot must be checked by a fixture-based secret scan.
- `test/status-page-security-v3.test.mjs` scans `app/**/*.svelte` for `{@html`, `prompt(`, `confirm(`, `unsafe-eval`, and inline `<script>`; it fails on any hit.

### 6.3 Reset token handling

- Token in the `Authorization` header only; never in URL, DOM after submit, storage, logs, or toast.
- Input type `password`, `autocomplete="off"`, `spellcheck="false"`; value cleared before the request resolves.
- Server `adminTokenMatches` remains constant-time; no token echo in errors.
- HTTPS gate is enforced server-side and mirrored client-side for fast feedback.

### 6.4 Accessibility contract

- Contrast: light text 17.17:1, muted 6.05:1, link 6.39:1; dark text 15.54:1, muted 10.35:1, link 10.90:1. Large text ≥3:1.
- Keyboard: skip link, Tab order follows visual order, visible 2px focus ring, no trap except the modal dialog, Escape closes the dialog.
- Screen reader: landmarks (`banner`, `main`, `contentinfo` or equivalent roles), heading order, `aria-live` for banners/reset, table caption/scope, accessible names on icon-only controls.
- Touch: 44×44 minimum; F7 ListItem 48px; no hover-only action.
- Reduced motion: no nonessential animation; F7 page transitions disabled.
- 200% zoom and 320 reflow: no horizontal page scroll; table scroll is internal; no clipped action.
- CJK: system CJK font fallback; mono stack includes a CJK mono fallback; no negative letter-spacing; no tofu.

---

## 7. Build, packaging, and deployment

### 7.1 Exact pinned toolchain

Add to `devDependencies` (exact versions, no `^` or `~`):

```json
"@sveltejs/vite-plugin-svelte": "7.3.1",
"svelte": "5.57.3",
"vite": "8.3.7",
"framework7": "9.3.0",
"framework7-svelte": "9.3.0"
```

These versions are peer-compatible (`@sveltejs/vite-plugin-svelte@7.3.1` requires `svelte ^5.46.4` and `vite ^8.0.0`) and were used for a local SSR/hydration smoke build. `bun.lock` MUST be committed with the exact transitive graph. A build under Bun 1.4.4 and Node 22 MUST be exercised in CI before release; Vite 8 declares Node `^20.19 || >=22.12`, so the release job also runs `actions/setup-node@v4` with Node 22 if the Bun build ever diverges.

`package.json` scripts:

```json
"build:status-page": "bun scripts/build-status-page.mjs",
"build:status-page:check": "bun scripts/build-status-page.mjs --check"
```

`files` already includes `lib/`; add an explicit `lib/router/status-page/dist/` entry to make the packaging intent reviewable.

### 7.2 Deterministic build pipeline

`scripts/build-status-page.mjs`:

1. Read the existing `dist/manifest.json` (if any) and remember `assets`.
2. Build the client into `.tmp/status-page/client` with Vite:
   - `app/client.js` imports `framework7/framework7.css` and `./styles.css`; the SSR entry imports no CSS. This produces one hashed CSS file for the initial HTML link.
   - `base: "./"` is not used in output URLs; asset names are hashed and the runtime prefixes them.
   - `build.assetsInlineLimit: 0` (no data URLs; CSP has no `img-src`/`font-src`).
   - `build.sourcemap: false`, `build.minify: "esbuild"`, `build.cssCodeSplit: false`.
   - `rollupOptions.output.entryFileNames: "assets/status-page.[hash].js"`, `assetFileNames: "assets/status-page.[hash][extname]"`.
3. Build the SSR entry into `.tmp/status-page/server` with `build.ssr`, `ssr.noExternal: ["svelte", "framework7", "framework7-svelte"]`, `build.emitAssets: false` for CSS, and a stable output name.
4. Copy the client JS/CSS and `server/status-page.ssr.mjs` into a new `dist.next`.
5. Compute `buildId = "sha256-" + sha256(sorted(server bundle, entry JS, CSS files))`. Exclude `retained` and manifest metadata.
6. Compute `retained = old.assets - new.assets` (one previous release). Copy retained files from the old `dist/assets`; keep at most the previous release.
7. Write `manifest.json` with sorted keys:
   ```json
   {
     "schema": 1,
     "buildId": "sha256-...",
     "entry": "status-page.<hash>.js",
     "css": ["status-page.<hash>.css"],
     "assets": ["status-page.<hash>.js", "status-page.<hash>.css"],
     "retained": ["status-page.<oldhash>.js", "status-page.<oldhash>.css"]
   }
   ```
8. Delete assets not in `assets ∪ retained`.
9. Atomically replace `dist` (`dist.next` → `dist`), leaving the old tree intact on any failure.
10. `--check` builds into `.tmp/status-page/check`, compares `manifest.json` and every file hash with `dist`, and exits non-zero on any difference. It never writes `dist`.

Determinism checks:

- No timestamps, hostnames, absolute paths, or random IDs in output.
- Run the build twice from the same tree; `manifest.json` and all asset hashes MUST match.
- CI runs the build and then `git diff --exit-code -- lib/router/status-page/dist`.

### 7.3 Manifest and asset resolver

`lib/router/status-page.mjs` loads `dist/manifest.json` at module load and reads current + retained assets into a `Map`. It serves only names matching:

```
/^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/
```

The served URL is `[base]/assets/lazy-status/<name>`. No directory traversal, no query-dependent resolution, no fallback to `dist/server`. Unknown names under the page asset prefix return `404` with `cache-control: no-store`; unknown names elsewhere fall through to the gateway.

`statusAssetDir` (optional, default `null`) is a deployment directory for rollback retention. If set, the resolver also reads whitelisted `.js`/`.css` files from it, so an old tab can load a file from a release that is no longer the current package. The directory MUST be root-owned and not web-writable. `scripts/deploy-status-assets.mjs` copies the current `dist/assets/*` and `retained` files into it; it never deletes files referenced by the last two manifests.

### 7.4 CI and release

Add a `status-page` job to `.github/workflows/ci.yml`:

```yaml
status-page:
  name: Status page build freshness
  runs-on: ubuntu-latest
  timeout-minutes: 15
  steps:
    - uses: actions/checkout@v4
    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: "1.4.4"
    - run: bun install --frozen-lockfile
    - run: bun run build:status-page:check
    - run: git diff --exit-code -- lib/router/status-page/dist
```

`biome.json` MUST exclude `lib/router/status-page/dist/**`; generated bundles are not source.

`.github/workflows/release.yml` MUST run `bun run build:status-page:check` before `npm pack --dry-run`, and `prepublishOnly` SHOULD run it after `bun run ci`. `npm pack --dry-run` MUST list `lib/router/status-page/dist/manifest.json`, the SSR bundle, and every current/retained asset.

### 7.5 Caching, retention, and rollback

- HTML: `no-store`.
- Hashed JS/CSS: `public, max-age=31536000, immutable`.
- Current `dist/assets` + `manifest.retained` cover one previous release.
- `statusAssetDir` covers rollback and older live tabs. The deploy script copies, never moves, current assets there. A rollback keeps the directory; the previous release's package and the shared directory together serve every hash referenced by a live tab.
- A missing asset returns 404; the page remains readable from SSR and shows "页面资源已更新，请刷新" if the entry script fails. No mixed-version UI.
- Rollback test: deploy v3-a, open a tab, deploy v3-b, roll back to v3-a, open a new tab and refresh the old tab. Both must load; no 404 for v3-b assets referenced by the still-open tab.

### 7.6 Version handshake

- `manifest.buildId` → `snapshot.buildVersion` → `<meta name="status-build">` → `Root.initialSnapshot.buildVersion`.
- Every refresh compares `schemaVersion` and `buildVersion`; mismatch stops polling and shows the reload banner.
- `worker_load.build_version` and `view_schema` expose mixed workers. If any live worker differs, `snapshot.notices` includes `version_mismatch`; the page shows a warning and disables reset until the release completes.
- `answeredBy` is diagnostic only; it is not a user-facing metric.

### 7.7 Subpath

- `statusBasePath` (config, default `""`) is the explicit mount prefix. If empty, `X-Forwarded-Prefix` from a trusted loopback proxy is used. The value is normalized: must start with `/`, no `..`, no `//`, only `[A-Za-z0-9._~/-]`, trailing slashes removed.
- `lazyRouterHandler` strips the base path before matching `/`, the asset prefix, the status path, the reset path, and `/v1/models`.
- The HTML uses absolute paths: `[base]/assets/lazy-status/<file>`, `[base]/v1/lazy/status`, `[base]/v1/lazy/token-totals/reset`.
- The client reads the metas; no hardcoded `/`.
- nginx example:
  ```nginx
  location /ops/ {
    proxy_set_header X-Forwarded-Prefix /ops;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:8787/;
  }
  ```
- If the proxy cannot set headers, set `statusBasePath: "/ops"` in `shims.json`.

### 7.8 Policy amendments

`CONTRIBUTING.md` "Pure ES modules" bullet becomes:

> **Pure ES modules at runtime.** New runtime source files use `.mjs`. One exception is the status page UI: `lib/router/status-page/app/**` is Svelte source compiled by Vite, and its output is committed under `lib/router/status-page/dist/`. The gateway never builds at startup or on a request. Run `bun run build:status-page` after changing the page source; CI fails on source/output drift.

Add to the Checks section:

```sh
bun run build:status-page        # rebuild the committed status-page assets
bun run build:status-page:check  # fail if the committed output is stale
```

`CHANGELOG.md` under `Unreleased`:

> **Status page v3.** The dashboard is now a Framework7 Svelte application with server-rendered content, one-snapshot refresh, global four-worker statistics, a shared token epoch, and a Framework7 reset dialog. The status page has a narrow build-time Vite/Svelte toolchain; the gateway runtime remains build-free. The theme is Material Design only; iOS users see Material Design, not a native iOS theme. The page CSP permits inline styles for Framework7 but still forbids inline scripts and `unsafe-eval`. The page is `noindex`.

Also note the iOS/auto-theme limitation (MD only) in the same entry.

---

## 8. Implementation sequence, invariants, and review checkpoints

This is an implementation order, not a goal task list. Each step is independently testable and leaves the tree coherent.

### Step 1 — Snapshot contract and pure formatter

**Build:** `snapshot.mjs`, `format.mjs`, `test/status-page-snapshot-v3.test.mjs`.

**Invariants:**

- One `Metric` for each M01–M27; no duplicate, no missing.
- Unknown → `—`; tokens/percent/duration rules in §3.9.
- `unitRef` hashing; no raw account id.
- URL allowlist `https:` only.
- JSON-template escaping.

**Review checkpoint:** table-driven fixture with every metric and every unavailable branch; snapshot contains no `undefined`; no DB import.

**Unlocks:** CASE-02 data, CASE-03 D1/D3, CASE-07 formatting, CASE-11 D4.

### Step 2 — Store expansion and one read transaction

**Build:** `state-store.mjs`, migration tests, `test/router-perf-window-v3.test.mjs` seed helpers.

**Invariants:**

- Migration idempotent; `user_version` stays 2; v2 tables still usable.
- One read transaction for epoch/totals/health/capacity/workers/proof/affinity/perf.
- 30-bucket bound inclusive; imputed separation; batch query.
- Heartbeat/affinity/proof/token tables.

**Review checkpoint:** open a v2 fixture, migrate, reopen, run the old v2 `STATE_SCHEMA` statements; compare totals and `since`; assert exactly one epoch row; count SQL statements for one status read.

**Unlocks:** CASE-05 D1/D2, CASE-06 D1/D4, CASE-07 D1/D3, CASE-08 D1/D2/D3, CASE-09 D1, CASE-10 D1/D2.

### Step 3 — Router wiring and correctness

**Build:** `router.mjs`, `perf.mjs`, `health.mjs`, `affinity.mjs`, `provider-concurrency-proof.mjs`, `features/lazy-router.mjs`, `test/router-status-v3.test.mjs`, `test/router-token-epoch-v3.test.mjs`.

**Invariants:**

- `statusView()` calls `readStatusData()` once and builds one snapshot.
- `#routeViews` uses preloaded health/capacity/perf/proof; no per-candidate store query.
- Shared health reason/next probe; `markDead` false creates no local cooling.
- Proof persists across restart; TTL 30m.
- Affinity counters at the lookup decision; no double count.
- Speed observes healthy completions; client-gone is censored only.
- Request-start epoch; usage once; non-SSE/direct counted.

**Review checkpoint:** four-worker fixture; compare page JSON to SQLite rows; restart proof; run 10/20 affinity; run a long request through a reset; count usage taps.

**Unlocks:** CASE-05, CASE-06, CASE-07, CASE-08, CASE-09, CASE-14 server semantics.

### Step 4 — Svelte SSR shell and F7 component tree

**Build:** `app/StatusApp.svelte`, `Root.svelte`, `ssr.js`, `styles.css`, leaf components, `status-page.mjs`, `dist` build.

**Invariants:**

- SSR body contains all sections; no client-only data path.
- F7 MD only; App/Page/Navbar/Card/List/Accordion/Button/Toast/Dialog real.
- No module top-level `window`, `document`, or `navigator` access in Svelte source; browser work lives in `onMount`/`$effect` and the client entry. Framework7's own `getWindow()` SSR shim is the only exception.
- No nested cards; four primary groups.
- No inline script; template JSON; external CSS/JS.
- SSR render under Bun succeeds; one `<App>` root.

**Review checkpoint:** `bun test test/status-page-build-v3.test.mjs`; render a fixture; assert `</template>` absent from the escaped JSON; assert no `<script>` without `src`; compare against the F7 kitchen sink at 1440/320.

**Unlocks:** CASE-01, CASE-02, CASE-03.

### Step 5 — Hydration, refresh, and reset

**Build:** `client.js`, `refresh.js`, `reset-dialog.js`, `Banner.svelte`, `ResetAction.svelte`.

**Invariants:**

- Hydration target `#status-root`; one App/navbar.
- One request per cycle; 8s timeout; backoff; visibility/offline.
- `snapshotId`/build/schema checks; no splice; focus/open state preserved.
- F7 Dialog; token memory-only; no native prompt/confirm; HTTPS gate; pending/error.
- `409` conflict handling; no optimistic success.

**Review checkpoint:** throttled network, hang, offline, focus trace, 100 cycles, double reset, invalid token.

**Unlocks:** CASE-04, CASE-14 client.

### Step 6 — Security, accessibility, and subpath

**Build:** CSP/headers, URL allowlist, `noindex`, contrast tokens, focus/keyboard handlers, base-path resolver, proxy docs.

**Invariants:**

- Exact CSP; no inline script/eval; console clean.
- XSS fixtures render as text.
- Contrast/keyboard/touch/reduced-motion/zoom.
- `/ops/` assets/status/reset work; no hardcoded root.

**Review checkpoint:** XSS fixture set; CSP header dump; axe/keyboard pass; 320/768/1440; `/ops/` HAR.

**Unlocks:** CASE-11, CASE-12, CASE-13 U4.

### Step 7 — Build/deploy automation and policy docs

**Build:** `scripts/build-status-page.mjs`, `scripts/deploy-status-assets.mjs`, `package.json`, `bun.lock`, CI/release, `biome.json`, `CONTRIBUTING.md`, `CHANGELOG.md`, `README.md`.

**Invariants:**

- Deterministic build; committed dist; CI drift fail.
- `dist` packaged; no runtime Svelte/F7 dependency.
- N-1 assets; rollback; version handshake.
- Policy exception documented.

**Review checkpoint:** two builds hash-identical; CI job; `npm pack --dry-run`; rollback with a live old tab.

**Unlocks:** CASE-13.

### Step 8 — Manual evidence and cleanup

**Build:** no feature work; run the S1 matrix, write `report.md` in S4 only.

**Invariants:**

- Every CASE has its named evidence; unexecuted paths are 0.
- No dead code: old `view.mjs`, `client.mjs`, `index.html`, `style.css`, local cooling status path, per-model perf SELECTs removed.
- Documentation and changelog match the shipped behaviour.

**Review checkpoint:** S1 traceability table re-walked; no orphan metric, no dead payload, no old section IDs that could splice.

---

## 9. Risk register

| Risk | Trigger | Impact | Mitigation / check |
|---|---|---|---|
| Build/toolchain policy | Vite/Svelte introduced into a no-build package | Owner rejects; CI/package copies source but not dist | D1 decision + narrow `CONTRIBUTING`/`CHANGELOG` exception; `files` includes dist; CI drift check; runtime import test |
| Vite 8 vs Bun 1.4.4 | Vite declares Node engines; CI builds with Bun | Build fails or nondeterministic | Build under Bun 1.4.4 and Node 22 in CI; if Bun diverges, run the build with `actions/setup-node` and `npm ci` while keeping `bun test`; pin exact Vite |
| CSP relaxation | `style-src 'unsafe-inline'` | XSS via style injection or policy objection | No user-controlled style values; no `{@html}`; F7-only inline styles; CSP header/console evidence; strict fallback would require dropping F7 components |
| F7/Svelte compatibility | Version drift or plugin install order | SSR `undefined is not a constructor`; hydration mismatch | Exact pins; `Framework7.use(Framework7Svelte)` before render; SSR smoke test; kitchen-sink comparison; no `auto` theme |
| SSR/hydration mismatch | Different server/client props or source versions | Duplicate App, lost listeners, CLS | Same `buildId` for SSR and client; `nowMs` from `generatedAt`; same `StatusApp` tree; template JSON; hydration smoke test in happy-dom + real browser |
| SQLite migration | v2 file with mixed/imputed rows | Lost diagnostics or failed open | Expand-only tables/columns; `user_version` stays 2; backfill `legacy_mixed`; reopen test; backup before deploy |
| Multi-worker races | Four workers, reset, proof, affinity, capacity | Split totals, undercount, stale global | One read transaction; request-start epoch; `MAX` proof upsert; `affinity_stat` upsert; `worker_load` heartbeat; 5s/5min bounds; version handshake |
| Old tabs | Deploy changes build/schema | Crash or mixed UI | `buildVersion` mismatch banner; stop polling; N-1 assets; no HTML refresh; v2 tabs cannot splice because v3 section IDs are absent |
| Asset retention/rollback | Rollback removes current hashes | 404 for a live tab | `manifest.retained` + `statusAssetDir` shared directory; deploy script copies, never moves; rollback test |
| Reset abuse | Public page, HTTP, invalid token | Unauthorized reset | HTTPS gate server-side; `adminTokenMatches`; `x-lazy-reset`; idempotency/409; memory-only token; no logs |
| Accessibility of F7 defaults | F7 controls lack labels/focus | CASE-12 failure | Wrapper labels, `aria-expanded`, focus management, 44px CSS, axe/manual pass |
| Payload size | Four workers × routes × units | Slow status response | One snapshot, batch queries, 30-bucket cap, no per-model SELECT, no alternate payload; measure with 50 models |
| `X-Forwarded-Prefix` trust | Client-supplied header | Wrong URLs, not XSS | Only trust from loopback proxy or explicit `statusBasePath`; strict normalization |
| CJK/font rendering | F7 Roboto stack, mono fallback | Tofu/crowded glyphs | System CJK stacks; no negative tracking; 14px/12px floors; computed-style evidence |

---

## 10. Manual verification mapping

Automated tests are supporting evidence only. Each CASE below must be executed manually and recorded under `docs/manual-acceptance/status-page-v3/evidence/CASE-XX/`. The S4 auditor scores from observed evidence, not from this guide.

### 10.1 Common build/run commands

```sh
bun install --frozen-lockfile
bun run build:status-page:check       # must not modify dist
bun test                              # supporting only
systemctl --user restart omp-auth-gateway@{1..4}
ss -ltnp | grep <gateway-port>
curl -sS -D /tmp/status.headers http://127.0.0.1:<gateway-port>/ -o /tmp/status.html
curl -sS http://127.0.0.1:<gateway-port>/v1/lazy/status -o /tmp/status.json
sqlite3 ~/.omp/omp-shims-state.sqlite '.tables'
sqlite3 ~/.omp/omp-shims-state.sqlite 'SELECT * FROM worker_load;'
```

For `/ops/`, use the nginx config in §7.7 and repeat the URL/asset/reset checks.

### 10.2 CASE mapping

| CASE | Build/run steps | Required evidence |
|---|---|---|
| 01 F7 authenticity | Open `/`; inspect DOM and `Framework7ComponentsApp.f7`; exercise App/Page/Navbar/Card/List/Accordion/Button/Toast/Dialog; compare with `framework7@9.3.0` MD kitchen sink at 1440/320; cache-disabled reload | DOM classes, F7 version/theme, component interaction video, side-by-side screenshots, self-hosted network log, one App/navbar after hydration |
| 02 Hierarchy/layout/typography | Count primary groups; inspect route DOM for `.card .card`; screenshots 320/768/1440 light/dark; measure fonts, `scrollWidth` vs `clientWidth`, table caption/scope, tree leaf/op, healthy chips | Screenshots, DOM/computed styles, overflow metrics, table DOM |
| 03 SSR/JS-off/hydration | `curl` raw HTML; JS-off profile; slow 3G hydration; compare initial/hydrated values and `snapshotId`; confirm reset disabled + noscript | Raw HTML, JS-off screenshots, CLS trace, hydration console, template JSON parse, snapshot ID comparison |
| 04 Refresh | Change perf/speed/affinity/proof/coverage/value/next probe; hang the endpoint; HAR; focus/open details; offline 30s; change server structure | Screen recording, HAR with one status request per cycle, timeout/offline banner, focus/open-state DOM, version mismatch banner |
| 05 In-flight/capacity | Eight concurrent requests to a limited unit; sample status; compare `worker_load`/`capacity`; kill a worker; unlimited unit; duplicate labels; 40 samples by `answeredBy` | DB rows/sums, status JSON, worker PIDs, screenshots, 40-sample table |
| 06 Proof/affinity | Overlapping cohorts on two workers; restart all; 10 matching/10 non-matching lookups; reset tokens; inspect `proof`/`affinity_stat` | Proof rows before/after restart, affinity counters, page labels, reset-invariance |
| 07 Tokens/epoch | Send SSE `100/50/20`, JSON `10/5/2`, direct `7/3/1`; two SSE usage frames; long request + reset; 100 reads during writes; output-only; read failure; memory store | Totals/coverage/epoch SQL, usage logs, reset responses, 100-read comparison, screenshots |
| 08 Perf/speed/query | Seed minute-31/-30/-29/current/future buckets; complete/imputed; count SQL; period boundary; 20 healthy completions + client-gone; no samples | Seeded rows, query trace/count, complete-only calculation, speed before/after, `—` screenshot |
| 09 Health/fencing | Bench worker A with quota until +10m; read worker B; early probe; concurrent probes; stale fenced `markDead`; busy vs cooling; restart | Health rows, probe timestamps, fence rejection log, two-worker screenshots, restart evidence |
| 10 Degradation | Memory store; read fault; reset write fault; old-build worker; DB lock; scroll; recovery | Status JSON, screenshots, banner DOM/ARIA, reset responses, worker versions, recovery |
| 11 Security/CSP | Inject `<img onerror>` and `javascript:`; dump CSP/headers; `noindex`; invalid token; non-loopback HTTP; secret scan; frame/nosniff/referrer/link rel | Payload screenshots/DOM, CSP header, console, reset responses, storage inspection, secret-scan output |
| 12 Accessibility | Contrast measurements; keyboard Tab/Enter/Space/Escape; aria-live; table caption/scope; 44px boxes; reduced motion; 200% zoom; CJK | Computed contrast, keyboard video, a11y tree, touch boxes, zoom/reduced-motion screenshots |
| 13 Deployment/cache | Build twice/hash; headers; old tab after deploy; rollback; `/ops/`; source change without rebuild -> CI fail; `npm pack` listing | Build hashes, headers, old-tab/rollback video, subpath HAR, CI output, package listing |
| 14 Reset UX | Open F7 Dialog; cancel/Escape; invalid token; valid token; long in-flight reset; double submit; non-loopback HTTP | Dialog video/DOM, network responses, epoch JSON/DB, in-flight log, double-submit result |

### 10.3 Evidence naming

Use `CASE-XX_<subject>_<viewport>_<theme>.<ext>` for screenshots; `CASE-XX_<table>.txt` for DB dumps; `CASE-XX_<subject>.json` for status JSON; `CASE-XX_<subject>.har` for network captures. Keep full-frame originals before cropping.

### 10.4 Pass rule

The S4 report uses the S1 §5.0 rubric: `final = min(user_score, developer_score)`, PASS ≥ 80, hard fail = 0. A CASE without its named evidence scores 0. Automated test output may be attached but never substitutes for the manual observation.

---

## 11. Definition of done for implementation review

The implementation is ready for S3/S4 only when all of the following are true:

1. `bun run build:status-page:check` passes and `git diff --exit-code -- lib/router/status-page/dist` is empty.
2. `bun test` passes; the status-page build test imports the committed SSR bundle and renders a fixture with no DOM.
3. `npm pack --dry-run` lists `lib/router/status-page/dist/manifest.json`, `dist/server/status-page.ssr.mjs`, and every current/retained asset.
4. The SSR bundle has no bare `svelte`, `framework7`, or `framework7-svelte` import.
5. The page response has the exact CSP, `no-store`, `noindex`, `nosniff`, and `no-referrer` headers; assets have `immutable`.
6. `statusView()` has exactly M01–M27; M25 is explicitly removed; no client-side sum remains.
7. One refresh produces one status request; a hang aborts within 10 seconds; focus and open items survive.
8. Reset uses an F7 Dialog; no `prompt`/`confirm`; token is memory-only; reset is HTTPS-gated and epoch-atomic.
9. A four-worker staging run shows the same global values within the freshness bound; proof survives restart; affinity matches the 10/20 case.
10. The S1 traceability table has no uncovered audit finding; the risk register has an owner and a check for each open risk.
