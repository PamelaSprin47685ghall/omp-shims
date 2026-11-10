# omp-shims Status Page v3 — S3 Coordination Book

- **Goal slug**: `status-page-v3`
- **Date**: 2026-11-11
- **Inputs**: `requirements.md` (S1, approved), `development-guide.md` (S2, approved).
- **Purpose**: make the S2 implementation executable by six engineers with disjoint write sets, explicit handoffs, a merge train, and an S4 execution plan.
- **Rule**: this book allocates work and fixes interfaces. It does not change product behaviour. Where S2 is silent, the name is marked **S3-fixed**; where S2 already names it, the S2 name is used verbatim.

---

## 0. Operating rules

### 0.1 Invariants every unit must preserve

| ID | Invariant | Consequence |
|---|---|---|
| I1 | One `statusView()` call produces exactly one `StatusSnapshotV3`; HTML `data-snapshot-id`, the embedded template, and that render carry the same id | No unit may add a second aggregation pass or splice a later JSON into the initial HTML |
| I2 | The server owns all aggregation and formatting; the browser never sums routes, units, workers, tokens, capacity, or proof | Components render `Metric.value`; no client arithmetic |
| I3 | `statusView()` performs one `readStatusData()` transaction and zero per-candidate store queries | Route views use preloaded health/capacity/perf/proof |
| I4 | The gateway never builds at startup or per request; `dist/**` is committed and CI-checked | Only `scripts/build-status-page.mjs` compiles Svelte |
| I5 | Unknown is `—`, never `0`, `0%`, `0 ms`, or `0 tokens` | Every unavailable branch has a reason |
| I6 | `PRAGMA user_version` stays `2`; the migration is expand-only | Rollback to the previous package opens the same file |
| I7 | Reset changes only token totals and the epoch; it is HTTPS-gated, authorized, idempotent, and atomic | No optimistic success, no split request |
| I8 | No account id, e-mail, credential, digest content, upstream URL, or stack trace appears in HTML, JSON, or logs | Secret-scan fixture is a merge gate |

### 0.2 Single-writer rule

1. Every file has exactly one owner at any moment. The owner is the only unit allowed to edit it.
2. Other units code against the interface in §3 and send review comments; they do not edit.
3. A shared file with two concerns gets a **time-boxed handoff**, not two writers:
   - `lib/router/state-store.mjs`: C0 writes the schema/migration/read interface; at **G0a** ownership transfers to E4. C0 never writes it again without E4's request.
   - `lib/router/router.mjs`: E3 is the writer; E4 signs off the usage/epoch call sites, C0 signs off the `buildSnapshot()` call.
   - `features/lazy-router.mjs`: E2 is the writer; E4 signs off the reset route and epoch capture; E1 signs off the asset/meta names.
   - `package.json`: E1 is the writer; E5 requests release-script changes through E1.
   - `test/**`: E5 is the writer. A failing test is reported to its owner; E5 changes a test only when the contract changes and C0 approves.
4. A unit's branch must not contain edits outside its write set. The reviewer rejects such a branch without reading further.

### 0.3 Units at a glance

| Unit | Role | Primary deliverable | Write-set size |
|---|---|---|---|
| C0 | Contract engineer | Snapshot/formatter contract + store schema/migration/read interface | 3 files |
| E1 | UI/build engineer | Pinned toolchain, Svelte SSR bundle, F7 component tree, hydration | `app/**`, `dist/**`, build script, package files, CI |
| E2 | Server/page engineer | Page/asset resolver, config/base path, handler wiring, reset route | 3 files + legacy page deletion |
| E3 | Read-model engineer | `statusView()` + perf/speed/health/affinity/capacity/proof | 8 files |
| E4 | Accounting engineer | Token epoch, usage capture contract, reset transaction, heartbeat rows | `state-store.mjs` |
| E5 | Quality/release engineer | Test suite, v2 fixture, deploy script, docs, release workflow | `test/**`, docs, deploy script |

**Maximum concurrency**: 6 writers (C0, E1, E2, E3, E4, E5). E4 is the only unit that starts after a gate (G0a). No additional unit may be added without splitting a file set.

---

## 1. Work units

### 1.1 C0 — Contracts and snapshot schema

| Field | Value |
|---|---|
| **Owner role** | Contract engineer (one person; later the contract arbiter) |
| **Starts** | W0, day 1 |
| **Depends on** | S2 §3.1–§3.10, S1 §4, existing `lib/router/state-store.mjs`, `lib/router/router.mjs`, `lib/router/official-rate-value.mjs` |
| **Unlocks** | E1 (snapshot prop shape), E2 (page HTML), E3 (`buildSnapshot` + `readStatusData`), E4 (store handoff), E5 (contract tests) |

**Write set**

| Path | Scope |
|---|---|
| `lib/router/status-page/snapshot.mjs` | New. `buildSnapshot(input)`, `buildSnapshotMetrics`, `toRouteView`, `buildDiagnostics`, `buildWorkers`, `buildCapacity`, `buildHealth`, `buildProof`, `buildAffinity`, `buildTokenTotals`, `buildNotices`; M01–M27; `unitRef`; URL allowlist; `sanitizeStatusReason`; JSON-template escaping |
| `lib/router/status-page/format.mjs` | New. Tokens, percent, duration, count, currency, exact-title strings, `—` rules |
| `lib/router/state-store.mjs` | **Temporary, until G0a only**: `STATE_SCHEMA` unchanged; `migrateStatusV3(db)`; `ensureTokenEpoch(db, now)`; `readStatusData(...)`; `captureTokenEpoch()`; `resetTokenTotals({resetId})` signature stub |

**Read-only inputs**: S2 §3.1–§3.6 and §3.10; S1 §4.1–§4.5; existing v2 schema and `totals` mirror; `officialApiEquivalent()`; `sanitizeReason` conventions; existing `STATE_VERSION = 2`.

**Explicit non-goal**: do **not** create `lib/router/status-view-schema.mjs`. It is not in the S2 file plan. The executable schema is `test/status-page-snapshot-v3.test.mjs`; JSDoc typedefs live in `snapshot.mjs`.

**Outputs**

1. `buildSnapshot(input)` accepting exactly the S2 §3.4 input keys: `now`, `idFactory`, `answeredBy`, `buildVersion`, `epoch`, `store`, `period`, `catalog`, `routes`, `perfRows`, `nowMinute`, `workerRows`, `capacityRows`, `healthRows`, `proofRows`, `affinityStats`, `tokenTotals`.
2. `readStatusData()` returning the raw-row bundle in §3.3.
3. Migration that leaves `PRAGMA user_version = 2`, creates the v3 tables, adds the perf columns, backfills `legacy_mixed`, and writes `metadata.state_features = 'status-v3'` last.
4. Handoff note at G0a: the exact list of methods E4 now owns.

**Dependencies**: none. C0 is the root of the DAG.

**Definition of ready**: S1/S2 approved; existing v2 schema read; fixture schema agreed with E5.

**Definition of done**:
- `bun test test/status-page-snapshot-v3.test.mjs` green.
- A v2 fixture opens, migrates, closes, reopens; `user_version = 2`; old v2 statements still run.
- Every metric M01–M27 appears exactly once in its documented placement; M25 is `available:false`.
- Snapshot contains no `undefined` value at any depth.
- `snapshot.mjs` imports no database, DOM, or Node built-in.
- `readStatusData()` is one SQLite read transaction; a query-count test asserts one `readStatusData` call per snapshot and zero per-candidate queries.
- G0a handoff recorded and E4 has started.

---

### 1.2 E1 — Build, toolchain, SSR shell, F7 component library

| Field | Value |
|---|---|
| **Owner role** | UI/build engineer |
| **Starts** | W0, day 1 (toolchain and shell can start before C0 finishes; use the E5 fixture) |
| **Depends on** | C0 snapshot shape for final props; E2 manifest/SSR consumer contract; E4 build version |
| **Unlocks** | E2 page render; E5 build/security tests; CASE-01, 02, 03, 04, 12 |

**Write set**

| Path | Scope |
|---|---|
| `lib/router/status-page/app/**` | All Svelte components, `Root.svelte`, `StatusApp.svelte`, `client.js`, `ssr.js`, `vite.config.mjs`, `vite.ssr.config.mjs`, `styles.css`, `lib/*.svelte`, `lib/relative.js`, `lib/refresh.js`, `lib/reset-dialog.js` |
| `lib/router/status-page/dist/**` | Generated: `manifest.json`, `server/status-page.ssr.mjs`, `assets/status-page.<hash>.{js,css}` |
| `scripts/build-status-page.mjs` | Deterministic two-build pipeline, manifest, retention, `--check` |
| `package.json` | Exact devDeps, `build:status-page`, `build:status-page:check`, `files` includes `lib/router/status-page/dist/` |
| `bun.lock` | Exact resolved graph |
| `biome.json` | Exclude `lib/router/status-page/dist/**` |
| `.gitignore` | Ignore `.tmp/`; keep `dist/` tracked |
| `.github/workflows/ci.yml` | Add the `status-page` freshness job |

**Read-only inputs**: S2 §1.2–§1.4, §4, §5, §6, §7.1–§7.8; C0 snapshot contract; E5 `test/fixtures/status-snapshot-v3.json`; F7 kitchen sink at `framework7@9.3.0`.

**Explicit non-goals**: do not edit `lib/router/status-page.mjs` (E2), `lib/router/state-store.mjs` (E4), `features/lazy-router.mjs` (E2), `test/**` (E5), `scripts/deploy-status-assets.mjs` (E5).

**Work breakdown**

| Phase | Deliverable | Gate |
|---|---|---|
| E1a (W0) | Pin exact devDeps; `vite.config.mjs`, `vite.ssr.config.mjs`; `scripts/build-status-page.mjs` producing a manifest from a trivial entry; `App` shell; `ssr.js` plugin install | `bun install --frozen-lockfile`; one SSR render of the fixture; two builds hash-identical |
| E1b (W1) | `StatusApp.svelte` full tree; all leaf components; `styles.css` tokens; SSR body complete with JS off | SSR HTML contains all four primary groups, routes, channels, units, diagnostics, reset explanation |
| E1c (W2) | `client.js` hydrate; `refresh.js`; `Root.svelte` exports `apply`, `setConnection`, `tick`, `setReady`; `reset-dialog.js`; `Banner.svelte`; `ResetAction.svelte` | Hydration smoke; one request per cycle; 8 s abort; F7 Dialog; no `prompt`/`confirm` |
| E1d (W3) | CSP-safe styles and a11y adjustments inside `app/**`; 44 px targets; focus; reduced motion; CJK | axe/keyboard pass; `/ops/` assets load (with E2) |

