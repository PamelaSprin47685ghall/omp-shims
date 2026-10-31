// Recursive keyed-model policy. Each leaf chooses among available credentials;
// its parent decides fallback, uniform random order or speed-posterior order.
import { readFileSync } from "node:fs";
import { splitModelRef } from "./catalog.js";
import { affinityStickiness, ROUTING_DEFAULTS } from "./ranking.js";
import { isEffortLevel } from "./effort.js";

export function loadCompositionData(path = new URL("./composition-routes.json", import.meta.url)) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const WINDOWS = new Set(["deepseek", "ollama", "commandcode"]);
const TYPES = new Set(["model", "fallback", "random", "rating"]);
const HOUR = 3_600_000;

function checkNode(node, name, path) {
  if (!node || !TYPES.has(node.type)) throw new Error("invalid composition node: " + name + "/" + path);
  const out = { ...node, key: path };
  if (node.type === "model") {
    const { provider, id } = splitModelRef(node.model ?? "");
    if (!provider || !id) throw new Error("invalid qualified model: " + name);
    if (node.effort && !isEffortLevel(node.effort)) throw new Error("invalid effort: " + name);
    if (node.offPeakOnly && !WINDOWS.has(node.offPeakOnly)) throw new Error("invalid tariff schedule: " + name);
    if (node.tier && (typeof node.tier !== "string" || !node.tier)) throw new Error("invalid tier: " + name);
    if ("credentialId" in node || "units" in node) throw new Error("credentials must be discovered, not embedded");
    return { ...out, provider, id };
  }
  if (!Array.isArray(node.children) || node.children.length < 1) throw new Error("empty composition: " + name);
  return { ...out, children: node.children.map((child, index) => checkNode(child, name, path + "." + index)) };
}

function shuffle(items, random) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function gaussian(random) {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random());
}

// Gumbel-top-k samples a full Plackett-Luce order. Its first choice is
// exactly softmax(log(speed^-1) / temperature) when RD is zero.
// The Gaussian term samples each speed rating's uncertainty before selection.
function gumbel(random) {
  const u = Math.max(1e-12, Math.min(1 - 1e-12, random()));
  return -Math.log(-Math.log(u));
}

function softmaxOrder(rows, predict, temperature, random) {
  return rows.map((row, index) => {
    const posterior = predict(row.child);
    const latency = Number.isFinite(posterior.totalMs) && posterior.totalMs > 0
      ? posterior.totalMs : 8000;
    const rating = -Math.log(Math.max(1, latency));
    const rd = Number.isFinite(posterior.rd) && posterior.rd >= 0 ? posterior.rd : 1.25;
    // Zero temperature is the deterministic fastest-first limit.
    const draw = temperature === 0 ? rating
      : rating / temperature + rd * gaussian(random) + gumbel(random);
    return { ...row, index, draw };
  }).sort((a, b) => b.draw - a.draw || a.index - b.index);
}

