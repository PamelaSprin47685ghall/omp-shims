// Contract tests for the outbound fetch pipeline.
//
// One globalThis.fetch wrapper per process, priority order with a per-call
// snapshot, isolation of broken handlers, and propagation of genuine network
// failures. Every test installs a local stand-in fetch first.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import * as outbound from "../lib/outbound.mjs";

const realFetch = globalThis.fetch;

/** Keep expected failure logs out of the test output. */
function silenceReport() {
  const original = console.error;
  console.error = () => {};
  return () => {
    console.error = original;
  };
}

afterEach(() => {
  outbound.resetOutboundForTests();
  globalThis.fetch = realFetch;
});

afterAll(() => {
  outbound.resetOutboundForTests();
  globalThis.fetch = realFetch;
  expect(globalThis.fetch).toBe(realFetch);
});

describe("single globalThis.fetch wrapper", () => {
  test("installs once, never double-wraps, and restores on the last dispose", () => {
    const stand_in = async () => new Response("stand-in");
    globalThis.fetch = stand_in;

    const disposeFirst = outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 10 });
    const patched = globalThis.fetch;
    expect(patched).not.toBe(stand_in);

    const disposeSecond = outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 20 });
    expect(globalThis.fetch).toBe(patched);

    disposeSecond();
    expect(globalThis.fetch).toBe(patched);

    disposeFirst();
    expect(globalThis.fetch).toBe(stand_in);
  });

  test("resetOutboundForTests() restores the original fetch", () => {
    const stand_in = async () => new Response("stand-in");
    globalThis.fetch = stand_in;
    outbound.addFetchHandler(async (input, init, next) => next(input, init));
    expect(globalThis.fetch).not.toBe(stand_in);

    outbound.resetOutboundForTests();
    expect(globalThis.fetch).toBe(stand_in);
  });
});

describe("dispose", () => {
  test("removes two handlers, restores the exact original, and is idempotent", () => {
    const stand_in = async () => new Response("stand-in");
    globalThis.fetch = stand_in;
    outbound.dispose();
    expect(globalThis.fetch).toBe(stand_in);

    outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 10 });
    outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 20 });
    expect(globalThis.fetch).not.toBe(stand_in);

    outbound.dispose();
    expect(globalThis.fetch).toBe(stand_in);

    outbound.dispose();
    expect(globalThis.fetch).toBe(stand_in);
  });

  test("leaves a third-party replacement in place", () => {
    const stand_in = async () => new Response("stand-in");
    globalThis.fetch = stand_in;
    outbound.addFetchHandler(async (input, init, next) => next(input, init));
    const replacement = async () => new Response("replacement");
    globalThis.fetch = replacement;

    outbound.dispose();
    expect(globalThis.fetch).toBe(replacement);
  });

  test("a handler registered after dispose creates one fresh wrapper", async () => {
    const stand_in = async () => new Response("stand-in");
    globalThis.fetch = stand_in;
    outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 10 });
    outbound.dispose();

    let calls = 0;
    outbound.addFetchHandler(
      async (input, init, next) => {
        calls += 1;
        return next(input, init);
      },
      { priority: 10 },
    );
    const fresh = globalThis.fetch;
    expect(fresh).not.toBe(stand_in);

    outbound.addFetchHandler(async (input, init, next) => next(input, init), { priority: 20 });
    expect(globalThis.fetch).toBe(fresh);
    expect(await (await globalThis.fetch("https://j.example")).text()).toBe("stand-in");
    expect(calls).toBe(1);
  });

  test("bypassFetch calls the true original before and after dispose", async () => {
    const seen = [];
    const stand_in = async (input) => {
      seen.push(input);
      return new Response(`net:${input}`);
    };
    globalThis.fetch = stand_in;
    outbound.addFetchHandler(async () => new Response("handler"), { priority: 10 });

    expect(await (await outbound.bypassFetch("https://k.example")).text()).toBe("net:https://k.example");
    expect(seen).toEqual(["https://k.example"]);

    outbound.dispose();
    expect(await (await outbound.bypassFetch("https://k.example")).text()).toBe("net:https://k.example");
    expect(seen).toEqual(["https://k.example", "https://k.example"]);
  });
});

describe("outboundPriority", () => {
  test("is frozen and keeps the v1 onion order", () => {
    const priority = outbound.outboundPriority;
    expect(Object.isFrozen(priority)).toBe(true);
    expect(Object.keys(priority).sort()).toEqual(
      [
        "toolIdHash",
        "antigravityCapture",
        "antigravityAccountRouting",
        "antigravityContinuation",
        "antigravitySystemInstruction",
        "copilotAuto",
        "lazyRouter",
        "clinePinUpstream",
        "antigravityRouting",
        "ipv6First",
        "antigravitySanitizer",
      ].sort(),
    );

    expect(priority.toolIdHash).toBeLessThan(priority.lazyRouter);
    expect(priority.lazyRouter).toBeLessThan(priority.clinePinUpstream);
    expect(priority.clinePinUpstream).toBeLessThan(priority.ipv6First);
    expect(priority.ipv6First).toBeLessThan(priority.antigravitySanitizer);
    expect(priority.antigravityAccountRouting).toBeLessThan(priority.antigravityContinuation);
    expect(priority.antigravityContinuation).toBeLessThan(priority.antigravitySystemInstruction);
    expect(priority.copilotAuto).toBeLessThan(priority.lazyRouter);
  });
});

