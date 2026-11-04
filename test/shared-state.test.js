import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SharedStateStore } from "../lib/lazy-router/shared-state.js";
import { InFlightTracker } from "../lib/lazy-router/capacity.js";
import { AdmissionControl } from "../lib/lazy-router/admission.js";
import { ModelPerf } from "../lib/lazy-router/perf.js";
import { CyclicSpeed } from "../lib/lazy-router/cyclic-speed.js";
import { ProviderConcurrencyProof } from "../lib/lazy-router/provider-concurrency-proof.js";
import { PrefixAffinity } from "../lib/lazy-router/affinity.js";
import { tempDir } from "./helpers.js";

function stores(options = {}) {
  const path = join(tempDir("omp-state-"), "state.sqlite");
  const a = new SharedStateStore({ path, worker: "a", ...options });
  const b = new SharedStateStore({ path, worker: "b", ...options });
  return [a, b];
}

describe("shared capacity", () => {
  test("one limit across workers", () => {
    const [a, b] = stores();
    const release = a.acquire("u", 1);
    expect(release).toBeFunction();
    expect(b.acquire("u", 1)).toBeUndefined();
    release();
    release(); // idempotent
    expect(b.acquire("u", 1)).toBeFunction();
    a.close();
    b.close();
  });

  test("two trackers enforce the same unit limit", () => {
    const [a, b] = stores();
    const unit = { key: "unit", provider: "p", tier: null };
    const limitOf = () => 1;
    const first = new InFlightTracker({ limitOf, shared: a });
    const second = new InFlightTracker({ limitOf, shared: b });
    const slot = first.slot(unit);
    expect(slot.granted).toBe(true);
    b.refresh();
    expect(second.hasRoom(unit)).toBe(false);
    // Even with a stale mirror the reservation itself is authoritative.
    expect(second.slot(unit).granted).toBe(false);
    slot.releaseAll();
    expect(second.slot(unit).granted).toBe(true);
    a.close();
    b.close();
  });

  test("a dead worker's slots are reaped", async () => {
    const [a, b] = stores({ staleMs: 0 });
    const release = a.acquire("u", 1);
    expect(release).toBeFunction();
    await Bun.sleep(3);
    b.upkeep();
    expect(b.acquire("u", 1)).toBeFunction();
    a.close();
    b.close();
  });
});

describe("shared admission", () => {
  test("samples from every worker count toward the threshold", () => {
    const [a, b] = stores();
    const first = new AdmissionControl({ shared: a });
    const second = new AdmissionControl({ shared: b });
    // Four samples, capacity 2: the second-best share is the threshold.
    first.evaluate("u", 0.9, 2);
    first.evaluate("u", 0.1, 2);
    second.evaluate("u", 0.8, 2);
    const last = second.evaluate("u", 0.2, 2);
    expect(last.threshold).toBe(0.8);
    expect(last.admitted).toBe(false);
    expect(first.windowCount("u")).toBe(4);
    a.close();
    b.close();
  });
});

describe("shared account cooldowns", () => {
  test("a cooldown written by one worker is visible to another", () => {
    const [a, b] = stores();
    const until = Date.now() + 60_000;
    a.setCooldown("User@Example.com", until, "429");
    expect(b.cooldowns().get("User@Example.com")).toBe(until);
    a.close();
    b.close();
  });
});

describe("shared perf window", () => {
  test("a sample recorded by one worker shows up in another's window", () => {
    const [a, b] = stores();
    let clock = 1_800_000_000_000;
    const perfA = new ModelPerf({ shared: a, now: () => clock });
    const perfB = new ModelPerf({ shared: b, now: () => clock });
    perfA.record("p/a", { ttftMs: 400, outputTokens: 20, generationMs: 1_000, totalMs: 2_000 }, "peak");
    perfB.refresh();
    expect(perfB.view("peak")["p/a"]).toMatchObject({ ttftMs: 400, samples: 1 });
    expect(perfB.routingView("peak")["p/a"].totalMs).toBe(2_000);
    a.close();
    b.close();
  });
});