**Definition of ready**: exact versions installable under Bun `1.4.4`; C0 fixture available; F7 kitchen-sink reference available.

**Definition of done**:
- `bun run build:status-page:check` exits 0 and does not write `dist`.
- Two clean builds produce identical `manifest.json` and asset hashes.
- `bun test test/status-page-build-v3.test.mjs test/status-page-security-v3.test.mjs` green.
- The SSR bundle has no bare `svelte`, `framework7`, or `framework7-svelte` import.
- No inline `<script>`; no `{@html}`; no `prompt(`/`confirm(`; no module-top-level `window`/`document`/`navigator`.
- One `<App>` and one navbar after hydration; `#status-root` `data-snapshot-id` equals the template id.
- `dist/**` committed; CI drift job added.

---

### 1.3 E2 — Server page, asset resolver, config, handler wiring

| Field | Value |
|---|---|
| **Owner role** | Server/page engineer |
| **Starts** | W0, day 1 (config and base-path normalizer first) |
| **Depends on** | E1 `dist/server/status-page.ssr.mjs` + manifest; C0 snapshot; E4 store methods |
| **Unlocks** | E5 route/security tests; CASE-11, 13, 14; page serving for every UI CASE |

**Write set**

| Path | Scope |
|---|---|
| `lib/router/status-page.mjs` | Replace template-string renderer with `renderStatusDocument`; static import of the SSR bundle; manifest loader; asset resolver; exact CSP/headers; `noindex`; `HEAD`; 404 for unknown page assets; base-path-aware URLs |
| `lib/config.mjs` | `features["lazy-router"].statusBasePath` (default `""`), `.statusAssetDir` (default `null`); validation/normalization |
| `features/lazy-router.mjs` | Page/asset/status/reset dispatch; base-path strip; heartbeat start/stop; direct `measureDirect(..., epoch)` call site; reset route; build version pass-through |
| `lib/router/status-page/view.mjs` | **Delete** |
| `lib/router/status-page/client.mjs` | **Delete** |
| `lib/router/status-page/index.html` | **Delete** |
| `lib/router/status-page/style.css` | **Delete** |

**Read-only inputs**: S2 §1.2–§1.3, §3.8, §6.1, §7.3, §7.5–§7.7; E1 manifest shape (§3.5 here); C0 snapshot; E4 `captureTokenEpoch`, `resetTokenTotals`; `lib/router/admin-token.mjs`.

**Work breakdown**

| Phase | Deliverable | Gate |
|---|---|---|
| E2a (W0) | Config keys + normalizer; base-path resolver unit tests via E5; manifest loader skeleton | Accepts `""`, `/ops`; rejects `..`, `//`, bad chars, non-`/` start |
| E2b (W1) | `status-page.mjs` renders an SSR fixture with exact headers; asset resolver 200/404/HEAD | Header dump matches §3.4; traversal rejected |
| E2c (W2) | `features/lazy-router.mjs` serves `/`, assets, status, reset; strips base path for `/`, asset prefix, status path, reset path, `/v1/models` | `/ops/` HAR; four routes correct |
| E2d (W3) | Heartbeat interval (2 s, `.unref()`), install write, dispose delete; epoch capture before `downstream()`; reset route gates | 4 `worker_load` rows; reset 401/403/405/409/503/200 |

**Handoff obligations** (E4 review required, E2 writes):
- Reset route order: POST → HTTPS gate → `x-lazy-reset` + JSON content type → `adminTokenMatches` → `store.resetTokenTotals({resetId})` → map result.
- `LazyRouter.serve()` captures `const epoch = this.store.captureTokenEpoch()` before the first upstream attempt.
- `lazyRouterHandler` captures the epoch before `downstream()` for direct requests and passes it to `measureDirect()`.
- Heartbeat payload: `{worker, host, pid, build_version, view_schema:3, in_flight, catalog_ready, epoch, updated_at}`.

**Definition of ready**: E1 manifest shape frozen; C0 `buildSnapshot` exported; E4 method signatures frozen.

**Definition of done**:
- Exact headers on `/`: CSP, `cache-control: no-store`, `nosniff`, `no-referrer`, `x-robots-tag`.
- Asset 200 has `immutable`; unknown asset 404 with `no-store`; `HEAD` works.
- Unknown page asset does not fall through to the gateway; unknown non-asset path does.
- `statusBasePath`/`X-Forwarded-Prefix` produce absolute URLs with no hardcoded `/`.
- Reset returns the exact status/body matrix; no optimistic success.
- Legacy `view.mjs`, `client.mjs`, `index.html`, `style.css` deleted; no imports remain.
- E4 sign-off recorded for the reset route and epoch call sites.

---

### 1.4 E3 — Stats read model

| Field | Value |
|---|---|
| **Owner role** | Read-model engineer |
| **Starts** | W0, day 1 (pure perf/affinity/health/capacity modules); `statusView` integration after G0b |
| **Depends on** | C0 `buildSnapshot` + `readStatusData`; E4 token epoch read shape |
| **Unlocks** | E2 page data; E5 stats tests; CASE-05, 06, 08, 09, 10 |

**Write set**

| Path | Scope |
|---|---|
| `lib/router/router.mjs` | `statusView()` one read + one snapshot; `status()` JSON; preloaded route views; speed on healthy completion; proof from store; affinity counters; request-start epoch; `createUsageTap` exactly-once; `measureDirect` epoch/period |
| `lib/router/perf.mjs` | Inclusive 30-bucket window; batch summaries; complete-only mean; imputed separation |
| `lib/router/cyclic-speed.mjs` | `snapshotFromRows(speedRows, at)`; routing `predict()` unchanged |
| `lib/router/provider-concurrency-proof.mjs` | Shared proof store; monotonic `MAX`; 30-min TTL; local map cache only |
| `lib/router/affinity.mjs` | 5-minute lookup/hit counters at the lookup decision; digest storage unchanged |
| `lib/router/health.mjs` | Shared row read `{state, until, reason, updatedAt, probeLeaseUntil}`; false `markDead` authoritative; local mirror cache |
| `lib/router/capacity.mjs` | Status reads shared rows; no `inFlight()` per candidate; policy unchanged |

**Read-only inputs**: S2 §3.1–§3.5, §3.9, §3.10; C0 snapshot contract; C0/E4 store API; `lib/router/plan.mjs`, `units.mjs`, `ranking.mjs`.

**Explicit non-goals**: do not edit `snapshot.mjs` (C0), `state-store.mjs` (E4), `features/lazy-router.mjs` (E2), `test/**` (E5). If `buildSnapshot` lacks a field, request it from C0; do not patch around it.

**Work breakdown**

| Phase | Deliverable | Gate |
|---|---|---|
| E3a (W0) | `perf.mjs` 30-bucket/complete-only; `affinity.mjs` counters; `capacity.mjs` shared rows; `health.mjs` row read; `proof.mjs` store upsert | Unit fixtures for 30/31 buckets, 10/20 affinity, stale rows, false `markDead` |
| E3b (W1) | `cyclic-speed.mjs` `snapshotFromRows`; `router.mjs` `statusView` skeleton with preloaded data; `#routeViews` preload | One read; no per-candidate query count |
| E3c (W2) | `statusView` complete: M01–M27, notices, `tokenTotals`, `affinity`, `proof`, `capacity`, `health`; 503 JSON path | Four-worker fixture; JSON equals DB rows |
| E3d (W3) | `createUsageTap` exactly-once + bounded JSON tail; `measureDirect` epoch; direct `openUpstream` | Long request through reset; duplicate usage frame; SSE/JSON/direct |

**Definition of ready**: C0 `buildSnapshot` frozen; `readStatusData` returns raw rows; E4 `captureTokenEpoch` available.

**Definition of done**:
- `statusView()` calls `readStatusData()` exactly once; no second `readSpeedRows()`.
- `#routeViews` issues no store query per candidate.
- M01–M27 inventory passes; M25 explicit; no client-side sum.
- Health reason/next probe come from shared rows; rejected `markDead` creates no local cooling.
- Proof survives restart; affinity matches 10/20; speed updates only on healthy completion.
- Usage tap fires once per request; aborted/errored requests do not increment `complete`.
- `bun test test/router-status-v3.test.mjs test/router-perf-window-v3.test.mjs test/router-token-epoch-v3.test.mjs` green.
- E4 sign-off on usage/epoch call sites; C0 sign-off on the `buildSnapshot()` call.

---

### 1.5 E4 — Token epoch and usage accounting

| Field | Value |
|---|---|
| **Owner role** | Accounting engineer |
| **Starts** | **G0a** (after C0 hands off `state-store.mjs`) |
| **Depends on** | C0 schema/migration/read interface |
| **Unlocks** | E3 token view; E2 reset route; E5 epoch tests; CASE-07, 14 |

**Write set**

| Path | Scope |
|---|---|
| `lib/router/state-store.mjs` | Sole owner after G0a: token tables; `captureTokenEpoch()`; `addTokenTotals(epoch, provider, model, usage)` one transaction + legacy mirror; `resetTokenTotals({resetId})` idempotency/2 s guard/atomic epoch; `writeWorkerLoad`/`deleteWorkerLoad`; `readStatusData` token/worker/proof/affinity/perf rows; `prune()` bounds |

**Read-only inputs**: S2 §3.6–§3.9; existing `addTokenTotals`, `readTokenTotals`, `resetTokenTotals`, `prune`, `reserveSlot`, `releaseSlot`, `writeHealth`, `setProof`; C0 migration.

**Explicit non-goals**: do not edit `features/lazy-router.mjs` (E2), `router.mjs` (E3), `snapshot.mjs` (C0). E4 defines signatures and reviews E2/E3's call sites.

**Call-site ownership**: E4 owns the accounting contract and the sign-off, not the physical bytes of `features/lazy-router.mjs` or `router.mjs`. E2/E3 apply the exact call sites; E4 reviews that diff and records `accounting-reviewed` on the merge. A wrong call site blocks the merge even when E4's store tests pass.

