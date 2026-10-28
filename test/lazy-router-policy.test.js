import { describe, expect, test } from "bun:test";
import { PERIOD } from "../lib/lazy-router/calendar.js";
import { loadPolicyData, RoutePolicy } from "../lib/lazy-router/policy.js";
import { UnitDirectory } from "../lib/lazy-router/units.js";

/**
 * Synthetic accounts in the shape of a typical deployment: several accounts
 * for the tiered providers and the key-based pools, one for most others, and
 * none for a provider whose key lives in models.yml. Ids only fix the order.
 */
const ACCOUNTS = [
  { id: 1, provider: "google-antigravity", tier: "ultra" },
  { id: 2, provider: "cline-pass" },
  { id: 3, provider: "kiro" },
  { id: 4, provider: "commandcode" },
  { id: 5, provider: "openai-codex", tier: "plus" },
  { id: 6, provider: "openai-codex", tier: "pro" },
  { id: 7, provider: "mistral-vibe" },
  { id: 8, provider: "charm-hyper" },
  { id: 9, provider: "google-antigravity", tier: "pro" },
  { id: 10, provider: "google-antigravity", tier: "pro" },
  { id: 11, provider: "google-antigravity", tier: "pro" },
  { id: 12, provider: "qoder-cn" },
  { id: 13, provider: "cline-pass" },
  { id: 14, provider: "nvidia" },
  { id: 15, provider: "opencode-go" },
  { id: 16, provider: "ollama-cloud" },
];

const tierSource = (accounts, version = 1) => ({ version, ready: Promise.resolve(), accounts: () => accounts });
const policy = new RoutePolicy(loadPolicyData());
const units = new UnitDirectory({ tiers: tierSource(ACCOUNTS) });
const TEST_NOW = new Date("2026-10-28T12:00:00+08:00");
const order = (route, period, directory = units, at = TEST_NOW) =>
  policy.candidates(route, period, directory, at).candidates.map((c) => `${c.unit.label} ${c.model}`);

