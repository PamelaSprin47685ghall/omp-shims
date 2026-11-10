// Prefix-cache affinity: send a conversation back to the unit that served it.
//
// Providers cache the processed prefix of a prompt for a few minutes. After a
// request is served, the caller records the prefix digests it observed against
// the serving unit. A later request orders the same unit first when one of its
// digests matches the longest recorded prefix.
//
// Only (length, digest) pairs are stored, never prompt content. The shared
// table has one row per digest, a TTL and a hard entry cap. A lookup is one
// indexed query with the digests the caller already computed.

export const AFFINITY_TTL_MS = 300_000;
export const AFFINITY_MAX_ENTRIES = 50_000;
export const AFFINITY_MIN_PREFIX_BYTES = 1_024;
/** Rolling hit-rate window, in minute buckets. */
export const AFFINITY_WINDOW_MINUTES = 5;
/** Buckets kept beyond the window so a late reader still sees the whole window. */
const AFFINITY_STAT_RETENTION_MINUTES = 10;

/** Normalize one digest entry: {length, digest}, [length, digest] or digest. */
function digestEntry(value) {
  if (typeof value === "string") return { digest: value, length: null };
  if (Array.isArray(value)) {
    const length = Number(value[0]);
    return {
      digest: typeof value[1] === "string" ? value[1] : undefined,
      length: Number.isFinite(length) ? length : null,
    };
  }
  if (value && typeof value === "object" && typeof value.digest === "string") {
    const length = Number(value.length);
    return { digest: value.digest, length: Number.isFinite(length) ? length : null };
  }
  return undefined;
}

function digestList(digests) {
  if (!Array.isArray(digests)) return [];
  return digests.map(digestEntry).filter((entry) => entry?.digest);
}

export class PrefixAffinity {
  /**
   * @param {{store?: import("./state-store.mjs").StateStore, ttlMs?: number,
   *   maxEntries?: number, minPrefixBytes?: number, now?: () => number}} [options]
   */
  constructor({
    store = null,
    ttlMs = AFFINITY_TTL_MS,
    maxEntries = AFFINITY_MAX_ENTRIES,
    minPrefixBytes = AFFINITY_MIN_PREFIX_BYTES,
    now = Date.now,
  } = {}) {
    this.store = store;
    this.ttlMs = Math.max(1, ttlMs);
    this.maxEntries = Math.max(1, maxEntries);
    this.minPrefixBytes = Math.max(1, minPrefixBytes);
    this.now = now;
    /** digest -> entry, used only when no store exists */
    this.local = new Map();
    this.remembered = 0;
    this.lastPrune = 0;
    /** minute -> {hits, lookups}, used only when no store exists */
    this.stats = new Map();
  }

  /**
   * Reorder unit keys so the unit with the longest matching prefix comes
   * first. Every input key is kept, in its original order otherwise.
   * @param {string[]} unitKeys
   * @param {{digests?: Array<{length: number, digest: string}|[number, string]|string>}} [options]
   * @returns {string[]}
   */
  order(unitKeys, { digests } = {}) {
    return this.lookup(unitKeys, { digests }).keys;
  }

