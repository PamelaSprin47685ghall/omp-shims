// Import legacy minute buckets and weak global history into cyclic speed statistics.
// No request bodies, credentials or full per-request samples are loaded or stored.
// Run only while the production gateway is stopped to avoid racing its file writer.
import { existsSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { CyclicSpeed, periodicBasis } from "../lib/lazy-router/cyclic-speed.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const LEGACY_VERSION = 1;
const HOUR_COUNT = 24;
const HISTORICAL_WEIGHT_CAP = 8;
const LOG_LOWER = Math.log(1);
const LOG_UPPER = Math.log(3_600_000);

const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clampLog = (value) => Math.min(LOG_UPPER, Math.max(LOG_LOWER, value));
const decayFactor = (now, at) => Math.pow(0.5, Math.max(0, now - at) / DAY);

function validSnapshot(snapshot) {
  return snapshot && snapshot.version === LEGACY_VERSION && Number.isFinite(snapshot.savedAt);
}

/** Recover usable minute aggregates without counting a shared minute twice. */
export function collectLegacy(snapshots, { now, cutoff }) {
  const buckets = new Map();
  const history = new Map();
  for (const { source, snapshot, current = false } of snapshots) {
    if (!validSnapshot(snapshot)) throw new Error("invalid legacy performance snapshot: " + source);
    for (const models of Object.values(snapshot.periods ?? {})) {
      for (const [model, entries] of Object.entries(models ?? {})) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const minute = entry.minute;
          if (!Number.isInteger(minute)) continue;
          const at = minute * 60_000 + 30_000;
          if (at > now || (current && at >= cutoff)) continue;
          const count = asNumber(entry.totalCount);
          const imputed = asNumber(entry.imputedCount);
          const logSum = Number(entry.totalLog);
          if (!(count > 0 && imputed >= 0 && imputed <= count && Number.isFinite(logSum))) continue;
          const reliable = count - imputed;
          if (reliable <= 0) continue;
          const key = model + "\u0000" + minute;
          const previous = buckets.get(key);
          if (!previous || previous.savedAt < snapshot.savedAt) {
            buckets.set(key, {
              model, at, savedAt: snapshot.savedAt, source,
              original: count,
              imputed,
              // Legacy minute sums mix imputed completions with genuine ones.
              // Recovering individual values is impossible; downweight the
              // entire minute by its known-complete share.
              effective: reliable * decayFactor(now, at),
              logMean: clampLog(logSum / count),
            });
          }
        }
      }
    }
    for (const [period, models] of Object.entries(snapshot.history ?? {})) {
      for (const [model, h] of Object.entries(models ?? {})) {
        const weight = asNumber(h.weight);
        const updatedAt = asNumber(h.updatedAt);
        const logMean = Number(h.meanLog);
        if (!(weight > 0 && updatedAt > 0 && Number.isFinite(logMean) && updatedAt <= now + 60_000)) continue;
        const key = model + "\u0000" + period;
        const previous = history.get(key);
        if (!previous || previous.savedAt < snapshot.savedAt) {
          history.set(key, {
            model, source, savedAt: snapshot.savedAt,
            logMean: clampLog(logMean),
            weight: weight * decayFactor(now, updatedAt),
          });
        }
      }
    }
  }
  const histByModel = new Map();
  for (const row of history.values()) {
    if (!histByModel.has(row.model)) histByModel.set(row.model, []);
    histByModel.get(row.model).push(row);
  }
  const priors = [];
  for (const [model, evidence] of histByModel) {
    const valid = evidence.filter((h) => h.weight > 1e-5);
    const sum = valid.reduce((n, h) => n + h.weight, 0);
    if (!sum) continue;
    // The old period means have no timestamped observations.
    // Represent only a low-weight constant prior, never inferred hourly peaks.
    priors.push({
      model,
      logMean: valid.reduce((n, h) => n + h.weight * h.logMean, 0) / sum,
      weight: Math.min(HISTORICAL_WEIGHT_CAP, sum),
    });
  }
  return { buckets: [...buckets.values()], priors };
}

/** Add a fractional sufficient-statistics observation at one UTC timestamp. */
function addStats(stats, at, y, w) {
  if (!(w > 0)) return;
  const basis = periodicBasis(at);
  for (const [i, vi] of basis) {
    stats.rhs[i] += w * vi * y;
    for (const [j, vj] of basis) stats.gram[i][j] += w * vi * vj;
  }
  stats.weight += w;
}