describe("priority order", () => {
  test("a smaller priority runs further out and can rewrite the call", async () => {
    let networkInput;
    globalThis.fetch = async (input) => {
      networkInput = input;
      return new Response(`net:${input}`);
    };
    const seen = [];
    const dispose = [
      outbound.addFetchHandler(
        async (input, init, next) => {
          seen.push("outer");
          return next(`${input}/outer`, init);
        },
        { priority: 10 },
      ),
      outbound.addFetchHandler(
        async (input, init, next) => {
          seen.push("inner");
          return next(input, init);
        },
        { priority: 20 },
      ),
    ];
    try {
      expect(await (await globalThis.fetch("https://a.example")).text()).toBe("net:https://a.example/outer");
      expect(seen).toEqual(["outer", "inner"]);
      expect(networkInput).toBe("https://a.example/outer");
    } finally {
      for (const remove of dispose) remove();
    }
  });
});

describe("mid-flight dispose", () => {
  test("a snapshot keeps a handler that is disposed during the call", async () => {
    globalThis.fetch = async () => new Response("net");
    let innerCalls = 0;
    let disposeInner;
    const disposeOuter = outbound.addFetchHandler(
      async (input, init, next) => {
        disposeInner();
        return next(input, init);
      },
      { name: "outer", priority: 10 },
    );
    disposeInner = outbound.addFetchHandler(
      async (input, init, next) => {
        innerCalls += 1;
        return next(input, init);
      },
      { name: "inner", priority: 20 },
    );

    try {
      await globalThis.fetch("https://b.example");
      await globalThis.fetch("https://b.example");
      expect(innerCalls).toBe(1);
    } finally {
      disposeOuter();
    }
  });
});

describe("failure isolation", () => {
  test("a sync throw and an async rejection both degrade to next", async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      return new Response("net");
    };
    const dispose = [
      outbound.addFetchHandler(
        () => {
          throw new Error("sync bug");
        },
        { name: "sync-broken", priority: 10 },
      ),
      outbound.addFetchHandler(
        async () => {
          throw new Error("async bug");
        },
        { name: "async-broken", priority: 20 },
      ),
    ];
    const restore = silenceReport();
    try {
      expect(await (await globalThis.fetch("https://c.example")).text()).toBe("net");
      expect(networkCalls).toBe(1);
    } finally {
      restore();
      for (const remove of dispose) remove();
    }
  });

  test("a network rejection propagates to the caller and runs exactly once", async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("network-down");
    };
    let observed = 0;
    const dispose = outbound.addFetchHandler(
      async (input, init, next) => {
        try {
          return await next(input, init);
        } catch (error) {
          observed += 1;
          throw error;
        }
      },
      { name: "observer", priority: 10 },
    );
    const restore = silenceReport();
    try {
      await expect(globalThis.fetch("https://d.example")).rejects.toThrow("network-down");
      expect(observed).toBe(1);
      expect(networkCalls).toBe(1);
    } finally {
      restore();
      dispose();
    }
  });

  test("a network rejection is not reported as a handler failure", async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      throw new Error("connect ECONNREFUSED 127.0.0.1:443");
    };
    const lines = [];
    const originalError = console.error;
    console.error = (...args) => {
      lines.push(args.join(" "));
    };
    const dispose = [10, 20, 30].map((priority, index) =>
      outbound.addFetchHandler(async (input, init, next) => next(input, init), {
        name: `pass-through-${index}`,
        priority,
      }),
    );
    try {
      await expect(globalThis.fetch("https://g.example")).rejects.toThrow("ECONNREFUSED");
      expect(networkCalls).toBe(1);
      expect(lines.filter((line) => line.includes("fetch handler") && line.includes("failed"))).toEqual([]);
    } finally {
      console.error = originalError;
      for (const remove of dispose) remove();
    }
  });

  test("a handler bug after a successful next degrades to a second next", async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      return new Response("net");
    };
    const dispose = outbound.addFetchHandler(
      async (input, init, next) => {
        await next(input, init);
        throw new Error("late bug");
      },
      { name: "late-bug", priority: 10 },
    );
    const restore = silenceReport();
    try {
      expect(await (await globalThis.fetch("https://e.example")).text()).toBe("net");
      expect(networkCalls).toBe(2);
    } finally {
      restore();
      dispose();
    }
  });
});

describe("bypassFetch", () => {
  test("skips every handler in the pipeline", async () => {
    globalThis.fetch = async (input) => new Response(`net:${input}`);
    let pipelineCalls = 0;
    const dispose = outbound.addFetchHandler(
      async (input, init, next) => {
        pipelineCalls += 1;
        return next(input, init);
      },
      { name: "counter", priority: 10 },
    );
    try {
      expect(await (await outbound.bypassFetch("https://f.example")).text()).toBe("net:https://f.example");
      expect(pipelineCalls).toBe(0);
      await globalThis.fetch("https://f.example");
      expect(pipelineCalls).toBe(1);
    } finally {
      dispose();
    }
  });
});

describe("intentional attempt abandonment", () => {
  test("an AttemptAbandoned error propagates without a fallback call or a failure report", async () => {
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls += 1;
      return new Response("net");
    };
    const lines = [];
    const originalError = console.error;
    console.error = (...args) => {
      lines.push(args.join(" "));
    };
    const abandoned = new Error("attempt abandoned");
    abandoned.name = "AttemptAbandoned";
    const dispose = outbound.addFetchHandler(
      async () => {
        throw abandoned;
      },
      { name: "lazy-router", priority: outbound.outboundPriority.lazyRouter },
    );
    try {
      await expect(globalThis.fetch("https://i.example")).rejects.toBe(abandoned);
      expect(networkCalls).toBe(0);
      expect(lines.filter((line) => line.includes("fetch handler") && line.includes("failed"))).toEqual([]);
    } finally {
      console.error = originalError;
      dispose();
    }
  });
});
