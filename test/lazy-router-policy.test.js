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
const order = (route, period, directory = units) =>
  policy.candidates(route, period, directory).candidates.map((c) => `${c.unit.label} ${c.model}`);

describe("bundled route tables", () => {
  test("the bundled tables name no accounts", () => {
    const text = JSON.stringify(loadPolicyData());
    expect(text).not.toContain("credentialId");
    expect(text).not.toContain('"units"');
    expect(text).not.toMatch(/@/);
  });

  test("peak default follows the priority list, tiers in the listed order, accounts oldest first", () => {
    expect(order("default", PERIOD.PEAK)).toEqual([
      "openai-codex:plus#1 openai-codex/gpt-6.1-terra",
      "kiro kiro/claude-opus-5-5",
      "google-antigravity:ultra#1 google-antigravity/claude-opus-5-5",
      "google-antigravity:ultra#1 google-antigravity/gemini-4-argon",
      "openai-codex:pro#1 openai-codex/gpt-6.1-terra",
      "mistral-vibe mistral-vibe/zai-glm-5-3-flash",
      "ollama-cloud ollama-cloud/glm-5.3-flash",
      "cline-pass#1 cline-pass/glm-5.3-flash",
      "cline-pass#2 cline-pass/glm-5.3-flash",
      "qoder-cn qoder-cn/qwen3.8-flash",
      "charm-hyper charm-hyper/qwen3.8-flash",
      "ctyun ctyun/deepseek-v4-pro-0813-oc",
      "ctyun ctyun/glm-5.3-oc",
    ]);
  });

  test("off-peak default is opencode-go first, then the whole peak list", () => {
    const offPeak = order("default", PERIOD.OFF_PEAK);
    expect(offPeak[0]).toBe("opencode-go opencode-go/deepseek-v4.1-flash");
    expect(policy.candidates("default", PERIOD.OFF_PEAK, units).candidates[0].intelligence).toBe("excellent");
    expect(offPeak.slice(1)).toEqual(order("default", PERIOD.PEAK));
  });

  test("capped entries are exactly the configured excellent front-runners", () => {
    const capped = policy
      .candidates("default", PERIOD.PEAK, units)
      .candidates.filter((c) => c.effort === "capped")
      .map((c) => c.unit.label);
    expect(capped).toEqual(["openai-codex:plus#1", "kiro", "google-antigravity:ultra#1", "google-antigravity:ultra#1", "openai-codex:pro#1"]);
  });

  test("task lists differ by period; gemini-3.8-flash drains Pro accounts before Ultra", () => {
    expect(order("task", PERIOD.PEAK).slice(0, 5)).toEqual([
      "google-antigravity:pro#1 google-antigravity/gemini-3.8-flash",
      "google-antigravity:pro#2 google-antigravity/gemini-3.8-flash",
      "google-antigravity:pro#3 google-antigravity/gemini-3.8-flash",
      "google-antigravity:ultra#1 google-antigravity/gemini-3.8-flash",
      "qoder-cn qoder-cn/qwen3.8-flash",
    ]);
    expect(order("task", PERIOD.OFF_PEAK).slice(0, 3)).toEqual([
      "ctyun ctyun/deepseek-v4-pro-0813-oc",
      "ctyun ctyun/glm-5.3-oc",
      "google-antigravity:pro#1 google-antigravity/gemini-3.8-flash",
    ]);
  });

  test("antigravity opus 5.5 is an excellent capped Ultra candidate in every default period", () => {
    for (const period of [PERIOD.PEAK, PERIOD.OFF_PEAK]) {
      const matches = policy
        .candidates("default", period, units)
        .candidates.filter((c) => c.model === "google-antigravity/claude-opus-5-5");
      expect(matches).toHaveLength(1);
      expect(matches[0].unit.label).toBe("google-antigravity:ultra#1");
      expect(matches[0].intelligence).toBe("excellent");
      expect(matches[0].effort).toBe("capped");
    }
  });

  test("gemini-4 is served by Ultra accounts only, in every period", () => {
    for (const period of [PERIOD.PEAK, PERIOD.OFF_PEAK]) {
      const tiers = policy
        .candidates("default", period, units)
        .candidates.filter((c) => c.model.includes("gemini-4"))
        .map((c) => c.unit.tier);
      expect(tiers).toEqual(["ultra"]);
    }
  });

  test("vision derives from task, requires image input, and appends durable image fallbacks", () => {
    const { candidates, require } = policy.candidates("vision", PERIOD.PEAK, units);
    const task = policy.candidates("task", PERIOD.PEAK, units).candidates;
    expect(require).toEqual(["text", "image"]);
    expect(candidates.slice(0, task.length)).toEqual(task);
    expect(candidates.slice(task.length).map((c) => `${c.unit.label} ${c.model}`)).toEqual([
      "openai-codex:plus#1 openai-codex/gpt-6.1-terra",
      "openai-codex:pro#1 openai-codex/gpt-6.1-terra",
      "google-antigravity:ultra#1 google-antigravity/gemini-4-argon",
    ]);
  });

  test("routeFor accepts only lazy models with a table", () => {
    expect(policy.routeFor("lazy/task")).toBe("task");
    expect(policy.routeFor("lazy/nope")).toBeUndefined();
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
    data.routes.task.periods.peak = [{ model: "qoder-cn/qwen3.8-flash", effort: "turbo" }];
    expect(() => new RoutePolicy(data).candidates("task", PERIOD.PEAK, units)).toThrow(/unknown effort "turbo"/);
  });
});

describe("runtime expansion", () => {
  test("a newly added account joins its tier without any table change", () => {
    const more = [...ACCOUNTS, { id: 17, provider: "openai-codex", tier: "plus" }];
    const codex = order("default", PERIOD.PEAK, new UnitDirectory({ tiers: tierSource(more, 2) })).filter((line) =>
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
    expect(order("default", PERIOD.PEAK, directory).filter((l) => l.includes("gemini-4"))).not.toContain(
      "google-antigravity#1 google-antigravity/gemini-4-argon",
    );
    expect(order("task", PERIOD.PEAK, directory).filter((l) => l.includes("gemini-3.8"))).toEqual([
      "google-antigravity:pro#1 google-antigravity/gemini-3.8-flash",
      "google-antigravity:pro#2 google-antigravity/gemini-3.8-flash",
      "google-antigravity:ultra#1 google-antigravity/gemini-3.8-flash",
    ]);
  });

  test("expansions are cached per unit version", () => {
    const tiers = tierSource(ACCOUNTS);
    const directory = new UnitDirectory({ tiers });
    const first = policy.candidates("default", PERIOD.PEAK, directory).candidates;
    expect(policy.candidates("default", PERIOD.PEAK, directory).candidates).toBe(first);
    tiers.version = 2;
    tiers.accounts = () => ACCOUNTS.filter((a) => a.id !== 5);
    const next = order("default", PERIOD.PEAK, directory);
    expect(next[0]).toBe("kiro kiro/claude-opus-5-5");
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