export function applyLegacy(speed, evidence, now) {
  const touched = new Set();
  const statsOf = (model) => {
    const stats = speed.state(model);
    if (!touched.has(model)) {
      speed.decay(stats, now);
      touched.add(model);
    }
    return stats;
  };
  const summary = new Map();
  const report = (model) => {
    if (!summary.has(model)) {
      summary.set(model, { historicalWeight: 0, bucketWeight: 0, bucketCount: 0, imputedDiscounted: 0 });
    }
    return summary.get(model);
  };
  for (const row of evidence.buckets) {
    const stats = statsOf(row.model);
    addStats(stats, row.at, row.logMean, row.effective);
    stats.completed += row.effective;
    const r = report(row.model);
    r.bucketWeight += row.effective;
    r.bucketCount += row.original;
    r.imputedDiscounted += row.imputed;
  }
  for (const row of evidence.priors) {
    const stats = statsOf(row.model);
    for (let hour = 0; hour < HOUR_COUNT; hour += 1) {
      // Uniformly spread summary information. No fictional diurnal shape.
      addStats(stats, hour * HOUR + HOUR / 2, row.logMean, row.weight / HOUR_COUNT);
    }
    report(row.model).historicalWeight += row.weight;
  }
  for (const model of touched) speed.cache.delete(model);
  return summary;
}

function parseArguments(args) {
  const options = {};
  const legacy = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--legacy") legacy.push(args[++i]);
    else if (["--state", "--output", "--cutoff", "--marker"].includes(args[i])) options[args[i].slice(2)] = args[++i];
    else throw new Error("unknown argument " + args[i]);
  }
  if (!options.state || !options.output || !options.cutoff || legacy.length === 0) {
    throw new Error("usage: bun scripts/seed-cyclic-speed.js --state PATH --output PATH --cutoff ISO --legacy PATH [--legacy PATH...] [--marker PATH]");
  }
  const cutoff = Date.parse(options.cutoff);
  if (!Number.isFinite(cutoff)) throw new Error("invalid cutoff");
  return { ...options, legacy, cutoff };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.marker && existsSync(options.marker)) {
    console.log("SKIPPED_ALREADY_SEEDED", options.marker);
    return;
  }
  const now = Date.now();
  const snapshots = options.legacy.map((file) => {
    const snapshot = JSON.parse(readFileSync(file, "utf8"));
    return { source: file.split("/").at(-1), snapshot, current: file.includes("current") };
  });
  if (options.state !== options.output) copyFileSync(options.state, options.output);
  const speed = new CyclicSpeed({ statePath: options.output, now: () => now });
  const before = new Map([...speed.models].map(([model, stats]) =>
    [model, stats.weight * decayFactor(now, stats.updatedAt || now)]));
  const evidence = collectLegacy(snapshots, { now, cutoff: options.cutoff });
  const summary = applyLegacy(speed, evidence, now);
  speed.flush();
  const rows = [...summary].map(([model, counts]) => ({
    model,
    ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round(v * 1000) / 1000])),
    liveBefore: Math.round((before.get(model) ?? 0) * 1000) / 1000,
    totalAfter: Math.round((speed.models.get(model)?.weight ?? 0) * 1000) / 1000,
  })).sort((a, b) => a.model.localeCompare(b.model));
  const report = {
    version: 1,
    seededAt: new Date(now).toISOString(),
    cutoff: new Date(options.cutoff).toISOString(),
    sourceFiles: snapshots.map((s) => s.source),
    reconstructedMinutes: evidence.buckets.length,
    models: rows,
  };
  if (options.marker) {
    writeFileSync(options.marker, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    chmodSync(options.marker, 0o600);
  }
  console.log("LEGACY_SEED_COMPLETE", JSON.stringify({
    models: rows.length, minutes: evidence.buckets.length,
    totalEffectiveBucketWeight: Math.round(rows.reduce((n, r) => n + r.bucketWeight, 0) * 100) / 100,
    historicalPriorWeight: Math.round(rows.reduce((n, r) => n + r.historicalWeight, 0) * 100) / 100,
  }));
  for (const r of rows) console.log("MODEL",r.model,"raw",r.bucketCount,"effective",r.bucketWeight,"prior",r.historicalWeight,"before",r.liveBefore,"after",r.totalAfter);
}

if (import.meta.main) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
