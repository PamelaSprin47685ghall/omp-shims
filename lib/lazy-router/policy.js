// Route policy: the declarative route tables, validated and expanded.
//
// The tables (routes.json, overridable from shims.json) name models and account
// tiers, never accounts. This module validates them and expands them into
// ordered candidate lists against the accounts of the moment (see units.js); it
// knows nothing about health, capabilities or the clock.

import { readFileSync } from "node:fs";
import { splitModelRef } from "./catalog.js";
import { EFFORT_POLICY, isEffortLevel } from "./effort.js";

/** Prefix of the advertised model ids: "lazy/default", "lazy/task", ... */
export const LAZY_PREFIX = "lazy/";

/**
 * @typedef {{provider: string, model: string, effort: string, intelligence: string, tiers?: string[], activeUntil?: number}} Entry
 * @typedef {{unit: import("./units.js").Unit, model: string, effort: string}} Candidate
 */

/** The bundled policy data. */
export function loadPolicyData(path = new URL("./routes.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export class RoutePolicy {
  /** @param {any} data parsed routes.json */
  constructor(data) {
    this.contextWindow = data.contextWindow;
    this.maxOutputTokens = data.maxOutputTokens;
    this.peakWindows = data.peakWindows;
    this.modelTraits = data.modelTraits ?? {};
    this.routes = data.routes ?? {};
    this.limits = parseLimits(data.maxInFlight ?? {});
    // Expand everything once, so a broken table fails at install time, not on a request.
    this.table = new Map();
    for (const name of Object.keys(this.routes)) this.table.set(name, this.#expandRoute(name, []));
    /** Expansions per unit directory, each tagged with the directory version it was built for. */
    this.expanded = new WeakMap();
  }

  /** Route names, in table order. */
  get routeNames() {
    return [...this.table.keys()];
  }

  /** "lazy/task" → "task"; undefined for anything that is not a lazy model. */
  routeFor(model) {
    if (typeof model !== "string" || !model.startsWith(LAZY_PREFIX)) return undefined;
    const name = model.slice(LAZY_PREFIX.length);
    return this.table.has(name) ? name : undefined;
  }

  /**
   * Concurrent upstream requests a unit may have open; 0 = unlimited.
   * "provider:tier" overrides "provider".
   * @param {import("./units.js").Unit} unit
   */
  maxInFlight(unit) {
    return this.limits.get(`${unit.provider}:${unit.tier}`) ?? this.limits.get(unit.provider) ?? 0;
  }

  /** Input modalities a route promises to accept. */
  inputOf(name) {
    return this.routes[name]?.input ?? ["text"];
  }

  /**
   * The route's entries for a period, before they meet any account.
   * @returns {{entries: Entry[], require: string[]}}
   */
  entries(name, period) {
    const periods = this.table.get(name);
    if (!periods) throw new Error(`unknown lazy route "${name}"`);
    return { entries: periods.lists[period] ?? [], require: periods.require };
  }

  /**
   * Ordered candidates for a route in a period, expanded against the accounts
   * enabled right now. `require` lists the input modalities each candidate must
   * support (derived routes, image requests).
   * @param {string} name
   * @param {string} period
   * @param {import("./units.js").UnitDirectory} units
   * @returns {{candidates: Candidate[], require: string[]}}
   */
  candidates(name, period, units, at = new Date()) {
    const { entries, require } = this.entries(name, period);
    if (!this.expanded.has(units)) this.expanded.set(units, new Map());
    const cache = this.expanded.get(units);
    const cacheKey = `${name} ${period}`;
    const cached = cache.get(cacheKey);
    let candidates;
    if (cached?.version === units.version) candidates = cached.candidates;
    else {
      candidates = entries.flatMap((entry) =>
        units.select(entry.provider, entry.tiers).map((unit) => ({
          unit,
          model: entry.model,
          effort: entry.effort,
          intelligence: entry.intelligence,
          ...(entry.activeUntil ? { activeUntil: entry.activeUntil } : {}),
        })),
      );
      cache.set(cacheKey, { version: units.version, candidates });
    }
    const atMs = at instanceof Date ? at.getTime() : Number(at);
    const hasExpiry = candidates.some((candidate) => candidate.activeUntil);
    const active = hasExpiry
      ? candidates.filter((candidate) => !candidate.activeUntil || atMs < candidate.activeUntil)
      : candidates;
    return { candidates: active, require };
  }

  #expandRoute(name, seen) {
    if (seen.includes(name)) throw new Error(`lazy route cycle: ${[...seen, name].join(" → ")}`);
    const route = this.routes[name];
    if (!route) throw new Error(`unknown lazy route "${name}"`);

    if (route.derive) {
      // A derived route reuses the source lists; its own `input` becomes a requirement.
      // Optional `append` entries are route-specific fallbacks added after every source period.
      const source = this.#expandRoute(route.derive.from, [...seen, name]);
      if (!Array.isArray(route.derive.append ?? [])) {
        throw new Error(`lazy route "${name}": derive.append must be an array`);
      }
      const append = (route.derive.append ?? []).map((entry) => parseEntry(name, entry));
      const excludeModels = route.derive.excludeModels ?? [];
      if (!Array.isArray(excludeModels) || excludeModels.some((model) => typeof model !== "string" || model === "")) {
        throw new Error(`lazy route "${name}": derive.excludeModels must be an array of model refs`);
      }
      const excluded = new Set(excludeModels);
      const lists = Object.fromEntries(
        Object.entries(source.lists).map(([period, entries]) => [
          period,
          [...entries.filter((entry) => !excluded.has(entry.model)), ...append],
        ]),
      );
      return { lists, require: route.input ?? ["text"] };
    }

    const lists = {};
    for (const period of Object.keys(route.periods ?? {})) {
      lists[period] = this.#expandPeriod(name, route.periods, period, []);
    }
    return { lists, require: [] };
  }

  #expandPeriod(route, periods, period, seen) {
    if (seen.includes(period)) throw new Error(`lazy route "${route}" period cycle: ${[...seen, period].join(" → ")}`);
    const entries = periods[period];
    if (!Array.isArray(entries)) throw new Error(`lazy route "${route}" has no period "${period}"`);
    return entries.flatMap((entry) =>
      entry.sameAs ? this.#expandPeriod(route, periods, entry.sameAs, [...seen, period]) : [parseEntry(route, entry)],
    );
  }
}

