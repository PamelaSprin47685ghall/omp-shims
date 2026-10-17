// Antigravity account tier routing:
// - Gemini 4, Claude Opus, and Claude Sonnet always route to Ultra account(s).
// - Other models (e.g. Gemini 3.8 Flash, 3.5 Flash Lite) prioritize Pro accounts,
//   falling back to Ultra if all Pro accounts fail (429 quota exhaustion or error).
//
// Accounts are read from agent.db and automatically refreshed via the broker
// when near expiry. Pro accounts are round-robin balanced; an account returning
// 429 is placed in cooldown so subsequent requests avoid wasting round trips.
//
// Config (~/.omp/shims.json):
//   "antigravity-account-routing": {
//     "enabled": true,
//     "ultraAccounts": ["***REMOVED***"],
//     "proAccounts": ["***REMOVED***", "***REMOVED***", "***REMOVED***"],
//     "cooldownMs": 60000
//   }

import {
  addFetchHandler as sharedAddFetchHandler,
  appendJsonLine,
  isCloudCodeStream,
  requestUrl,
  requestBody,
} from "../lib/fetch-chain.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_ULTRA_PATTERN = /gemini-4|opus|sonnet/i;

let cachedAccounts = [];
let lastAccountsFetch = 0;
let proCursor = 0;

function getBrokerToken() {
  const tokenPath = join(homedir(), ".omp", "auth-broker.token");
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

function loadAccounts(dbPath, ultraList, proList) {
  const { Database } = require("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query(
      "SELECT id, data FROM auth_credentials WHERE provider = 'google-antigravity' AND disabled_cause IS NULL ORDER BY id"
    ).all();
    const loaded = [];
    for (const row of rows) {
      try {
        const d = JSON.parse(row.data);
        if (!d.email || !d.access) continue;
        const email = d.email.toLowerCase();
        const isUltra = ultraList.includes(email);
        const isPro = proList.includes(email) || (!isUltra && proList.length === 0);
        loaded.push({
          id: row.id,
          email: d.email,
          token: d.access,
          expires: d.expires || 0,
          projectId: d.projectId || "aicode-consumers",
          isUltra,
          isPro,
          cooldownUntil: 0,
        });
      } catch {}
    }
    return loaded;
  } finally {
    db.close();
  }
}

