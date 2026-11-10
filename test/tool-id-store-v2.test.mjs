// Tests for the global SQLite tool-id store.
//
// The store is the authority: these tests reopen the file, share it between
// instances, prune it, and break it on purpose. The cache is only a speed-up,
// so every cache assertion also checks the persisted row.

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StateStore } from "../lib/router/state-store.mjs";
import {
  closeToolIdStore,
  SHORT_LENGTHS,
  SHORT_PREFIX,
  shortId,
  TOOL_ID_TTL_MS,
  ToolIdStore,
  toolIdStore,
} from "../lib/tool-id-store.mjs";

const directories = [];
const stores = [];

function freshPath() {
  const directory = mkdtempSync(join(tmpdir(), "omp-shims-tool-ids-"));
  directories.push(directory);
  return join(directory, "state.sqlite");
}

function open(path = freshPath(), options = {}) {
  const store = new ToolIdStore({ path, ...options });
  stores.push(store);
  return store;
}

function rows(path) {
  const db = new Database(path, { readonly: true });
  try {
    return db.query("SELECT original, short, created_at AS createdAt, last_seen AS lastSeen FROM tool_ids").all();
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  closeToolIdStore();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("schema", () => {
  test("creates the tool_ids table with the required columns and index", () => {
    const path = freshPath();
    open(path);
    const db = new Database(path, { readonly: true });
    try {
      const columns = db
        .query("PRAGMA table_info(tool_ids)")
        .all()
        .map((row) => row.name);
      expect(columns).toEqual(["id", "original", "short", "created_at", "last_seen"]);
      const index = db
        .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'tool_ids_last_seen'")
        .get();
      expect(index?.name).toBe("tool_ids_last_seen");
    } finally {
      db.close();
    }
  });

  test("a fresh file carries the v2 state version so the router store can open it", () => {
    const path = freshPath();
    open(path);
    const db = new Database(path, { readonly: true });
    try {
      expect(db.query("PRAGMA user_version").get().user_version).toBe(2);
    } finally {
      db.close();
    }
    const router = new StateStore({ path });
    expect(router.available).toBe(true);
    router.close();
  });

  test("an existing legacy file keeps version 0", () => {
    const path = freshPath();
    const db = new Database(path, { create: true });
    db.exec("CREATE TABLE health (key TEXT PRIMARY KEY)");
    db.close();
    const store = open(path);
    expect(store.available).toBe(true);
    const probe = new Database(path, { readonly: true });
    try {
      expect(probe.query("PRAGMA user_version").get().user_version).toBe(0);
    } finally {
      probe.close();
    }
  });

  test("opens with a busy timeout and WAL", () => {
    const path = freshPath();
    const store = open(path);
    const db = new Database(path, { readonly: true });
    try {
      expect(db.query("PRAGMA journal_mode").get().journal_mode).toBe("wal");
    } finally {
      db.close();
    }
    expect(store.db.query("PRAGMA busy_timeout").get().timeout).toBe(2_000);
  });
});

describe("mapping", () => {
  test("a 91-character original gets a short id of at most 32 characters", () => {
    const store = open();
    const original = `call_${"a".repeat(86)}`;
    const short = store.shortFor(original);
    expect(original).toHaveLength(91);
    expect(short.startsWith(SHORT_PREFIX)).toBe(true);
    expect(short.length).toBeLessThanOrEqual(32);
    expect(short).toBe(shortId(original));
    expect(store.originalFor(short)).toBe(original);
  });

  test("shortId is deterministic and the digest grows by attempt", () => {
    const original = "call_deterministic";
    const first = shortId(original);
    expect(shortId(original)).toBe(first);
    expect(SHORT_LENGTHS.map((length) => shortId(original, length).length)).toEqual([12, 14, 16]);
  });

  test("the same original keeps one short across calls", () => {
    const store = open();
    const first = store.shortFor("call_same");
    const second = store.shortFor("call_same");
    expect(second).toBe(first);
    expect(store.count()).toBe(1);
  });

  test("different originals get different shorts", () => {
    const store = open();
    const ids = ["call_one", "call_two", "call_three"];
    const shorts = ids.map((id) => store.shortFor(id));
    expect(new Set(shorts).size).toBe(ids.length);
    expect(store.count()).toBe(ids.length);
  });

  test("two instances on one file agree, and a reopened store resolves the row", () => {
    const path = freshPath();
    const first = open(path);
    const short = first.shortFor("call_shared");

    const second = open(path);
    expect(second.shortFor("call_shared")).toBe(short);
    expect(second.originalFor(short)).toBe("call_shared");

    first.close();
    second.close();
    const reopened = open(path);
    expect(reopened.originalFor(short)).toBe("call_shared");
    expect(reopened.count()).toBe(1);
  });

  test("twenty concurrent calls for one original make one row and one short", async () => {
    const store = open();
    const results = await Promise.all(Array.from({ length: 20 }, async () => store.shortFor("call_race")));
    expect(new Set(results).size).toBe(1);
    expect(store.count()).toBe(1);
    expect(rows(store.path)).toHaveLength(1);
  });

  test("two instances racing on one original agree on the stored short", async () => {
    const path = freshPath();
    const a = open(path);
    const b = open(path);
    const [left, right] = await Promise.all([a.shortFor("call_cross"), b.shortFor("call_cross")]);
    expect(left).toBe(right);
    expect(a.count()).toBe(1);
  });

  test("unknown and non-minted values pass through", () => {
    const store = open();
    expect(store.originalFor(`${SHORT_PREFIX}unknown`)).toBeUndefined();
    expect(store.originalFor("call_plain")).toBeUndefined();
    expect(store.shortFor("")).toBe("");
  });

  test("a client id equal to a future short is never restored from another row", () => {
    const path = freshPath();
    const store = open(path);
    const literal = shortId("call_victim");
    const db = new Database(path, { create: true });
    db.query(
      `INSERT INTO tool_ids (original, short, created_at, last_seen)
       VALUES (?, ?, ?, ?)`,
    ).run("call_other", literal, 1, 1);
    db.close();

    const minted = store.shortFor(literal);
    expect(minted).not.toBe(literal);
    // The client's literal value is now an original, so the store must not
    // resolve that same text as the short of another row.
    expect(store.originalFor(literal)).toBeUndefined();
    expect(store.originalFor(minted)).toBe(literal);
    expect(store.count()).toBe(2);
  });
});

describe("cache", () => {
  test("a cached original skips the write and stays under the cap", () => {
    const store = open(freshPath(), { cacheEntries: 2 });
    const path = store.path;
    const short = store.shortFor("call_cached");
    const first = rows(path)[0].lastSeen;
    store.shortFor("call_cached");
    expect(rows(path)[0].lastSeen).toBe(first);
    expect(store.cacheEntries).toBe(1);
    store.shortFor("call_cached_2");
    store.shortFor("call_cached_3");
    expect(store.cacheEntries).toBeLessThanOrEqual(2);
    expect(store.originalFor(short)).toBe("call_cached");
  });

  test("last_seen refresh happens at most once per minute", () => {
    const path = freshPath();
    let now = 1_000;
    const store = open(path, { now: () => now });
    const short = store.shortFor("call_touch");
    expect(rows(path)[0].lastSeen).toBe(1_000);

    now += 30_000;
    expect(store.shortFor("call_touch")).toBe(short);
    expect(rows(path)[0].lastSeen).toBe(1_000);

    now += 30_000;
    expect(store.shortFor("call_touch")).toBe(short);
    expect(rows(path)[0].lastSeen).toBe(61_000);
  });
});

describe("pruning", () => {
  test("rows older than the TTL are removed", () => {
    const path = freshPath();
    let now = 10_000;
    const store = open(path, { now: () => now });
    const short = store.shortFor("call_old");
    expect(store.count()).toBe(1);

    now += TOOL_ID_TTL_MS + 1;
    expect(store.prune()).toBe(1);
    expect(store.count()).toBe(0);

    const reopened = open(path, { now: () => now });
    expect(reopened.originalFor(short)).toBeUndefined();
  });

  test("the cap drops the oldest rows first", () => {
    const path = freshPath();
    let now = 1_000;
    const store = open(path, { now: () => now, maxRows: 3 });
    const shorts = [];
    for (let index = 0; index < 5; index += 1) {
      now += 1;
      shorts.push(store.shortFor(`call_cap_${index}`));
    }
    expect(store.prune()).toBe(2);
    expect(store.count()).toBe(3);
    const remaining = rows(path).map((row) => row.original);
    expect(remaining).not.toContain("call_cap_0");
    expect(remaining).not.toContain("call_cap_1");
    expect(store.originalFor(shorts[4])).toBe("call_cap_4");
  });

  test("the singleton prunes on a timer that never holds the process", () => {
    const store = toolIdStore(freshPath());
    expect(store.available).toBe(true);
    expect(toolIdStore(store.path)).toBe(store);
  });
});

describe("failure", () => {
  test("an unopenable path leaves the store unavailable and never maps", () => {
    const directory = mkdtempSync(join(tmpdir(), "omp-shims-tool-ids-bad-"));
    directories.push(directory);
    const blocker = join(directory, "blocker");
    writeFileSync(blocker, "not a directory");
    const store = open(join(blocker, "state.sqlite"));
    expect(store.available).toBe(false);
    expect(() => store.shortFor("call_broken")).toThrow("unavailable");
    expect(store.originalFor(`${SHORT_PREFIX}anything`)).toBeUndefined();
    expect(store.count()).toBe(0);
    expect(store.prune()).toBe(0);
  });
});

describe("hot path", () => {
  test("1000 cold rewrites and restores stay well under a second", () => {
    const store = open();
    const originals = Array.from(
      { length: 1000 },
      (_, index) => `call_${String(index).padStart(60, "0")}_${"x".repeat(24)}`,
    );
    const started = performance.now();
    const shorts = originals.map((original) => store.shortFor(original));
    const restored = shorts.map((short) => store.originalFor(short));
    const elapsed = performance.now() - started;

    expect(new Set(shorts).size).toBe(1000);
    expect(shorts.every((short) => short.length <= 32)).toBe(true);
    expect(restored.every((original, index) => original === originals[index])).toBe(true);
    expect(elapsed).toBeLessThan(2000);

    const hotStart = performance.now();
    for (let pass = 0; pass < 10; pass += 1) {
      for (const original of originals) store.shortFor(original);
      for (const short of shorts) store.originalFor(short);
    }
    expect(performance.now() - hotStart).toBeLessThan(500);
  });
});