**Work breakdown**

| Phase | Deliverable | Gate |
|---|---|---|
| E4a (W1) | Token tables + `ensureTokenEpoch`; `captureTokenEpoch`; `addTokenTotals` epoch argument + legacy mirror in one transaction; `readStatusData` reads epoch/totals/models in the same transaction | Migration from v2; one epoch row; totals/since equal; 100 reads during writes see one epoch |
| E4b (W2) | `resetTokenTotals({resetId})`: idempotent replay, 2 s conflict, new epoch, legacy clear; `writeWorkerLoad`/`deleteWorkerLoad`; prune bounds | 200/409/replay; worker rows 4; stale reaping |
| E4c (W3) | Performance: batch proof/capacity/health/perf reads; statement count; legacy `readTokenTotals` retained for N-1 | One read transaction; no N+1 |

**Interface sign-offs**: reset route (E2), usage/epoch call sites (E3), heartbeat payload (E2).

**Definition of ready**: G0a handoff signed; schema tests (E5) available; synthetic v2 fixture.

**Definition of done**:
- Migration is idempotent; `user_version = 2`; old v2 tables accept old statements.
- A request that starts before a reset writes only to its captured epoch.
- Duplicate usage frames and retries cannot double-count; `complete` increments once per request with usage.
- Missing metric → `seen_*=0`, `complete` may be 1; M08–M10 render `—`.
- Reset is atomic, idempotent by `resetId`, conflict within 2 s, `503` on store failure.
- Legacy `totals`/`metadata.since` mirror keeps v2 rollback working.
- `bun test test/router-token-epoch-v3.test.mjs test/router-state-v2.test.mjs` green.

---

### 1.6 E5 — Tests, deployment, rollout, docs

| Field | Value |
|---|---|
| **Owner role** | Quality/release engineer |
| **Starts** | W0, day 1 (fixtures and contract tests before code; docs last) |
| **Depends on** | Contracts in §3; C0 schema for fixtures; E1 build script for CI; all units for full suite |
| **Unlocks** | Every merge gate; release; S4 environment |

**Write set**

| Path | Scope |
|---|---|
| `test/status-page-snapshot-v3.test.mjs` | Metric inventory, formatting, identity, escaping, unavailable branches |
| `test/status-page-security-v3.test.mjs` | CSP, XSS fixtures, URL allowlist, template JSON, no `{@html}`, no native dialog |
| `test/status-page-build-v3.test.mjs` | Manifest, asset existence, SSR import/render, no bare imports, deterministic names |
| `test/router-token-epoch-v3.test.mjs` | Epoch capture, reset atomicity/idempotency, coverage, SSE/JSON/direct, usage-once |
| `test/router-perf-window-v3.test.mjs` | 30-bucket bound, imputed separation, batch query, seed helpers |
| `test/router-status-v3.test.mjs` | Envelope, M01–M27, shared health/capacity/proof/affinity, 503 |
| `test/router-status-v2.test.mjs` | Keep `releaseWhenSettled` + usage-tap coverage; remove old page/SSR assertions |
| `test/router-state-v2.test.mjs` | Migration compatibility + new tables |
| `test/router-perf-v2.test.mjs` | 30-bucket + imputed expectations |
| `test/router-affinity-v2.test.mjs` | Counter aggregation |
| `test/router-capacity-v2.test.mjs` | Stale/live rows + heartbeat |
| `test/router-health-v2.test.mjs` | Shared reason/next probe; false `markDead` |
| `test/router-e2e-v2.test.mjs` | Snapshot envelope + refresh shape |
| `test/config-v2.test.mjs` | New config keys + validation |
| `test/fixtures/**` | Synthetic v2 SQLite, snapshot JSON, XSS names, duplicate labels, perf buckets, token usage |
| `scripts/deploy-status-assets.mjs` | Copy current + retained assets; never move; never delete last-two-manifest files |
| `.github/workflows/release.yml` | `build:status-page:check` before pack/publish |
| `README.md` | `statusBasePath`, `statusAssetDir`, `/ops/` proxy, build command |
| `CHANGELOG.md` | v3 entry, build exception, CSP style exception, `noindex`, reset dialog, MD-only |
| `CONTRIBUTING.md` | Narrow build exception + checks |

**Read-only inputs**: S1 entire matrix; S2 §7–§11; every interface in §3.

**Explicit non-goals**: do not write product code, `package.json`, `biome.json`, `ci.yml`, `dist/**`, or `report.md`.

**Definition of ready**: fixture schema agreed with C0; build command exists (or is stubbed by E1a); evidence naming fixed (S1 §7.3).

**Definition of done**:
- Every v3 test file exists and targets the §3 contract, not private helpers.
- `bun test` green against the integrated tree.
- `bun run build:status-page:check` green; `git diff --exit-code -- lib/router/status-page/dist` empty.
- `npm pack --dry-run` lists `dist/manifest.json`, `dist/server/status-page.ssr.mjs`, and every current/retained asset.
- Synthetic v2 fixture is safe (no real credential/account data).
- Deploy script copies, never moves; rollback keeps both releases.
- Docs match shipped behaviour; no runtime build claim remains.
- Release workflow calls the check before pack.

---

## 2. Write-set conflict matrix

### 2.1 File ownership ledger

