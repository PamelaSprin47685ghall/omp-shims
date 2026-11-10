// The composable route plan: one graph engine for every virtual model.
//
// A route is a graph of four node types:
//   model     one provider-qualified model at one account tier;
//   fallback  strict child order;
//   random    child order drawn from a random stream;
//   rating    child order from one score (intelligence, cost, latency, affinity).
//
// The plan data is policy only. It never names an account. The caller supplies
// the accounts of the moment and a tier reader, so a newly added account joins
// its route without a code change.
//
// Route ids are opaque. `modelIdOf` returns the client-facing id unchanged.

import { readFileSync } from "node:fs";
import offPeakPolicy from "../../presets/offpeak.json" with { type: "json" };
import { affinityStickiness, median, scoreCandidate } from "./ranking.mjs";

export const PLAN_PERIOD = Object.freeze({ PEAK: "peak", OFF_PEAK: "offPeak" });

const NODE_TYPES = new Set(["model", "fallback", "random", "rating"]);
const EFFORT_LEVELS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "capped"]);
const OFF_PEAK_SCHEDULE_DATA = offPeakPolicy.schedules ?? {};
export const OFF_PEAK_SCHEDULES = Object.freeze(Object.keys(OFF_PEAK_SCHEDULE_DATA));
const OFF_PEAK_SCHEDULE_SET = new Set(OFF_PEAK_SCHEDULES);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The bundled plan data. */
export function loadPlanData(path = new URL("../../presets/routes.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The bundled Mainland China holiday data. */
function loadCalendarData(path = new URL("../../presets/holidays-cn.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** "HH:MM" -> minutes after midnight. */
function clockMinutes(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) throw new Error(`invalid peak clock "${text}" (expected HH:MM)`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes < 0 || minutes > 24 * 60) throw new Error(`peak clock out of range: "${text}"`);
  return minutes;
}

/** Every "YYYY-MM-DD" from `from` to `to`, inclusive. */
function dateRange(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days = [];
  for (let at = start; at <= end; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

/** Build a day-kind map from presets/holidays-cn.json. */
function holidayCalendar(data) {
  const days = new Map();
  const years = new Map();
  for (const [year, block] of Object.entries(data?.years ?? {})) {
    years.set(year, { status: block.status, source: block.source });
    for (const holiday of block.holidays ?? []) {
      for (const day of dateRange(holiday.from, holiday.to)) days.set(day, { kind: "holiday", name: holiday.name });
    }
    for (const day of block.makeupWorkdays ?? []) days.set(day, { kind: "makeup-workday" });
  }
  return {
    timeZone: data?.timeZone ?? "Asia/Shanghai",
    days,
    years,
    classify(dateKey, isoWeekday) {
      const special = days.get(dateKey);
      return special ?? { kind: isoWeekday >= 6 ? "weekend" : "workday" };
    },
    coverage: (year) => years.get(String(year)),
  };
}

let bundledCalendar;

/** The bundled calendar, loaded once and only when a node needs it. */
function defaultCalendar() {
  if (bundledCalendar === undefined) {
    try {
      bundledCalendar = holidayCalendar(loadCalendarData());
    } catch {
      bundledCalendar = holidayCalendar({});
    }
  }
  return bundledCalendar;
}

/** Wall clock in the calendar time zone. */
function wallClock(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  );
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return {
    dateKey,
    isoWeekday: weekday === 0 ? 7 : weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    localTime: `${dateKey} ${parts.hour}:${parts.minute}`,
  };
}

/**
 * True when one named off-peak schedule is inside a peak window.
 * The schedule data (weekdays, UTC windows, holiday rule) lives in
 * presets/offpeak.json; this function only applies it.
 */
export function isSchedulePeak(scheduleName, at, calendar) {
  const schedule = OFF_PEAK_SCHEDULE_DATA[scheduleName];
  if (!schedule) throw new Error(`unknown off-peak schedule "${scheduleName}"`);
  const date = new Date(at);
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  if (!Array.isArray(schedule.weekdays) || !schedule.weekdays.includes(isoWeekday)) return false;
  if (schedule.excludeCalendarHolidays === true) {
    const offsetHours = Number.isFinite(schedule.holidayUtcOffsetHours) ? schedule.holidayUtcOffsetHours : 0;
    const localDate = new Date(date.getTime() + offsetHours * HOUR_MS).toISOString().slice(0, 10);
    if (dayKind(calendar, localDate, dayOf(localDate)) === "holiday") return false;
  }
  const minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  const windows = Array.isArray(schedule.utcWindows) ? schedule.utcWindows : [];
  return windows.some((window) => minute >= clockMinutes(window.from) && minute < clockMinutes(window.to));
}

/** ISO weekday from a date key. */
function dayOf(dateKey) {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Classify a local date through the caller's calendar or the bundled one. */
function dayKind(calendar, dateKey, isoWeekday) {
  if (typeof calendar?.classify === "function") {
    const result = calendar.classify(dateKey, isoWeekday);
    return result?.kind ?? result ?? (isoWeekday >= 6 ? "weekend" : "workday");
  }
  const days = calendar?.days;
  if (days instanceof Map) {
    const special = days.get(dateKey);
    if (special) return special.kind ?? special;
  } else if (days && typeof days === "object") {
    const special = days[dateKey];
    if (special) return special.kind ?? special;
  }
  return isoWeekday >= 6 ? "weekend" : "workday";
}

/** Calendar coverage of a year: {status, source} when known. */
function calendarStatus(calendar, year) {
  if (typeof calendar?.coverage === "function") return calendar.coverage(year)?.status ?? "uncovered";
  const years = calendar?.years;
  if (years instanceof Map) return years.get(String(year))?.status ?? "uncovered";
  return years?.[year]?.status ?? "uncovered";
}

/** A model reference must be provider-qualified. */
function splitModel(model) {
  if (typeof model !== "string") return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) return undefined;
  return { provider: model.slice(0, slash), id: model.slice(slash + 1) };
}

function tierList(value, label) {
  if (value === undefined || value === null) return undefined;
  const list = (Array.isArray(value) ? value : [value]).map((tier) => String(tier).trim().toLowerCase());
  if (list.length === 0 || list.some((tier) => tier === "")) throw new Error(`${label}: empty or non-string tier`);
  return Object.freeze([...new Set(list)]);
}

function activeUntilOf(value, label) {
  if (value === undefined || value === null) return undefined;
  const at = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(at)) throw new Error(`${label}: invalid activeUntil`);
  return at;
}

function integerLimit(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function periodName(value) {
  return value === PLAN_PERIOD.PEAK ? PLAN_PERIOD.PEAK : PLAN_PERIOD.OFF_PEAK;
}

function accountName(account, provider) {
  const raw = account?.account ?? account?.credentialId ?? account?.id ?? account?.label ?? account?.key;
  if (raw === undefined || raw === null) return null;
  const text = String(raw);
  if (text.startsWith(`${provider}/`)) return text.slice(provider.length + 1);
  return text;
}

/** The account value as the caller gave it; a numeric id stays numeric. */
function accountValue(account) {
  const raw = account?.credentialId ?? account?.id ?? account?.account ?? account?.label ?? account?.key;
  return raw === undefined || raw === null ? null : raw;
}

function accountTier(account, provider, tierOf) {
  let tier;
  if (typeof tierOf === "function") {
    tier = tierOf(provider, accountValue(account) ?? accountName(account, provider));
    if (tier === true) return true;
    if (tier === false) return false;
    if (tier === undefined || tier === null) tier = account?.tier;
  } else {
    tier = account?.tier;
  }
  if (Array.isArray(tier) || tier instanceof Set) return [...tier].map((value) => String(value).toLowerCase());
  if (typeof tier === "string") return [tier.toLowerCase()];
  return [];
}

function acceptsTier(required, actual) {
  if (!required || required.length === 0) return true;
  if (actual === true) return true;
  if (actual === false) return false;
  if (typeof actual === "string") return required.includes(actual.toLowerCase());
  if (Array.isArray(actual)) return actual.some((tier) => required.includes(String(tier).toLowerCase()));
  return false;
}

function shuffle(items, random) {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1));
    [output[index], output[pick]] = [output[pick], output[index]];
  }
  return output;
}

/** Remove excluded model leaves; drop a composite that becomes empty. */
function excludeModels(node, excluded) {
  if (!excluded || excluded.size === 0) return node;
  if (node.type === "model") return excluded.has(node.model) ? undefined : node;
  const children = node.children.map((child) => excludeModels(child, excluded)).filter(Boolean);
  return children.length === 0 ? undefined : { ...node, children };
}

export class ComposedPolicy {
  /**
   * @param {any} [planData] policy data; defaults to presets/routes.json
   * @param {{calendar?: any, now?: () => number}} [options]
   */
  constructor(planData = loadPlanData(), { calendar, now = Date.now } = {}) {
    this.now = now;
    this.data = planData ?? {};
    this.calendar = calendar ?? defaultCalendar();
    this.timeZone = this.calendar?.timeZone ?? "Asia/Shanghai";
    this.contextWindow = this.#globalLimit("contextWindow", 500_000);
    this.maxOutputTokens = this.#globalLimit("maxOutputTokens", 64_000);
    this.routes = this.data.routes ?? {};
    this.namedNodes = this.data.nodes ?? {};
    this.names = Object.keys(this.routes);
    this.limits = new Map();
    for (const [key, value] of Object.entries(this.data.maxInFlight ?? {})) {
      if (key.startsWith("$")) continue;
      const limit = integerLimit(value, `maxInFlight "${key}"`);
      if (limit > 0) this.limits.set(key, limit);
    }
    this.peakWindows = this.#windows(this.data.peakWindows);
    this.#compiled = new Map();
    this.#named = new Map();
    for (const name of this.names) this.#compileRoute(name, []);
  }

  #compiled;
  #named;

  /** Route ids, in declaration order. */
  get routeNames() {
    return [...this.names];
  }

  /** A client-facing route id is opaque; return it unchanged. */
  modelIdOf(routeId) {
    return typeof routeId === "string" ? routeId : undefined;
  }

  /** The human-readable route name. */
  displayNameOf(routeId) {
    return this.routes[routeId]?.displayName ?? routeId;
  }

  /** Input modalities the route promises. */
  inputOf(routeId) {
    return this.routes[routeId]?.input ?? ["text"];
  }

  /** Minimum context window promised by one route. */
  contextWindowOf(routeId) {
    return this.#routeLimit(routeId, "contextWindow", this.contextWindow);
  }

  /** Maximum output budget of one route. */
  maxOutputTokensOf(routeId) {
    return this.#routeLimit(routeId, "maxOutputTokens", this.maxOutputTokens);
  }

  /**
   * Concurrent upstream requests one unit may open; 0 means unlimited.
   * Accepts a provider key, a model id, a "provider/account" key, or a unit
   * object with `key` or `provider`.
   */
  maxInFlight(unitKey) {
    const key =
      typeof unitKey === "string"
        ? unitKey
        : unitKey && typeof unitKey === "object"
          ? (unitKey.key ?? unitKey.provider)
          : undefined;
    if (typeof key !== "string" || key === "") return 0;
    const exact = this.limits.get(key);
    if (exact) return exact;
    const hash = key.indexOf("#");
    if (hash > 0 && this.limits.has(key.slice(0, hash))) return this.limits.get(key.slice(0, hash));
    const slash = key.indexOf("/");
    if (slash > 0) {
      const provider = key.slice(0, slash);
      if (this.limits.has(provider)) return this.limits.get(provider);
      const model = key.slice(slash + 1);
      if (this.limits.has(model)) return this.limits.get(model);
    }
    return 0;
  }

  /** "peak" or "offPeak" at one instant, in Beijing time. */
  periodAt(at = this.now()) {
    return this.scheduleAt(at).period;
  }

  /** Peak decision with its evidence, for the status page. */
  scheduleAt(at = this.now()) {
    const clock = wallClock(Number(at), this.timeZone);
    const kind = dayKind(this.calendar, clock.dateKey, clock.isoWeekday);
    const inWindow = this.peakWindows.some(
      (window) => clock.minutes >= clockMinutes(window.from) && clock.minutes < clockMinutes(window.to),
    );
    const working = clock.isoWeekday <= 5 && kind !== "holiday";
    const coverage = calendarStatus(this.calendar, clock.dateKey.slice(0, 4));
    return {
      period: working && inWindow ? PLAN_PERIOD.PEAK : PLAN_PERIOD.OFF_PEAK,
      localTime: clock.localTime,
      dayKind: kind,
      calendarStatus: coverage,
    };
  }

  /**
   * Ordered candidates for one route.
   *
   * `options.accounts` (optional) is `[{provider, account, tier}]`. When it is
   * present, every model leaf expands to its matching accounts and the tier
   * filter uses `tierOf(provider, account)` or `account.tier`. When it is
   * absent, one provider-level candidate is returned per leaf and the leaf's
   * required tier is reported for the caller to expand.
   *
   * Optional ranking evidence: `perfOf(candidate)`, `affinityOf(candidate)`,
   * `at`, `random`, `temperature`, `referenceMs`, `referenceCost`.
   *
   * @returns {Array<{routeId: string, provider: string, account: number|string|null,
   *   unitKey: string, model: string, effort: string, tier: string|null,
   *   tiers: string[], intelligence: number, cost: number, leafKey: string,
   *   activeUntil?: number, ratingScore?: number}>}
   */
  candidatesFor(routeId, options = {}) {
    const graph = this.#compiled.get(routeId);
    if (!graph) throw new Error(`unknown route "${routeId}"`);
    const at = Number.isFinite(options.at) ? options.at : this.now();
    const period = periodName(options.period ?? this.periodAt(at));
    const accounts = Array.isArray(options.accounts) ? options.accounts : undefined;
    const tierOf = options.tierOf;
    const random = typeof options.random === "function" ? options.random : Math.random;
    const select = (node) => this.#select(node, routeId, { at, period, accounts, tierOf });

    const evaluate = (node) => {
      if (node.type === "model") return select(node);
      if (node.type === "fallback") return node.children.flatMap(evaluate);
      if (node.type === "random") {
        return shuffle(
          node.children.map((child) => evaluate(child)).filter((group) => group.length > 0),
          random,
        ).flat();
      }
      return this.#rank(node, evaluate, options, random);
    };
    return evaluate(graph);
  }

  #rank(node, evaluate, options, random) {
    const groups = node.children
      .map((child) => evaluate(child))
      .filter((group) => group.length > 0)
      .map((group, index) => ({ group, index }));
    if (groups.length < 2) return groups.flatMap((row) => row.group);

    const perfOf =
      typeof options.perfOf === "function" ? options.perfOf : (candidate) => options.perf?.[candidate.model];
    const affinityOf =
      typeof options.affinityOf === "function"
        ? options.affinityOf
        : (candidate) => options.affinity?.[candidate.unitKey];
    const all = groups.flatMap((row) => row.group);
    const latencyOf = (candidate) => {
      const value = perfOf(candidate);
      if (Number.isFinite(value)) return value;
      return Number.isFinite(value?.totalMs) && value.totalMs > 0 ? value.totalMs : undefined;
    };
    const referenceMs =
      Number.isFinite(options.referenceMs) && options.referenceMs > 0
        ? options.referenceMs
        : median(all.map(latencyOf));
    const referenceCost =
      Number.isFinite(options.referenceCost) && options.referenceCost > 0
        ? options.referenceCost
        : median(all.map((candidate) => candidate.cost));
    let lockStickiness = 0;
    for (const candidate of all) {
      const value = affinityOf(candidate);
      const stickiness =
        value && typeof value === "object"
          ? affinityStickiness(value.share, value.bytes).stickiness
          : Number.isFinite(value)
            ? Math.max(0, value)
            : 0;
      if (stickiness > lockStickiness) lockStickiness = stickiness;
    }

    const scored = groups.map((row) => {
      const representative = row.group[0];
      const routing = scoreCandidate(representative, {
        perf: perfOf(representative),
        affinity: affinityOf(representative),
        referenceMs,
        referenceCost,
        lockStickiness,
        temperature: options.temperature,
        random,
      });
      for (const candidate of row.group) candidate.ratingScore = routing.selectionScore;
      return { ...row, routing };
    });
    scored.sort((a, b) => b.routing.selectionScore - a.routing.selectionScore || a.index - b.index);
    return scored.flatMap((row) => row.group);
  }

  #select(node, routeId, { at, period, accounts, tierOf }) {
    if (node.activeUntil && at >= node.activeUntil) return [];
    if (node.offPeakOnly && !this.#offPeakAllowed(node.offPeakOnly, at, period)) return [];
    const pool =
      accounts === undefined
        ? [{ account: null, unitKey: node.provider, tier: node.tiers?.[0] ?? null }]
        : accounts
            .filter((account) => account?.provider === node.provider)
            .map((account) => {
              const name = accountName(account, node.provider);
              const value = accountValue(account);
              return {
                account: typeof value === "number" ? value : name,
                unitKey: account.unitKey ?? `${node.provider}/${name ?? "default"}`,
                tier: accountTier(account, node.provider, tierOf),
              };
            })
            .filter((account) => acceptsTier(node.tiers, account.tier));
    return pool.map((account) => ({
      routeId,
      provider: node.provider,
      account: account.account,
      unitKey: account.unitKey,
      model: node.model,
      effort: node.effort,
      tier:
        typeof account.tier === "string"
          ? account.tier
          : Array.isArray(account.tier) && account.tier.length > 0
            ? account.tier[0]
            : (node.tiers?.[0] ?? null),
      tiers: node.tiers ? [...node.tiers] : [],
      intelligence: node.intelligence,
      cost: node.cost,
      leafKey: node.key,
      ...(node.activeUntil ? { activeUntil: node.activeUntil } : {}),
    }));
  }

  #offPeakAllowed(rule, at, period) {
    if (rule === true) return period === PLAN_PERIOD.OFF_PEAK;
    if (rule === false) return true;
    if (OFF_PEAK_SCHEDULE_SET.has(rule)) return !isSchedulePeak(rule, at, this.calendar);
    return true;
  }

  // ---- compilation -------------------------------------------------------

  #compileRoute(name, seen) {
    const cached = this.#compiled.get(name);
    if (cached) return cached;
    if (seen.includes(name)) throw new Error(`route cycle: ${[...seen, name].join(" -> ")}`);
    const source = this.routes[name];
    if (!source) throw new Error(`unknown route "${name}"`);

    let graph;
    if (source.sameAs) {
      graph = this.#compileRoute(source.sameAs, [...seen, name]);
    } else if (source.derive) {
      const derive = source.derive;
      const from = typeof derive === "string" ? derive : derive.from;
      if (typeof from !== "string" || from === "") throw new Error(`route "${name}": derive.from is required`);
      const base = this.#compileRoute(from, [...seen, name]);
      const append = derive.append ?? [];
      if (!Array.isArray(append)) throw new Error(`route "${name}": derive.append must be an array`);
      const additions = append.map((node, index) => this.#node(node, `${name}:derive.${index}`, new Set()));
      const excluded = derive.excludeModels ?? [];
      if (!Array.isArray(excluded) || excluded.some((model) => typeof model !== "string" || model === "")) {
        throw new Error(`route "${name}": derive.excludeModels must be model strings`);
      }
      const kept = excludeModels(base, new Set(excluded));
      if (!kept)
        graph = additions.length === 1 ? additions[0] : { type: "rating", key: `${name}:root`, children: additions };
      else if (kept.type === "model") {
        graph = { type: "rating", key: `${name}:root`, children: [kept, ...additions] };
      } else graph = { ...kept, children: [...kept.children, ...additions] };
    } else {
      graph = this.#node(source.graph, `${name}:root`, new Set());
    }
    this.#compiled.set(name, graph);
    return graph;
  }

  #node(raw, path, seen) {
    if (!raw || typeof raw !== "object") throw new Error(`invalid node at ${path}`);
    let source = raw;
    if (source.sameAs) {
      const reference = String(source.sameAs);
      if (seen.has(reference)) throw new Error(`node cycle at ${path}: ${[...seen, reference].join(" -> ")}`);
      const base = this.#namedNode(reference, new Set([...seen, reference]));
      source = { ...base, ...source, sameAs: undefined, type: source.type ?? base.type };
    }
    const type = source.type;
    if (!NODE_TYPES.has(type)) throw new Error(`invalid node type at ${path}: ${String(type)}`);
    if ("units" in source || "credentialId" in source) {
      throw new Error(`node at ${path} names accounts; select accounts by tier`);
    }
    if (type === "model") return this.#modelNode(source, path);
    if (!Array.isArray(source.children) || source.children.length === 0) {
      throw new Error(`empty ${type} node at ${path}`);
    }
    return Object.freeze({
      type,
      key: path,
      children: Object.freeze(source.children.map((child, index) => this.#node(child, `${path}.${index}`, seen))),
    });
  }

  #namedNode(name, seen) {
    const cached = this.#named.get(name);
    if (cached) return cached;
    const raw = this.namedNodes[name];
    if (!raw) throw new Error(`unknown named node "${name}"`);
    const node = this.#node(raw, `nodes:${name}`, seen);
    this.#named.set(name, node);
    return node;
  }

  #modelNode(source, path) {
    const ref = splitModel(source.model);
    if (!ref) throw new Error(`node at ${path}: "${source.model}" is not a provider/model reference`);
    const tiers = tierList(source.tier, `${path} ${source.model}`);
    const effort = source.effort ?? "high";
    if (typeof effort !== "string" || !EFFORT_LEVELS.has(effort)) {
      throw new Error(`node at ${path}: unknown effort "${effort}"`);
    }
    if (source.offPeakOnly !== undefined && source.offPeakOnly !== true && source.offPeakOnly !== false) {
      if (typeof source.offPeakOnly !== "string" || !OFF_PEAK_SCHEDULE_SET.has(source.offPeakOnly)) {
        throw new Error(`node at ${path}: invalid offPeakOnly "${source.offPeakOnly}"`);
      }
    }
    const intelligence = source.intelligence ?? 50;
    if (!Number.isFinite(intelligence) || intelligence < 0 || intelligence > 100) {
      throw new Error(`node at ${path}: intelligence must be 0..100`);
    }
    const cost = source.cost ?? 1;
    if (!Number.isFinite(cost) || cost <= 0) throw new Error(`node at ${path}: cost must be positive`);
    const activeUntil = activeUntilOf(source.activeUntil, `${path} ${source.model}`);
    return Object.freeze({
      type: "model",
      key: path,
      provider: ref.provider,
      model: source.model,
      effort,
      intelligence,
      cost,
      ...(tiers ? { tiers } : {}),
      ...(source.offPeakOnly !== undefined ? { offPeakOnly: source.offPeakOnly } : {}),
      ...(activeUntil !== undefined ? { activeUntil } : {}),
    });
  }

  #globalLimit(field, fallback) {
    const value = this.data?.[field];
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
    return value;
  }

  #routeLimit(routeId, field, fallback) {
    const value = this.routes[routeId]?.[field];
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value <= 0) throw new Error(`route "${routeId}": ${field} must be positive`);
    return value;
  }

  #windows(list) {
    if (!Array.isArray(list) || list.length === 0) throw new Error("peakWindows must be a non-empty array");
    return Object.freeze(
      list.map(({ from, to }) => {
        if (clockMinutes(from) >= clockMinutes(to)) throw new Error(`invalid peak window ${from}-${to}`);
        return Object.freeze({ from: String(from), to: String(to) });
      }),
    );
  }
}
