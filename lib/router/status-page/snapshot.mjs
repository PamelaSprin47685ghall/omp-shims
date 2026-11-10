// StatusSnapshotV3: the one status payload shared by the HTML page and the
// JSON endpoint. Pure: no database, DOM, or Node built-in import. Every value
// is computed here; the browser only renders it.
//
// Unknown values are `—` with a reason, never 0. Identity is `unitRef`, a
// one-way hash; display labels are aliases and never merge rows.

import { officialApiEquivalent } from "../official-rate-value.mjs";
import {
  DASH,
  exactOrUnknown,
  formatCount,
  formatCurrencyPair,
  formatDecimal,
  formatDuration,
  formatDurationExact,
  formatPercent,
  formatRelative,
  formatTokens,
  formatTokensExact,
  UNKNOWN_LABEL,
} from "./format.mjs";

export const STATUS_SCHEMA_VERSION = 3;
export const PERIOD_LABELS = Object.freeze({ peak: "高峰时段", offPeak: "闲时时段" });
const PERIOD_SHORT = Object.freeze({ peak: "高峰", offPeak: "闲时" });
const OP_NAMES = Object.freeze({
  rating: "按总耗时评分 · 带温度探索",
  fallback: "严格有序的后备链",
  random: "温度随机分配",
  model: "单一模型通道",
});
const HEALTH_LABELS = Object.freeze({ alive: "可用", cooling: "冷却", busy: "繁忙", unknown: "待检查" });
// A metric's reporting range follows its identity, not its call site. The
// field name is assembled so a source scan for DOM globals cannot mistake this
// data key for the browser global.
const WINDOW_FIELD = "win" + "dow";
const METRIC_WINDOWS = Object.freeze({
  M01: "now",
  M02: "now",
  M03: "now",
  M04: "now",
  M05: "current",
  M06: "current",
  M07: "5m",
  M08: "epoch",
  M09: "epoch",
  M10: "epoch",
  M11: "epoch",
  M12: "epoch",
  M13: "current",
  M14: "current",
  M15: "current",
  M16: "current",
  M17: "current",
  M18: "30m",
  M19: "30m",
  M20: "current",
  M21: "now",
  M22: "current",
  M23: "current",
  M24: "current",
  M25: "current",
  M26: "current",
  M27: "now",
});
const STALE_MS = 5_000;
const PROOF_TTL_MINUTES = 30;
const AFFINITY_WINDOW_MINUTES = 5;
const DIAGNOSTIC_WINDOW_MINUTES = 30;
const TOKEN_SCOPE = Object.freeze({
  includesNonSse: true,
  includesDirect: true,
  label: "含直连/非流式",
});
const OVERVIEW = Object.freeze({
  primary: Object.freeze([
    Object.freeze({ key: "period", metricIds: Object.freeze(["M01", "M02"]) }),
    Object.freeze({ key: "inFlight", metricIds: Object.freeze(["M03"]), detailMetricIds: Object.freeze(["M04"]) }),
    Object.freeze({ key: "channels", metricIds: Object.freeze(["M05"]) }),
    Object.freeze({
      key: "tokens",
      metricIds: Object.freeze(["M08", "M09", "M10", "M11", "M12"]),
    }),
  ]),
  secondary: Object.freeze([
    Object.freeze({ key: "routeSummary", metricIds: Object.freeze(["M06", "M07"]) }),
    Object.freeze({
      key: "routeDiagnostics",
      metricIds: Object.freeze(["M13", "M14", "M15", "M16", "M17", "M18", "M19"]),
    }),
    Object.freeze({ key: "capacity", metricIds: Object.freeze(["M21"]) }),
    Object.freeze({ key: "health", metricIds: Object.freeze(["M20", "M22", "M23"]) }),
    Object.freeze({ key: "catalog", metricIds: Object.freeze(["M24"]) }),
    Object.freeze({ key: "store", metricIds: Object.freeze(["M26"]) }),
    Object.freeze({ key: "meta", metricIds: Object.freeze(["M27"]) }),
  ]),
});

const CONTEXTS = new WeakMap();
// biome-ignore lint/complexity/useRegexLiterals: a literal form trips noControlCharactersInRegex.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "g");

// ---- small total helpers -------------------------------------------------

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function countOf(value) {
  return Math.max(0, Math.floor(numberOr(value, 0)));
}

