// Host export capture, loaded as the first --preload file.
//
// This file has no static imports. Bun evaluates the imports of an ES module
// before any statement in the file, so an import here would delay the hook.
//
// The host exports three values through lazy getters. Their backing bindings
// stay in the temporal dead zone (TDZ) while the host graph evaluates. This
// file wraps Object.defineProperty, polls the captured getters with bounded
// backoff, and restores Object.defineProperty when the job is done. Every
// timer calls unref(): polling must never keep a short-lived CLI process
// alive.

(() => {
  const TARGETS = ["ModelRegistry", "streamSimple", "registerOAuthProvider"];
  const TARGET_SET = new Set(TARGETS);
  const FIRST_DELAY_MS = 10;
  const MAX_DELAY_MS = 250;
  const MAX_WINDOW_MS = 30_000;

  // A second load (two --preload flags, for example) must not wrap the hook twice.
  if (globalThis.__OMP_SHIMS_HOST__?.restore) return;

  const originalDefineProperty = Object.defineProperty;
  const wrappedGetters = new WeakSet();
  const captured = new Map();
  /** name -> { name, target, getter, delay, timer } */
  const pending = new Map();
  /** name -> Set<observer> */
  const observers = new Map();
  const startedAt = Date.now();
  let restored = false;

  const deadline = setTimeout(() => restore(), MAX_WINDOW_MS);
  deadline.unref?.();

  /** Stop the poll timer of one pending entry. Keep the entry for resolve(). */
  function stopPolling(entry) {
    if (!entry?.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  function stopAllPolling() {
    for (const entry of pending.values()) stopPolling(entry);
  }

  /**
   * Record a resolved export and tell its observers.
   * The first value wins: a lazy binding resolves once.
   */
  function publish(name, value) {
    if (captured.has(name)) return;
    captured.set(name, value);
    const entry = pending.get(name);
    if (entry) {
      stopPolling(entry);
      pending.delete(name);
    }
    for (const observer of observers.get(name) ?? []) {
      try {
        observer(value);
      } catch {}
    }
    if (TARGETS.every((target) => captured.has(target))) restore();
  }

  /** Read one pending getter now. Returns undefined while the binding is in TDZ. */
  function readPending(entry) {
    try {
      const value = entry.getter.call(entry.target);
      return value === undefined || value === null ? undefined : value;
    } catch {
      return undefined;
    }
  }

  function schedule(entry) {
    if (restored) return;
    const timer = setTimeout(() => {
      entry.timer = null;
      poll(entry);
    }, entry.delay);
    timer.unref?.();
    entry.timer = timer;
  }

  function poll(entry) {
    if (restored || captured.has(entry.name)) return;
    if (Date.now() - startedAt >= MAX_WINDOW_MS) {
      restore();
      return;
    }
    const value = readPending(entry);
    if (value !== undefined) {
      publish(entry.name, value);
      return;
    }
    entry.delay = Math.min(MAX_DELAY_MS, entry.delay * 2);
    schedule(entry);
  }

  /**
   * Stop polling and put Object.defineProperty back when nothing replaced it.
   * Already wrapped getters stay in place: a late read still resolves the export.
   */
  function restore() {
    if (restored) return true;
    restored = true;
    clearTimeout(deadline);
    stopAllPolling();
    if (Object.defineProperty === patchedDefineProperty) Object.defineProperty = originalDefineProperty;
    return true;
  }

  /** Subscribe to one export. Returns an unsubscribe function. */
  function observe(name, observer) {
    if (typeof observer !== "function") return () => {};
    let set = observers.get(name);
    if (!set) {
      set = new Set();
      observers.set(name, set);
    }
    set.add(observer);
    if (captured.has(name)) {
      try {
        observer(captured.get(name));
      } catch {}
    }
    return () => {
      set.delete(observer);
      if (set.size === 0 && observers.get(name) === set) observers.delete(name);
    };
  }

  /** Read an export now, from the captured value or from its pending getter. */
  function resolve(name) {
    if (captured.has(name)) return captured.get(name);
    const entry = pending.get(name);
    if (!entry) return undefined;
    const value = readPending(entry);
    if (value !== undefined) publish(name, value);
    return value;
  }

  function patchedDefineProperty(target, property, descriptor) {
    if (TARGET_SET.has(property) && descriptor && typeof descriptor === "object") {
      if (typeof descriptor.get === "function") {
        const getter = descriptor.get;
        if (!wrappedGetters.has(getter)) {
          const wrapped = function (...args) {
            const value = getter.apply(this, args);
            if (value !== undefined && value !== null) publish(property, value);
            return value;
          };
          wrappedGetters.add(wrapped);
          descriptor = { ...descriptor, get: wrapped };
        }
        const previous = pending.get(property);
        if (previous) stopPolling(previous);
        const entry = { name: property, target, getter: descriptor.get, delay: FIRST_DELAY_MS, timer: null };
        pending.set(property, entry);
        if (!restored) schedule(entry);
      } else if ("value" in descriptor) {
        const value = descriptor.value;
        if (value !== undefined && value !== null) publish(property, value);
      }
    }
    return Reflect.apply(originalDefineProperty, this, [target, property, descriptor]);
  }

  Object.defineProperty = patchedDefineProperty;

  globalThis.__OMP_SHIMS_HOST__ = {
    captured,
    observe,
    resolve,
    restore,
  };
})();
