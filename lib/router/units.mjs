// Units: the labelled (provider, account) pairs one candidate serves through.
//
// A unit label names a provider, a tier, and an ordinal. It never names an
// account id, an e-mail, or a key. The internal key identifies the unit for
// health, capacity, and affinity, and it is never shown.

import { rebuildResponse, streamingHeaders } from "../sse.mjs";
import { accountKey } from "./tiers.mjs";

/** A provider needs this many accounts before its units carry ordinals. */
const MIN_ACCOUNTS_TO_PIN = 2;

/**
 * Build the label index for a set of account rows.
 * @param {{provider: string, id: number, tier?: string}[]} accounts
 * @returns {Map<string, {label: string, ordinal: number, tier?: string, email?: string}>}
 *   key: `${provider}/${accountId}`
 */
export function buildAccountIndex(accounts = []) {
  const grouped = new Map();
  for (const account of [...accounts].sort((left, right) => left.id - right.id)) {
    if (!grouped.has(account.provider)) grouped.set(account.provider, []);
    grouped.get(account.provider).push(account);
  }

  const index = new Map();
  for (const [provider, rows] of grouped) {
    if (rows.length < MIN_ACCOUNTS_TO_PIN) {
      const [only] = rows;
      if (!only) continue;
      index.set(accountKey(provider, only.id), {
        label: provider,
        ordinal: 1,
        tier: only.tier,
        email: only.email,
      });
      continue;
    }
    const ordinals = new Map();
    for (const row of rows) {
      const tierKey = row.tier ?? "";
      const ordinal = (ordinals.get(tierKey) ?? 0) + 1;
      ordinals.set(tierKey, ordinal);
      index.set(accountKey(provider, row.id), {
        label: `${provider}${row.tier ? `:${row.tier}` : ""}#${ordinal}`,
        ordinal,
        tier: row.tier,
        email: row.email,
      });
    }
  }
  return index;
}

/**
 * One candidate as a unit the router can probe and count.
 * @param {{provider: string, account?: number|null, unitKey?: string|null,
 *   tier?: string|null}} candidate
 * @param {ReturnType<typeof buildAccountIndex>} [index]
 * @returns {{label: string, provider: string, tier: string|undefined, key: string,
 *   credentialId: number|undefined, email: string|undefined}}
 */
export function unitFor(candidate, index = new Map()) {
  const provider = candidate.provider;
  const account = Number.isInteger(candidate.account) ? candidate.account : undefined;
  const key = candidate.unitKey ?? (account === undefined ? provider : accountKey(provider, account));
  const entry = account === undefined ? undefined : index.get(accountKey(provider, account));
  return {
    label: entry?.label ?? provider,
    provider,
    tier: candidate.tier ?? entry?.tier ?? undefined,
    key,
    credentialId: account,
    email: entry?.email,
  };
}

/**
 * The same response, with `release` called exactly once when its body has been
 * read to the end, failed, or been cancelled; at once when there is no body.
 * `onEnd(true)` runs on a clean end, `onEnd(false)` on an error or cancel.
 *
 * @param {Response} response
 * @param {{release?: () => void, onEnd?: (ok: boolean) => void, signal?: AbortSignal}} hooks
 */
export function releaseWhenSettled(response, { release = () => {}, onEnd, signal } = {}) {
  let finished = false;
  const onAbort = () => finish(false);
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    release();
    onEnd?.(ok);
  };

  if (signal) {
    if (signal.aborted) finish(false);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  if (!response.body) {
    finish(true);
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish(true);
          controller.close();
        } else controller.enqueue(value);
      } catch (error) {
        finish(false);
        controller.error(error);
      }
    },
    cancel(reason) {
      finish(false);
      return reader.cancel(reason);
    },
  });
  return rebuildResponse(response, body, { headers: streamingHeaders(response.headers) });
}
