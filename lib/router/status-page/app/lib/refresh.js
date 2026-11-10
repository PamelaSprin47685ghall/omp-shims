export const REFRESH_MS = 10_000;
export const TIMEOUT_MS = 8_000;
export const MAX_BACKOFF_MS = 120_000;

function jitter() {
  return 1 + (Math.random() * 0.4 - 0.2);
}

function hasRequiredShape(next) {
  if (!next || typeof next !== "object") return false;
  if (next.schemaVersion !== 3) return false;
  if (typeof next.snapshotId !== "string" || next.snapshotId.length === 0) return false;
  if (typeof next.generatedAt !== "string" || !Number.isFinite(Date.parse(next.generatedAt))) return false;
  if (!Array.isArray(next.routes)) return false;
  if (!next.metrics || typeof next.metrics !== "object") return false;
  if (next.metrics.M03?.id !== "M03") return false;
  for (const key of [
    "store",
    "epoch",
    "period",
    "catalog",
    "overview",
    "metrics",
    "diagnostics",
    "capacity",
    "health",
    "proof",
    "affinity",
    "tokenTotals",
  ]) {
    if (!next[key] || typeof next[key] !== "object") return false;
  }
  if (!Array.isArray(next.workers) || !Array.isArray(next.notices)) return false;
  return true;
}

/**
 * One status request per cycle. Applies only a complete, same-build snapshot.
 * All browser globals are read inside functions so the module stays import-safe.
 */
export function startRefresh({ initialSnapshot, statusPath, onSnapshot, onConnection, onVersionMismatch, onBusy }) {
  if (!initialSnapshot || typeof initialSnapshot !== "object") {
    throw new TypeError("startRefresh requires initialSnapshot");
  }
  if (typeof statusPath !== "string" || !statusPath.startsWith("/")) {
    throw new TypeError("startRefresh requires an absolute statusPath");
  }

  let timer = null;
  let controller = null;
  let inFlight = false;
  let failures = 0;
  let stopped = false;
  let retryRequested = false;
  let currentId = initialSnapshot.snapshotId;
  let currentGeneratedAt = initialSnapshot.generatedAt;

  function schedule(delay) {
    clearTimer();
    if (stopped) return;
    timer = setTimeout(
      () => {
        timer = null;
        void cycle();
      },
      Math.max(0, delay),
    );
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function lastGoodAt() {
    return currentGeneratedAt;
  }

  function stop() {
    stopped = true;
    clearTimer();
    removeListeners();
    if (controller) controller.abort();
    controller = null;
  }

  function mismatch(next) {
    stop();
    onVersionMismatch?.(next);
  }

  async function cycle() {
    if (stopped || inFlight) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      onConnection?.({ state: "offline", lastGoodAt: lastGoodAt(), error: null });
      schedule(REFRESH_MS);
      return;
    }

    inFlight = true;
    onBusy?.(true);
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(statusPath, {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json" },
        signal: activeController.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();

      if (next?.schemaVersion !== 3 || next?.buildVersion !== initialSnapshot.buildVersion) {
        mismatch(next);
        return;
      }
      if (!hasRequiredShape(next)) {
        mismatch(next);
        return;
      }

      failures = 0;
      if (next.snapshotId !== currentId) {
        currentId = next.snapshotId;
        currentGeneratedAt = next.generatedAt;
        onSnapshot?.(next);
      }
      onConnection?.({ state: "live", lastGoodAt: currentGeneratedAt, error: null });
      schedule(REFRESH_MS);
    } catch (error) {
      if (stopped) return;
      failures += 1;
      const timedOut = error?.name === "AbortError";
      onConnection?.({
        state: timedOut ? "timeout" : "stale",
        lastGoodAt: lastGoodAt(),
        error: timedOut ? "刷新超时" : "刷新暂时失败",
      });
      const delay = Math.min(MAX_BACKOFF_MS, REFRESH_MS * 2 ** (failures - 1)) * jitter();
      schedule(delay);
    } finally {
      clearTimeout(timeout);
      if (controller === activeController) controller = null;
      inFlight = false;
      onBusy?.(false);
      if (retryRequested && !stopped) {
        retryRequested = false;
        schedule(0);
      }
    }
  }

  function onVisibility() {
    if (stopped) return;
    if (document.visibilityState === "hidden") {
      clearTimer();
      return;
    }
    schedule(0);
  }

  function onOnline() {
    if (stopped) return;
    failures = 0;
    schedule(0);
  }

  function onOffline() {
    if (stopped) return;
    clearTimer();
    onConnection?.({ state: "offline", lastGoodAt: lastGoodAt(), error: null });
  }

  function addListeners() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
    }
  }

  function removeListeners() {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    }
  }

  function retryNow() {
    if (stopped) return;
    clearTimer();
    if (inFlight) {
      retryRequested = true;
      controller?.abort();
      return;
    }
    failures = 0;
    schedule(0);
  }

  addListeners();
  schedule(REFRESH_MS);

  return { retryNow, stop };
}