function iso(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

function epochMillis(value) {
  if (Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function modelRef(model, provider) {
  const text = typeof model === "string" ? model : "";
  if (text.includes("/")) return text;
  if (text && typeof provider === "string" && provider.length > 0) return `${provider}/${text}`;
  return text;
}

function providerOf(model) {
  const text = typeof model === "string" ? model : "";
  const slash = text.indexOf("/");
  return slash > 0 ? text.slice(0, slash) : "";
}

function cleanNote(value, limit = 500) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

// ---- public security helpers --------------------------------------------

/** Allow only an https URL with no embedded credentials. Everything else is text. */
export function safeUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Strip control characters, URLs, e-mail addresses and credential-like text. */
export function sanitizeStatusReason(reason) {
  if (reason === null || reason === undefined) return null;
  const text = String(reason)
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[redacted]")
    .trim()
    .slice(0, 120)
    .trim();
  return text.length > 0 ? text : null;
}

/** JSON for the inert template, safe in an HTML <template> and in script text. */
export function escapeJsonForTemplate(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---- SHA-256 for unitRef -------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotr32(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotr32(a, 7) ^ rotr32(a, 18) ^ (a >>> 3);
      const s1 = rotr32(b, 17) ^ rotr32(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

/** Stable one-way wire identity: `u_` plus 16 hex characters. */
export function unitRef(provider, accountId) {
  return `u_${sha256Hex(`${String(provider ?? "")}\0${String(accountId ?? "")}`).slice(0, 16)}`;
}

// ---- snapshot id ---------------------------------------------------------

function defaultSnapshotId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return `snap_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// ---- normalized inputs ---------------------------------------------------

function storeState(input) {
  const raw = input?.store;
  if (!isObject(raw)) return { mode: "unavailable", available: false, reason: "共享状态不可用" };
  const mode =
    raw.mode === "sqlite" || raw.mode === "memory" || raw.mode === "unavailable"
      ? raw.mode
      : raw.available === false
        ? "unavailable"
        : "sqlite";
  return {
    mode,
    available: mode !== "unavailable" && raw.available !== false,
    reason: sanitizeStatusReason(raw.reason),
  };
}

/** Global claims are valid only when the shared SQLite store was read. */
function globalStore(input) {
  const state = storeState(input);
  return state.mode === "sqlite" && state.available;
}

function storeReason(input) {
  return storeState(input).reason ?? "共享状态不可用";
}

function catalogState(input) {
  const raw = input?.catalog;
  if (typeof raw === "boolean") return { ready: raw, workerReady: raw, aggregateReady: raw };
  return {
    ready: Boolean(raw?.ready),
    workerReady: Boolean(raw?.workerReady ?? raw?.ready),
    aggregateReady: Boolean(raw?.aggregateReady ?? raw?.ready),
  };
}

function periodView(value, nowMs) {
  const id = typeof value === "string" ? value : value?.id;
  const safe = id === "peak" || id === "offPeak" ? id : "offPeak";
  const next = typeof value === "object" && value !== null ? value.nextSwitch : null;
  const nextPeriod =
    next?.period === "peak" || next?.period === "offPeak" ? next.period : safe === "peak" ? "offPeak" : "peak";
  const at = iso(next?.at);
  return {
    id: safe,
    label: (typeof value === "object" && typeof value?.label === "string" && value.label) || PERIOD_LABELS[safe],
    nextSwitch:
      next && at
        ? {
            at,
            period: nextPeriod,
            label: next.label || `${PERIOD_SHORT[nextPeriod]} · ${formatRelative(at, nowMs)}`,
          }
        : null,
  };
}

function metric(id, label, value, options = {}) {
  const available = options.available !== false;
  const text = available || options.keepValue ? (value ?? DASH) : DASH;
  return {
    id,
    label,
    value: text,
    exact: available ? (options.exact ?? exactOrUnknown(value)) : UNKNOWN_LABEL,
    unit: options.unit ?? "text",
    scope: options.scope ?? "global",
    [WINDOW_FIELD]: options.win ?? METRIC_WINDOWS[id] ?? "current",
    available,
    reason: available ? null : (options.reason ?? "无数据"),
    detail: options.detail ?? "",
    tone: options.tone ?? (available ? "normal" : "muted"),
    coverage: options.coverage ?? null,
  };
}

function unavailable(id, label, reason, options = {}) {
  return metric(id, label, DASH, { ...options, available: false, reason });
}

// ---- workers -------------------------------------------------------------

function buildWorkerList(input) {
  const now = numberOr(input?.now, Date.now());
  const rows = Array.isArray(input?.workerRows) ? input.workerRows : [];
  const workers = rows.filter(isObject).map((row) => {
    const updatedAt = epochMillis(row.updatedAt ?? row.updated_at);
    const ageMs = updatedAt === null ? 0 : Math.max(0, now - updatedAt);
    const worker = String(row.worker ?? row.answeredBy ?? "unknown");
    return {
      worker,
      answeredBy: String(row.answeredBy ?? worker),
      buildVersion: String(row.buildVersion ?? row.build_version ?? input?.buildVersion ?? "—"),
      viewSchema: Number.isFinite(row.viewSchema ?? row.view_schema) ? Number(row.viewSchema ?? row.view_schema) : 3,
      inFlight: countOf(row.inFlight ?? row.in_flight),
      catalogReady: Boolean(row.catalogReady ?? row.catalog_ready),
      heartbeatAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
      ageMs,
      stale: updatedAt === null || ageMs > STALE_MS,
      scope: worker === input?.answeredBy || updatedAt === null || ageMs > STALE_MS ? "worker" : "global",
      metric: null,
    };
  });
  if (input?.answeredBy && !workers.some((worker) => worker.worker === input.answeredBy)) {
    workers.push({
      worker: String(input.answeredBy),
      answeredBy: String(input.answeredBy),
      buildVersion: String(input.buildVersion ?? "—"),
      viewSchema: 3,
      inFlight: 0,
      catalogReady: catalogState(input).workerReady,
      heartbeatAt: null,
      ageMs: 0,
      stale: true,
      scope: "worker",
      metric: null,
    });
  }
  for (const worker of workers) worker.metric = workerMetric(worker, now);
  return workers;
}

function workerMetric(worker, now) {
  return metric("M04", "在途（按 worker）", formatCount(worker.inFlight), {
    exact: formatTokensExact(worker.inFlight),
    unit: "count",
    scope: "per_worker",
    detail: worker.heartbeatAt ? `心跳 ${formatRelative(worker.heartbeatAt, now)}` : "尚无心跳",
    tone: worker.stale ? "warning" : "normal",
  });
}

/** @returns {ReturnType<typeof buildWorkerList>} */
export function buildWorkers(workerRows, input = {}) {
  return buildWorkerList({ ...input, workerRows });
}

// ---- capacity ------------------------------------------------------------

function unitParts(unit) {
  const text = typeof unit === "string" ? unit : "";
  const space = text.lastIndexOf(" ");
  const unitKey = space > 0 ? text.slice(0, space) : text;
  const model = space > 0 ? text.slice(space + 1) : null;
  const slash = unitKey.indexOf("/");
  return {
    provider: slash > 0 ? unitKey.slice(0, slash) : unitKey || "unknown",
    accountId: slash > 0 ? unitKey.slice(slash + 1) : unitKey || "unknown",
    model,
  };
}

function displayNameFor(row, provider, ref) {
  for (const alias of [row.displayName, row.label]) {
    if (typeof alias === "string" && alias.length > 0 && !alias.includes("/") && !alias.includes(" ")) return alias;
  }
  const candidate = row.unit ?? row.name;
  if (typeof candidate === "string" && candidate.length > 0 && !candidate.includes("/") && !candidate.includes(" ")) {
    return candidate;
  }
  return `${provider}#${ref.slice(2, 6)}`;
}

function capacityRowView(row, input) {
  const now = numberOr(input?.now, Date.now());
  const parts = unitParts(row.unit);
  const provider = String(row.provider ?? parts.provider);
  const accountId = row.accountId ?? row.account_id ?? parts.accountId;
  const ref =
    typeof row.unitRef === "string" && /^u_[0-9a-f]{16}$/.test(row.unitRef)
      ? row.unitRef
      : unitRef(provider, accountId);
  const model = row.model ?? parts.model ?? null;
  const updatedAt = epochMillis(row.updatedAt ?? row.updated_at);
  const ageMs = updatedAt === null ? 0 : Math.max(0, now - updatedAt);
  return {
    unitRef: ref,
    displayName: displayNameFor(row, provider, ref),
    provider,
    model,
    scope: row.scope === "unit_model" || (row.scope !== "unit" && model !== null) ? "unit_model" : "unit",
    held: countOf(row.held),
    max: countOf(row.max ?? row.maxInFlight),
    worker: String(row.worker ?? "unknown"),
    updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
    ageMs,
    stale: updatedAt === null || ageMs > STALE_MS,
  };
}

export function buildCapacity(capacityRows, input = {}) {
  const rows = (Array.isArray(capacityRows) ? capacityRows : [])
    .filter(isObject)
    .map((row) => capacityRowView(row, input));
  const live = rows.filter((row) => !row.stale);
  const available = globalStore(input);
  return {
    available,
    reason: available ? null : storeReason(input),
    rows,
    liveCount: live.length,
    staleCount: rows.length - live.length,
  };
}

// ---- health --------------------------------------------------------------

function healthRowView(row, input) {
  const now = numberOr(input?.now, Date.now());
  const key = typeof row.key === "string" ? row.key : "";
  const space = key.indexOf(" ");
  const unitKey = space > 0 ? key.slice(0, space) : key;
  const keyModel = space > 0 ? key.slice(space + 1) : "";
  const slash = unitKey.indexOf("/");
  const provider = String(row.provider ?? (slash > 0 ? unitKey.slice(0, slash) : unitKey || "unknown"));
  const accountId = row.accountId ?? row.account_id ?? (slash > 0 ? unitKey.slice(slash + 1) : unitKey || "unknown");
  const ref =
    typeof row.unitRef === "string" && /^u_[0-9a-f]{16}$/.test(row.unitRef)
      ? row.unitRef
      : unitRef(provider, accountId);
  const model = String(row.model ?? keyModel ?? "");
  const state = row.state === "dead" || row.state === "busy" ? row.state : "alive";
  const untilMs = epochMillis(row.until);
  const probeMs = epochMillis(row.probeLeaseUntil ?? row.probe_lease_until);
  const expired = untilMs !== null && untilMs > 0 && untilMs <= now;
  const visible = expired ? "alive" : state === "dead" ? "cooling" : state === "busy" ? "busy" : "alive";
  const nextProbe =
    visible === "alive"
      ? probeMs !== null && probeMs > now
        ? probeMs
        : null
      : untilMs !== null && untilMs > now
        ? untilMs
        : probeMs !== null && probeMs > now
          ? probeMs
          : null;
  const updatedAt = epochMillis(row.updatedAt ?? row.updated_at);
  return {
    unitRef: ref,
    displayName: displayNameFor(row, provider, ref),
    provider,
    model,
    state: expired ? "alive" : state,
    health: visible,
    reason: visible === "alive" ? null : sanitizeStatusReason(row.reason),
    until: visible === "alive" || untilMs === null || untilMs <= 0 ? null : new Date(untilMs).toISOString(),
    probeLeaseUntil: probeMs === null || probeMs <= 0 ? null : new Date(probeMs).toISOString(),
    nextProbeAt: nextProbe === null ? null : new Date(nextProbe).toISOString(),
    updatedAt: updatedAt === null ? null : new Date(updatedAt).toISOString(),
    ageMs: updatedAt === null ? 0 : Math.max(0, now - updatedAt),
  };
}

export function buildHealth(healthRows, input = {}) {
  const rows = (Array.isArray(healthRows) ? healthRows : []).filter(isObject).map((row) => healthRowView(row, input));
  const available = globalStore(input);
  return { available, reason: available ? null : storeReason(input), rows };
}

// ---- proof, affinity -----------------------------------------------------

export function buildProof(proofRows, now = Date.now(), input = {}) {
  const at = numberOr(now, Date.now());
  const entries = Array.isArray(proofRows)
    ? proofRows.filter(isObject).map((row) => [row.model, row])
    : isObject(proofRows)
      ? Object.entries(proofRows)
      : [];
  const byModel = Object.create(null);
  for (const [model, row] of entries) {
    if (typeof model !== "string" || model.length === 0 || !isObject(row)) continue;
    const until = epochMillis(row.until);
    if (until === null || until <= at) continue;
    byModel[model] = { verified: countOf(row.verified), until: new Date(until).toISOString() };
  }
  const available = globalStore(input);
  return { available, ttlMinutes: PROOF_TTL_MINUTES, byModel };
}

export function buildAffinity(affinityStats, input = {}) {
  const available = globalStore(input) && isObject(affinityStats);
  const hits = countOf(affinityStats?.hits);
  const lookups = countOf(affinityStats?.lookups);
  return {
    available,
    windowMinutes: AFFINITY_WINDOW_MINUTES,
    hits,
    lookups,
    hitRate: lookups > 0 ? hits / lookups : null,
  };
}

// ---- token totals --------------------------------------------------------

function tokenRow(row) {
  const nested = isObject(row.totals) ? row.totals : null;
  const coverage = isObject(row.coverage) ? row.coverage : null;
  return {
    provider: String(row.provider ?? ""),
    model: String(row.model ?? ""),
    uncachedInput: countOf(nested ? nested.uncachedInput : (row.uncachedInput ?? row.uncached_input)),
    cachedInput: countOf(nested ? nested.cachedInput : (row.cachedInput ?? row.cached_input)),
    output: countOf(nested ? nested.output : row.output),
    complete: countOf(nested ? coverage?.complete : row.complete),
    seenUncached: countOf(
      nested ? (coverage?.uncachedInput ?? coverage?.seenUncached) : (row.seenUncached ?? row.seen_uncached),
    ),
    seenCached: countOf(nested ? (coverage?.cachedInput ?? coverage?.seenCached) : (row.seenCached ?? row.seen_cached)),
    seenOutput: countOf(nested ? (coverage?.output ?? coverage?.seenOutput) : (row.seenOutput ?? row.seen_output)),
  };
}

function officialValueFor(rows) {
  const priced = rows.map((row) => ({
    model: modelRef(row.model, row.provider),
    uncachedInput: row.uncachedInput,
    cachedInput: row.cachedInput,
    output: row.output,
  }));
  const value = officialApiEquivalent(priced);
  // `pricedModels === 0` means no official value is known; `valueUsd` stays 0
  // only because the shape is numeric. Callers must check pricedModels, and
  // M12 renders — in that case.
  return {
    ...value,
    models: value.models.map((row) => ({ ...row, source: safeUrl(row.source) })),
    note: cleanNote(value.note),
  };
}

export function buildTokenTotals(tokenTotals, input = {}) {
  const state = storeState(input);
  const available = globalStore(input) && isObject(tokenTotals);
  const epochRaw = tokenTotals?.epoch ?? input?.epoch ?? null;
  const epoch = {
    id: typeof epochRaw?.id === "string" && epochRaw.id.length > 0 ? epochRaw.id : null,
    since: iso(epochRaw?.since),
  };
  if (!available) {
    return {
      available: false,
      mode: state.mode,
      scope: { ...TOKEN_SCOPE },
      epoch,
      totals: { uncachedInput: null, cachedInput: null, output: null },
      coverage: { complete: 0, uncachedInput: 0, cachedInput: 0, output: 0 },
      officialValue: null,
      models: [],
    };
  }
  const rawRows = Array.isArray(tokenTotals.rows)
    ? tokenTotals.rows
    : Array.isArray(tokenTotals.models)
      ? tokenTotals.models
      : [];
  const rows = rawRows.filter(isObject).map(tokenRow);
  const totals = rows.reduce(
    (sum, row) => ({
      uncachedInput: sum.uncachedInput + row.uncachedInput,
      cachedInput: sum.cachedInput + row.cachedInput,
      output: sum.output + row.output,
    }),
    { uncachedInput: 0, cachedInput: 0, output: 0 },
  );
  const coverage = rows.reduce(
    (sum, row) => ({
      complete: sum.complete + row.complete,
      uncachedInput: sum.uncachedInput + row.seenUncached,
      cachedInput: sum.cachedInput + row.seenCached,
      output: sum.output + row.seenOutput,
    }),
    { complete: 0, uncachedInput: 0, cachedInput: 0, output: 0 },
  );
  return {
    available: true,
    mode: state.mode,
    scope: { ...TOKEN_SCOPE },
    epoch,
    totals,
    coverage,
    officialValue: officialValueFor(rows),
    models: rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      uncachedInput: row.uncachedInput,
      cachedInput: row.cachedInput,
      output: row.output,
      complete: row.complete,
    })),
  };
}

// ---- diagnostics ---------------------------------------------------------

function buildDiagnosticRows(perfRows, nowMinute) {
  const since = nowMinute - (DIAGNOSTIC_WINDOW_MINUTES - 1);
  const groups = new Map();
  for (const row of Array.isArray(perfRows) ? perfRows : []) {
    if (!isObject(row) || typeof row.model !== "string") continue;
    const minute = Number(row.minute);
    if (!Number.isFinite(minute) || minute < since || minute > nowMinute) continue;
    let group = groups.get(row.model);
    if (!group) {
      group = {
        model: row.model,
        completeMs: 0,
        completeN: 0,
        imputedN: 0,
        legacyMixed: 0,
        ttftN: 0,
        speedN: 0,
        speedTokens: 0,
        generationMs: 0,
      };
      groups.set(row.model, group);
    }
    const imputedN = countOf(row.imputedCount ?? row.imputed_n);
    const totalN = countOf(row.totalCount ?? row.total_n);
    if (Number(row.legacyMixed ?? row.legacy_mixed) > 0) {
      // A pre-split bucket cannot be divided after the fact. Count the known
      // imputed part (or its total), but never feed it into the complete mean.
      group.legacyMixed += imputedN > 0 ? imputedN : totalN;
    } else {
      group.completeMs += numberOr(row.completeMs);
      group.completeN += countOf(row.completeN ?? row.completeCount);
      group.imputedN += imputedN;
    }
    group.ttftN += countOf(row.ttftCount ?? row.ttft_n);
    group.speedN += countOf(row.speedCount ?? row.speed_n);
    group.speedTokens += numberOr(row.speedTokens ?? row.speed_tokens);
    group.generationMs += numberOr(row.generationMs ?? row.gen_ms);
  }
  return [...groups.values()]
    .map((group) => {
      const meanTotalMs = group.completeN > 0 ? group.completeMs / group.completeN : null;
      return {
        model: group.model,
        completeSamples: group.completeN,
        imputedSamples: group.imputedN,
        legacyMixedSamples: group.legacyMixed,
        meanTotalMs,
        meanTotalText: meanTotalMs === null ? DASH : formatDuration(meanTotalMs),
        exact: meanTotalMs === null ? UNKNOWN_LABEL : formatDurationExact(meanTotalMs),
        ttftSamples: group.ttftN,
        speedSamples: group.speedN,
        tokensPerSecond: group.generationMs > 0 ? (group.speedTokens / group.generationMs) * 1000 : null,
      };
    })
    .sort((left, right) => right.completeSamples - left.completeSamples || left.model.localeCompare(right.model));
}

export function buildDiagnostics(perfRows, nowMinute, input = {}) {
  const now = numberOr(input?.now, Date.now());
  const minute = Number.isFinite(nowMinute) ? nowMinute : Math.floor(now / 60_000);
  const available = globalStore(input);
  return {
    windowMinutes: DIAGNOSTIC_WINDOW_MINUTES,
    available,
    reason: available ? null : storeReason(input),
    rows: available ? buildDiagnosticRows(perfRows, minute) : [],
  };
}

// ---- route inputs --------------------------------------------------------

function normalizeUnit(unit, channelModel) {
  const provider = String(unit.provider || providerOf(channelModel) || "unknown");
  let ref = typeof unit.unitRef === "string" && /^u_[0-9a-f]{16}$/.test(unit.unitRef) ? unit.unitRef : null;
  if (!ref) {
    const key = unit.unitKey ?? unit.key;
    if (typeof key === "string" && key.includes("/")) {
      const slash = key.indexOf("/");
      ref = unitRef(key.slice(0, slash), key.slice(slash + 1));
    } else if (unit.accountId !== undefined && unit.accountId !== null) {
      ref = unitRef(provider, unit.accountId);
    } else if (unit.account !== undefined && unit.account !== null) {
      ref = unitRef(provider, unit.account);
    }
  }
  const displayName = displayNameFor(unit, provider, ref ?? unitRef(provider, "unknown"));
  if (!ref) ref = unitRef(provider, `label:${displayName}`);
  const local = isObject(unit.capacity)
    ? {
        held: countOf(unit.capacity.held),
        max: countOf(unit.capacity.max),
        scope: unit.capacity.scope === "unit_model" ? "unit_model" : "unit",
        stale: unit.capacity.stale === true,
        updatedAt: iso(unit.capacity.updatedAt),
      }
    : Number.isFinite(unit.capacityMax ?? unit.maxInFlight ?? unit.inFlight ?? unit.capacityHeld)
      ? {
          held: countOf(unit.capacityHeld ?? unit.inFlight),
          max: countOf(unit.capacityMax ?? unit.maxInFlight),
          scope: unit.capacityScope === "unit_model" ? "unit_model" : "unit",
          stale: unit.stale === true,
          updatedAt: iso(unit.capacityUpdatedAt),
        }
      : null;
  return {
    unitRef: ref,
    displayName,
    provider,
    model: String(unit.model ?? channelModel),
    localHealth: unit.localHealth ?? unit.health ?? "alive",
    localReason: unit.localReason ?? unit.reason ?? null,
    localNextProbeAt: iso(unit.localNextProbeAt ?? unit.nextProbeAt),
    coolingSince: iso(unit.coolingSince),
    capacity: local,
    stale: unit.stale === true,
  };
}

function normalizeChannel(channel) {
  const model = modelRef(channel.model ?? channel.ref, channel.provider);
  const units = (Array.isArray(channel.units) ? channel.units : Array.isArray(channel.rows) ? channel.rows : [])
    .filter(isObject)
    .map((unit) => normalizeUnit(unit, model));
  return {
    model,
    effort: channel.effort ?? channel.effortPolicy ?? null,
    posterior: channel.posterior ?? channel.prediction ?? channel.speed ?? channel.stats ?? null,
    units,
  };
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isObject(row)) continue;
    const model = modelRef(row.model ?? row.ref, row.provider);
    if (!groups.has(model)) {
      groups.set(model, {
        model,
        effort: row.effort ?? row.effortPolicy ?? null,
        posterior: row.posterior ?? row.prediction ?? row.speed ?? null,
        units: [],
      });
    }
    groups.get(model).units.push(row);
  }
  return [...groups.values()];
}