/**
 * Validate the `maxInFlight` table: "provider" or "provider:tier" → a
 * non-negative integer ("$comment" keys are documentation).
 * @returns {Map<string, number>}
 */
function parseLimits(table) {
  const limits = new Map();
  for (const [key, value] of Object.entries(table)) {
    if (key.startsWith("$")) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`lazy-router maxInFlight: "${key}" must be a non-negative integer, got ${JSON.stringify(value)}`);
    }
    if (value > 0) limits.set(key, value);
  }
  return limits;
}

/**
 * Validate one table entry: a provider-qualified model, an optional tier or
 * ordered tier list, and an effort policy: "capped", "high" (the default) or a
 * fixed level such as "low".
 * @returns {Entry}
 */
function parseEntry(route, entry) {
  const { provider, id } = splitModelRef(entry.model ?? "");
  if (!provider || !id) throw new Error(`lazy route "${route}": "${entry.model}" is not a provider/model reference`);
  if ("units" in entry || "credentialId" in entry) {
    throw new Error(`lazy route "${route}": ${entry.model} names accounts; select them by "tier" instead`);
  }
  const tiers = entry.tier === undefined ? undefined : [entry.tier].flat();
  if (tiers && (tiers.length === 0 || tiers.some((tier) => typeof tier !== "string" || tier === ""))) {
    throw new Error(`lazy route "${route}": ${entry.model} has an empty or non-string tier`);
  }
  const effort = entry.effort ?? EFFORT_POLICY.HIGH;
  if (effort !== EFFORT_POLICY.CAPPED && !isEffortLevel(effort)) {
    throw new Error(`lazy route "${route}": ${entry.model} has unknown effort "${effort}"`);
  }
  const intelligence = entry.intelligence ?? "medium";
  if (intelligence !== "medium" && intelligence !== "excellent") throw new Error("invalid intelligence tier");
  let activeUntil;
  if (entry.activeUntil !== undefined) {
    if (typeof entry.activeUntil !== "string" || !Number.isFinite(Date.parse(entry.activeUntil))) {
      throw new Error(`lazy route "${route}": ${entry.model} has invalid activeUntil`);
    }
    activeUntil = Date.parse(entry.activeUntil);
  }
  return Object.freeze({
    provider,
    model: entry.model,
    effort,
    intelligence,
    ...(tiers ? { tiers: tiers.map((tier) => tier.toLowerCase()) } : {}),
    ...(activeUntil ? { activeUntil } : {}),
  });
}
