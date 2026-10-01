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

globalThis.__OMP_SHIMS_HOST__ = {
  captured,
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
  let attempts = 0;
  const attempt = () => {
    if (captured.has(name)) return;
    let value;
    try {
      value = read();
    } catch {
      value = undefined;
    }
    if (value === undefined || value === null || (typeof value === "function" && value.length === 0 && name !== "x")) {
      attempts += 1;
      if (attempts < 40) setTimeout(attempt, 25);
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
  if ((property === "ModelRegistry" || property === "streamSimple") && descriptor && typeof descriptor.get === "function") {
    const getter = descriptor.get;
    announce(property, () => getter.call(this));
    descriptor.get = function () {
      const value = getter.apply(this, arguments);
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
  return originalDefineProperty.apply(this, arguments);
};