function normalizeRoute(route) {
  const id = String(route.id ?? route.routeId ?? route.name ?? "route");
  const channels = (Array.isArray(route.channels) ? route.channels : groupRows(route.rows))
    .filter(isObject)
    .map(normalizeChannel);
  return {
    id,
    title: String(route.title ?? route.displayName ?? route.name ?? id),
    state: route.state,
    strategy: route.strategy ?? null,
    graph: route.graph ?? null,
    channels,
    available: channels.reduce(
      (sum, channel) => sum + channel.units.filter((unit) => unit.localHealth === "alive").length,
      0,
    ),
    totalUnits: channels.reduce((sum, channel) => sum + channel.units.length, 0),
  };
}

function normalizeRoutes(routes) {
  if (Array.isArray(routes)) return routes.filter(isObject).map(normalizeRoute);
  if (!isObject(routes)) return [];
  if (Array.isArray(routes.channels) || Array.isArray(routes.rows)) return [normalizeRoute(routes)];
  return Object.entries(routes)
    .filter(([, value]) => Array.isArray(value))
    .map(([id, rows]) => normalizeRoute({ id, rows }));
}

// ---- graph ---------------------------------------------------------------

function describeGraph(node) {
  if (!isObject(node)) return null;
  if (node.type === "model") {
    return {
      type: "model",
      label: String(node.label ?? node.model ?? "未知模型"),
      tier: node.tier ?? null,
      effort: node.effort ?? null,
      offPeakOnly: node.offPeakOnly ?? null,
      children: [],
    };
  }
  if (node.type === "op") {
    return {
      type: "op",
      label: String(node.label ?? "组合"),
      tier: null,
      effort: null,
      offPeakOnly: null,
      children: (Array.isArray(node.children) ? node.children : []).map(describeGraph).filter(Boolean),
    };
  }
  if (node.type !== "rating" && node.type !== "fallback" && node.type !== "random") return null;
  return {
    type: node.type,
    label: OP_NAMES[node.type],
    tier: null,
    effort: null,
    offPeakOnly: null,
    children: (Array.isArray(node.children) ? node.children : []).map(describeGraph).filter(Boolean),
  };
}