describe("bundled route tables", () => {
  test("the bundled tables name no accounts", () => {
    const text = JSON.stringify(loadPolicyData());
    expect(text).not.toContain("credentialId");
    expect(text).not.toContain('"units"');
    expect(text).not.toMatch(/@/);
  });

  test("peak and off-peak expose identical candidates; periods are performance regimes only", () => {
    for (const route of ["lazy/default", "lazy/task", "rush/default", "rush/task", "weak/default", "weak/task"]) {
      expect(order(route, PERIOD.OFF_PEAK)).toEqual(order(route, PERIOD.PEAK));
    }
  });

  test("lazy/default is high-quality production work without Rush-reserved Terra or GLM Flash", () => {
    const candidates = policy.candidates("lazy/default", PERIOD.PEAK, units, TEST_NOW).candidates;
    expect(candidates.map((c) => c.model)).toEqual([
      "google-antigravity/gemini-4-argon",
      "google-antigravity/claude-opus-5-5",
      "kiro/claude-opus-5-5",
      "opencode-go/deepseek-v4.1-flash",
      "ctyun/glm-5.3-oc",
      "ctyun/deepseek-v4-pro-0813-oc",
    ]);
    expect(candidates.every((c) => typeof c.intelligence === "number" && c.cost > 0)).toBe(true);
    expect(candidates.some((c) => c.model.includes("gpt-6.1-terra"))).toBe(false);
    expect(candidates.some((c) => c.model.includes("glm-5.3-flash"))).toBe(false);
  });

  test("lazy/task uses Gemini Pro, never Ultra, and keeps Rush capacity out of the ordinary pool", () => {
    const candidates = policy.candidates("lazy/task", PERIOD.PEAK, units, TEST_NOW).candidates;
    const gemini = candidates.filter((c) => c.model === "google-antigravity/gemini-3.8-flash");
    expect(gemini.map((c) => c.unit.tier)).toEqual(["pro", "pro", "pro"]);
    expect(candidates.some((c) => c.model === "mistral-vibe/zai-glm-5-3-flash")).toBe(false);
    expect(candidates.some((c) => c.model === "cline-pass/glm-5.3-flash")).toBe(false);
    expect(candidates.some((c) => c.model === "ollama-cloud/glm-5.3-flash")).toBe(false);
  });

  test("Qoder DeepSeek Flash is a temporary zero-cost-like task candidate through October", () => {
    const active = new Date("2026-10-31T23:59:59+08:00");
    const expired = new Date("2026-11-01T00:00:00+08:00");
    const live = policy.candidates("lazy/task", PERIOD.PEAK, units, active).candidates.filter((c) => c.model === "qoder-cn/deepseek-v4-flash");
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ effort: "max", intelligence: 59, cost: 0.01 });
    expect(policy.candidates("lazy/task", PERIOD.PEAK, units, expired).candidates.some((c) => c.model === "qoder-cn/deepseek-v4-flash")).toBe(false);
  });

  test("rush/default is strict Terra medium: Plus first, then Pro", () => {
    expect(policy.selectionOf("rush/default")).toBe("ordered");
    const candidates = policy.candidates("rush/default", PERIOD.PEAK, units).candidates;
    expect(candidates.map((c) => [c.unit.label, c.model, c.effort])).toEqual([
      ["openai-codex:plus#1", "openai-codex/gpt-6.1-terra", "medium"],
      ["openai-codex:pro#1", "openai-codex/gpt-6.1-terra", "medium"],
    ]);
  });

  test("rush/task and rush/vision are strict Mistral -> Cline -> Ollama GLM Flash lanes", () => {
    const expected = [
      "mistral-vibe mistral-vibe/zai-glm-5-3-flash",
      "cline-pass#1 cline-pass/glm-5.3-flash",
      "cline-pass#2 cline-pass/glm-5.3-flash",
      "ollama-cloud ollama-cloud/glm-5.3-flash",
    ];
    expect(policy.selectionOf("rush/task")).toBe("ordered");
    expect(order("rush/task", PERIOD.PEAK)).toEqual(expected);
    const vision = policy.candidates("rush/vision", PERIOD.PEAK, units, TEST_NOW);
    expect(vision.require).toEqual(["text", "image"]);
    expect(vision.candidates.map((c) => c.unit.label + " " + c.model)).toEqual(expected);
    expect(vision.candidates.every((c) => c.effort === "max")).toBe(true);
  });

  test("weak is an independent coordinator/worker family and does not advertise untested vision", () => {
    expect(policy.selectionOf("weak/default")).toBe("ordered");
    expect(order("weak/default", PERIOD.PEAK)).toEqual([
      "ctyun ctyun/glm-5.3-oc",
      "ctyun ctyun/deepseek-v4-pro-0813-oc",
    ]);
    expect(order("weak/task", PERIOD.PEAK)).toEqual([
      "commandcode commandcode/poolside/laguna-s-2.1-free",
      "commandcode commandcode/stealth/glyph-cluster:free",
      "mistral-vibe mistral-vibe/mistral-small-latest",
      "opencode-go opencode-go/iceman-contributor-free",
    ]);
    expect(policy.routeFor("weak/vision")).toBeUndefined();
    expect(policy.routeFor("lazy/weak")).toBeUndefined();
    expect(policy.contextWindowOf("weak/task")).toBe(250000);
    expect(policy.maxOutputTokensOf("weak/task")).toBe(32768);
  });

  test("lazy/vision derives from task, requires images, and appends Argon Ultra as a durable fallback", () => {
    const { candidates, require } = policy.candidates("lazy/vision", PERIOD.PEAK, units, TEST_NOW);
    const task = policy.candidates("lazy/task", PERIOD.PEAK, units, TEST_NOW).candidates;
    expect(require).toEqual(["text", "image"]);
    expect(candidates.slice(0, task.length)).toEqual(task);
    expect(candidates.at(-1)).toMatchObject({ model: "google-antigravity/gemini-4-argon", intelligence: 63.1, effort: "medium" });
    expect(candidates.at(-1).unit.tier).toBe("ultra");
  });

  test("routeFor accepts all configured virtual families and rejects direct/unknown ids", () => {
    for (const id of ["lazy/default", "lazy/task", "lazy/vision", "rush/default", "rush/task", "rush/vision", "weak/default", "weak/task"]) {
      expect(policy.routeFor(id)).toBe(id);
      expect(policy.modelIdOf(id)).toBe(id);
    }
    expect(policy.routeFor("weak/vision")).toBeUndefined();
    expect(policy.routeFor("kiro/claude-opus-5-5")).toBeUndefined();
  });
});

describe("concurrency limits", () => {
  const unit = (provider, tier) => ({ provider, tier, key: provider, label: provider });

  test("ollama-cloud and charm-hyper have measured safe limits", () => {
    expect(policy.maxInFlight(unit("ollama-cloud"))).toBe(3);
    expect(policy.maxInFlight(unit("charm-hyper"))).toBe(2);
    for (const provider of ["cline-pass", "openai-codex", "kiro", "commandcode", "google-antigravity", "nvidia"]) {
      expect(policy.maxInFlight(unit(provider, "pro"))).toBe(0);
    }
  });

  test("a provider:tier limit overrides the provider's, and 0 means unlimited", () => {
    const data = loadPolicyData();
    data.maxInFlight = { $comment: "x", p: 2, "p:gold": 5, q: 0 };
    const limits = new RoutePolicy(data);
    expect(limits.maxInFlight(unit("p", "gold"))).toBe(5);
    expect(limits.maxInFlight(unit("p", "silver"))).toBe(2);
    expect(limits.maxInFlight(unit("q"))).toBe(0);
  });

  test("a negative or fractional limit is rejected when the table loads", () => {
    for (const bad of [-1, 1.5, "3"]) {
      const data = loadPolicyData();
      data.maxInFlight = { p: bad };
      expect(() => new RoutePolicy(data)).toThrow(/maxInFlight/);
    }
  });
});