| Path | Sole owner | Readers / reviewers | Handoff |
|---|---|---|---|
| `lib/router/status-page/snapshot.mjs` | C0 | E1, E2, E3, E5 | Frozen at G0b; changes only through C0 |
| `lib/router/status-page/format.mjs` | C0 | E1, E3, E5 | Frozen at G0b |
| `lib/router/state-store.mjs` | C0 → **E4 at G0a** | E2, E3, E5 | C0 delivers schema/read; E4 hardens token/reset/heartbeat; C0 reviews schema changes |
| `lib/router/status-page/app/**` | E1 | E2 (asset names), E5 (tests) | Frozen at IC3 for content; security tweaks in W3 are E1 |
| `lib/router/status-page/dist/**` | E1 (generated) | E2, E5 | Only the build script writes it; `--check` writes `.tmp/` only |
| `scripts/build-status-page.mjs` | E1 | E5 | Interface: exit 0/≠0; never writes `dist` under `--check` |
| `package.json`, `bun.lock`, `biome.json`, `.gitignore` | E1 | E5 | E5 requests release script changes through E1 |
| `.github/workflows/ci.yml` | E1 | E5 | E5 does not edit; requests job changes |
| `lib/router/status-page.mjs` | E2 | E1, E5 | Consumes E1's SSR export + manifest |
| `lib/config.mjs` | E2 | E5 | Key names frozen in §3.6 |
| `features/lazy-router.mjs` | E2 | E1, E4, E5 | E4 signs off reset/epoch; E1 signs off asset/meta names |
| `lib/router/router.mjs` | E3 | C0, E4, E5 | C0 signs off `buildSnapshot()`; E4 signs off usage/epoch |
| `lib/router/perf.mjs` | E3 | E5 | Raw rows per §3.3 |
| `lib/router/cyclic-speed.mjs` | E3 | E5 | `snapshotFromRows(speedRows, at)` |
| `lib/router/provider-concurrency-proof.mjs` | E3 | E5 | Store-backed `MAX` upsert |
| `lib/router/affinity.mjs` | E3 | E5 | 5-minute counters |
| `lib/router/health.mjs` | E3 | E5 | Shared row read |
| `lib/router/capacity.mjs` | E3 | E5 | Shared rows; policy unchanged |
| `lib/router/status-page/{view.mjs,client.mjs,index.html,style.css}` | E2 (delete) | — | Deletion lands with E2's page commit |
| `scripts/deploy-status-assets.mjs` | E5 | E1 | Copy-only contract |
| `.github/workflows/release.yml` | E5 | E1 | Calls E1's script |
| `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | E5 | all | Reviewed by C0 for contract accuracy |
| `test/**` | E5 | all | Tests encode §3; contract changes need C0 approval |

### 2.2 Conflict proofs

- No two concurrent units write `package.json`: only E1.
- No two concurrent units write `bun.lock`: only E1.
- No two concurrent units write `features/lazy-router.mjs`: only E2; E4 reviews.
- No two concurrent units write `router.mjs`: only E3; E4 reviews.
- `state-store.mjs` has one writer at any time; the handoff is a dated commit boundary, not a shared branch.
- `dist/**` has one producer; E2/E5 only read.
- `.github/workflows/*.yml` are split by file: E1 owns `ci.yml`, E5 owns `release.yml`.
- Deletions are assigned to E2 and land in one commit; no other unit removes files.

### 2.3 Shared-file handoff contracts

| Shared file | Producer → consumer | Contract that must be frozen before the consumer starts |
|---|---|---|
| `state-store.mjs` | C0 → E4 | `readStatusData(request)` request/response keys; table names; `user_version=2`; migration order |
| `router.mjs` | E3 → E2 | `statusView()` returns `StatusSnapshotV3`; `status()` returns JSON; `measureDirect(model, response, startedAt, signal, epoch)` |
| `features/lazy-router.mjs` | E2 → E4/E1 | Reset status/body matrix; heartbeat payload; epoch capture points; meta names |
| `package.json` | E1 → E5 | `build:status-page`, `build:status-page:check`; `files` includes dist |
| `manifest.json` | E1 → E2 | §3.5 exact fields; asset name regex |
| `snapshot.mjs` | C0 → E1/E3 | §3.1–§3.3 exact fields; no extra keys without a version bump |

---

## 3. Interface contracts

### 3.1 Snapshot envelope `StatusSnapshotV3`

```js
{
  schemaVersion: 3,
  snapshotId: "snap_<16 hex>",
  generatedAt: "2026-11-10T...Z",
  answeredBy: "host:pid",
  buildVersion: "sha256-<12 hex>",
  epoch: { id: "epoch_...", since: ISO | null },
  store: { mode: "sqlite"|"memory"|"unavailable", available: boolean, reason: string|null },
  period: { id: "peak"|"offPeak", label: "高峰时段"|"闲时时段",
            nextSwitch: { at: ISO, period, label } | null },
  catalog: { ready: boolean, workerReady: boolean, aggregateReady: boolean },
  overview: { primary: [...], secondary: [...] },
  metrics: { M01..M12, M24..M27 },
  routes: [RouteView],
  diagnostics: { windowMinutes: 30, available: boolean, reason: string|null, rows: [DiagnosticRow] },
  workers: [WorkerView],
  capacity: { available: boolean, reason: string|null, rows: [CapacityRow], liveCount: number, staleCount: number },
  health: { available: boolean, reason: string|null, rows: [HealthRow] },
  proof: { available: boolean, ttlMinutes: 30, byModel: { [model]: { verified: number, until: ISO } } },
  affinity: { available: boolean, windowMinutes: 5, hits: number, lookups: number, hitRate: number|null },
  tokenTotals: TokenTotalsView,
  notices: [Notice]
}
```

**Fixed rules**

| Rule | Value |
|---|---|
| `snapshotId` | `snap_` + 16 hex; generated after the read transaction; `idFactory` injectable |
| `generatedAt` | Clock value at read-transaction start; ISO |
| `answeredBy` | `store.worker` or `${hostname()}:${pid}`; diagnostic only |
| `buildVersion` | `dist/manifest.json` `buildId`; never `package.json` |
| `overview.primary` | `period:[M01,M02]`, `inFlight:[M03]` + `detailMetricIds:[M04]`, `channels:[M05]`, `tokens:[M08..M12]` |
| `overview.secondary` | `routeSummary:[M06,M07]`, `routeDiagnostics:[M13..M19]`, `capacity:[M21]`, `health:[M20,M22,M23]`, `catalog:[M24]`, `store:[M26]`, `meta:[M27]` |
| `Metric` | `{id,label,value,exact,unit,scope,window,available,reason,detail,tone,coverage}` |
| `unit` | `count` \| `tokens` \| `ms` \| `percent` \| `usd` \| `text` |
| `scope` | `global` \| `global_approx` \| `worker` \| `per_worker` \| `per_model` \| `per_unit` \| `n/a` |
| `tone` | `normal` \| `positive` \| `warning` \| `muted` |
| `coverage` | `{observed, complete}` or `null` |
| `TokenTotalsView` | `available`, `mode`, `scope:{includesNonSse:true, includesDirect:true, label:"含直连/非流式"}`, `epoch`, `totals`, `coverage`, `officialValue`, `models` |
| Unavailable totals | `totals.* = null` and `officialValue = null`; never `0` |

`TokenTotalsView` inner shapes:

| Field | Shape |
|---|---|
| `totals` | `{uncachedInput, cachedInput, output}` — each `number\|null` |
| `coverage` | `{complete, uncachedInput, cachedInput, output}` |
| `models` | `[{provider, model, uncachedInput, cachedInput, output, complete}]` |
| `officialValue` | `{currency:"USD", valueUsd, pricedModels, totalModels, unpricedModels, models:[{model,priced,valueUsd,source,basis,perMillion?}], ratesAsOf, note} \| null` |

### 3.2 Metric placement (M01–M27)

| ID | Label | Placement | Unknown rule |
|---|---|---|---|
| M01 | 当前时段 | `metrics.M01` | `—` |
| M02 | 下次切换 | `metrics.M02` | `"21 天内无时段切换"` |
| M03 | 全局在途上游请求 | `metrics.M03` | `—`; detail `全局近似 · N workers · 最旧 Xs` |
| M04 | 在途（按 worker） | `workers[].metric` | stale flag; excluded from M03 |
| M05 | 可用/冷却/繁忙账号通道 | `metrics.M05` | `"目录加载中"` + `available:false` |
| M06 | Lazy 路由/实际模型 | `metrics.M06` | `—` |
| M07 | 路由前缀亲和命中率 | `metrics.M07` | no lookups → `—`, not `0%` |
| M08 | 累计未缓存输入 | `metrics.M08` | `seen_uncached=0` → `—` |
| M09 | 累计缓存输入 | `metrics.M09` | `seen_cached=0` → `—` |
| M10 | 累计输出 | `metrics.M10` | `seen_output=0` → `—` |
| M11 | Token 上报覆盖率 | `metrics.M11` | denominator `coverage.complete` |
| M12 | 官方价格等效价值 | `metrics.M12` | `—` if store unavailable |
| M13 | 预测总耗时 | `channels[].perf.M13` | no prediction → `—` |
| M14 | RD | `channels[].perf.M14` | `—` |
| M15 | 证据权重 | `channels[].perf.M15` | `—` |
| M16 | 右删失 | `channels[].perf.M16` | `—` |
| M17 | 无错并发实证 | `channels[].perf.M17` | absent/expired → `—` |
| M18 | 最近完整耗时 | `channels[].perf.M18` | no complete sample → `—` |
| M19 | 30 分钟完整/删失样本 | `channels[].perf.M19` | counts, never a percentage |
| M20 | 账号健康 | `units[].metrics.M20` | `unknown` → 待检查 |
| M21 | 账号并发 | `units[].metrics.M21` | unlimited → `不限`; stale → badge |
| M22 | 下次探测 | `units[].metrics.M22` | alive/no lease → `—` |
| M23 | 冷却原因 | `units[].metrics.M23` | empty after sanitize → `—` |
| M24 | 目录就绪 | `metrics.M24` | false → `目录加载中` |
| M25 | 另一时段预览 | `metrics.M25` | `available:false`, `reason:"未保留该时段预览"` |
| M26 | 共享状态 | `metrics.M26` | memory → unavailable for global |
| M27 | 上次更新/快照 | `metrics.M27` | ids in disclosure/meta |

**Inventory rule**: M01–M12 and M24–M27 appear only in `metrics`; M04 only on each `WorkerView`; M13–M19 only in each `ChannelView.perf`; M20–M23 only in each `UnitView.metrics`. M25 still has a record.

### 3.2.1 Row shapes

| Type | Fields (exact) |
|---|---|
| `RouteView` | `id`, `title`, `state` (`alive` / `loading` / `cooling` / `empty`), `available`, `totalUnits`, `strategy`, `graph:NodeView\|null`, `channels:[ChannelView]` |
| `ChannelView` | `id` (`<routeId>\|<provider/model>`), `model`, `effort` (`high` / `—`), `available`, `totalUnits`, `perf:{M13..M19}`, `units:[UnitView]` |
| `UnitView` | `unitRef` (`u_<16 hex>`), `displayName`, `provider`, `model`, `health` (`alive` / `cooling` / `busy` / `unknown`), `healthLabel`, `metrics:{M20..M23}`, `capacity:{held,max,scope,stale,updatedAt}\|null`, `reason:string\|null`, `nextProbeAt:ISO\|null`, `coolingSince:ISO\|null`, `stale:boolean` |
| `WorkerView` | `worker`, `answeredBy`, `buildVersion`, `viewSchema:3`, `inFlight`, `catalogReady`, `heartbeatAt`, `ageMs`, `stale`, `scope` (`global` / `worker`), `metric:Metric` (M04) |
| `CapacityRow` | `unitRef`, `displayName`, `provider`, `model:string\|null`, `scope` (`unit` / `unit_model`), `held`, `max`, `worker`, `updatedAt`, `ageMs`, `stale` |
| `HealthRow` | `unitRef`, `displayName`, `provider`, `model`, `state` (`alive` / `dead` / `busy`), `health` (`alive` / `cooling` / `busy`), `reason:string\|null`, `until:ISO\|null`, `probeLeaseUntil:ISO\|null`, `nextProbeAt:ISO\|null`, `updatedAt`, `ageMs` |
| `DiagnosticRow` | `model`, `completeSamples`, `imputedSamples`, `legacyMixedSamples`, `meanTotalMs:number\|null`, `meanTotalText`, `exact`, `ttftSamples`, `speedSamples`, `tokensPerSecond:number\|null` |

Identity rules: `unitRef = "u_" + sha256(provider + "\0" + accountId).slice(0,16)`; display labels are aliases and never merge rows; `health` normalisation turns an expired `dead`/`busy` row into `alive`, and `busy` is never labelled cooling.

### 3.3 Store API

#### `readStatusData(request)`

Request (exact, from S2 §3.5):

```js
{
  now,                 // ms
  period,              // "peak" | "offPeak"
  perfSinceMinute,     // minute - 29
  perfUntilMinute,     // minute
  affinitySinceMinute, // minute - 4
  workerSince,         // now - 5 * 60_000
  healthSince          // now - 7 * 24 * 60 * 60_000
}
```

Response (**S3-fixed key names**; S2 fixes the semantic content):

```js
{
  available: boolean,
  mode: "sqlite"|"memory"|"unavailable",
  reason: string|null,
  epoch: { id, since } | null,
  tokenTotals: { epoch: { id, since }, rows: [/* token_totals rows */],
                 models: [/* provider, model, totals, coverage */] } | null,
  perfRows: [ /* bucket rows incl. complete_*, imputed_*, legacy_mixed */ ],
  speedRows: [ /* per-model per-worker grammar/rhs */ ],
  workerRows: [ /* worker_load rows */ ],
  capacityRows: [ /* capacity rows */ ],
  healthRows: [ /* health rows */ ],
  proofRows: [ /* proof rows */ ],
  affinityStats: { hits, lookups, sinceMinute, untilMinute } | null
}
```

Rules: one SQLite read transaction; `available:false` immediately when `db === null`; never zero-filled on read error; raw rows only (formatting and stale classification are C0's).

#### Other methods

| Signature | Returns | Owner |
|---|---|---|
| `captureTokenEpoch()` | `string \| null` — current epoch id, no write | E4 |
| `addTokenTotals(epoch, provider, model, usage)` | `boolean` — one transaction + legacy mirror; `false` when skipped | E4 |
| `resetTokenTotals({resetId})` | `{epoch:{id,since}, idempotent:true}` \| `{epoch:{id,since}, idempotent:false}` \| `{conflict:true, epoch}` \| `null` (unavailable) | E4 |
| `writeWorkerLoad(row)` | `void` — upsert `worker_load` (**S3-fixed name**) | E4 |
| `deleteWorkerLoad(worker)` | `void` (**S3-fixed name**) | E4 |
| `readTokenTotals()` | legacy shape, kept for N-1 tests | E4 |
| `prune(now)` | `void` — worker 5 min, affinity 10 min, token 90 days except current | E4 |
| `setProof(model, verified, until)` | `void` — monotonic `MAX` | E3 |
| `getProof(model)` | `{verified, until} \| undefined` | E3 |

#### Request accounting contract

| Rule | Exact behaviour |
|---|---|
| Epoch capture | `LazyRouter.serve()` reads `const epoch = this.store.captureTokenEpoch()` before the first upstream attempt; `lazyRouterHandler` does the same before `downstream()` for direct requests |
| Usage tap | `createUsageTap(response, { onUsage, mode })`; `mode` is `sse` or `json`; `onUsage` runs exactly once at clean stream end with the final merged usage |
| Duplicate suppression | Each attempt carries an opaque random `requestId`; a duplicate frame/retry for the same id cannot add a second record; the id is never written to `token_totals` |
| SSE | Merge the last provider usage frame; never emit per frame |
| JSON/direct | Keep a 64 KiB tail, parse at end; never buffer the whole body |
| Incomplete | Aborted or errored responses do not increment `complete` |
| Direct counter | The direct path increments `openUpstream` before `downstream()` and decrements on settle; heartbeat publishes `concurrencyProof.inFlight() + openUpstream` |
| Scope label | `tokenTotals.scope = { includesNonSse:true, includesDirect:true, label:"含直连/非流式" }`; narrowing the scope requires changing the label and M08–M11 together |

### 3.4 HTTP surface

| Method + path | Success | Failure | Headers |
|---|---|---|---|
| `GET [base]/` | `200` SSR HTML with embedded template | `404` only if the page is disabled | CSP; `cache-control: no-store`; `nosniff`; `referrer-policy: no-referrer`; `x-robots-tag: noindex, nofollow` |
| `HEAD [base]/` | `200`, no body | as GET | as GET |
| `GET [base]/assets/lazy-status/<name>` | `200` JS/CSS | `404` unknown/traversal, `no-store` | `cache-control: public, max-age=31536000, immutable`; `nosniff`; exact content-type |
| `HEAD` asset | `200` | `404` | as asset |
| `GET [base]/v1/lazy/status` | `200 StatusSnapshotV3` | `503 {error:"store_unavailable", snapshotId, generatedAt, buildVersion}` on read error | `cache-control: no-store` |
| `POST [base]/v1/lazy/token-totals/reset` | `200 {ok:true, epoch, tokenTotals}` | `405 allow: POST`; `403 {error:"https_required"}`; `401`; `409 {error:"reset_conflict", epoch}`; `503 {error:"counter_unavailable"}` | `cache-control: no-store` |

**Exact CSP** (no deviation):

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

**Asset name regex**: `/^[A-Za-z0-9][A-Za-z0-9._-]*\.(js|css)$/`. Served URL: `[base]/assets/lazy-status/<name>`. No query-dependent resolution; no fallback to `dist/server`.

**Asset content types**: `text/javascript; charset=utf-8` for `.js`, `text/css; charset=utf-8` for `.css`.

**Initial HTML vs JSON on a read error**: the initial HTML may render an `available:false` snapshot so a first-time visitor sees the reason; the JSON endpoint returns `503` so an existing tab keeps its last good snapshot and retries.

**Reset request**: `authorization: Bearer <gateway token>`, `content-type: application/json`, `x-lazy-reset: token-totals`, body `{ "resetId": "<uuid>" }`. Server gate order: POST → HTTPS → header/content-type → `adminTokenMatches` → store transaction.

### 3.5 Manifest and build identity

`lib/router/status-page/dist/manifest.json` (sorted keys):

```json
{
  "schema": 1,
  "buildId": "sha256-<12 hex>",
  "entry": "status-page.<hash>.js",
  "css": ["status-page.<hash>.css"],
  "assets": ["status-page.<hash>.js", "status-page.<hash>.css"],
  "retained": ["status-page.<oldhash>.js", "status-page.<oldhash>.css"]
}
```

| Rule | Value |
|---|---|
| `buildId` | `"sha256-" + sha256(sorted(server bundle, entry JS, CSS files))`; excludes retained/manifest metadata |
| Retention | one previous release (`assets` ∪ `retained`) |
| `--check` | builds into `.tmp/status-page/check`; compares manifest + every file hash; never writes `dist` |
| Version chain | `manifest.buildId` → `snapshot.buildVersion` → `<meta name="status-build">` → `Root.initialSnapshot.buildVersion` |
| Drift gate | `git diff --exit-code -- lib/router/status-page/dist` |

**Length rule**: the manifest value is authoritative. S2 §3.1 illustrates `sha256-<12 hex>`; the chain requires `snapshot.buildVersion === manifest.buildId`, so do not truncate independently in two places.

### 3.6 Config keys

| Logical key | JSON location | Default | Validation |
|---|---|---|---|
| `lazy-router.statusBasePath` | `features["lazy-router"].statusBasePath` (or the top-level `lazy-router` patch shortcut) | `""` | string; if non-empty must start `/`; no `..`; no `//`; only `[A-Za-z0-9._~/-]`; trailing slashes removed |
| `lazy-router.statusAssetDir` | `features["lazy-router"].statusAssetDir` | `null` | `null` or non-empty absolute path; readable; root-owned, not web-writable (deployment check) |