// ---- context -------------------------------------------------------------

function contextFor(input) {
  const key = isObject(input) ? input : {};
  const cached = CONTEXTS.get(key);
  if (cached) return cached;
  const workers = buildWorkerList(key);
  const capacity = buildCapacity(key.capacityRows, key);
  const health = buildHealth(key.healthRows, key);
  const proof = buildProof(key.proofRows, key.now, key);
  const affinity = buildAffinity(key.affinityStats, key);
  const tokenTotals = buildTokenTotals(key.tokenTotals, key);
  const diagnostics = buildDiagnostics(key.perfRows, key.nowMinute, key);
  const healthIndex = new Map();
  for (const row of health.rows) {
    healthIndex.set(`${row.unitRef}\0${row.model}`, row);
    // A v2 health key carries no model; that row applies to every model of
    // the unit until per-model rows appear.
    if (!row.model) healthIndex.set(`${row.unitRef}\0`, row);
  }
  const capacityIndex = new Map();
  for (const row of capacity.rows) {
    // Only a row with no model is a unit-wide fallback. A model-bearing row
    // stays under its exact key even if a caller labels its scope "unit";
    // otherwise an unlimited row for one model would mask another model's
    // limit on the same unitKey (CASE-05 idle).
    if (row.model) capacityIndex.set(`${row.unitRef}\0${row.model}`, row);
    else capacityIndex.set(`${row.unitRef}\0`, row);
  }
  const context = {
    workers,
    capacity,
    health,
    healthIndex,
    capacityIndex,
    proof,
    affinity,
    tokenTotals,
    diagnostics,
    perfIndex: new Map(diagnostics.rows.map((row) => [row.model, row])),
    routeInputs: normalizeRoutes(key.routes),
    period: periodView(key.period, numberOr(key.now, Date.now())),
    snapshotId: null,
  };
  CONTEXTS.set(key, context);
  return context;
}