/** DeepSeek official API: weekdays 01–04 and 06–10 UTC, Chinese public holidays excluded. */
export function isDeepSeekPeak(at, calendar) {
  const d = at instanceof Date ? at : new Date(at);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const shanghaiDate = new Date(d.getTime() + 8 * HOUR).toISOString().slice(0, 10);
  if (calendar?.days?.get(shanghaiDate)?.kind === "holiday") return false;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** Command Code: V4.1 Flash billed at off-peak rates outside weekday
 * 01–04 and 06–10 UTC. Their terms do not grant Chinese holiday exemptions.
 * This intentionally differs from DeepSeek's direct-API schedule.
 */
export function isCommandCodePeak(at) {
  const d = at instanceof Date ? at : new Date(at);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** Ollama Cloud: weekdays 12–18 UTC. No Chinese holiday exception. */
export function isOllamaPeak(at) {
  const d = at instanceof Date ? at : new Date(at);
  const day = d.getUTCDay();
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return day >= 1 && day <= 5 && hour >= 12 && hour < 18;
}

function availableAt(node, at, calendar) {
  if (node.offPeakOnly === "deepseek") return !isDeepSeekPeak(at, calendar);
  if (node.offPeakOnly === "commandcode") return !isCommandCodePeak(at);
  if (node.offPeakOnly === "ollama") return !isOllamaPeak(at);
  return true;
}

function limit(name, kind, value, fallback) {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n <= 0) throw new Error("invalid " + kind + " for " + name);
  return n;
}

export class ComposedPolicy {
  constructor(data = loadCompositionData(), { calendar } = {}) {
    this.contextWindow = limit("global", "context", data.contextWindow, 500000);
    this.maxOutputTokens = limit("global", "output", data.maxOutputTokens, 64000);
    this.modelTraits = data.modelTraits ?? {};
    this.calendar = calendar;
    this.routes = data.routes ?? {};
    this.names = Object.keys(this.routes);
    this.compiled = new Map();
    this.limits = new Map();
    for (const [key, value] of Object.entries(data.maxInFlight ?? {})) {
      if (key.startsWith("$")) continue;
      if (!Number.isInteger(value) || value < 0) throw new Error("invalid concurrency limit: " + key);
      if (value) this.limits.set(key, value);
    }
    for (const name of this.names) {
      this.contextWindowOf(name);
      this.maxOutputTokensOf(name);
      this.#resolve(name, []);
    }
  }

  get routeNames() { return this.names; }
  /** Public route structure, excluding credentials and internal ranking state. */
  routeTopology() {
    const visit = (node) => {
      if (node.type === "model") return {
        type: "model", model: node.model, tier: node.tier ?? null,
        effort: node.effort ?? null, offPeakOnly: node.offPeakOnly ?? null,
      };
      return { type: node.type, children: node.children.map(visit) };
    };
    return Object.fromEntries(this.names.map((name) =>
      [name, { graph: visit(this.compiled.get(name)) }]));
  }
  routeFor(model) { return this.routes[model] ? model : undefined; }
  modelIdOf(name) { return this.routes[name] ? name : undefined; }
  selectionOf() { return "composed"; }
  inputOf(name) { return this.routes[name]?.input ?? ["text"]; }
  contextWindowOf(name) { return limit(name, "context", this.routes[name]?.contextWindow, this.contextWindow); }
  maxOutputTokensOf(name) { return limit(name, "output", this.routes[name]?.maxOutputTokens, this.maxOutputTokens); }
  maxInFlight(unit) {
    return this.limits.get(unit.model) ?? this.limits.get(unit.provider + ":" + unit.tier) ?? this.limits.get(unit.provider) ?? 0;
  }
  /** A model-specific limit is shared by routes, but not by account keys or other models. */
  capacityUnit(candidate) {
    if (!this.limits.has(candidate.model)) return candidate.unit;
    return { ...candidate.unit, model: candidate.model, key: candidate.unit.key + " " + candidate.model };
  }

  #resolve(name, seen) {
    if (!this.routes[name] || seen.includes(name)) throw new Error("invalid or cyclic alias: " + name);
    const cached = this.compiled.get(name);
    if (cached) return cached;
    const source = this.routes[name];
    const node = source.alias ? this.#resolve(source.alias, [...seen, name]) : checkNode(source.graph, name, "root");
    this.compiled.set(name, node);
    return node;
  }

  /** Returns leaf candidates in declaration order. The tree determines actual routing. */
  candidates(name, _period, units, at = new Date()) {
    const graph = this.#resolve(name, []);
    const candidates = [];
    const visit = (node) => {
      if (node.type !== "model") { node.children.forEach(visit); return; }
      if (!availableAt(node, at, this.calendar)) return;
      for (const unit of units.select(node.provider, node.tier ? [node.tier] : undefined)) {
        candidates.push({ unit, model: node.model, effort: node.effort ?? "high", leafKey: node.key });
      }
    };
    visit(graph);
    return { candidates, require: this.routes[name]?.require ?? [] };
  }

  /**
   * Recursively order eligible credentials. The same model's multiple keys
   * are shuffled without a per-key rating; all learning is per provider/model.
   * Fallback preserves strict subtree precedence; rating uses only completion time.
   */
  rankCandidates(name, candidates, {
    speed, at = new Date(), available = () => true,
    cachedShare = () => 0, cachedBytes = () => 0,
    settings = {}, random = Math.random,
  } = {}) {
    const cfg = { ...ROUTING_DEFAULTS, ...settings };
    const root = this.#resolve(name, []);
    const byLeaf = new Map();
    for (const candidate of candidates) {
      if (!byLeaf.has(candidate.leafKey)) byLeaf.set(candidate.leafKey, []);
      if (available(candidate)) byLeaf.get(candidate.leafKey).push(candidate);
    }
    const st = new Map();
    for (const candidate of candidates) {
      if (!available(candidate)) continue;
      const adhesion = affinityStickiness(cachedShare(candidate), cachedBytes(candidate), cfg).stickiness;
      st.set(candidate.unit.key, Math.max(adhesion, st.get(candidate.unit.key) ?? 0));
    }
    const lock = Math.max(0, ...st.values());
    const temp = Math.max(0, cfg.temperature ?? 0.6) * Math.exp(-Math.max(0, cfg.affinityTemperatureWeight ?? 1) * lock);

    const predict = (node) => {
      if (node.type === "model") return speed?.predict(node.model, at) ?? { totalMs: 8000, rd: 1.25, weight: 0 };
      const values = node.children.map(predict);
      // Fallback receives the time of its preferred child, not the mean of its backups.
      return node.type === "fallback" ? values[0] : values.reduce((a, b) => a.totalMs <= b.totalMs ? a : b);
    };
    const ordered = (node) => {
      if (node.type === "model") {
        const pool = shuffle(byLeaf.get(node.key) ?? [], random);
        if (pool.length < 2) return pool;
        // Mistral's DeepSeek prefix cache is account-local: retain the
        // same key across an entire multi-turn session. Once a matching prefix
        // is observed, always stay on its healthy account unless it is no
        // longer eligible (cooldown/capacity/failure). Other models retain
        // their existing temperature-based exploration.
        if (node.model === "mistral-vibe/deepseek-v4-1-flash-1017") {
          const warmBytes = Math.max(0, ...pool.map((c) => cachedBytes(c)));
          if (warmBytes > 0) {
            const warm = pool.find((c) => cachedBytes(c) === warmBytes);
            return [warm, ...pool.filter((c) => c !== warm)];
          }
        }
        // Affinity changes how often random selection retains its previous key.
        const warm = pool.reduce((best, c) => (st.get(c.unit.key) ?? 0) > (st.get(best.unit.key) ?? 0) ? c : best);
        if ((st.get(warm.unit.key) ?? 0) > 0 && random() > Math.min(1, temp)) {
          return [warm, ...pool.filter((candidate) => candidate !== warm)];
        }
        return pool;
      }
      const children = node.children.map((child) => ({ child, items: ordered(child) })).filter((row) => row.items.length > 0);
      if (node.type === "fallback") return children.flatMap((row) => row.items);
      const rows = node.type === "random"
        ? shuffle(children, random)
        : softmaxOrder(children, predict, temp, random);
      return rows.flatMap((row) => row.items);
    };

    return ordered(root).map((candidate) => {
      const p = predict({ type: "model", model: candidate.model });
      return {
        candidate,
        routing: {
          rating: -Math.log(Math.max(1, p.totalMs)),
          rd: p.rd,
          latencyMs: p.totalMs,
          samples: p.weight,
          score: -Math.log(Math.max(1, p.totalMs)),
          selectionScore: null,
          posteriorDraw: null,
          affinityStickiness: st.get(candidate.unit.key) ?? 0,
          affinityLockStickiness: lock,
          temperature: cfg.temperature,
          effectiveTemperature: temp,
          costRating: 0,
        },
      };
    });
  }
}