`statusBasePath: ""` uses `X-Forwarded-Prefix` only from a trusted loopback proxy. The handler strips the base prefix before matching `/`, the asset prefix, the status path, the reset path, and `/v1/models`.

### 3.7 SSR and hydration DOM contract

```html
<html lang="zh-CN" class="md">
<div id="status-root" data-snapshot-id="snap_..."><!-- SSR body --></div>
<template id="status-snapshot">{escaped JSON}</template>
<meta name="status-build" content="sha256-...">
<meta name="status-snapshot" content="snap_...">
<meta name="lazy-status-path" content="[base]/v1/lazy/status">
<meta name="lazy-reset-path" content="[base]/v1/lazy/token-totals/reset">
<script type="module" src="[base]/assets/lazy-status/status-page.<hash>.js"></script>
```

| Rule | Value |
|---|---|
| JSON escaping | `<` → `\u003c`; U+2028 → `\u2028`; U+2029 → `\u2029` |
| Inline script | none; template is inert; no `script-src` exception |
| Hydration target | `#status-root`; exactly one `<App>`; one navbar |
| `nowMs` | `Date.parse(snapshot.generatedAt)` on both sides |
| Meta source | `client.js` reads the metas; no hardcoded `/` |
| Failure | parse failure keeps SSR content visible and appends a visible `role="alert"` node |
| JS off | every value, route, channel, unit, table, reset explanation, banner state present; `<noscript>` explains refresh/reset need JS |

**SSR bundle export**: `renderStatusDocument(snapshot, options)` from `dist/server/status-page.ssr.mjs`; `Framework7.use(Framework7Svelte)` before render.

### 3.8 Client API

| Export | Shape | Rules |
|---|---|---|
| `Root.svelte` | `apply(next)`, `setConnection(next)`, `tick(at)`, `setReady()` | Svelte 5 exports; no DOM wrapper |
| `startRefresh` | `startRefresh({initialSnapshot, statusPath, onSnapshot, onConnection, onVersionMismatch})` → `{retryNow, stop}` | one request per cycle; 8 s `AbortController`; backoff; visibility/offline; stop on schema/build mismatch; no splice |
| `reset-dialog.js` | F7 `f7.dialog.create()`; title `重置累计 Token 统计`; token memory-only | `closeByBackdrop:false`; `destroyOnClose:true`; no `prompt`/`confirm` |
| Toasts | `f7.toast.create()` | success is `role="status"`; error stays in dialog |

### 3.9 Notices and error shapes

```js
Notice = { level:"info"|"warning"|"error",
           code:"store_unavailable"|"memory_store"|"catalog_loading"|"worker_stale"|
                "version_mismatch"|"snapshot_stale"|"reset_conflict",
           title, message, action:"retry"|"reload"|null }
```

| Condition | Notice | UI |
|---|---|---|
| Store memory/unavailable | `memory_store` / `store_unavailable` | sticky banner; global `—`; per-worker `本 worker` |
| Catalog loading | `catalog_loading` | `目录加载中`; not “no accounts” |
| Worker stale | `worker_stale` | stale badge; excluded from M03 |
| Build/schema mismatch | `version_mismatch` | reload banner; polling stops |
| Last-good snapshot | `snapshot_stale` | show `generatedAt`; retry |
| Reset 409 | `reset_conflict` | dialog message; refresh |

### 3.9.1 Refresh connection and error shapes

`onConnection(next)` receives `{ state, lastGoodAt, error }`:

| `state` | When | User text | Banner role |
|---|---|---|---|
| `server` | SSR initial props | none | — |
| `live` | last refresh succeeded | none | — |
| `offline` | `navigator.onLine === false` | `离线，显示上次快照。` | `status` |
| `timeout` | `AbortError` after 8 s | `刷新超时，正在重试。` | `alert` |
| `stale` | HTTP/parse/network failure (last good kept) | `刷新暂时失败，页面保留上次成功的状态；将自动重试。` | `alert` |

`onVersionMismatch(next)` fires when `next.schemaVersion !== 3` or `next.buildVersion !== initialSnapshot.buildVersion`; polling stops and the banner shows `页面已更新，请刷新。` with an F7 reload Button. A structural error (missing required field, non-array `routes`, missing `metrics.M03`) is treated as `stale`: keep the last good snapshot, show the reload banner, stop applying responses.

Timer constants: `REFRESH_MS = 10_000`, `TIMEOUT_MS = 8_000`, `MAX_BACKOFF_MS = 120_000`; backoff `10s → 20s → 40s → 80s → 120s` with ±20% jitter, reset on success. One request per tab; no fetch while `inFlight` or `document.visibilityState === "hidden"`.

### 3.10 SQL schema contract

New tables: `worker_load`, `affinity_stat`, `token_epochs`, `token_totals`; index `perf_period_minute`; perf columns `complete_ms`, `complete_log`, `complete_log_sq`, `complete_n`, `imputed_ms`, `legacy_mixed`.

| Table | Key columns |
|---|---|
| `worker_load` | `worker` PK, `host`, `pid`, `build_version`, `view_schema`, `in_flight`, `catalog_ready`, `epoch`, `updated_at` |
| `affinity_stat` | `minute` PK, `hits`, `lookups`, `updated_at` |
| `token_epochs` | `id` PK, `since`, `created_at` |
| `token_totals` | PK `(epoch, provider, model)`, `uncached_input`, `cached_input`, `output`, `complete`, `seen_uncached`, `seen_cached`, `seen_output`, `updated_at` |