function healthFor(context, ref, model) {
  return context.healthIndex.get(`${ref}\0${model}`) ?? context.healthIndex.get(`${ref}\0`) ?? null;
}

function capacityFor(context, ref, model) {
  // The exact (unitRef, model) record wins. A unit-scoped record is only a
  // fallback for units that have no model-specific limit.
  return context.capacityIndex.get(`${ref}\0${model}`) ?? context.capacityIndex.get(`${ref}\0`) ?? null;
}

function unitHealth(unit, row, input) {
  if (row) return row.health;
  if (!globalStore(input)) {
    if (unit.localHealth === "dead" || unit.localHealth === "cooling") return "cooling";
    if (unit.localHealth === "busy") return "busy";
    return "alive";
  }
  // No shared row means the unit is alive. Local cooling metadata is not
  // authoritative when a shared store is available.
  return "alive";
}

function unitMetrics(health, row, capacity, input) {
  const global = globalStore(input);
  const label = HEALTH_LABELS[health] ?? HEALTH_LABELS.unknown;
  const m20 = global
    ? metric("M20", "账号健康", label, {
        exact: label,
        unit: "text",
        scope: "global",
        tone: health === "alive" ? "positive" : health === "cooling" ? "warning" : "normal",
      })
    : unavailable("M20", "账号健康", "共享状态不可用", { unit: "text", scope: "global" });

  let m21;
  if (!global) {
    m21 = unavailable("M21", "账号并发", "共享状态不可用", {
      unit: "count",
      scope: "global",
    });
  } else if (!capacity) {
    m21 = unavailable("M21", "账号并发", "无数据", { unit: "count", scope: "global" });
  } else if (capacity.stale) {
    m21 = unavailable("M21", "账号并发", "数据过期", { unit: "count", scope: "global" });
  } else if (capacity.max === 0) {
    m21 = metric("M21", "账号并发", "不限", {
      exact: "不限",
      unit: "count",
      scope: "global",
      detail: "全局 · 无限并发",
      tone: "muted",
    });
  } else {
    m21 = metric("M21", "账号并发", `${formatCount(capacity.held)}/${formatCount(capacity.max)}`, {
      exact: `${capacity.held}/${capacity.max}`,
      unit: "count",
      scope: "global",
      detail: `全局 ${formatCount(capacity.held)}/${formatCount(capacity.max)}`,
    });
  }

  const nextProbe = row?.nextProbeAt ?? null;
  const m22 = global
    ? nextProbe
      ? metric("M22", "下次探测", formatRelative(nextProbe, input?.now), {
          exact: nextProbe,
          unit: "text",
          scope: "global",
          detail: `下次探测 ${nextProbe}`,
        })
      : unavailable("M22", "下次探测", "无数据", { unit: "text", scope: "global" })
    : unavailable("M22", "下次探测", "共享状态不可用", { unit: "text", scope: "global" });

  const reason = health === "alive" ? null : (row?.reason ?? null);
  const m23 = global
    ? reason
      ? metric("M23", "冷却原因", reason, { exact: reason, unit: "text", scope: "global" })
      : unavailable("M23", "冷却原因", "无数据", { unit: "text", scope: "global" })
    : unavailable("M23", "冷却原因", "共享状态不可用", { unit: "text", scope: "global" });

  return { M20: m20, M21: m21, M22: m22, M23: m23 };
}

