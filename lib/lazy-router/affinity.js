// Prefix-cache affinity: send a conversation back to the unit that served it.
//
// Providers cache the processed prefix of a prompt for a few minutes, so a
// conversation that stays on one (provider, key) unit pays for its history
// once. After a request is served, the router records the first half of its
// canonical bytes (canonical.js) against the unit; a later request whose bytes
// start with a recorded prefix prefers that unit. Only (length, digest) pairs
// are kept, never content.
//
// Lookup streams the request's bytes through one incremental SHA-256 and
// snapshots the digest at every recorded length up to the request's size, so
// it costs O(|S| + k) for k distinct recorded lengths, however many entries
// share a length. The longest matching prefix wins.
//
// Prefixes shorter than `minPrefixBytes` are not recorded: providers do not
// cache prompts that short (1024 tokens is the usual floor), and the first
// bytes of every transcript are the same framing, so such a match would only
// herd unrelated conversations onto one unit.
//
// Entries live for `ttlMs` (five minutes, the usual provider cache lifetime),
// refreshed whenever a lookup matches them. The map is kept in last-touch
// order, which with a single TTL is also expiry order, so pruning only ever
// looks at the oldest entries, and the size cap evicts the least recently used.

import { createHash } from "node:crypto";

export const AFFINITY_TTL_MS = 300_000;
export const AFFINITY_MAX_ENTRIES = 50_000;
export const AFFINITY_MIN_PREFIX_BYTES = 1_024;
/**
 * Recorded prefixes are rounded down to this boundary. A lookup digests the
 * request once per *distinct* recorded length, so unrounded half-transcript
 * lengths made that set grow with every request size ever seen (thousands of
 * digests per request). Rounding keeps the same prefix-match semantics while
 * bounding the set to |transcript| / 4 KiB.
 */
export const AFFINITY_PREFIX_GRID_BYTES = 16_384;

const DIGEST = "sha256";

/** Map key of one recorded prefix. */
const entryKey = (length, digest) => `${length}:${digest}`;

/**
 * Digests of `bytes` at each of `lengths` (ascending, each <= bytes.length),
 * computed in one pass.
 * @param {Uint8Array} bytes
 * @param {number[]} lengths
 * @returns {string[]}
 */
export function prefixDigests(bytes, lengths) {
  const hash = createHash(DIGEST);
  const digests = [];
  let offset = 0;
  for (const length of lengths) {
    if (length > offset) hash.update(bytes.subarray(offset, length));
    offset = length;
    digests.push(hash.copy().digest("base64url"));
  }
  return digests;
}

/** Digest of the first `length` bytes. */
export function prefixDigest(bytes, length) {
  return createHash(DIGEST).update(bytes.subarray(0, length)).digest("base64url");
}

/**
 * @typedef {{unitKey: string, length: number}} AffinityMatch
 * @typedef {{best?: AffinityMatch, byUnit: Map<string, number>, size: number}} AffinityLookup
 *   best: the longest match; byUnit: longest matched length per unit; size: |S|
 */