Migration order: existing `STATE_SCHEMA` + `PRAGMA user_version = 2` → `migrateStatusV3(db)` → `ensureTokenEpoch(db, now)` → write `metadata.state_features = 'status-v3'`. Backfills: perf complete columns, `legacy_mixed`, legacy token epoch/totals, `metadata.token_epoch`.

---

## 4. Dependency DAG, schedule, merge train

### 4.1 DAG

| From | To | Artifact that unlocks the edge |
|---|---|---|
| C0a (state schema) | E4 | `state-store.mjs` handoff at G0a |
| C0a | E3 | `readStatusData` + table contract |
| C0b (snapshot/format) | E1 | `StatusSnapshotV3` fields + E5 fixture |
| C0b | E3 | `buildSnapshot(input)` |
| C0b | E2 | HTML payload shape |
| E1a (toolchain) | E1b/E2 | `dist/server/status-page.ssr.mjs` + `manifest.json` |
| E4 | E3 | `tokenTotals` current-epoch view |
| E4 | E2 | `captureTokenEpoch`, `resetTokenTotals` |
| E3 | E2 | `statusView()` complete |
| E1b | E2 | SSR render function |
| E2 | E5 | page/asset/reset routes for e2e tests |
| E5 tests | every gate | contract test battery + fixtures |
| E5 deploy | release | copy-only asset deployment |

There is no cycle. The only soft edge is E2 → E1 for the asset meta names; it is resolved by freezing §3.7 before E1c.

### 4.2 Maximum-concurrency schedule

Assumption: one engineer per unit, six lanes. "Day" is relative, not a calendar commitment.

| Wave | C0 | E1 | E2 | E3 | E4 | E5 | Gate at end |
|---|---|---|---|---|---|---|---|
| W0 D1–D2 | C0a: schema, migration, `readStatusData`, epoch/reset stubs | E1a: pin deps, Vite configs, build script skeleton, App shell | E2a: config keys, normalizer, manifest loader skeleton | E3a: perf/affinity/capacity/health/proof | Read S2; prepare schema review (no writes) | E5a: fixtures, contract tests, v2 DB | **G0a** |
| W1 D3–D4 | C0b: snapshot + format; contract tests green | E1b: full component tree + SSR body | E2b: SSR page + headers + resolver | E3b: `snapshotFromRows`, `statusView` skeleton | E4a: token tables, epoch capture, `addTokenTotals` | E5b: snapshot/build/security tests | **G0b** |
| W2 D5–D6 | Freeze; contract arbitration | E1c: hydration, refresh, reset dialog | E2c: handler wiring, heartbeat, epoch call sites | E3c: full `statusView`, 503 | E4b: reset transaction, worker rows, prune | E5c: status/perf/token tests | **IC2/IC3** |
| W3 D7–D8 | Review only | E1d: CSP/a11y/subpath polish | E2d: reset route gates, base path | E3d: usage-once, direct/JSON, query count | E4c: batch reads, statement count | E5d: full suite, build tests | **IC4/IC5** |
| W4 D9–D10 | Review only | Bug fixes only | Bug fixes only | Bug fixes only | Bug fixes only | E5e: deploy script, docs, release workflow | **IC6** |
| W5 | — | on-call | on-call | on-call | on-call | environment steward | **S4** |

**Why E4 starts at G0a**: `state-store.mjs` is C0's file until the schema and read interface are frozen. Starting E4 earlier would create two writers. C0a is deliberately first and small.

**Why E1 starts at W0**: toolchain risk is the longest lead item. E1 uses E5's fixture JSON, not C0's code, so it is not blocked.

**Why E5 starts at W0**: tests-first encodes the contract; they are the executable definition C0 and E1 build against.

**Start/wait matrix**

| Work | Can start at W0 without C0 code | Waits for G0a | Waits for G0b |
|---|---|---|---|
| E1 toolchain, Vite configs, build script, App shell | yes (uses E5 fixture) | — | full component bindings |
| E2 config keys, normalizer, manifest loader | yes (manifest shape is fixed in §3.5) | — | SSR page props |
| E3 perf/affinity/capacity/health/proof modules | yes (SQL contract in S2 §3.9) | store-dependent reads | `buildSnapshot` wiring |
| E4 token/epoch/reset | no (file owned by C0) | yes | — |
| E5 fixtures, contract tests, docs skeleton | yes | migration expectations | snapshot expectations |
| E2 handler wiring / reset route | no | yes (store methods) | page render needs E1 |
| E1 hydration/refresh | no | — | snapshot fixture + SSR bundle |

### 4.3 Merge order

| Merge | Branch content | Units | Must be green before merge |
|---|---|---|---|
| m0a `contract-store` | E5 migration tests + C0a schema/read/epoch stubs | C0, E5 | v2 migrate/reopen; one read transaction |
| m0b `snapshot` | E5 snapshot tests + C0b snapshot/format | C0, E5 | Snapshot test; M01–M27 inventory |
| m1 `token-epoch` | E4 token tables, epoch capture, reset transaction, worker rows | E4 | Token-epoch test; v2 migration test |
| m2 `read-model` | E3 perf/speed/health/affinity/capacity/proof + `statusView` | E3 | Router status/perf tests; four-worker fixture |
| m3 `build-ssr` | E1 pins, build script, SSR shell, component tree, `dist` | E1 | Build check; SSR render; two-build determinism |
| m4 `page-config` | E2 config, resolver, page render, handler wiring | E2 | Header/asset/base-path matrix; page renders E1 bundle |
| m5 `hydration-reset` | E1 client/refresh/dialog + E2 reset route + E4 reset sign-off | E1, E2 | Hydration smoke; refresh cycle; reset matrix |
| m6 `hardening` | E1 CSP/a11y; E2 subpath/404/HEAD; E5 security tests | E1, E2, E5 | Security test; axe/keyboard; `/ops/` HAR |
| m7 `release` | E5 deploy script, docs, release workflow | E5 | Full `bun test`; `npm pack --dry-run`; rollback rehearsal |
| m8 `staging` | version bump/commit only | E5 | IC6 |

m0a and m0b may be reviewed in parallel, but both must merge before m2; m1 merges after m0a. m2 merges after m0b and m1. m3 is independent of m1/m2 at the file level but merges after m0b so the fixture is stable. m4 merges after m3. m5 merges after m4. A **unit branch** contains only its owner's files; the integration train merges unit branches in the order above and never edits them during merge.

### 4.4 Integration checkpoints

| Checkpoint | When | Commands / observations | Pass condition |
|---|---|---|---|
| IC0 contract | after m0b | `bun test test/status-page-snapshot-v3.test.mjs`; migrate synthetic v2; reopen; assert one read transaction and zero per-candidate queries | M01–M27 once; no `undefined`; `user_version=2`; one read transaction |
| IC1 accounting | after m1 | `bun test test/router-token-epoch-v3.test.mjs`; long request + reset; replay `resetId` | Captured epoch; one write; idempotent; 409 within 2 s |
| IC2 read model | after m2 | Four-worker fixture; compare JSON to `worker_load`/`capacity`/`health`/`proof`/`affinity`/`perf` | Equal within freshness bound; no per-candidate query |
| IC3 UI | after m3/m4 | `bun run build:status-page:check`; SSR render; `curl -D` headers; asset 200/404/HEAD | Build deterministic; full SSR body; exact headers |
| IC4 interaction | after m5 | Hydration smoke; 100 refresh cycles; hang 8 s; offline; reset 200/401/403/405/409/503 | One App; one request per cycle; focus/state preserved; no false success |
| IC5 hardening | after m6 | XSS fixtures; CSP console; axe/keyboard; 320/768/1440; `/ops/` | No XSS; CSP clean; no overflow; subpath works |
| IC6 release | after m7 | `bun test`; `npm pack --dry-run`; `git diff --exit-code -- dist`; 4-worker staging | S2 §11 items 1–10; staging global values consistent |

### 4.5 Rollback points

| Point | Meaning | Rollback action |
|---|---|---|
| RP0 after m0a/m1 | Schema expand is live | Revert package; DB stays; `user_version=2`; no table drops |
| RP1 after m4 | New page serves | Revert release commit set; restart workers; old package opens the same DB |
| RP2 after m7 | Release candidate | Deployment rollback in §8.2; assets already retained |

---

## 5. Verification per unit

### 5.1 Automated merge gates (gates only, never acceptance evidence)

| Unit | Commands | Merge-blocking assertions |
|---|---|---|
| C0 | `bun test test/status-page-snapshot-v3.test.mjs`; migration test | Metric inventory; formatting; `unitRef`; no DB import; no `undefined`; v2 reopen |
| E1 | `bun run build:status-page:check`; `bun test test/status-page-build-v3.test.mjs test/status-page-security-v3.test.mjs`; two builds | Manifest/assets; SSR import/render; no bare imports; no inline script/`{@html}`/`prompt`/`confirm`; identical hashes |
| E2 | `bun test test/config-v2.test.mjs`; route matrix via `curl`/test server | Header exactness; 200/404/HEAD; base-path normalize; reset matrix |
| E3 | `bun test test/router-status-v3.test.mjs test/router-perf-window-v3.test.mjs` | One read; 30-bucket; imputed separation; M01–M27; JSON/DB equality |
| E4 | `bun test test/router-token-epoch-v3.test.mjs test/router-state-v2.test.mjs` | Epoch capture; usage once; coverage; reset atomic/idempotent; legacy mirror |
| E5 | `bun test`; `bun run build:status-page:check`; `npm pack --dry-run`; `git diff --exit-code` | Full suite; package listing; CI freshness |

Rules:
- A unit may not merge with a red gate, even if the failure is in another unit's file. The failure is routed to that file's owner; the branch waits.
- A test change requires C0 approval when it changes a §3 contract; otherwise E5 owns the edit.
- Automated tests do not close a CASE. They only allow a merge.

### 5.2 Manual observations reserved for S4