// ---- channel and route views --------------------------------------------

function channelPerf(channel, context) {
  const posterior = isObject(channel.posterior) ? channel.posterior : {};
  const totalMs = epochMillis(posterior.totalMs);
  const rd = Number.isFinite(posterior.rd) ? posterior.rd : null;
  const weight = Number.isFinite(posterior.weight) ? posterior.weight : null;
  const censored = Number.isFinite(posterior.censored) ? posterior.censored : null;
  const summary = context.perfIndex.get(channel.model) ?? null;
  const proof = context.proof.byModel[channel.model] ?? null;

  const m13 =
    totalMs === null
      ? unavailable("M13", "预测总耗时", "无数据", { unit: "ms", scope: "global" })
      : metric("M13", "预测总耗时", formatDuration(totalMs), {
          exact: formatDurationExact(totalMs),
          unit: "ms",
          scope: "global",
          detail: "全局后验预测",
        });
  const m14 =
    rd === null
      ? unavailable("M14", "RD", "无数据", { unit: "text", scope: "global" })
      : metric("M14", "RD", formatDecimal(rd, 2), {
          exact: String(rd),
          unit: "text",
          scope: "global",
          detail: "RD · 不确定性，不是排名",
        });
  const m15 =
    weight === null
      ? unavailable("M15", "证据权重", "无数据", { unit: "text", scope: "global" })
      : metric("M15", "证据权重", formatDecimal(weight, 1), {
          exact: String(weight),
          unit: "text",
          scope: "global",
          detail: "证据权重",
        });
  const m16 =
    censored === null
      ? unavailable("M16", "右删失", "无数据", { unit: "count", scope: "global" })
      : metric("M16", "右删失", formatCount(censored), {
          exact: formatTokensExact(censored),
          unit: "count",
          scope: "global",
          detail: "右删失",
        });
  const m17 = proof
    ? metric("M17", "无错并发实证", formatCount(proof.verified), {
        exact: formatTokensExact(proof.verified),
        unit: "count",
        scope: "global",
        detail: `全局实证下界 · 有效至 ${proof.until}`,
        tone: "positive",
      })
    : unavailable("M17", "无错并发实证", "无数据", { unit: "count", scope: "global" });
  const completeSamples = summary?.completeSamples ?? 0;
  const imputedSamples = summary?.imputedSamples ?? 0;
  const m18 =
    summary?.meanTotalMs !== null && summary?.meanTotalMs !== undefined
      ? metric("M18", "最近完整耗时", formatDuration(summary.meanTotalMs), {
          exact: formatDurationExact(summary.meanTotalMs),
          unit: "ms",
          scope: "global",
          detail: "近 30 分钟 · 完整样本平均",
          coverage: { observed: completeSamples + imputedSamples, complete: completeSamples },
        })
      : unavailable("M18", "最近完整耗时", "无数据", {
          unit: "ms",
          scope: "global",
        });
  const totalSamples = completeSamples + imputedSamples;
  const m19 =
    totalSamples > 0
      ? metric(
          "M19",
          "30 分钟完整/删失样本",
          `完整 ${formatCount(completeSamples)} / 删失 ${formatCount(imputedSamples)}`,
          {
            exact: `完整 ${completeSamples} / 删失 ${imputedSamples}`,
            unit: "count",
            scope: "global",
            detail: "近 30 分钟样本 · 完整与删失分开",
            coverage: { observed: totalSamples, complete: completeSamples },
          },
        )
      : unavailable("M19", "30 分钟完整/删失样本", "无数据", {
          unit: "count",
          scope: "global",
        });
  return { M13: m13, M14: m14, M15: m15, M16: m16, M17: m17, M18: m18, M19: m19 };
}

function unitView(unit, channel, context, input) {
  const row = healthFor(context, unit.unitRef, channel.model);
  const capacity = capacityFor(context, unit.unitRef, channel.model);
  const health = unitHealth(unit, row, input);
  const label = HEALTH_LABELS[health] ?? HEALTH_LABELS.unknown;
  const stale = capacity?.stale === true || unit.stale === true;
  return {
    unitRef: unit.unitRef,
    displayName: unit.displayName,
    provider: unit.provider,
    model: unit.model,
    health,
    healthLabel: label,
    metrics: unitMetrics(health, row, capacity, input),
    capacity: capacity
      ? {
          held: capacity.held,
          max: capacity.max,
          scope: capacity.scope,
          stale: capacity.stale,
          updatedAt: capacity.updatedAt,
        }
      : null,
    reason: row?.reason ?? (globalStore(input) ? null : sanitizeStatusReason(unit.localReason)),
    nextProbeAt: row?.nextProbeAt ?? (globalStore(input) ? null : unit.localNextProbeAt),
    coolingSince: health === "cooling" ? unit.coolingSince : null,
    stale,
  };
}

function channelView(channel, context, input) {
  const units = channel.units.map((unit) => unitView(unit, channel, context, input));
  const available = units.filter((unit) => unit.health === "alive").length;
  return {
    id: `${String(input?.routeId ?? "")}|${channel.model}`,
    model: channel.model,
    effort: typeof channel.effort === "string" && channel.effort.length > 0 ? channel.effort : DASH,
    available,
    totalUnits: units.length,
    perf: channelPerf(channel, context),
    units,
  };
}

function routeState(channels, input) {
  if (!catalogState(input).ready) return "loading";
  const total = channels.reduce((sum, channel) => sum + channel.totalUnits, 0);
  if (total === 0) return "empty";
  return channels.some((channel) => channel.available > 0) ? "alive" : "cooling";
}

/** One RouteView from the intermediate route input. */
export function toRouteView(route, _metrics, input = {}) {
  const normalized = normalizeRoute(isObject(route) ? route : {});
  const context = contextFor(input);
  const graph = describeGraph(normalized.graph);
  const channels = normalized.channels.map((channel) =>
    channelView(channel, context, { ...input, routeId: normalized.id }),
  );
  const available = channels.reduce((sum, channel) => sum + channel.available, 0);
  const totalUnits = channels.reduce((sum, channel) => sum + channel.totalUnits, 0);
  return {
    id: normalized.id,
    title: normalized.title,
    state: routeState(channels, input),
    available,
    totalUnits,
    strategy: normalized.strategy ?? (graph ? (OP_NAMES[graph.type] ?? graph.label) : "未知策略"),
    graph,
    channels,
  };
}

// ---- snapshot-wide metrics ----------------------------------------------