async function refreshAccountToken(account, brokerToken) {
  if (Date.now() < account.expires - 120_000 && account.token) return account.token;
  if (!brokerToken) return account.token;
  try {
    const res = await fetch(`http://127.0.0.1:8765/v1/credential/${account.id}/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${brokerToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      const fresh = data.entry?.credential;
      if (fresh?.access) {
        account.token = fresh.access;
        account.expires = fresh.expires || Date.now() + 3600_000;
      }
    }
  } catch {}
  return account.token;
}

export function install(config, context) {
  if (config?.enabled === false) return;

  const addFetchHandler = context.addFetchHandler ?? sharedAddFetchHandler;
  const extraHosts = context.extraHosts ?? [];
  const log = context.log ?? (() => {});

  const ultraEmails = (config.ultraAccounts ?? ["***REMOVED***"]).map((e) => e.toLowerCase());
  const proEmails = (
    config.proAccounts ?? ["***REMOVED***", "***REMOVED***", "***REMOVED***"]
  ).map((e) => e.toLowerCase());
  const cooldownMs = Number.parseInt(String(config.cooldownMs ?? DEFAULT_COOLDOWN_MS), 10) || DEFAULT_COOLDOWN_MS;
  const ultraPattern = config.ultraModelPattern ? new RegExp(config.ultraModelPattern, "i") : DEFAULT_ULTRA_PATTERN;
  const agentDbPath = join(homedir(), ".omp", "agent", "agent.db");
  const out = config.out ?? process.env.OMP_SHIMS_AG_ACCOUNTS_OUT ?? join(homedir(), ".omp", "logs", "antigravity-accounts.jsonl");
  const record = (entry) => appendJsonLine(out, entry);

  log("antigravity-account-routing: enabled", { ultraEmails, proEmails, cooldownMs });

  return addFetchHandler(async (input, init, next) => {
    const url = requestUrl(input);
    if (!isCloudCodeStream(url, extraHosts)) return next(input, init);

    const bodyString = requestBody(input, init);
    if (!bodyString) return next(input, init);

    let parsed;
    try {
      parsed = JSON.parse(bodyString);
    } catch {
      return next(input, init);
    }
    const model = parsed.model;
    if (typeof model !== "string") return next(input, init);

    // Refresh accounts cache if empty or stale (> 30s)
    if (cachedAccounts.length === 0 || Date.now() - lastAccountsFetch > 30_000) {
      if (existsSync(agentDbPath)) {
        const fresh = loadAccounts(agentDbPath, ultraEmails, proEmails);
        for (const acc of fresh) {
          const prev = cachedAccounts.find((p) => p.id === acc.id);
          if (prev?.cooldownUntil && prev.cooldownUntil > Date.now()) {
            acc.cooldownUntil = prev.cooldownUntil;
          }
        }
        cachedAccounts = fresh;
        lastAccountsFetch = Date.now();
      }
    }

    if (cachedAccounts.length === 0) return next(input, init);

    const brokerToken = getBrokerToken();
    const isUltraRequired = ultraPattern.test(model);

    if (isUltraRequired) {
      // Always route to Ultra account(s)
      const ultras = cachedAccounts.filter((a) => a.isUltra);
      if (ultras.length === 0) return next(input, init);

      const ultra = ultras.find((a) => Date.now() >= a.cooldownUntil) ?? ultras[0];
      await refreshAccountToken(ultra, brokerToken);

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("Authorization", `Bearer ${ultra.token}`);
      log(`antigravity-account-routing: model "${model}" -> ultra (${ultra.email})`);
      const response = await next(input, { ...init, headers });
      record({ ts: new Date().toISOString(), event: "account-route", model, account: ultra.email, tier: "ultra", status: response.status });
      return response;
    }

    // Pro model (e.g. Gemini 3.8 Flash):
    // Prioritize Pro accounts, fallback to Ultra if all Pro fail.
    const pros = cachedAccounts.filter((a) => a.isPro);
    const ultras = cachedAccounts.filter((a) => a.isUltra);

    if (pros.length === 0) {
      if (ultras.length > 0) {
        await refreshAccountToken(ultras[0], brokerToken);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${ultras[0].token}`);
        return next(input, { ...init, headers });
      }
      return next(input, init);
    }

    // Round-robin starting pro account
    const proList = [...pros];
    const startIndex = proCursor++ % proList.length;
    const orderedPros = [...proList.slice(startIndex), ...proList.slice(0, startIndex)];

    const now = Date.now();
    const availablePros = orderedPros.filter((a) => now >= a.cooldownUntil);
    const candidates = [...(availablePros.length > 0 ? availablePros : orderedPros), ...ultras];

    let lastResponse;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      await refreshAccountToken(candidate, brokerToken);

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("Authorization", `Bearer ${candidate.token}`);

      log(
        `antigravity-account-routing: model "${model}" attempt ${i + 1}/${candidates.length} -> ${candidate.isUltra ? "ultra" : "pro"} (${candidate.email})`
      );

      const response = await next(input, { ...init, headers });
      record({
        ts: new Date().toISOString(),
        event: "account-route",
        model,
        account: candidate.email,
        tier: candidate.isUltra ? "ultra" : "pro",
        attempt: i + 1,
        candidatesCount: candidates.length,
        status: response.status,
      });

      // If successful or non-quota status, return immediately
      if (response.status !== 429) {
        return response;
      }

      // 429: quota exhausted for this account, mark cooldown and try next candidate
      candidate.cooldownUntil = Date.now() + cooldownMs;
      log(`antigravity-account-routing: account ${candidate.email} returned 429; cooling down for ${cooldownMs}ms`);

      try {
        await response.body?.cancel();
      } catch {}

      lastResponse = response;
    }

    return lastResponse;
  });
}
