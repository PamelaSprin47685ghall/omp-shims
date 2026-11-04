import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createLazyRouter } from "../features/lazy-router.js";
import { tempDir } from "./helpers.js";

// The router build path wires a dozen collaborators, several of them shared
// SQLite stores. A reference that is used before its declaration fails only at
// install time, where the loader catches it and the gateway silently serves
// every lazy model as unknown. Constructing the whole wiring is the cheapest
// way to keep that from shipping again.
describe("lazy router wiring", () => {
  test("builds every collaborator and answers a status view", () => {
    const dir = tempDir("omp-wiring-");
    const config = {
      stateDbPath: join(dir, "state.sqlite"),
      healthDbPath: join(dir, "health.sqlite"),
      tokenTotalsPath: join(dir, "totals.sqlite"),
      perfStatePath: join(dir, "perf.json"),
      speedStatePath: join(dir, "speed.json"),
      concurrencyProofStatePath: join(dir, "proof.json"),
      out: join(dir, "events.jsonl"),
      gatewayTokenPath: join(dir, "gateway.token"),
      brokerTokenPath: join(dir, "broker.token"),
      agentDbPath: join(dir, "agent.db"),
      probeIntervalMs: 60_000,
    };
    const { router, dispatcher, catalog, tiers, credentials } = createLazyRouter(config, { log: () => {} });
    expect(typeof router.serve).toBe("function");
    expect(typeof dispatcher.run).toBe("function");
    expect(typeof catalog.find).toBe("function");
    expect(typeof tiers.refresh).toBe("function");
    expect(typeof credentials.list).toBe("function");

    const view = router.statusView();
    expect(view.period === "peak" || view.period === "offPeak").toBe(true);
    expect(Array.isArray(view.units)).toBe(true);
    expect(Object.keys(view.routes).length).toBeGreaterThan(0);
  });
});
