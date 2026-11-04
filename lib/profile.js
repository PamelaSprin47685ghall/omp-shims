// Opt-in CPU attribution for the request path.
//
// The gateway serves every request on one JS thread, so per-request CPU is the
// throughput ceiling. `OMP_SHIMS_PROFILE=1` wraps the synchronous stages of a
// request and prints one aggregate line per window:
//
//   [omp-shims] profile {"windowMs":30000,"counters":{"requests":184,...},
//     "phases":{"canonical":{"n":184,"cpuMs":...,"wallMs":...},...}}
//
// `cpuMs` is process CPU (user+system) for the stage, `wallMs` is elapsed time;
// they differ where the stage blocks on I/O. Chunk-level notes use wall time
// only: two getrusage calls per SSE event would cost more than the event.
// Disabled, `span` is a single predictable branch and `note` is a no-op.

export const enabled = process.env.OMP_SHIMS_PROFILE === "1";
const INTERVAL_MS = Number.parseInt(process.env.OMP_SHIMS_PROFILE_INTERVAL_MS ?? "30000", 10) || 30_000;

/** name → {n, cpuMs, wallMs, maxMs} */
const phases = new Map();
const counters = new Map();
let windowStart = Date.now();
let lastCpu = process.cpuUsage();

function slot(map, name) {
  let entry = map.get(name);
  if (!entry) {
    entry = map === phases ? { n: 0, cpuMs: 0, wallMs: 0, maxMs: 0 } : { n: 0 };
    map.set(name, entry);
  }
  return entry;
}

/** Add a count to a named counter. */
export function count(name, n = 1) {
  if (!enabled) return;
  slot(counters, name).n += n;
}

/** Add one observed wall duration in milliseconds to a named phase. */
export function note(name, ms) {
  if (!enabled) return;
  const entry = slot(phases, name);
  entry.n += 1;
  entry.wallMs += ms;
  if (ms > entry.maxMs) entry.maxMs = ms;
}

/** Run `fn` synchronously, attributing its CPU and wall time to `name`. */
export function span(name, fn) {
  if (!enabled) return fn();
  const cpu0 = process.cpuUsage();
  const wall0 = performance.now();
  try {
    return fn();
  } finally {
    const cpu = process.cpuUsage(cpu0);
    const ms = performance.now() - wall0;
    const entry = slot(phases, name);
    entry.n += 1;
    entry.cpuMs += (cpu.user + cpu.system) / 1000;
    entry.wallMs += ms;
    if (ms > entry.maxMs) entry.maxMs = ms;
  }
}

/** Round to one decimal; totals are read by operators, not by code. */
const r1 = (n) => Math.round(n * 10) / 10;

function flush() {
  if (!enabled) return;
  const now = Date.now();
  const cpu = process.cpuUsage(lastCpu);
  lastCpu = process.cpuUsage();
  const processCpuMs = (cpu.user + cpu.system) / 1000;
  const report = {
    windowMs: now - windowStart,
    processCpuMs: r1(processCpuMs),
    requests: counters.get("requests")?.n ?? 0,
    cpuMsPerRequest: r1(processCpuMs / Math.max(1, counters.get("requests")?.n ?? 1)),
    counters: Object.fromEntries([...counters].map(([name, entry]) => [name, entry.n])),
    phases: Object.fromEntries([...phases].map(([name, entry]) => [name, {
      n: entry.n,
      cpuMs: r1(entry.cpuMs),
      wallMs: r1(entry.wallMs),
      maxMs: r1(entry.maxMs),
    }])),
  };
  phases.clear();
  counters.clear();
  windowStart = now;
  // One synchronous line per window: never on the per-request path.
  console.error(`[omp-shims] profile ${JSON.stringify(report)}`);
}

if (enabled) {
  const timer = setInterval(flush, INTERVAL_MS);
  timer.unref?.();
}