describe("shared cyclic speed", () => {
  test("both workers' evidence feeds one posterior", () => {
    const [a, b] = stores();
    const clock = 1_800_000_000_000;
    const speedA = new CyclicSpeed({ shared: a, now: () => clock });
    const speedB = new CyclicSpeed({ shared: b, now: () => clock });
    speedA.observe("p/a", 1_000);
    speedA.flush();
    speedB.observe("p/a", 3_000);
    speedB.flush();
    speedA.refresh();
    speedB.refresh();
    const viewA = speedA.view(clock)["p/a"];
    const viewB = speedB.view(clock)["p/a"];
    expect(viewA).toBeDefined();
    expect(viewA.weight).toBeCloseTo(viewB.weight, 5);
    expect(viewA.completed).toBeCloseTo(2, 5);
    a.close();
    b.close();
  });
});

describe("shared concurrency proof", () => {
  test("overlap is counted across workers, not per worker", () => {
    const [a, b] = stores();
    let clock = 1_800_000_000_000;
    const first = new ProviderConcurrencyProof({ shared: a, now: () => clock });
    const second = new ProviderConcurrencyProof({ shared: b, now: () => clock });
    // Four attempts overlap in time, two started by each worker.
    const a1 = first.begin("p/model");
    const a2 = first.begin("p/model");
    const b1 = second.begin("p/model");
    const b2 = second.begin("p/model");
    a1.firstToken();
    a2.firstToken();
    b1.firstToken();
    b2.firstToken();
    clock += 100;
    a1.finish(true);
    a2.finish(true);
    b1.finish(true);
    b2.finish(true);
    first.refresh();
    second.refresh();
    expect(first.max("p/model")).toBe(4);
    expect(second.max("p/model")).toBe(4);
    a.close();
    b.close();
  });

  test("time before the first token does not count as concurrency", () => {
    const [a, b] = stores();
    let clock = 1_800_000_000_000;
    const first = new ProviderConcurrencyProof({ shared: a, now: () => clock });
    const second = new ProviderConcurrencyProof({ shared: b, now: () => clock });
    // Three requests are open, but only one is emitting tokens at a time:
    // the others are still waiting for their first token.
    const slow = first.begin("p/model");
    const one = second.begin("p/model");
    one.firstToken();
    clock += 1_000;
    one.finish(true);
    clock += 1_000;
    slow.firstToken();
    clock += 1_000;
    slow.finish(true);
    first.refresh();
    expect(first.max("p/model")).toBe(1);
    a.close();
    b.close();
  });

  test("a failed attempt does not count toward the proof", () => {
    const [a, b] = stores();
    let clock = 1_800_000_000_000;
    const first = new ProviderConcurrencyProof({ shared: a, now: () => clock });
    const second = new ProviderConcurrencyProof({ shared: b, now: () => clock });
    const a1 = first.begin("p/model");
    const b1 = second.begin("p/model");
    const b2 = second.begin("p/model");
    a1.firstToken();
    b1.firstToken();
    b2.firstToken();
    clock += 50;
    a1.finish(true);
    b1.finish(false);
    b2.finish(true);
    first.refresh();
    expect(first.max("p/model")).toBe(2);
    a.close();
    b.close();
  });
});

describe("shared affinity", () => {
  test("a conversation recorded by one worker matches in another", () => {
    const [a, b] = stores();
    const affA = new PrefixAffinity({ shared: a });
    const affB = new PrefixAffinity({ shared: b });
    const transcript = Buffer.from("conversation ".repeat(2_000));
    affA.record(transcript, "unit#1");
    affB.refreshShared();
    // B has never seen this conversation locally; the shared row answers.
    const match = affB.lookup(transcript);
    expect(match.best).toMatchObject({ unitKey: "unit#1" });
    a.close();
    b.close();
  });
});