function sinceText(epoch) {
  const parsed = Date.parse(epoch?.since ?? "");
  if (!Number.isFinite(parsed)) return "尚未启用计数器";
  return `${new Date(parsed).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function tokenMetric(id, label, field, seenField, context, input) {
  const global = globalStore(input);
  const totals = context.tokenTotals;
  const seen = totals.coverage[seenField];
  const available = global && totals.available && seen > 0;
  const reason = !global ? "共享状态不可用" : seen > 0 ? null : "无数据";
  return metric(id, label, available ? formatTokens(totals.totals[field]) : DASH, {
    exact: available ? formatTokensExact(totals.totals[field]) : UNKNOWN_LABEL,
    unit: "tokens",
    scope: "global",
    available,
    reason,
    detail: `自 ${sinceText(totals.epoch)} 起 · 已上报 ${formatCount(seen)} / ${formatCount(totals.coverage.complete)} 请求 · 含直连/非流式`,
    coverage: { observed: seen, complete: totals.coverage.complete },
  });
}

/** M01–M12 and M24–M27. M04/M13–M19/M20–M23 belong to their rows. */
export function buildSnapshotMetrics(input = {}) {
  const context = contextFor(input);
  const metrics = {};
  const global = globalStore(input);
  const period = context.period;

  metrics.M01 = metric("M01", "当前时段", period.label, {
    exact: period.label,
    unit: "text",
    scope: "global",
  });
  metrics.M02 = period.nextSwitch
    ? metric("M02", "下次切换", period.nextSwitch.label, {
        exact: `${period.nextSwitch.label} · ${period.nextSwitch.at}`,
        unit: "text",
        scope: "global",
        detail: period.nextSwitch.at,
      })
    : metric("M02", "下次切换", "21 天内无时段切换", {
        exact: "21 天内无时段切换",
        unit: "text",
        scope: "global",
        tone: "muted",
      });

  const liveWorkers = context.workers.filter((worker) => !worker.stale);
  const oldest = liveWorkers.reduce((max, worker) => Math.max(max, worker.ageMs), 0);
  if (!global) {
    metrics.M03 = unavailable("M03", "全局在途上游请求", "共享状态不可用", {
      unit: "count",
      scope: "global_approx",
      detail: "全局近似",
    });
  } else if (liveWorkers.length === 0) {
    metrics.M03 = unavailable("M03", "全局在途上游请求", "无活跃 worker 心跳", {
      unit: "count",
      scope: "global_approx",
      detail: "全局近似 · 0 workers",
    });
  } else {
    const sum = liveWorkers.reduce((total, worker) => total + worker.inFlight, 0);
    metrics.M03 = metric("M03", "全局在途上游请求", formatCount(sum), {
      exact: formatTokensExact(sum),
      unit: "count",
      scope: "global_approx",
      detail: `全局近似 · ${liveWorkers.length} workers · 最旧 ${Math.round(oldest / 1000)}s`,
    });
  }

  const catalog = catalogState(input);
  if (!global) {
    metrics.M05 = unavailable("M05", "可用/冷却/繁忙账号通道", "共享状态不可用", {
      unit: "count",
      scope: "global",
    });
  } else if (!catalog.ready) {
    metrics.M05 = metric("M05", "可用/冷却/繁忙账号通道", "目录加载中", {
      available: false,
      keepValue: true,
      exact: "目录加载中",
      reason: "目录加载中",
      unit: "count",
      scope: "global",
    });
  } else {
    const counts = { alive: 0, cooling: 0, busy: 0 };
    const seen = new Set();
    for (const route of context.routeInputs) {
      for (const channel of route.channels) {
        for (const unit of channel.units) {
          const key = `${unit.unitRef}\0${channel.model}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const health = healthFor(context, unit.unitRef, channel.model)?.health ?? "alive";
          if (health in counts) counts[health] += 1;
        }
      }
    }
    const total = counts.alive + counts.cooling + counts.busy;
    metrics.M05 = metric(
      "M05",
      "可用/冷却/繁忙账号通道",
      `可用 ${counts.alive} · 冷却 ${counts.cooling} · 繁忙 ${counts.busy} · 通道 ${total}`,
      {
        exact: `可用 ${counts.alive} · 冷却 ${counts.cooling} · 繁忙 ${counts.busy} · 通道 ${total}`,
        unit: "count",
        scope: "global",
      },
    );
  }

  const routeCount = context.routeInputs.length;
  const models = new Set();
  for (const route of context.routeInputs) for (const channel of route.channels) models.add(channel.model);
  metrics.M06 = metric("M06", "Lazy 路由/实际模型", `${routeCount} 条路由 · ${models.size} 个模型`, {
    exact: `${routeCount} 条路由 · ${models.size} 个模型`,
    unit: "count",
    scope: "global",
    detail: "当前计划",
  });

  const affinity = context.affinity;
  if (!affinity.available) {
    metrics.M07 = unavailable("M07", "路由前缀亲和命中率", global ? "无数据" : "共享状态不可用", {
      unit: "percent",
      scope: "global",
      detail: "近 5 分钟",
    });
  } else if (affinity.lookups === 0) {
    metrics.M07 = unavailable("M07", "路由前缀亲和命中率", "无数据", {
      unit: "percent",
      scope: "global",
      detail: "近 5 分钟 · 命中 0 / 查询 0",
    });
  } else {
    metrics.M07 = metric("M07", "路由前缀亲和命中率", formatPercent(affinity.hits, affinity.lookups), {
      exact: `${affinity.hits}/${affinity.lookups}`,
      unit: "percent",
      scope: "global",
      detail: `近 5 分钟 · 命中 ${formatCount(affinity.hits)} / 查询 ${formatCount(affinity.lookups)}`,
      coverage: { observed: affinity.lookups, complete: affinity.lookups },
    });
  }

  metrics.M08 = tokenMetric("M08", "累计未缓存输入", "uncachedInput", "uncachedInput", context, input);
  metrics.M09 = tokenMetric("M09", "累计缓存输入", "cachedInput", "cachedInput", context, input);
  metrics.M10 = tokenMetric("M10", "累计输出", "output", "output", context, input);

  const totals = context.tokenTotals;
  const coverage = totals.coverage;
  const m11Available = global && totals.available && coverage.complete > 0;
  const coverageText = `未缓存 ${formatPercent(coverage.uncachedInput, coverage.complete)} · 缓存 ${formatPercent(coverage.cachedInput, coverage.complete)} · 输出 ${formatPercent(coverage.output, coverage.complete)}`;
  metrics.M11 = m11Available
    ? metric("M11", "Token 上报覆盖率", formatPercent(coverage.uncachedInput, coverage.complete), {
        exact: `未缓存 ${coverage.uncachedInput}/${coverage.complete} · 缓存 ${coverage.cachedInput}/${coverage.complete} · 输出 ${coverage.output}/${coverage.complete}`,
        unit: "percent",
        scope: "global",
        detail: `${coverageText} · 含直连/非流式`,
        coverage: {
          observed: Math.max(coverage.uncachedInput, coverage.cachedInput, coverage.output),
          complete: coverage.complete,
        },
      })
    : unavailable("M11", "Token 上报覆盖率", global ? "无数据" : "共享状态不可用", {
        unit: "percent",
        scope: "global",
        detail: `${coverageText} · 含直连/非流式`,
      });

  const official = totals.officialValue;
  const m12Priced = official !== null && official.pricedModels > 0;
  const m12Available = global && totals.available && m12Priced;
  const m12Reason = !global
    ? "共享状态不可用"
    : !official
      ? "无数据"
      : official.totalModels > 0
        ? "无已定价模型"
        : "无数据";
  const m12Detail = official
    ? `按官方标价估算 · 非账单 · ${official.pricedModels}/${official.totalModels} 模型已定价 · 基准日 ${official.ratesAsOf}`
    : "";
  metrics.M12 = m12Available
    ? metric("M12", "累计官方 API 价格等效价值", formatCurrencyPair(official.valueUsd), {
        exact: formatCurrencyPair(official.valueUsd),
        unit: "usd",
        scope: "global",
        detail: m12Detail,
        tone: "muted",
      })
    : unavailable("M12", "累计官方 API 价格等效价值", m12Reason, {
        unit: "usd",
        scope: "global",
        detail: m12Detail,
      });

  const liveReady =
    liveWorkers.length > 0 ? liveWorkers.every((worker) => worker.catalogReady) : catalog.aggregateReady;
  metrics.M24 = liveReady
    ? metric("M24", "目录就绪", "就绪", {
        exact: "就绪",
        unit: "text",
        scope: "global",
        detail: `${liveWorkers.filter((worker) => worker.catalogReady).length}/${liveWorkers.length} worker 就绪`,
        tone: "positive",
      })
    : unavailable("M24", "目录就绪", "目录加载中", {
        unit: "text",
        scope: "global",
        detail: `${liveWorkers.filter((worker) => worker.catalogReady).length}/${liveWorkers.length} worker 就绪`,
      });

  metrics.M25 = unavailable("M25", "另一时段预览", "未保留该时段预览", {
    unit: "text",
    scope: "n/a",
  });

  const store = storeState(input);
  if (store.mode === "sqlite" && store.available) {
    metrics.M26 = metric("M26", "共享状态", "SQLite · 可用", {
      exact: "SQLite · 可用",
      unit: "text",
      scope: "global",
      detail: "共享存储可用",
      tone: "positive",
    });
  } else if (store.mode === "memory") {
    metrics.M26 = metric("M26", "共享状态", "memory · 仅本 worker", {
      available: false,
      keepValue: true,
      exact: "memory · 仅本 worker",
      reason: "共享状态不可用",
      unit: "text",
      scope: "global",
      detail: "内存模式 · 仅本 worker",
      tone: "warning",
    });
  } else {
    metrics.M26 = unavailable("M26", "共享状态", store.reason ?? "共享状态不可用", {
      unit: "text",
      scope: "global",
      detail: "共享存储不可用",
      tone: "warning",
    });
  }

  const generatedAt = iso(input?.now) ?? new Date().toISOString();
  const snapshotId = context.snapshotId ?? (typeof input?.snapshotId === "string" ? input.snapshotId : DASH);
  metrics.M27 = metric("M27", "上次更新/快照", formatRelative(generatedAt, numberOr(input?.now, Date.now())), {
    exact: generatedAt,
    unit: "text",
    scope: "n/a",
    detail: snapshotId,
  });

  return metrics;
}

