// Read-only view of OMP's official model cache.
//
// The gateway keeps each provider's full model metadata (reasoning, thinking
// levels, compat, limits) in ~/.omp/agent/models.db. Its /v1/models response
// deliberately omits the reasoning fields, and the live ModelRegistry class is
// not always exposed to preload hooks, so this cache is the reliable official
// source for capability traits. It is read only, cached per provider, and
// falls back to an empty map when the file or table is unavailable.
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MODEL_CACHE_TTL_MS = 30_000;

const defaultPath = () => process.env.OMP_SHIMS_MODELS_DB_PATH ?? join(homedir(), ".omp", "agent", "models.db");

const entries = new Map();

/**
 * Models of one provider from the official cache, keyed by "provider/id".
 * @param {string} provider
 * @param {{path?: string, now?: () => number}} [options]
 * @returns {Map<string, object>}
 */
export function officialModels(provider, { path = defaultPath(), now = Date.now } = {}) {
  if (typeof provider !== "string" || provider === "") return new Map();
  const at = now();
  const held = entries.get(provider);
  if (held && at - held.at < MODEL_CACHE_TTL_MS && held.path === path) return held.byRef;

  const byRef = new Map();
  if (existsSync(path)) {
    let db;
    try {
      db = new Database(path, { readonly: true });
      const row = db.query("select models from model_cache where provider_id = ?").get(provider);
      const models = row?.models ? JSON.parse(row.models) : undefined;
      if (Array.isArray(models)) {
        for (const model of models) {
          if (model?.provider && model?.id) byRef.set(`${model.provider}/${model.id}`, model);
        }
      }
    } catch {
      // A locked or older cache is not fatal: the caller still has /v1/models.
    } finally {
      db?.close();
    }
  }
  entries.set(provider, { at, path, byRef });
  return byRef;
}

/** Forget cached reads (tests and explicit reloads). */
export function clearOfficialModelCache() {
  entries.clear();
}
