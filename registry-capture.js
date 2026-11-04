// Host export capture, split out so it runs before anything else.
//
// This file must stay free of static `import` statements: ES module imports are
// hoisted and evaluated before any other statement, so a hook installed after an
// import would miss the definitions it needs to observe. Bun loads --preload
// files in order, so listing this one first is enough.
//
// It records classes and functions the bundle exports lazily through getters.
// Consumers subscribe and receive each value as soon as it exists, with a short
// retry to get past the bundle's temporal dead zone.

const captured = new Map();
const observers = [];
const pendingGetters = new Map();

globalThis.__OMP_SHIMS_HOST__ = {
  captured,
  resolve: resolveHostExport,
  /** Subscribe to a host export, now and whenever it is (re)defined. */
  observe(name, observer) {
    observers.push({ name, observer });
    if (captured.has(name)) {
      try {
        observer(captured.get(name));
      } catch {}
    }
  },
};

/** Poll until `read()` yields a usable value, then announce it. */
function announce(name, read) {
  const attempt = () => {
    if (captured.has(name)) return;
    let value;
    try {
      value = read();
    } catch {
      value = undefined;
    }
    // A resolved zero-arity function is usable. Only an undefined/null read means the lazy getter is still in TDZ.
    if (value === undefined || value === null) {
      // Host getters stay in TDZ until their module finishes evaluating, which can
      // be well after the first request. Keep polling; a resolved value stops it.
      setTimeout(attempt, 25);
      return;
    }
    captured.set(name, value);
    for (const entry of observers) {
      if (entry.name !== name) continue;
      try {
        entry.observer(value);
      } catch {}
    }
  };
  setTimeout(attempt, 0);
}

const originalDefineProperty = Object.defineProperty;
Object.defineProperty = function (target, property, descriptor) {
  // The bundle exports these through lazy getters whose backing bindings are
  // still in TDZ when the export runs; announce them once they resolve.
  if (
    (property === "ModelRegistry" || property === "streamSimple" || property === "registerOAuthProvider") &&
    descriptor &&
    typeof descriptor.get === "function"
  ) {
    const getter = descriptor.get;
    pendingGetters.set(property, () => getter.call(target));

    announce(property, () => getter.call(target));
    descriptor.get = function (...args) {
      const value = getter.apply(this, args);
      if (!captured.has(property) && value !== undefined && value !== null) {
        captured.set(property, value);
        for (const entry of observers) {
          if (entry.name !== property) continue;
          try {
            entry.observer(value);
          } catch {}
        }
      }
      return value;
    };
  }
  return originalDefineProperty.call(this, target, property, descriptor);
};

/** Read a host export now, even if the lazy getter resolved after polling started. */
function resolveHostExport(name) {
  if (captured.has(name)) return captured.get(name);
  const read = pendingGetters.get(name);
  if (!read) return undefined;
  try {
    const value = read();
    if (value !== undefined && value !== null) captured.set(name, value);
    return value;
  } catch {
    return undefined;
  }
}
