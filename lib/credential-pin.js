// Request-scoped credential pins.
//
// A layer that decides WHICH account serves a request (the lazy router, on the
// inbound side) and the layers that touch the outbound fetch (header injection,
// Antigravity account routing) run in the same process but far apart in the
// call stack, with the gateway in between. AsyncLocalStorage carries the
// decision across that gap without relying on the gateway forwarding headers.
//
// A scope is any object with `provider` and, when an account is pinned,
// `credentialId`. Layers that do their own account selection must step aside
// when `activePin(provider)` returns a pin: the pin is the routing decision.

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();

/** Run `fn` with `scope` visible to every fetch it causes. */
export function runPinned(scope, fn) {
  return storage.run(scope, fn);
}

/** The scope of the request being served, if any. */
export function currentPinScope() {
  return storage.getStore();
}

/** The pin for `provider` when the current request is pinned to one of its accounts. */
export function activePin(provider) {
  const scope = storage.getStore();
  return scope?.provider === provider && scope.credentialId !== undefined ? scope : undefined;
}
