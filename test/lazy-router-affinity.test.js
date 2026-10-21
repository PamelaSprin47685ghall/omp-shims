import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PrefixAffinity, prefixDigest, prefixDigests } from "../lib/lazy-router/affinity.js";

const bytesOf = (text) => Buffer.from(text, "utf8");
const clock = (start = 0) => {
  const c = { t: start, now: () => c.t };
  return c;
};
/** An affinity map without the production minimum prefix, for short test strings. */
const affinity = (options = {}) => new PrefixAffinity({ minPrefixBytes: 1, ...options });

describe("prefixDigests", () => {
  test("one pass yields the digest of every requested prefix", () => {
    const bytes = bytesOf("abcdefghij");
    const lengths = [0, 1, 4, 4, 10];
    const expected = lengths.map((n) => createHash("sha256").update(bytes.subarray(0, n)).digest("base64url"));
    expect(prefixDigests(bytes, lengths)).toEqual(expected);
    expect(prefixDigest(bytes, 4)).toBe(expected[2]);
  });
});

describe("PrefixAffinity", () => {
  test("records the first half and matches requests that extend it", () => {
    const map = affinity();
    map.record(bytesOf("aaaabbbb"), "u1"); // records "aaaa"
    const hit = map.lookup(bytesOf("aaaaXYZ"));
    expect(hit.best).toEqual({ unitKey: "u1", length: 4 });
    expect(hit.byUnit.get("u1")).toBe(4);
    expect(map.lookup(bytesOf("aaabbbbb")).best).toBeUndefined();
    expect(map.lookup(bytesOf("aaa")).best).toBeUndefined(); // shorter than the prefix
  });

  test("the longest matching prefix wins, and each unit reports its own best", () => {
    const map = affinity();
    map.record(bytesOf("ab".repeat(2)), "short"); // "ab"
    map.record(bytesOf("abab".repeat(4)), "long"); // "abababab"
    map.record(bytesOf("abababZZ"), "other"); // "abab"
    const { best, byUnit } = map.lookup(bytesOf("ababababab"));
    expect(best).toEqual({ unitKey: "long", length: 8 });
    expect(Object.fromEntries(byUnit)).toEqual({ short: 2, other: 4, long: 8 });
  });

  test("entries expire after the TTL; a hit refreshes it", () => {
    const c = clock();
    const map = affinity({ ttlMs: 1_000, now: c.now });
    map.record(bytesOf("keepkeep"), "u1");
    map.record(bytesOf("dropdrop"), "u2");
    c.t = 900;
    expect(map.lookup(bytesOf("keep+")).best?.unitKey).toBe("u1"); // refreshed to 1900
    c.t = 1_500;
    expect(map.lookup(bytesOf("drop+")).best).toBeUndefined();
    expect(map.lookup(bytesOf("keep+")).best?.unitKey).toBe("u1");
    c.t = 2_600;
    expect(map.lookup(bytesOf("keep+")).best).toBeUndefined();
    expect(map.size).toBe(0);
  });

  test("the size cap evicts the least recently used entry", () => {
    const map = affinity({ maxEntries: 2 });
    map.record(bytesOf("aaaa"), "a");
    map.record(bytesOf("bbbb"), "b");
    map.lookup(bytesOf("aa")); // a is now the most recent
    map.record(bytesOf("cccc"), "c");
    expect(map.size).toBe(2);
    expect(map.lookup(bytesOf("bbbb")).best).toBeUndefined();
    expect(map.lookup(bytesOf("aaaa")).best?.unitKey).toBe("a");
    expect(map.lookup(bytesOf("cccc")).best?.unitKey).toBe("c");
  });

  test("re-recording a prefix moves it to the unit that served last", () => {
    const map = affinity();
    map.record(bytesOf("samesame"), "u1");
    map.record(bytesOf("samesame"), "u2");
    expect(map.size).toBe(1);
    expect(map.lookup(bytesOf("same...")).best?.unitKey).toBe("u2");
  });

  test("prefixes below the minimum are not recorded", () => {
    const map = new PrefixAffinity({ minPrefixBytes: 1024 });
    map.record(Buffer.alloc(2046, 120), "u1");
    expect(map.size).toBe(0);
    map.record(Buffer.alloc(2048, 120), "u1");
    expect(map.lookup(Buffer.alloc(4000, 120)).best).toEqual({ unitKey: "u1", length: 1024 });
  });

  test("the public view counts lookups and hits and holds no digests or keys", () => {
    const map = affinity();
    map.record(bytesOf("aaaabbbb"), "secret-unit-key");
    map.lookup(bytesOf("aaaa"));
    map.lookup(bytesOf("zzzz"));
    map.lookup(bytesOf(""));
    const view = map.view();
    expect(view).toEqual({ entries: 1, ttlMs: 300_000, lookups: 2, hits: 1, hitRate: 0.5 });
    expect(JSON.stringify(view)).not.toContain("secret");
  });
});
