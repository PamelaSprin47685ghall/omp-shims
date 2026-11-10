import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const registryUrl = new URL("../registry-capture.mjs", import.meta.url).href;
const directory = mkdtempSync(join(tmpdir(), "omp-shims-registry-v2-"));
let childCount = 0;

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * Run one registry-capture scenario in a fresh Bun process.
 * A subprocess is the only honest way to prove that the polling timers do not
 * keep a short-lived CLI process alive, and it keeps the global hook out of
 * the test runner process.
 */
function runChild(source, timeout = 5000) {
  const file = join(directory, `child-${childCount++}.mjs`);
  writeFileSync(file, source);
  const started = Date.now();
  const result = spawnSync(process.execPath, [file, registryUrl], { encoding: "utf8", timeout });
  return { ...result, elapsed: Date.now() - started };
}

function expectSuccess(result) {
  if (result.error || result.status !== 0) {
    throw new Error(
      `child failed: status=${result.status} error=${result.error?.message ?? "none"}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  expect(result.stdout).toContain("OK");
}

describe("registry-capture", () => {
  test("polls TDZ getters, captures all three exports and restores defineProperty", () => {
    const source = `
const original = Object.defineProperty;
await import(process.argv[2]);
if (Object.defineProperty === original) throw new Error("defineProperty was not hooked");

const host = globalThis.__OMP_SHIMS_HOST__;
if (!(host.captured instanceof Map)) throw new Error("captured is not a Map");

// A non-target property keeps its descriptor and value.
const other = {};
const otherGetter = () => 42;
Object.defineProperty(other, "unrelated", { configurable: true, get: otherGetter });
if (other.unrelated !== 42) throw new Error("non-target getter broke");

let modelRegistry;
let streamSimple;
let registerOAuthProvider;
const exportsObject = {};
Object.defineProperty(exportsObject, "ModelRegistry", { configurable: true, get: () => modelRegistry });
Object.defineProperty(exportsObject, "streamSimple", { configurable: true, get: () => streamSimple });
Object.defineProperty(exportsObject, "registerOAuthProvider", { configurable: true, get: () => registerOAuthProvider });

const seen = [];
host.observe("registerOAuthProvider", (value) => seen.push(value));

// The values stay in TDZ for a few poll intervals. The poller must survive.
setTimeout(() => {
  modelRegistry = class ModelRegistry {};
  streamSimple = () => "stream";
  registerOAuthProvider = () => "oauth";
}, 35);

const deadline = Date.now() + 2500;
while (host.captured.size < 3) {
  if (Date.now() > deadline) throw new Error("capture timed out: " + host.captured.size);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

if (host.resolve("ModelRegistry") !== modelRegistry) throw new Error("resolve mismatch");
if (Object.defineProperty !== original) throw new Error("defineProperty was not restored");
if (seen.length !== 1 || seen[0] !== registerOAuthProvider) throw new Error("observer mismatch");

// A second load is inert.
await import(process.argv[2] + "?second=1");
if (globalThis.__OMP_SHIMS_HOST__ !== host) throw new Error("second load replaced the host");
if (Object.defineProperty !== original) throw new Error("second load re-hooked defineProperty");

console.log("OK");
`;
    expectSuccess(runChild(source));
  });

  test("restore() before a value exists still captures a later read", () => {
    const source = `
const original = Object.defineProperty;
await import(process.argv[2]);
const host = globalThis.__OMP_SHIMS_HOST__;

let late;
const namespace = {};
Object.defineProperty(namespace, "streamSimple", { configurable: true, get: () => late });
if (Object.defineProperty === original) throw new Error("defineProperty was not hooked");

host.restore();
if (Object.defineProperty !== original) throw new Error("defineProperty was not restored");

// The wrapped getter stays installed, so a late resolution is still recorded.
late = (value) => "late:" + value;
if (namespace.streamSimple("x") !== "late:x") throw new Error("wrapped getter was lost");
if (host.captured.get("streamSimple") !== late) throw new Error("late capture missed");
if (host.resolve("streamSimple") !== late) throw new Error("late resolve missed");

console.log("OK");
`;
    expectSuccess(runChild(source));
  });

  test("polling timers are unref'd, so a short-lived process exits", () => {
    const source = `
const original = Object.defineProperty;
await import(process.argv[2]);
if (Object.defineProperty === original) throw new Error("defineProperty was not hooked");

// A getter that never resolves keeps the poll loop armed.
let never;
const namespace = {};
Object.defineProperty(namespace, "ModelRegistry", { configurable: true, get: () => never });

// Let the first poll fire and schedule its longer backoff timer.
await new Promise((resolve) => setTimeout(resolve, 80));
console.log("OK");
`;
    const result = runChild(source, 3000);
    expectSuccess(result);
    // A ref'd 30s deadline timer would hit the 3s spawn timeout instead.
    expect(result.elapsed).toBeLessThan(2500);
  });
});