export class PrefixAffinity {
  /** @param {{ttlMs?: number, maxEntries?: number, minPrefixBytes?: number, now?: () => number}} [options] */
  constructor({
    ttlMs = AFFINITY_TTL_MS,
    maxEntries = AFFINITY_MAX_ENTRIES,
    minPrefixBytes = AFFINITY_MIN_PREFIX_BYTES,
    gridBytes = AFFINITY_PREFIX_GRID_BYTES,
    now = Date.now,
    shared = null,
    refreshMs = 2_000,
  } = {}) {
    Object.assign(this, { ttlMs, maxEntries, minPrefixBytes, now });
    this.gridBytes = Math.max(1, gridBytes);
    // Shared mode: records are written through so another worker can match a
    // conversation it has not seen; lookups fall back to the shared table only
    // on a local miss, which keeps the common path in memory.
    this.shared = shared?.enabled ? shared : null;
    this.sharedLengths = [];
    this.sharedTimer = null;
    if (this.shared) {
      this.#refreshSharedLengths();
      this.sharedTimer = setInterval(() => this.#refreshSharedLengths(), refreshMs);
      this.sharedTimer.unref?.();
    }
    /** @type {Map<string, {length: number, unitKey: string, expiresAt: number}>} in last-touch order */
    this.entries = new Map();
    /** recorded length → number of live entries with it */
    this.lengthCounts = new Map();
    /** @type {number[]|undefined} distinct lengths, ascending; rebuilt when the set changes */
    this.sortedLengths = undefined;
    this.stats = { lookups: 0, hits: 0 };
  }

  get size() {
    this.#prune();
    return this.entries.size;
  }

  /**
   * Units whose recorded prefixes start `bytes`, with the longest per unit.
   * Matched entries have their TTL refreshed.
   * @param {Uint8Array} bytes
   * @returns {AffinityLookup}
   */
  lookup(bytes) {
    this.#prune();
    const byUnit = new Map();
    let best;
    if (bytes.length > 0) {
      this.stats.lookups += 1;
      const lengths = this.#lengths().filter((length) => length <= bytes.length);
      const digests = prefixDigests(bytes, lengths);
      lengths.forEach((length, i) => {
        const key = entryKey(length, digests[i]);
        const entry = this.entries.get(key);
        if (!entry) return;
        this.#touch(key, entry);
        if ((byUnit.get(entry.unitKey) ?? 0) < length) byUnit.set(entry.unitKey, length);
        if (!best || length > best.length) best = { unitKey: entry.unitKey, length };
      });
      // A conversation first seen by another worker: ask the shared table,
      // but only when this worker's own map has nothing to say.
      if (!best && this.shared) {
        const sharedLengths = this.sharedLengths.filter((length) => length <= bytes.length);
        if (sharedLengths.length > 0) {
          const sharedDigests = prefixDigests(bytes, sharedLengths);
          const found = this.shared.affinityFind(sharedDigests);
          if (found.size > 0) {
            sharedLengths.forEach((length, i) => {
              const entry = found.get(sharedDigests[i]);
              if (!entry) return;
              if ((byUnit.get(entry.unitKey) ?? 0) < length) byUnit.set(entry.unitKey, length);
              if (!best || length > best.length) best = { unitKey: entry.unitKey, length };
            });
          }
        }
      }
      if (best) this.stats.hits += 1;
    }
    return { best, byUnit, size: bytes.length };
  }

  /** Re-read the shared length set now. */
  refreshShared() {
    if (this.shared) this.#refreshSharedLengths();
  }

  #refreshSharedLengths() {
    this.sharedLengths = this.shared.affinityLengths();
  }

  /**
   * Remember that `unitKey` served a request with these bytes: its first half
   * becomes a prefix later turns of the conversation will start with.
   * @param {Uint8Array} bytes
   * @param {string} unitKey
   */
  record(bytes, unitKey) {
    const half = Math.floor(bytes.length / 2);
    // Long transcripts round down to the grid; short ones keep the exact half
    // so a 1 KB prefix still counts. Rounding loses at most one grid step of a
    // half-transcript, never enough to lose the conversation's identity.
    const length = half >= this.gridBytes * 4
      ? Math.floor(half / this.gridBytes) * this.gridBytes
      : half;
    if (length === 0 || length < this.minPrefixBytes) return;
    const digest = prefixDigest(bytes, length);
    const key = entryKey(length, digest);
    // Write through so any worker can match this conversation next turn.
    this.shared?.affinityPut(digest, length, unitKey, this.now() + this.ttlMs);
    const existing = this.entries.get(key);
    if (existing) {
      existing.unitKey = unitKey;
      this.#touch(key, existing);
      return;
    }
    this.entries.set(key, { length, unitKey, expiresAt: this.now() + this.ttlMs });
    this.#countLength(length, +1);
    while (this.entries.size > this.maxEntries) this.#evict(this.entries.keys().next().value);
  }

  /** Public counters: no digests, no unit keys. */
  view() {
    const { lookups, hits } = this.stats;
    return { entries: this.size, ttlMs: this.ttlMs, lookups, hits, hitRate: lookups ? hits / lookups : null };
  }

  #touch(key, entry) {
    entry.expiresAt = this.now() + this.ttlMs;
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  #prune() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) break;
      this.#evict(key);
    }
  }

  #evict(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.#countLength(entry.length, -1);
  }

  #countLength(length, delta) {
    const count = (this.lengthCounts.get(length) ?? 0) + delta;
    if (count > 0) this.lengthCounts.set(length, count);
    else this.lengthCounts.delete(length);
    if (count === 0 || (delta > 0 && count === 1)) this.sortedLengths = undefined;
  }

  #lengths() {
    this.sortedLengths ??= [...this.lengthCounts.keys()].sort((a, b) => a - b);
    return this.sortedLengths;
  }
}