describe("fixed effort levels", () => {
  test("the Qoder trait correction records only effort levels its endpoint accepts", () => {
    const traits = policy.modelTraits["qoder-cn/qwen3.8-flash"];
    expect(traits.efforts).toEqual(["low", "medium"]);
  });

  test("an unknown effort is rejected when the table loads", () => {
    const data = loadPolicyData();
    data.routes["lazy/task"].periods.peak = [{ model: "qoder-cn/qwen3.8-flash", effort: "turbo" }];
    expect(() => new RoutePolicy(data).candidates("task", PERIOD.PEAK, units)).toThrow(/unknown effort "turbo"/);
  });
});

describe("runtime expansion", () => {
  test("a newly added account joins its tier without any table change", () => {
    const more = [...ACCOUNTS, { id: 17, provider: "openai-codex", tier: "plus" }];
    const codex = order("rush/default", PERIOD.PEAK, new UnitDirectory({ tiers: tierSource(more, 2) })).filter((line) =>
      line.startsWith("openai-codex"),
    );
    expect(codex).toEqual([
      "openai-codex:plus#1 openai-codex/gpt-6.1-terra",
      "openai-codex:plus#2 openai-codex/gpt-6.1-terra",
      "openai-codex:pro#1 openai-codex/gpt-6.1-terra",
    ]);
  });

  test("an account with an unknown tier is matched only by entries without a tier", () => {
    const unknown = ACCOUNTS.map((a) => (a.id === 9 ? { id: 9, provider: a.provider } : a));
    const directory = new UnitDirectory({ tiers: tierSource(unknown) });
    expect(order("lazy/default", PERIOD.PEAK, directory).filter((l) => l.includes("gemini-4"))).not.toContain(
      "google-antigravity#1 google-antigravity/gemini-4-argon",
    );
    expect(order("lazy/task", PERIOD.PEAK, directory).filter((l) => l.includes("gemini-3.8"))).toEqual([
      "google-antigravity:pro#1 google-antigravity/gemini-3.8-flash",
      "google-antigravity:pro#2 google-antigravity/gemini-3.8-flash",
    ]);
  });

  test("expansions are cached per unit version", () => {
    const tiers = tierSource(ACCOUNTS);
    const directory = new UnitDirectory({ tiers });
    const first = policy.candidates("rush/default", PERIOD.PEAK, directory).candidates;
    expect(policy.candidates("rush/default", PERIOD.PEAK, directory).candidates).toBe(first);
    tiers.version = 2;
    tiers.accounts = () => ACCOUNTS.filter((a) => a.id !== 5);
    const next = order("rush/default", PERIOD.PEAK, directory);
    expect(next[0]).toEndWith(" openai-codex/gpt-6.1-terra");
  });
});

describe("validation", () => {
  const base = () => ({ routes: { r: { periods: { peak: [{ model: "p/m" }] } } } });

  test("entries that name accounts are rejected", () => {
    const data = base();
    data.routes.r.periods.peak[0].units = ["a"];
    expect(() => new RoutePolicy(data)).toThrow(/select them by "tier"/);
  });

  test("models must be provider-qualified and tiers non-empty", () => {
    const bare = base();
    bare.routes.r.periods.peak[0].model = "m";
    expect(() => new RoutePolicy(bare)).toThrow(/provider\/model/);
    const empty = base();
    empty.routes.r.periods.peak[0].tier = [];
    expect(() => new RoutePolicy(empty)).toThrow(/tier/);
  });

  test("route-level context and output limits must be positive integers", () => {
    for (const [field, value] of [["contextWindow", 0], ["contextWindow", 1.5], ["maxOutputTokens", -1]]) {
      const data = base();
      data.routes.r[field] = value;
      expect(() => new RoutePolicy(data)).toThrow(new RegExp(field));
    }
  });

  test("invalid activeUntil timestamps are rejected", () => {
    const data = base();
    data.routes.r.periods.peak[0].activeUntil = "not-a-date";
    expect(() => new RoutePolicy(data)).toThrow(/activeUntil/);
  });

  test("sameAs cycles are rejected at load time", () => {
    const cycle = base();
    cycle.routes.r.periods = { peak: [{ sameAs: "offPeak" }], offPeak: [{ sameAs: "peak" }] };
    expect(() => new RoutePolicy(cycle)).toThrow(/cycle/);
  });
});

describe("model catalog", () => {
  test("one registry listing serves every lookup within the snapshot TTL", async () => {
    const { ModelCatalog, CATALOG_SNAPSHOT_TTL_MS } = await import("../lib/lazy-router/catalog.js");
    let clock = 0;
    let listings = 0;
    const registry = {
      getAll: () => {
        listings++;
        return [{ provider: "p", id: "m", contextWindow: 1, input: ["text"] }];
      },
    };
    const catalog = new ModelCatalog({ now: () => clock });
    catalog.attach(registry);
    for (let i = 0; i < 200; i++) catalog.find(i % 2 ? "p/m" : "p/missing");
    expect(listings).toBe(1);
    expect(catalog.find("p/m")).toBeDefined();
    expect(catalog.find("p/missing")).toBeUndefined();
    clock = CATALOG_SNAPSHOT_TTL_MS;
    catalog.find("p/m");
    expect(listings).toBe(2);
  });
});