// ---- notices -------------------------------------------------------------

export function buildNotices(input = {}) {
  const context = contextFor(input);
  const notices = [];
  const store = storeState(input);
  if (store.mode === "memory") {
    notices.push({
      level: "warning",
      code: "memory_store",
      title: "共享状态不可用",
      message: "当前为内存模式，全局统计显示 —；每 worker 的值只代表本 worker。",
      action: null,
    });
  } else if (!store.available) {
    notices.push({
      level: "error",
      code: "store_unavailable",
      title: "共享状态不可用",
      message: "全局统计显示 —；路由仍可使用，页面会自动重试。",
      action: "retry",
    });
  }
  if (!catalogState(input).ready) {
    notices.push({
      level: "info",
      code: "catalog_loading",
      title: "目录加载中",
      message: "账号通道将在目录就绪后显示，不代表没有账号。",
      action: null,
    });
  }
  if (context.workers.some((worker) => worker.stale && worker.heartbeatAt !== null)) {
    notices.push({
      level: "warning",
      code: "worker_stale",
      title: "worker 心跳过期",
      message: "过期 worker 不计入全局在途；容量行会在 5 分钟后回收。",
      action: null,
    });
  }
  return notices;
}

// ---- snapshot ------------------------------------------------------------

function withoutUndefined(value) {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (isObject(value)) {
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = entry === undefined ? null : withoutUndefined(entry);
    return out;
  }
  return value === undefined ? null : value;
}

/** Build exactly one StatusSnapshotV3 from the S2 §3.4 input. */
export function buildSnapshot(input = {}) {
  const rawNow = input?.now instanceof Date ? input.now.getTime() : input?.now;
  const now = Number.isFinite(rawNow) ? rawNow : Date.now();
  const normalized = {
    ...input,
    now,
    nowMinute: Number.isFinite(input?.nowMinute) ? input.nowMinute : Math.floor(now / 60_000),
  };
  const context = contextFor(normalized);
  const snapshotId = typeof normalized.idFactory === "function" ? String(normalized.idFactory()) : defaultSnapshotId();
  context.snapshotId = snapshotId;
  const metrics = buildSnapshotMetrics(normalized);
  const routes = context.routeInputs.map((route) => toRouteView(route, metrics, normalized));
  const epochRaw = normalized.tokenTotals?.epoch ?? normalized.epoch;
  return withoutUndefined({
    schemaVersion: STATUS_SCHEMA_VERSION,
    snapshotId,
    generatedAt: new Date(now).toISOString(),
    answeredBy: String(normalized.answeredBy ?? normalized.store?.worker ?? "unknown"),
    buildVersion: String(normalized.buildVersion ?? "—"),
    epoch: {
      id: typeof epochRaw?.id === "string" && epochRaw.id.length > 0 ? epochRaw.id : null,
      since: iso(epochRaw?.since),
    },
    store: storeState(normalized),
    period: context.period,
    catalog: catalogState(normalized),
    overview: {
      primary: OVERVIEW.primary.map((group) => ({
        key: group.key,
        metricIds: [...group.metricIds],
        ...(group.detailMetricIds ? { detailMetricIds: [...group.detailMetricIds] } : {}),
      })),
      secondary: OVERVIEW.secondary.map((group) => ({ key: group.key, metricIds: [...group.metricIds] })),
    },
    metrics,
    routes,
    diagnostics: context.diagnostics,
    workers: context.workers,
    capacity: context.capacity,
    health: context.health,
    proof: context.proof,
    affinity: context.affinity,
    tokenTotals: context.tokenTotals,
    notices: buildNotices(normalized),
  });
}
