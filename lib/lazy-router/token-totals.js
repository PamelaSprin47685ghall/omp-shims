// Persistent, provider-reported token usage. Never estimate missing fields.
// One row per provider-qualified model; all credentials are summed.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ZERO = Object.freeze({ uncachedInput: 0, cachedInput: 0, output: 0 });
const METRICS = Object.keys(ZERO);
function finiteToken(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
const pick = (obj, names) => {
  for (const key of names) {
    const n = finiteToken(obj?.[key]);
    if (n !== null) return n;
  }
  return null;
};
function parseObject(value) {
  if (!value || typeof value !== "object") return null;
  const sources = [];
  const visit = (node, depth = 0) => {
    if (depth > 7 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const entry of node) visit(entry, depth + 1); return; }
    if (node.usage && typeof node.usage === "object") sources.push(node.usage);
    if (node.usageMetadata && typeof node.usageMetadata === "object") sources.push(node.usageMetadata);
    if (node.token_usage && typeof node.token_usage === "object") sources.push(node.token_usage);
    for (const [key, inner] of Object.entries(node)) {
      if (key === "usage" || key === "usageMetadata" || key === "token_usage") continue;
      if (inner && typeof inner === "object" && !["messages","choices","content","parts"].includes(key)) visit(inner, depth + 1);
    }
  };
  visit(value);
  if (!sources.length && ("prompt_tokens" in value || "input_tokens" in value || "promptTokenCount" in value)) sources.push(value);
  const result = {};
  for (const source of sources) {
    const output = pick(source, ["output_tokens","completion_tokens","outputTokens","completionTokens","candidatesTokenCount","candidates_token_count"]);
    const total = pick(source, ["input_tokens","prompt_tokens","inputTokens","promptTokens","promptTokenCount","prompt_token_count"]);
    const details = source.input_tokens_details ?? source.prompt_tokens_details ?? source.promptTokensDetails ?? source.inputTokensDetails ?? {};
    const cached = pick(details, ["cached_tokens","cachedTokens"])
      ?? pick(source, ["cachedContentTokenCount","cache_read_input_tokens","cacheReadInputTokens"]);
    // Anthropic separates cache reads, cache writes and uncached input_tokens.
    const anthropic = "cache_read_input_tokens" in source || "cache_creation_input_tokens" in source;
    const creation = pick(source, ["cache_creation_input_tokens","cacheCreationInputTokens"]) ?? 0;
    const uncached = total === null ? null
      : anthropic ? total + creation : Math.max(0, total - (cached ?? 0));
    for (const [key, value] of Object.entries({ output, uncachedInput: uncached, cachedInput: cached })) {
      if (value !== null) result[key] = Math.max(result[key] ?? 0, value);
    }
  }
  return result;
}
/** Parse provider usage, not prompt content. Unreported fields remain absent. */
export function extractTokenAccounting(value) {
  return parseObject(value) ?? {};
}
export class TokenTotals {
  constructor({ path = null } = {}) {
    this.db = null;
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.db = new Database(path, { create: true });
      this.db.exec("PRAGMA busy_timeout=5000");
      this.db.exec("PRAGMA journal_mode=WAL");
      this.db.exec("CREATE TABLE IF NOT EXISTS totals (model TEXT PRIMARY KEY, uncachedInput INTEGER NOT NULL DEFAULT 0, cachedInput INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0, seenUncached INTEGER NOT NULL DEFAULT 0, seenCached INTEGER NOT NULL DEFAULT 0, seenOutput INTEGER NOT NULL DEFAULT 0)");
      this.db.exec("CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
      this.db.query("INSERT OR IGNORE INTO metadata (name, value) VALUES ('since', ?)").run(new Date().toISOString());
      this.insert = this.db.prepare("INSERT INTO totals (model, uncachedInput, cachedInput, output, complete, seenUncached, seenCached, seenOutput) VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(model) DO UPDATE SET uncachedInput=uncachedInput+excluded.uncachedInput, cachedInput=cachedInput+excluded.cachedInput, output=output+excluded.output, complete=complete+1, seenUncached=seenUncached+excluded.seenUncached, seenCached=seenCached+excluded.seenCached, seenOutput=seenOutput+excluded.seenOutput");
    } catch {
      try { this.db?.close(); } catch {}
      this.db = null;
    }
  }
  record(model, usage) {
    if (!this.db || typeof model !== "string" || !model.includes("/")) return;
    const values = METRICS.map((key) => finiteToken(usage?.[key]));
    try {
      this.insert.run(model, ...values.map((n) => n ?? 0), ...values.map((n) => Number(n !== null)));
    } catch { /* telemetry must never fail a model request */ }
  }
  view() {
    if (!this.db) return { since: null, totals: ZERO, coverage: { complete: 0, uncachedInput: 0, cachedInput: 0, output: 0 } };
    try {
      const row = this.db.query("SELECT COALESCE(SUM(uncachedInput),0) AS uncachedInput, COALESCE(SUM(cachedInput),0) AS cachedInput, COALESCE(SUM(output),0) AS output, COALESCE(SUM(complete),0) AS complete, COALESCE(SUM(seenUncached),0) AS seenUncached, COALESCE(SUM(seenCached),0) AS seenCached, COALESCE(SUM(seenOutput),0) AS seenOutput FROM totals").get();
      return { since: this.db.query("SELECT value FROM metadata WHERE name='since'").get()?.value ?? null,
        totals: { uncachedInput: row.uncachedInput, cachedInput: row.cachedInput, output: row.output },
        coverage: { complete: row.complete, uncachedInput: row.seenUncached, cachedInput: row.seenCached, output: row.seenOutput } };
    } catch { return { since: null, totals: ZERO, coverage: { complete: 0, uncachedInput: 0, cachedInput: 0, output: 0 } }; }
  }
  close() { this.db?.close(); }
}
