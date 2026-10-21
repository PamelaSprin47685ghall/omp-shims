import { describe, expect, test } from "bun:test";
import { runPinned } from "../lib/credential-pin.js";
import { Attempt, createAttemptLayer } from "../lib/lazy-router/attempt.js";
import { InFlightTracker, releaseWhenSettled, UNTRACKED_SLOT } from "../lib/lazy-router/capacity.js";

const LIMITED = { key: "ol", label: "ollama-cloud", provider: "ollama-cloud" };
const FREE = { key: "cp/1", label: "cline-pass#1", provider: "cline-pass" };
const tracker = () => new InFlightTracker({ limitOf: (unit) => (unit.provider === "ollama-cloud" ? 2 : 0) });

/** A response whose body the test feeds and ends by hand. */
function openResponse() {
  let controller;
  const body = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  return { response: new Response(body, { status: 200 }), controller };
}

describe("InFlightTracker and Slot", () => {
  test("a reservation counts until the first provider call takes it over", () => {
    const t = tracker();
    const slot = t.slot(LIMITED);
    expect(t.inFlight(LIMITED)).toBe(1);
    const first = slot.beginRequest();
    expect(t.inFlight(LIMITED)).toBe(1); // the reservation became the call
    const second = slot.beginRequest(); // a gateway retry is one more call
    expect(t.inFlight(LIMITED)).toBe(2);
    expect(t.hasRoom(LIMITED)).toBe(false);
    first();
    first(); // idempotent
    expect(t.inFlight(LIMITED)).toBe(1);
    second();
    expect(t.inFlight(LIMITED)).toBe(0);
  });

  test("releaseReservation gives back an unused reservation only; releaseAll ends open calls too", () => {
    const t = tracker();
    const unused = t.slot(LIMITED);
    unused.releaseReservation();
    unused.releaseReservation();
    expect(t.inFlight(LIMITED)).toBe(0);

    const busy = t.slot(LIMITED);
    busy.beginRequest();
    busy.releaseReservation(); // nothing left to give back
    expect(t.inFlight(LIMITED)).toBe(1);
    busy.releaseAll();
    expect(t.inFlight(LIMITED)).toBe(0);
  });

  test("probe slots count calls but reserve nothing", () => {
    const t = tracker();
    const probe = t.slot(LIMITED, { reserve: false });
    expect(t.inFlight(LIMITED)).toBe(0);
    const end = probe.beginRequest();
    expect(t.inFlight(LIMITED)).toBe(1);
    end();
    expect(t.inFlight(LIMITED)).toBe(0);
  });

  test("an unlimited unit gets the untracked slot and is always free", () => {
    const t = tracker();
    expect(t.slot(FREE)).toBe(UNTRACKED_SLOT);
    expect(t.isLimited(FREE)).toBe(false);
    expect(t.hasRoom(FREE)).toBe(true);
    const response = new Response("x");
    expect(UNTRACKED_SLOT.settleWith(response)).toBe(response);
  });
});

describe("releaseWhenSettled", () => {
  const counter = () => {
    const c = { n: 0, release: () => (c.n += 1) };
    return c;
  };

  test("releases once the body has been read to the end", async () => {
    const c = counter();
    const { response, controller } = openResponse();
    const wrapped = releaseWhenSettled(response, c.release);
    controller.enqueue(new TextEncoder().encode("hello"));
    const reading = wrapped.text();
    await Bun.sleep(1);
    expect(c.n).toBe(0);
    controller.close();
    expect(await reading).toBe("hello");
    expect(c.n).toBe(1);
  });

  test("releases when the reader cancels, when the body errors, and on abort", async () => {
    const cancelled = counter();
    const one = openResponse();
    await releaseWhenSettled(one.response, cancelled.release).body.cancel();
    expect(cancelled.n).toBe(1);

    const errored = counter();
    const two = openResponse();
    const reading = releaseWhenSettled(two.response, errored.release).text();
    two.controller.error(new Error("reset"));
    await expect(reading).rejects.toThrow("reset");
    expect(errored.n).toBe(1);

    const aborted = counter();
    const controller = new AbortController();
    releaseWhenSettled(openResponse().response, aborted.release, controller.signal);
    controller.abort();
    expect(aborted.n).toBe(1);
  });

  test("a response without a body releases at once and keeps status and headers otherwise", async () => {
    const c = counter();
    releaseWhenSettled(new Response(null, { status: 204 }), c.release);
    expect(c.n).toBe(1);
    const wrapped = releaseWhenSettled(new Response("x", { status: 429, headers: { "retry-after": "3" } }), () => {});
    expect(wrapped.status).toBe(429);
    expect(wrapped.headers.get("retry-after")).toBe("3");
  });
});

describe("the attempt layer counts provider calls", () => {
  const credentials = { isBrokerUrl: () => false };
  const layer = createAttemptLayer({ credentials });
  const attemptOn = (t) =>
    new Attempt({ unit: LIMITED, model: "ollama-cloud/glm", upstreamHost: "ollama.example", slot: t.slot(LIMITED) });
  const call = (attempt, next) =>
    runPinned(attempt, () => layer("https://ollama.example/v1/chat", { method: "POST", body: "{}" }, next));

  test("from the call leaving until its body is consumed", async () => {
    const t = tracker();
    const { response, controller } = openResponse();
    const answer = await call(attemptOn(t), async () => response);
    expect(t.inFlight(LIMITED)).toBe(1);
    controller.close();
    await answer.text();
    expect(t.inFlight(LIMITED)).toBe(0);
  });

  test("an error answer ends the call once its body has arrived, and the gateway can still read it", async () => {
    const t = tracker();
    const answer = await call(attemptOn(t), async () => new Response('{"error":"busy"}', { status: 429 }));
    // The layer read the error snippet, which drew the whole (short) body from upstream.
    expect(t.inFlight(LIMITED)).toBe(0);
    expect(await answer.text()).toContain("busy");
  });

  test("a call that throws is released at once", async () => {
    const t = tracker();
    await expect(
      call(attemptOn(t), async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
    expect(t.inFlight(LIMITED)).toBe(0);
  });

  test("an aborted call is released even if nobody reads its body", async () => {
    const t = tracker();
    const controller = new AbortController();
    const attempt = attemptOn(t);
    await runPinned(attempt, () =>
      layer(
        "https://ollama.example/v1/chat",
        { method: "POST", body: "{}", signal: controller.signal },
        async () => openResponse().response,
      ),
    );
    expect(t.inFlight(LIMITED)).toBe(1);
    controller.abort();
    expect(t.inFlight(LIMITED)).toBe(0);
  });
});
