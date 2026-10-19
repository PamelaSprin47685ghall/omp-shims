// Antigravity account tier routing:
// - Gemini 4, Claude Opus, and Claude Sonnet always route to Ultra account(s).
// - Other models (e.g. Gemini 3.8 Flash, 3.5 Flash Lite) prioritize Pro accounts,
//   falling back to Ultra if all Pro accounts fail (429 quota exhaustion or error).
// - Sequential drain order: within each tier, exhaust one account completely
//   (until 429 quota exhausted) before advancing to the next. No round-robin.
//
// Accounts are read from agent.db and automatically refreshed via the broker
// when near expiry. An account returning 429 is placed in cooldown so subsequent
// requests avoid wasting round trips and immediately stick to the next account.
//
// Config (~/.omp/shims.json):
//   "antigravity-account-routing": {
//     "enabled": true,
//     "ultraAccounts": ["ultra-account@example.com"],
//     "proAccounts": ["pro-1@example.com", "pro-2@example.com"],
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

function getBrokerToken() {
  const tokenPath = join(homedir(), ".omp", "auth-broker.token");
  try {
    return readFileSync(tokenPath, "utf8").trim();
  } catch {
    return "";
  }
}

function parseCooldownMs(bodyText, defaultMs) {
  if (!bodyText) return defaultMs;
  const secMatch = bodyText.match(/"(?:quotaResetDelay|retryDelay)"\s*:\s*"([0-9.]+)(?:s)?"/i);
  if (secMatch) {
    const sec = Number.parseFloat(secMatch[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 86_400_000);
  }
  const resetsMatch = bodyText.match(/Resets in\s*(?:([0-9]+)h)?\s*(?:([0-9]+)m)?\s*(?:([0-9]+)s)?/i);
  if (resetsMatch && (resetsMatch[1] || resetsMatch[2] || resetsMatch[3])) {
    const hours = Number.parseInt(resetsMatch[1] || "0", 10);
    const mins = Number.parseInt(resetsMatch[2] || "0", 10);
    const secs = Number.parseInt(resetsMatch[3] || "0", 10);
    const totalMs = (hours * 3600 + mins * 60 + secs) * 1000;
    if (totalMs > 0) return Math.min(totalMs, 86_400_000);
  }
  return defaultMs;
}

function sortByConfiguredOrder(accounts, emailOrder) {
  return [...accounts].sort((a, b) => {
    const idxA = emailOrder.indexOf(a.email.toLowerCase());
    const idxB = emailOrder.indexOf(b.email.toLowerCase());
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.id - b.id;
  });
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

  // No accounts are built in: tiers come from ~/.omp/shims.json. With no
  // ultraAccounts configured, Ultra-only models fall through to the gateway's
  // own credential; with no proAccounts, every non-Ultra account is a Pro one.
  const ultraEmails = (config.ultraAccounts ?? []).map((e) => e.toLowerCase());
  const proEmails = (config.proAccounts ?? []).map((e) => e.toLowerCase());
  const cooldownMs = Number.parseInt(String(config.cooldownMs ?? DEFAULT_COOLDOWN_MS), 10) || DEFAULT_COOLDOWN_MS;
  const ultraPattern = config.ultraModelPattern ? new RegExp(config.ultraModelPattern, "i") : DEFAULT_ULTRA_PATTERN;
  const agentDbPath = join(homedir(), ".omp", "agent", "agent.db");
  const out = config.out ?? process.env.OMP_SHIMS_AG_ACCOUNTS_OUT ?? join(homedir(), ".omp", "logs", "antigravity-accounts.jsonl");
  const record = (entry) => appendJsonLine(out, entry);

  log("antigravity-account-routing: enabled (sequential drain)", { ultraEmails, proEmails, cooldownMs });

  return addFetchHandler(async (input, init, next) => {
    try {
      return await routeRequest(input, init, next);
    } catch (error) {
      // A transport failure inside one candidate attempt (broker unreachable,
      // upstream connection reset, a continuation stream erroring) must not
      // reject the caller's fetch: fall through to the gateway's own
      // credential resolution so the request still completes on the normal
      // path instead of surfacing an unhandled rejection to the client.
      if (init?.signal?.aborted || input?.signal?.aborted) throw error;
      log(`antigravity-account-routing: candidate attempt threw; falling back to gateway credential: ${error?.message ?? error}`);
      return next(input, init);
    }
  });

  async function routeRequest(input, init, next) {
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

    // Refresh accounts cache if empty or stale (> 30s). Preserve any broker-
    // refreshed token/expiry from the in-memory cache so a reload does not
    // revert to a stale agent.db snapshot and force a redundant per-request
    // refresh (which added seconds of latency when tokens were near expiry).
    if (cachedAccounts.length === 0 || Date.now() - lastAccountsFetch > 30_000) {
      if (existsSync(agentDbPath)) {
        const fresh = loadAccounts(agentDbPath, ultraEmails, proEmails);
        for (const acc of fresh) {
          const prev = cachedAccounts.find((p) => p.id === acc.id);
          if (!prev) continue;
          if (prev.cooldownUntil > Date.now()) acc.cooldownUntil = prev.cooldownUntil;
          // Keep the freshest token: prefer the in-memory (possibly broker-
          // refreshed) one over the static agent.db snapshot.
          if (prev.token && (!acc.token || prev.expires > acc.expires)) {
            acc.token = prev.token;
            acc.expires = prev.expires;
          }
        }
        cachedAccounts = fresh;
        lastAccountsFetch = Date.now();
      }
    }

    if (cachedAccounts.length === 0) return next(input, init);

    const brokerToken = getBrokerToken();
    const isUltraRequired = ultraPattern.test(model);
    const now = Date.now();

    const ultras = sortByConfiguredOrder(cachedAccounts.filter((a) => a.isUltra), ultraEmails);
    const pros = sortByConfiguredOrder(cachedAccounts.filter((a) => a.isPro), proEmails);

    if (isUltraRequired) {
      // Ultra models (Gemini 4, Opus, Sonnet):
      // Exhaust Ultra accounts sequentially (use ultra1 until 429, then ultra2, etc.)
      const availableUltras = ultras.filter((a) => now >= a.cooldownUntil);
      const candidates = availableUltras.length > 0 ? availableUltras : ultras;
      if (candidates.length === 0) return next(input, init);

      let lastResponse;
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        await refreshAccountToken(candidate, brokerToken);

        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${candidate.token}`);

        log(`antigravity-account-routing: model "${model}" attempt ${i + 1}/${candidates.length} -> ultra (${candidate.email})`);
        const response = await next(input, { ...init, headers });

        record({
          ts: new Date().toISOString(),
          event: "account-route",
          model,
          account: candidate.email,
          tier: "ultra",
          attempt: i + 1,
          candidatesCount: candidates.length,
          status: response.status,
        });

        if (response.status !== 429) {
          return response;
        }

        let cooldownDuration = cooldownMs;
        try {
          const bodyClone = await response.clone().text();
          cooldownDuration = parseCooldownMs(bodyClone, cooldownMs);
        } catch {}
        candidate.cooldownUntil = Date.now() + cooldownDuration;
        log(
          `antigravity-account-routing: ultra account ${candidate.email} returned 429; cooling down for ${Math.round(cooldownDuration / 1000)}s`
        );

        try {
          await response.body?.cancel();
        } catch {}

        lastResponse = response;
      }
      return lastResponse;
    }

    // Pro models (Gemini 3.8 Flash, 3.5 Flash Lite, etc.):
    // Sequential drain: stick to pro1 until 429, then pro2, then pro3.
    // Only fall back to Ultra if ALL Pro accounts are in cooldown / fail.
    const availablePros = pros.filter((a) => now >= a.cooldownUntil);
    const availableUltras = ultras.filter((a) => now >= a.cooldownUntil);

    // Candidates in strict priority order: available pros first, then fallback ultras
    const candidates = [
      ...(availablePros.length > 0 ? availablePros : pros),
      ...(availableUltras.length > 0 ? availableUltras : ultras),
    ];

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

      // If successful or non-quota status, return immediately (sticks to this account)
      if (response.status !== 429) {
        return response;
      }

      // 429: account quota exhausted, set cooldown and advance to next account
      let cooldownDuration = cooldownMs;
      try {
        const bodyClone = await response.clone().text();
        cooldownDuration = parseCooldownMs(bodyClone, cooldownMs);
      } catch {}
      candidate.cooldownUntil = Date.now() + cooldownDuration;
      log(
        `antigravity-account-routing: account ${candidate.email} returned 429; cooling down for ${Math.round(cooldownDuration / 1000)}s`
      );

      try {
        await response.body?.cancel();
      } catch {}

      lastResponse = response;
    }

    return lastResponse;
  }
}