  /**
   * The lookup decision itself: one lookup per request that has at least two
   * candidates and at least one digest, one hit only when an eligible unit
   * moves to the front. The counters are written here, not in `remember()`,
   * so a retry cannot count twice.
   *
   * `share` is the matched prefix length over the transcript length: the
   * fraction of the prompt the provider can serve from its cache.
   * @param {string[]} unitKeys
   * @param {{digests?: Array<{length: number, digest: string}|[number, string]|string>,
   *   transcriptLength?: number}} [options]
   * @returns {{keys: string[], hit: boolean, lookedUp: boolean,
   *   matchedLength: number, share: number}}
   */
  lookup(unitKeys, { digests, transcriptLength } = {}) {
    const keys = Array.isArray(unitKeys)
      ? unitKeys.map((key) => (typeof key === "string" ? key : (key?.unitKey ?? key?.key))).filter(Boolean)
      : [];
    let entries = digestList(digests);
    if (keys.length < 2 || entries.length === 0) {
      return { keys, hit: false, lookedUp: false, matchedLength: 0, share: 0 };
    }

    let ordered = keys;
    let matchedLength = 0;
    let matchedUnit = null;
    let hit = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const found = this.#lookup(entries);
      const unit = found?.unitKey;
      if (unit && keys.includes(unit)) {
        ordered = [unit, ...keys.filter((key) => key !== unit)];
        matchedUnit = unit;
        matchedLength = Math.max(0, Number(found.length) || 0);
        hit = ordered[0] !== keys[0];
        break;
      }
      if (!found) break;
      const shorter = entries.filter((entry) => entry.length !== null && entry.length < found.length);
      if (shorter.length === 0 || shorter.length === entries.length) break;
      entries = shorter;
    }
    const length = Number(transcriptLength);
    const share = matchedLength > 0 && Number.isFinite(length) && length > 0 ? Math.min(1, matchedLength / length) : 0;
    this.#recordStat(hit ? 1 : 0, 1, this.now());
    return { keys: ordered, hit, lookedUp: true, matchedUnit, matchedLength, share };
  }

  /** Local counter sums for the window starting at `sinceMinute`. */
  statsSince(sinceMinute, untilMinute = Math.floor(this.now() / 60_000)) {
    const since = Number(sinceMinute);
    let hits = 0;
    let lookups = 0;
    for (const [minute, bucket] of this.stats) {
      if (minute < since || minute > untilMinute) continue;
      hits += bucket.hits;
      lookups += bucket.lookups;
    }
    return { hits, lookups, sinceMinute: since, untilMinute };
  }

  /** One counter write per lookup decision. */
  #recordStat(hits, lookups, at) {
    const minute = Math.floor(at / 60_000);
    if (typeof this.store?.recordAffinityStat === "function") {
      try {
        this.store.recordAffinityStat(minute, hits, lookups);
        return;
      } catch {
        // Counter loss must not fail a request; fall through to the local map.
      }
    }
    let bucket = this.stats.get(minute);
    if (!bucket) {
      bucket = { hits: 0, lookups: 0 };
      this.stats.set(minute, bucket);
    }
    bucket.hits += hits;
    bucket.lookups += lookups;
    for (const key of this.stats.keys()) {
      if (minute - key > AFFINITY_STAT_RETENTION_MINUTES) this.stats.delete(key);
    }
  }

  /**
   * Record the prefix digests one unit served. Entries shorter than
   * `minPrefixBytes` are ignored; an entry without a length is ignored too,
   * because it cannot be compared with another prefix.
   */
  remember(unitKey, digests) {
    const at = this.now();
    const expiresAt = at + this.ttlMs;
    let wrote = 0;
    for (const entry of digestList(digests)) {
      if (entry.length === null || entry.length < this.minPrefixBytes) continue;
      this.#put(entry.digest, entry.length, unitKey, expiresAt);
      wrote += 1;
    }
    if (wrote === 0) return;
    this.remembered += wrote;
    if (this.store && (this.remembered % 128 === 0 || at - this.lastPrune > 30_000)) {
      this.lastPrune = at;
      this.store.pruneAffinity(at, this.maxEntries);
    }
  }

  /** Live entries in the local fallback or the shared table count. */
  get size() {
    if (this.store) return this.store.countAffinity();
    this.#pruneLocal(this.now());
    return this.local.size;
  }

  #put(digest, length, unitKey, expiresAt) {
    if (this.store) {
      this.store.putAffinity(digest, length, unitKey, expiresAt);
      return;
    }
    this.local.delete(digest);
    this.local.set(digest, { length, unitKey, expiresAt });
    this.#pruneLocal(expiresAt - this.ttlMs);
    while (this.local.size > this.maxEntries) this.local.delete(this.local.keys().next().value);
  }

  #lookup(entries) {
    if (this.store) {
      const found = this.store.lookupAffinity(entries.map((entry) => entry.digest));
      return found ?? undefined;
    }
    const at = this.now();
    let best;
    for (const entry of entries) {
      const row = this.local.get(entry.digest);
      if (!row || row.expiresAt <= at) continue;
      if (!best || row.length > best.length) best = { unitKey: row.unitKey, length: row.length };
    }
    return best;
  }

  #pruneLocal(at) {
    for (const [digest, entry] of this.local) {
      if (entry.expiresAt > at) break;
      this.local.delete(digest);
    }
  }
}
