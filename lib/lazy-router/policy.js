// Route policy: the declarative route tables, validated and expanded.
//
// The tables (routes.json, overridable from shims.json) name units and models
// only. This module turns them into ordered candidate lists; it knows nothing
// about health, capabilities or the clock, so it stays a pure function of data.

import { readFileSync } from "node:fs";
import { splitModelRef } from "./catalog.js";
import { EFFORT_POLICY } from "./effort.js";

/** Prefix of the advertised model ids: "lazy/default", "lazy/task", ... */
export const LAZY_PREFIX = "lazy/";

/**
 * @typedef {{label: string, provider: string, credentialId?: number}} Unit
 * @typedef {{unit: Unit, model: string, effort: string}} Candidate
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
    this.units = buildUnits(data.units ?? {});
    this.groups = data.groups ?? {};
    this.routes = data.routes ?? {};
    // Expand everything once, so a broken table fails at install time, not on a request.
    this.table = new Map();
    for (const name of Object.keys(this.routes)) this.table.set(name, this.#expandRoute(name, []));
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

  /** Input modalities a route promises to accept. */
  inputOf(name) {
    return this.routes[name]?.input ?? ["text"];
  }

  /**
   * Ordered candidates for a route in a period. `require` lists the input
   * modalities each candidate must support (derived routes, image requests).
   * @returns {{candidates: Candidate[], require: string[]}}
   */
  candidates(name, period) {
    const periods = this.table.get(name);
    if (!periods) throw new Error(`unknown lazy route "${name}"`);
    return { candidates: periods.lists[period] ?? [], require: periods.require };
  }

  /** Every unit label in use, for the status view. */
  get unitLabels() {
    return [...this.units.keys()];
  }

  #expandRoute(name, seen) {
    if (seen.includes(name)) throw new Error(`lazy route cycle: ${[...seen, name].join(" → ")}`);
    const route = this.routes[name];
    if (!route) throw new Error(`unknown lazy route "${name}"`);

    if (route.derive) {
      // A derived route reuses the source lists; its own `input` becomes a requirement.
      const source = this.#expandRoute(route.derive.from, [...seen, name]);
      return { lists: source.lists, require: route.input ?? ["text"] };
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
      entry.sameAs
        ? this.#expandPeriod(route, periods, entry.sameAs, [...seen, period])
        : this.#expandEntry(route, entry),
    );
  }

  #expandEntry(route, entry) {
    const labels = typeof entry.units === "string" ? this.groups[entry.units] : entry.units;
    if (!Array.isArray(labels) || labels.length === 0) {
      throw new Error(`lazy route "${route}": entry for ${entry.model} names no units`);
    }
    const { provider } = splitModelRef(entry.model ?? "");
    const effort = entry.effort === EFFORT_POLICY.CAPPED ? EFFORT_POLICY.CAPPED : EFFORT_POLICY.HIGH;
    return labels.map((label) => {
      const unit = this.units.get(label);
      if (!unit) throw new Error(`lazy route "${route}": unknown unit "${label}"`);
      if (unit.provider !== provider) {
        throw new Error(`lazy route "${route}": unit ${label} (${unit.provider}) cannot serve ${entry.model}`);
      }
      return { unit, model: entry.model, effort };
    });
  }
}

function buildUnits(raw) {
  const units = new Map();
  for (const [label, spec] of Object.entries(raw)) {
    if (!spec?.provider) throw new Error(`lazy unit "${label}" has no provider`);
    units.set(
      label,
      Object.freeze({
        label,
        provider: spec.provider,
        ...(Number.isInteger(spec.credentialId) ? { credentialId: spec.credentialId } : {}),
      }),
    );
  }
  return units;
}
