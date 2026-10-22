// Adding plugin OAuth accounts to agent.db without a TUI, and repairing the
// identities of accounts stored before lib/oauth-identity.js existed.
//
// The plugin's own login runs (so tokens are exchanged and stored exactly as
// an interactive /login would), the result gets a stable identity, and the row
// is written the way OMP's credential store writes it. A login whose identity
// already exists updates that row; any other login adds a new account.

import { createRequire } from "node:module";
import { join } from "node:path";
import { PLACEHOLDER_EMAILS, stableIdentityOAuth, withStableIdentity } from "./oauth-identity.js";

const require_ = createRequire(import.meta.url);

/** OMP's identity key for an OAuth credential with an accountId. */
export const identityKeyOf = (credential) => (credential.accountId ? `account:${credential.accountId}` : null);

/** The oauth config a plugin package registers for `provider`. */
export async function pluginOAuth(pluginsDir, packageName, provider) {
  const packageDir = join(pluginsDir, "node_modules", packageName);
  const manifest = require_(join(packageDir, "package.json"));
  const entry = join(packageDir, manifest.main ?? "dist/index.js");
  const module = await import(entry);
  const init = module.default ?? module;
  let oauth;
  await init({
    on() {},
    registerCommand() {},
    registerProvider(id, config) {
      if (id === provider) oauth = config?.oauth;
    },
  });
  if (!oauth?.login) throw new Error(`${packageName} registers no OAuth login for ${provider}`);
  return stableIdentityOAuth(provider, oauth);
}

/**
 * Log in with a token the user pasted (answered to the plugin's token prompt;
 * every other prompt takes its default).
 */
export function loginWithToken(oauth, token) {
  return oauth.login({
    onPrompt: async ({ message = "" } = {}) => (/token/i.test(message) ? token : ""),
    onProgress() {},
    onAuth() {},
  });
}

function openDb(dbPath) {
  const { Database } = require_("bun:sqlite");
  const db = new Database(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  return db;
}

/**
 * Store an OAuth credential: update the row with the same identity, or add one.
 * @returns {{id: number, created: boolean}}
 */
export function upsertCredential(dbPath, provider, credential) {
  const identity = identityKeyOf(credential);
  if (!identity) throw new Error("credential has no stable identity; refusing to store it");
  const { type: _type, ...data } = credential;
  const db = openDb(dbPath);
  try {
    const existing = db
      .query("SELECT id FROM auth_credentials WHERE provider = ? AND identity_key = ? AND disabled_cause IS NULL")
      .get(provider, identity);
    if (existing) {
      db.query(
        "UPDATE auth_credentials SET data = ?, credential_type = 'oauth', updated_at = CAST(strftime('%s','now') AS INTEGER) WHERE id = ?",
      ).run(JSON.stringify(data), existing.id);
      return { id: existing.id, created: false };
    }
    const row = db
      .query(
        "INSERT INTO auth_credentials (provider, credential_type, data, identity_key) VALUES (?, 'oauth', ?, ?) RETURNING id",
      )
      .get(provider, JSON.stringify(data), identity);
    return { id: row.id, created: true };
  } finally {
    db.close();
  }
}

/**
 * Give stored accounts of `provider` that carry the placeholder identity a
 * stable one. Only the identity fields change; tokens are left as they are.
 * @returns {{id: number, identity: string}[]} the rows changed
 */
export function repairIdentities(dbPath, provider) {
  if (!PLACEHOLDER_EMAILS[provider]) return [];
  const db = openDb(dbPath);
  try {
    const changed = [];
    const rows = db
      .query("SELECT id, data, identity_key FROM auth_credentials WHERE provider = ? AND credential_type = 'oauth'")
      .all(provider);
    for (const row of rows) {
      const data = JSON.parse(row.data);
      const fixed = withStableIdentity(provider, data);
      const identity = identityKeyOf(fixed);
      if (!identity || identity === row.identity_key) continue;
      db.query("UPDATE auth_credentials SET data = ?, identity_key = ? WHERE id = ?").run(
        JSON.stringify(fixed),
        identity,
        row.id,
      );
      changed.push({ id: row.id, identity });
    }
    return changed;
  } finally {
    db.close();
  }
}