| Unit | CASE hooks | Observation S4 will make |
|---|---|---|
| C0 | 02 D*, 03 D1/D3, 07 formatting, 11 D4 | Four primary groups; SSR values; token units; no XSS from labels |
| E1 | 01, 02, 03, 04, 12 | Real F7 components; layout/typography; JS-off content; hydration; refresh; keyboard/contrast |
| E2 | 04, 11, 13 | Exact CSP; `noindex`; one snapshot; `/ops/`; assets/HEAD/404; reset status |
| E3 | 05, 06, 08, 09, 10 | Four-worker sums; proof/affinity; 30-bucket window; shared health; degradation |
| E4 | 06 (reset invariance), 07, 14 | Epoch totals/coverage; in-flight reset; double submit; dialog |
| E5 | 13 | Build hashes; old tab/rollback; CI output; package listing; deployment |

### 5.3 Evidence hooks the implementation must expose (for S4)

| Hook | Required by | Owner |
|---|---|---|
| `#status-root[data-snapshot-id]` | CASE-03 | E1 |
| `<template id="status-snapshot">` parseable | CASE-03 | E1/E2 |
| `<meta name="status-build">`, `status-snapshot`, `lazy-status-path`, `lazy-reset-path` | CASE-03/04/14 | E1/E2 |
| `role="alert"`/`role="status"` banners with stable text | CASE-10 | E1 |
| `aria-busy` on live region; `aria-expanded` on accordions | CASE-12 | E1 |
| Table `<caption>` and `scope` attributes | CASE-02/12 | E1 |
| Reset dialog DOM (`#status-reset-token`) and error node | CASE-14 | E1 |
| `snapshot.notices[].code` | CASE-10 | C0/E3 |
| `GET /v1/lazy/status` JSON | all stats CASES | E3 |
| `worker_load`, `capacity`, `health`, `proof`, `affinity_stat`, `perf`, `token_totals`, `metadata` | stats CASES | E4 |

---

## 6. Integration plan: 4-worker staging

### 6.1 Freeze and build

```sh
git rev-parse HEAD
bun install --frozen-lockfile
bun run build:status-page:check          # must not modify dist
git diff --exit-code -- lib/router/status-page/dist
bun test                                 # supporting only
```

Record: commit, `buildVersion`, F7/Svelte/Vite versions, Bun version, Node version, OS.

### 6.2 Staging database and v2 migration

1. Stop any v3 worker pointed at staging.
2. Copy the production DB to a staging path owned by the test user: `cp --reflink=auto <prod-db> <staging-db>`; chmod `0600`.
3. Record `PRAGMA user_version` (must be `2`) and `SELECT * FROM metadata`.
4. Start exactly one v3 worker against the copy with the staging config.
5. Verify: `user_version = 2`; `worker_load`, `affinity_stat`, `token_epochs`, `token_totals` exist; `perf` has the six columns; `metadata.state_features = 'status-v3'`; legacy `totals` and `metadata.since` equal the pre-migration values; exactly one current epoch.
6. Stop the worker; reopen the DB with the previous package's store code; confirm it still reads `totals`/`since` and does not fail on the new tables.
7. Keep the copy for the whole S4 run. Never point staging at the production file.

### 6.3 Start the four workers

Config (staging only):

```json
{
  "stateDbPath": "/srv/staging/omp-shims-state.sqlite",
  "features": {
    "lazy-router": {
      "statusPath": "/v1/lazy/status",
      "statusBasePath": "",
      "statusAssetDir": "/srv/staging/status-assets"
    }
  }
}
```

```sh
export OMP_SHIMS_REUSE_PORT=1
systemctl --user restart omp-auth-gateway@{1..4}
systemctl --user status 'omp-auth-gateway@*' --no-pager
ss -ltnp | grep "$GW_PORT"
```

Verify four `MainPID`s, one listening port with four PIDs (or the documented reuse behaviour), and four distinct `answeredBy` values from repeated `/v1/lazy/status` reads.

### 6.4 Verify the page and the stats

```sh
curl -sS -D /tmp/status.headers "http://127.0.0.1:$GW_PORT/" -o /tmp/status.html
curl -sS "http://127.0.0.1:$GW_PORT/v1/lazy/status" -o /tmp/status.json
curl -sS -D /tmp/asset.headers "http://127.0.0.1:$GW_PORT/assets/lazy-status/$ENTRY" -o /dev/null
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$GW_PORT/assets/lazy-status/nope.js"
```

Checks:
- HTML has one `#status-root`, one template, one module script, no inline script.
- `data-snapshot-id` equals the template `snapshotId`; `meta status-build` equals `manifest.buildId`.
- JSON has `schemaVersion:3`, M01–M27 placement, `store.mode:"sqlite"`, `store.available:true`.
- `answeredBy` cycles across four workers; M03/M04 agree with `worker_load`; M21 with `capacity`; M20/M22/M23 with `health`; M17 with `proof`; M07 with `affinity_stat`.
- Assets: 200 immutable; unknown 404 `no-store`.
- Reset without a token: 401; wrong content type/header: 401; GET: 405; HTTP non-loopback: 403.

### 6.5 Keep production untouched

| Rule | Check |
|---|---|
| Separate config file and DB copy | `readlink -f` both paths; assert staging path |
| No production reset | `curl` reset uses only the staging port; `last_reset_id` inspected on the copy |
| No production deploy during S4 | deploy only to the staging asset dir |
| No writes outside the product | `sqlite3` is SELECT-only except through the gateway |
| Record the isolation | Screenshot/console of config paths, PIDs, DB path |

### 6.6 Stop and clean

Stop the four workers; leave the staging DB and evidence untouched until the S4 report is signed. Remove only `.tmp/` build scratch and temporary `curl` files.

---

## 7. Manual acceptance execution plan

### 7.1 Roles

| Role | Who | May do | May not do |
|---|---|---|---|
| Visible S4 auditor | One named person | Run every CASE, capture evidence, score U/D, write `report.md` | Let another agent write or edit the report |
| Environment steward | E5 | Prepare build, DB copy, workers, fixtures, evidence folders; reset the environment between phases | Score, suggest scores, or edit the report |
| Fix-on-call | E1 (UI), E2 (server), E3 (stats), E4 (accounting) | Fix defects; produce a new build | Run acceptance, influence scoring, or mark a CASE pass |
| Cross-check auditor (optional) | A second person | Independently score the same evidence | Write `report.md`; override a hard fail |

### 7.2 Environment and evidence root

- Build under test: frozen commit + `buildVersion`; record in every CASE header.
- B0–B8 from S1 §5.0 apply to every CASE: four workers, staging DB copy, real browsers, JS-off profile, light/dark, 320/390/768/1440, synthetic fixtures, read-only SQLite, evidence discipline.
- Evidence root: `docs/manual-acceptance/status-page-v3/evidence/CASE-XX/`.
- Naming: `CASE-XX_<subject>_<viewport>_<theme>.<ext>`; DB dumps `CASE-XX_<table>.txt`; status JSON `CASE-XX_<subject>.json`; HAR `CASE-XX_<subject>.har`. Keep full-frame originals before cropping.

### 7.3 Sequencing

| Phase | CASES | Why this order | Environment reset before phase |
|---|---|---|---|
| P0 Baseline | — | Establish B0–B8, record build/versions, seed fixtures | Restore staging DB copy; restart four workers |
| P1 UI | 01 → 02 → 03 → 12 → 04 | Read-only page behaviour; no token reset or worker kill; a11y before interaction edge cases | Clean browser profile; four workers; known build |
| P2 Concurrency | 05 → 06 → 08 → 09 | Exercises worker/capacity/proof/affinity/perf; CASE-06 resets tokens at its last step | Four workers; no reset until CASE-06 step 5 |
| P3 Accounting | 07 → 14 | CASE-06 leaves a fresh epoch; CASE-07 records that epoch; CASE-14 resets again, so it runs last among reset cases | Record current epoch; known token sends |
| P4 Degradation/security | 10 → 11 | CASE-10 changes store mode and injects faults; CASE-11 checks CSP/headers across all prior evidence | Restore normal store mode; four workers |
| P5 Deployment | 13 | Changes build/version and exercises rollback; must be last so earlier evidence is not invalidated | Two releases; `/ops/` proxy; one open old tab |

Rules:
- After any CASE that kills/restarts a worker (05, 06, 09), re-establish four active workers and four `answeredBy` values before the next CASE.
- After any reset (06, 07, 14), record the new `epoch.id`/`since`; never reuse pre-reset totals.
- CASE-13 uses a separate build pair and a separate tab; it does not invalidate earlier screenshots because the earlier evidence names carry the old `buildVersion`.

### 7.4 Per-CASE runner and minimum artefacts

All CASES are run by the visible S4 auditor. The table names the unit on call for defects, not the runner.

| CASE | 路径 | Threshold | On-call | Minimum artefacts beyond the common set |
|---|---|---|---|---|
| 01 | 正常 | 80 | E1 | F7 DOM/version, kitchen-sink comparison, component interaction video |
| 02 | 正常 | 80 | E1 | 320/768/1440 light/dark screenshots, computed fonts, table DOM, overflow metrics |
| 03 | 正常 | 80 | E1/E2 | Raw HTML, JS-off screenshots, CLS trace, hydration console, template parse |
| 04 | 正常 | 80 | E1/E2 | HAR with one snapshot per cycle, timeout/offline video, focus/open-state trace |
| 05 | 并发 | 80 | E3/E4 | Capacity DB sums, worker kill/reap timeline, 40 samples by `answeredBy` |
| 06 | 并发 | 80 | E3/E4 | `proof` before/after restart, affinity counters, 10/20 hit-rate log |
| 07 | 正常 | 80 | E4 | Totals/coverage/epoch rows, SSE/JSON/direct usage logs, 100-read comparison |
| 08 | 边界 | 80 | E3 | Seeded perf rows, query count/trace, complete/imputed calculation, speed before/after |
| 09 | 异常 | 80 | E3 | Health rows, probe timestamps, fence rejection log, two-worker screenshots |
| 10 | 降级 | 80 | E2/E4 | Memory/read/write failure states, mismatch banner, sticky/live DOM, recovery |
| 11 | 安全 | 80 | E2 | XSS payloads, CSP header, reset 401/HTTPS, secret scan |
| 12 | 无障碍 | 80 | E1 | Contrast values, keyboard video, a11y tree, touch boxes, zoom/reduced-motion |
| 13 | 部署 | 80 | E5/E1 | Build hashes, asset headers, old-tab/rollback video, subpath HAR, CI output |
| 14 | 正常 | 80 | E1/E4 | Dialog video, reset responses, epoch JSON/DB, in-flight reset log, double submit |

