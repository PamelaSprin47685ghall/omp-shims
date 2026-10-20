import { describe, expect, test } from "bun:test";
import { isGatewayProcess } from "../features/lazy-router.js";
import { activePin } from "../lib/credential-pin.js";
import { CredentialStore } from "../lib/lazy-router/credentials.js";
import { decodeJwtPayload, normalizeTier, TIER_RESOLVERS, TierDirectory } from "../lib/lazy-router/tiers.js";
import { buildUnits, UnitDirectory } from "../lib/lazy-router/units.js";

/** An unsigned JWT with the given payload (synthetic; providers verify their own). */
const jwt = (payload) => `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const codexToken = (plan) => jwt({ "https://api.openai.com/auth": { chatgpt_plan_type: plan } });

/** A credential store over an in-memory row list the test can edit. */
function storeOf(rows) {
  let now = 0;
  const store = new CredentialStore({
    dbPath: "/nonexistent",
    brokerUrl: "http://broker.test",
    brokerTokenPath: "/nonexistent",
    now: () => now,
    readRows: () => rows,
  });
  return { store, advance: (ms) => (now += ms) };
}

const row = (id, provider, data) => ({ id, provider, data: JSON.stringify(data) });
const RELOAD_MS = 30_000;

describe("tier names", () => {
  test("normalizeTier folds provider spellings to plain names", () => {
    expect(normalizeTier("g1-ultra-tier")).toBe("ultra");
    expect(normalizeTier("g1-pro-tier")).toBe("pro");
    expect(normalizeTier("Plus")).toBe("plus");
    expect(normalizeTier("free-tier")).toBe("free");
    expect(normalizeTier("")).toBeUndefined();
    expect(normalizeTier(undefined)).toBeUndefined();
  });

  test("decodeJwtPayload reads the claims and tolerates junk", () => {
    expect(decodeJwtPayload(jwt({ a: 1 }))).toEqual({ a: 1 });
    expect(decodeJwtPayload("not-a-jwt")).toBeUndefined();
    expect(decodeJwtPayload(undefined)).toBeUndefined();
  });
});

describe("tier resolvers", () => {
  test("openai-codex reads the ChatGPT plan claim of the access token", async () => {
    expect(await TIER_RESOLVERS["openai-codex"].resolve({ secret: codexToken("pro") })).toBe("pro");
    expect(await TIER_RESOLVERS["openai-codex"].resolve({ secret: "opaque" })).toBeUndefined();
  });

  test("google-antigravity reads the paid tier from Cloud Code Assist", async () => {
    const seen = [];
    const fetch = async (url, init) => {
      seen.push({ url, auth: init.headers.authorization, agent: init.headers["user-agent"] });
      return Response.json({ currentTier: { id: "free-tier" }, paidTier: { id: "g1-ultra-tier" } });
    };
    expect(await TIER_RESOLVERS["google-antigravity"].resolve({ secret: "tok" }, { fetch })).toBe("g1-ultra-tier");
    expect(seen[0].url).toEndWith("/v1internal:loadCodeAssist");
    expect(seen[0].auth).toBe("Bearer tok");
    expect(seen[0].agent).toBe("antigravity"); // without it the tiers are omitted
  });
});

describe("TierDirectory", () => {
  const resolvers = {
    // A stand-in for a network resolver: tier comes from the row, failures are scripted.
    "google-antigravity": {
      freshToken: true,
      resolve: async (credential, { fetch }) => (await fetch(credential.secret)).tier,
    },
    "openai-codex": TIER_RESOLVERS["openai-codex"],
  };

  test("resolves tiers, pins network lookups to their account, and logs an unknown tier once", async () => {
    const { store } = storeOf([
      row(1, "google-antigravity", { access: "ultra", expires: 1e15 }),
      row(2, "google-antigravity", { access: "none", expires: 1e15 }),
      row(3, "openai-codex", { access: codexToken("plus"), expires: 1e15 }),
      row(4, "kiro", { access: "x", expires: 1e15 }),
    ]);
    const pins = [];
    const events = [];
    const tiers = new TierDirectory({
      credentials: store,
      resolvers,
      fetch: async (secret) => {
        pins.push(activePin("google-antigravity")?.credentialId);
        return { tier: secret === "none" ? undefined : secret };
      },
      emit: (event, detail) => events.push({ event, ...detail }),
    });
    await tiers.refresh();
    expect(tiers.accounts()).toEqual([
      { id: 1, provider: "google-antigravity", tier: "ultra" },
      { id: 2, provider: "google-antigravity", tier: undefined },
      { id: 3, provider: "openai-codex", tier: "plus" },
      { id: 4, provider: "kiro", tier: undefined },
    ]);
    expect(pins.sort()).toEqual([1, 2]);
    await tiers.refresh();
    // Only the tiered provider's unresolved account is reported, and only once.
    expect(events.filter((e) => e.event === "tier-unknown")).toEqual([
      expect.objectContaining({ provider: "google-antigravity" }),
    ]);
    expect(JSON.stringify(events)).not.toContain('"id"');
  });

  test("picks up added and removed accounts and bumps the version", async () => {
    const rows = [row(1, "openai-codex", { access: codexToken("plus"), expires: 1e15 })];
    const { store, advance } = storeOf(rows);
    const tiers = new TierDirectory({ credentials: store, resolvers });
    await tiers.refresh();
    const first = tiers.version;

    rows.push(row(2, "openai-codex", { access: codexToken("pro"), expires: 1e15 }));
    advance(RELOAD_MS);
    await tiers.refresh();
    expect(tiers.version).toBeGreaterThan(first);
    expect(tiers.accounts().map((a) => a.tier)).toEqual(["plus", "pro"]);

    rows.shift();
    advance(RELOAD_MS);
    await tiers.refresh();
    expect(tiers.accounts().map((a) => a.id)).toEqual([2]);
  });

  test("a failed lookup keeps the tier already known", async () => {
    let fail = false;
    const { store } = storeOf([row(1, "google-antigravity", { access: "pro", expires: 1e15 })]);
    let clock = 0;
    const tiers = new TierDirectory({
      credentials: store,
      resolvers,
      refreshMs: 10,
      now: () => clock,
      fetch: async (secret) => {
        if (fail) throw new Error("offline");
        return { tier: secret };
      },
    });
    await tiers.refresh();
    fail = true;
    clock = 100;
    await tiers.refresh();
    expect(tiers.tierOf(1)).toBe("pro");
  });
});

describe("units", () => {
  test("a provider with several accounts gets pinned units labelled by tier and age", () => {
    const units = buildUnits([
      { id: 9, provider: "a", tier: "pro" },
      { id: 3, provider: "a", tier: "pro" },
      { id: 5, provider: "a" },
    ]).get("a");
    expect(units.map((u) => [u.label, u.credentialId])).toEqual([
      ["a:pro#1", 3],
      ["a#1", 5],
      ["a:pro#2", 9],
    ]);
  });

  test("one account, or none in the store, is a single unit on the gateway's own credential", () => {
    const directory = new UnitDirectory({
      tiers: { version: 1, accounts: () => [{ id: 1, provider: "solo", tier: "max" }] },
    });
    expect(directory.select("solo", undefined)).toEqual([
      { label: "solo", provider: "solo", key: "solo", tier: "max" },
    ]);
    expect(directory.select("solo", ["max"])).toHaveLength(1);
    expect(directory.select("keyless", undefined)).toEqual([{ label: "keyless", provider: "keyless", key: "keyless" }]);
    expect(directory.select("keyless", ["pro"])).toEqual([]);
  });
});

test("the router installs only in the auth-gateway process", () => {
  expect(isGatewayProcess(["bun", "omp", "auth-gateway", "serve"])).toBe(true);
  expect(isGatewayProcess(["bun", "omp", "auth-broker", "serve"])).toBe(false);
  expect(isGatewayProcess(["bun", "omp"])).toBe(false);
});