### 7.5 Scoring and report ownership

- Rubric: S1 §5.0. Each CASE has U1–U5 and D1–D5; each check ≤ 20; clause score `round(20 × met/k)`; `final = min(user_score, developer_score)`; PASS ≥ 80; hard fail = 0.
- `user_score` and `developer_score` are the auditor's subjective willingness-to-pay estimates grounded in observed behaviour; they are not market data or fabricated testimony.
- Hard fail: any per-CASE `一票否决` condition sets all three scores to 0, regardless of other clauses.
- A CASE without its named evidence scores 0. “Not executed” scores 0. Automated output may be attached but never replaces the manual observation.
- **Report ownership**: only the visible S4 auditor writes `docs/manual-acceptance/status-page-v3/report.md` from its own execution. It records per CASE: U1–U5 and D1–D5 clause evidence, `user_score`, `developer_score`, `final_score`, hard-fail status, PASS/FAIL. No unit, environment steward, or other agent writes or edits this file.

### 7.6 Conflict resolution between auditors

1. Both auditors score the same evidence set independently and write their U/D clause marks with artefact paths.
2. If `|user_score_A − user_score_B| > 5` or `|developer_score_A − developer_score_B| > 5`, re-read the disputed clauses together and mark each clause met/unmet against the named artefact.
3. Recount. If the difference is still > 5, **use the lower score** for that CASE (S1 §5.0 rule 7). Do not average.
4. A hard fail found by either auditor stands; it cannot be voted away or averaged.
5. The visible auditor records the reconciled score and a one-line disagreement note in the report. A test result never breaks a tie.

---

## 8. Risk and rollback

### 8.1 Risks owned by the execution team

| Risk | Trigger | Owner | Check | Rollback trigger |
|---|---|---|---|---|
| Build/toolchain policy | Vite/Svelte rejected or CI cannot build | E1 | D1 decision; exact pins; `build:status-page:check`; CI on Bun 1.4.4 + Node 22 | Two consecutive build failures on a clean tree |
| Vite 8 vs Bun 1.4.4 | Build fails or is nondeterministic | E1 | Two-build hash equality; Node 22 fallback | `--check` mismatch after a clean rebuild |
| CSP relaxation | F7 needs inline styles; console errors | E2 | Exact header; no user-controlled style; CSP evidence | CSP blocks the page or a style injection is possible |
| F7/Svelte compatibility | `undefined is not a constructor`; hydration mismatch | E1 | Exact pins; plugin install before render; SSR smoke; kitchen sink | SSR render or hydration fails on the frozen build |
| SSR/hydration mismatch | Duplicate App, lost listeners, CLS | E1 | Same `buildId`; `nowMs` from `generatedAt`; template JSON | CLS > 0.25 or two Apps |
| Schema migration | v2 file with mixed/imputed rows fails | C0/E4 | Backup; migrate/reopen; legacy totals equal; `user_version=2` | Open failure or totals/since mismatch |
| Multi-worker races | Split totals, undercount, stale global | E3/E4 | One read txn; request-start epoch; `MAX` proof; 5 s/5 min bounds | DB sum differs from page or epoch splits |
| Old tabs | Build/schema change while a tab is open | E1/E2 | `version_mismatch`; polling stops; N-1 assets | Old tab crashes or 404s a referenced asset |
| Asset retention | Rollback removes current hashes | E5 | `retained` + `statusAssetDir`; copy-only deploy | 404 for an asset referenced by a live tab |
| Reset abuse | Public page, HTTP, invalid token | E2/E4 | HTTPS gate; `adminTokenMatches`; `x-lazy-reset`; idempotency | Unauthorized reset or false success |
| Accessibility of F7 defaults | Missing labels/focus/contrast | E1 | Wrapper labels; `aria-expanded`; 44 px; axe/manual | CASE-12 hard fail |
| Payload size | Four workers × routes × units | E3 | Batch queries; 30-bucket cap; no alternate payload | Status latency or payload regression |
| `X-Forwarded-Prefix` trust | Client-supplied header | E2 | Loopback-only trust; strict normalization | Wrong base URLs or traversal |
| CJK/font rendering | Tofu/crowded glyphs | E1 | System CJK stacks; 14/12 px floors; computed styles | Text unreadable at 320/200% |

### 8.2 Exact rollback order

**Code rollback (no DB corruption)**

1. Freeze deploys; record the failing `buildVersion` and `snapshotId`.
2. Copy the current and retained hashed assets into `statusAssetDir` (copy, never move). Old tabs must keep loading.
3. Stop v3 workers: `systemctl --user stop omp-auth-gateway@{1..4}`.
4. Switch the package to the previous release (tag/commit/package). Do not drop tables; the expand migration left `user_version = 2` and the legacy `totals`/`since` mirror is current.
5. Start the previous release; verify `/`, `/v1/lazy/status`, reset 401, and a known asset.
6. Keep `statusAssetDir`, the staging DB copy, and logs for the report.
7. Only after the service is stable, clean `.tmp/` and unused files.

**Database corruption (last resort)**

1. Stop all workers.
2. Restore the pre-deploy DB backup.
3. Start the previous release against the restored file.
4. Do not run `DROP TABLE` or downgrade the schema by hand.
5. Re-run the v2 open/read check before any v3 retry.

**Why this order**: assets first protects open tabs; package second restores the runtime; DB restore last because it loses evidence and is rarely needed.

---

## 9. Definition of ready and done

### 9.1 Per unit

| Unit | Ready when | Done when |
|---|---|---|
| C0 | S1/S2 approved; v2 schema read; fixture schema agreed | Contract tests green; migration/reopen; M01–M27 once; no DB import; G0a handed off |
| E1 | Exact versions installable; fixture available; F7 reference available | Build check; two-build determinism; SSR body complete; security test; one App; dist committed; CI job |
| E2 | Manifest shape + SSR export frozen; store methods frozen | Headers/assets/HEAD/404; base path; reset matrix; heartbeat; legacy files deleted; E4/E1 sign-offs |
| E3 | `buildSnapshot` + `readStatusData` frozen; epoch API available | One read; no N+1; M01–M27; shared health/capacity/proof/affinity; usage once; tests green; C0/E4 sign-offs |
| E4 | G0a handoff; schema tests + v2 fixture | Epoch capture; usage-once; coverage; reset atomic/idempotent; legacy mirror; prune; tests green |
| E5 | Contract + fixture schema; build command; evidence naming | All v3 tests; full `bun test`; build check; pack listing; deploy copy-only; docs; release workflow |

### 9.2 Whole goal

The goal is done only when **all** are true:

1. S2 §11 items 1–10 pass on the frozen build.
2. Every S1 CASE-01–CASE-14 has its named evidence under `evidence/CASE-XX/`, including the non-happy paths (concurrency, boundary, exception, degradation, security, accessibility, deployment).
3. The S4 report exists and is written by the visible auditor; each CASE records U1–U5, D1–D5, `user_score`, `developer_score`, `final_score`, hard-fail status, PASS/FAIL; every CASE reaches `final_score >= 80`; no unexecuted path is counted as pass.
4. No CASE is marked done from automated tests, from a code review, or from another CASE's evidence.
5. No runtime build: the gateway serves committed `dist`; `bun run build:status-page:check` is the only build path in CI.
6. The four-worker staging run shows global values consistent with the DB within the freshness bound; proof survives restart; affinity matches the 10/20 case.
7. Production data was never reset; staging used a copy; the evidence records the isolation.
8. The S1 traceability table has no uncovered audit finding; every open risk in §8.1 has an owner and a check.
9. Dead code is gone: `view.mjs`, `client.mjs`, `index.html`, `style.css`, the local cooling status path, and per-model perf SELECTs are removed.
10. Docs match shipped behaviour: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, and the CSP/`noindex`/MD-only notes.

### 9.3 S2 Step 1–8 coverage

| S2 Step | Units | Merge | Gate |
|---|---|---|---|
| 1 Snapshot contract and pure formatter | C0, E5 | m0b | Snapshot test; M01–M27; no DB import |
| 2 Store expansion and one read transaction | C0, E4, E5 | m0a/m1 | v2 migrate/reopen; one read transaction |
| 3 Router wiring and correctness | E3, E4, E2 | m2 | Four-worker fixture; JSON equals DB; usage once |
| 4 Svelte SSR shell and F7 tree | E1, E2 | m3/m4 | Build check; SSR render; kitchen-sink comparison |
| 5 Hydration, refresh, and reset | E1, E2, E4 | m5 | Hydration smoke; 100 cycles; reset matrix |
| 6 Security, accessibility, and subpath | E1, E2, E5 | m6 | XSS/CSP; axe/keyboard; `/ops/` HAR |
| 7 Build/deploy automation and policy docs | E1, E5 | m7 | Two builds hash-identical; pack listing; rollback |
| 8 Manual evidence and cleanup | S4 (visible auditor), E5 (steward) | — | Every CASE evidence; report written by S4 |

---

## 10. Coordination ledger

| Item | Decision | Owner | Status |
|---|---|---|---|
| Extra plan file | None; `coordination.md` is the only S3 file | C0 | fixed |
| `lib/router/status-view-schema.mjs` | Not created; schema is JSDoc in `snapshot.mjs` + E5 inventory test | C0 | fixed |
| `state-store.mjs` handoff | C0 → E4 at G0a; one writer at a time | C0/E4 | fixed |
| `router.mjs` writer | E3; E4 signs off usage/epoch; C0 signs off snapshot call | E3 | fixed |
| `lazy-router.mjs` writer | E2; E4 signs off reset/epoch; E1 signs off metas | E2 | fixed |
| `package.json` writer | E1; E5 requests script changes | E1 | fixed |
| CI workflow split | E1 owns `ci.yml`; E5 owns `release.yml` | E1/E5 | fixed |
| Test ownership | E5 owns `test/**`; contract changes require C0 approval | E5 | fixed |
| Report ownership | Visible S4 auditor only | S4 | fixed |
| Build-number source | `manifest.buildId`, never `package.json` | E1 | fixed |
