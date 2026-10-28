import { describe, expect, test } from "bun:test";
import { lazyRouterHandler } from "../features/lazy-router.js";
import { describeStatus, relative } from "../lib/lazy-router/status-page/view.js";
import { LABELS } from "../lib/lazy-router/status-page/labels.js";
import { ASSET_PREFIX, CONTENT_SECURITY_POLICY, escapeHtml, renderStatusPage } from "../lib/lazy-router/status-page.js";

const STATUS_PATH = "/v1/lazy/status";
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const NOW = Date.parse("2026-10-20T12:00:00Z");

/** A status document shaped like the router's, with one cooling unit and a not-applicable one. */
const STATUS = {
  now: "2026-10-20T12:00:00.000Z",
  period: "offPeak",
  clock: { period: "offPeak", localTime: "2026-10-20 20:00", dayKind: "workday", calendarStatus: "official" },
  nextSwitch: { at: "2026-10-21T01:00:00.000Z", period: "peak" },
  catalogReady: true,
  affinity: { entries: 12, ttlMs: 300000, lookups: 8, hits: 5, hitRate: 0.625 },
  routes: {
    default: [
      {
        unit: "p:gold#1",
        model: "p/big",
        effortPolicy: "capped",
        eligible: true,
        health: "cooling",
        coolingSince: "2026-10-20T11:59:00.000Z",
        reason: "upstream 429 Too Many Requests",
        nextProbeAt: "2026-10-20T12:29:00.000Z",
      },
      {
        unit: "p:gold#2",
        model: "p/big",
        effortPolicy: "capped",
        eligible: true,
        health: "alive",
        inFlight: 2,
        maxInFlight: 3,
      },
    ],
    vision: [
      { unit: "q", model: "q/text", effortPolicy: "high", eligible: false, health: "alive" },
      { unit: "p:gold#2", model: "p/big", effortPolicy: "high", eligible: true, health: "alive" },
    ],
  },
  alternate: {
    period: "peak",
    routes: {
      default: [],
      vision: [
        { unit: "q", model: "q/text", effortPolicy: "high", eligible: false, health: "alive" },
        { unit: "p:gold#1", model: "p/big", effortPolicy: "high", eligible: true, health: "alive" },
      ],
    },
  },
};

/** The router's inbound handler over a gateway that demands a token everywhere. */
function inbound() {
  const gatewayCalls = [];
  const gateway = async (request) => {
    gatewayCalls.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  };
  const router = {
    status: () => Response.json(STATUS),
    statusView: () => STATUS,
    advertisedModels: () => [],
    handles: () => false,
  };
  const handle = lazyRouterHandler(gateway, { router, dispatcher: { bind() {} }, statusPath: STATUS_PATH });
  const send = (method, path, headers = {}) => handle(new Request(`http://gateway.test${path}`, { method, headers }));
  return { send, gatewayCalls };
}

describe("public paths", () => {
  test("GET / serves the server-rendered page without a token", async () => {
    const { send, gatewayCalls } = inbound();
    const response = await send("GET", "/", { accept: "text/html" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    const html = await response.text();
    expect(html).toStartWith("<!doctype html>");
    // The state is in the HTML itself, not only after JavaScript runs.
    expect(html).toContain("p:gold#2");
    expect(html).toContain("upstream 429 Too Many Requests");
    expect(gatewayCalls).toEqual([]);
  });

  test("HEAD / and the page's own assets are public; assets carry their types", async () => {
    const { send } = inbound();
    const head = await send("HEAD", "/");
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const [name, type] of [
      ["style.css", "text/css"],
      ["client.js", "text/javascript"],
      ["view.js", "text/javascript"],
      ["labels.js", "text/javascript"],
    ]) {
      const response = await send("GET", `${ASSET_PREFIX}/${name}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith(type);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  test("the status JSON stays JSON whatever the client accepts", async () => {
    const response = await inbound().send("GET", STATUS_PATH, { accept: "text/html" });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("everything else still goes through the gateway's authentication", async () => {
    const { send, gatewayCalls } = inbound();
    const others = [
      ["POST", "/"],
      ["GET", "/v1/models"],
      ["GET", "/index.html"],
      ["GET", `${ASSET_PREFIX}/../../v1/models`],
      ["GET", `${ASSET_PREFIX}/secret.js`],
      ["POST", `${ASSET_PREFIX}/client.js`],
      ["GET", `${STATUS_PATH}/x`],
    ];
    for (const [method, path] of others) expect((await send(method, path)).status).toBe(401);
    expect(gatewayCalls).toHaveLength(others.length);
  });
});

describe("route labels", () => {
  test("weak has a stable Chinese status-page label", () => {
    expect(LABELS.routes.weak).toBe("弱档");
  });
});

describe("display model", () => {
  test("not-applicable units are hidden and numbering stays contiguous", () => {
    const view = describeStatus(STATUS);
    const vision = view.routes.find((route) => route.title.endsWith("lazy/vision"));
    expect(vision.rows.map((row) => [row.n, row.unit])).toEqual([["1", "p:gold#2"]]);
    expect(vision.other.items).toEqual(["p:gold#1 · p/big"]);
    expect(vision.other.summary).toBe("高峰时段顺序（1 个单元）");
  });

  test("the first alive unit is the active one", () => {
    const [main] = describeStatus(STATUS).routes;
    expect(main.rows.map((row) => [row.unit, row.active, row.health.text])).toEqual([
      ["p:gold#1", false, "冷却中"],
      ["p:gold#2", true, "可用"],
    ]);
    expect(main.sub).toBe("基础首选 p:gold#2 服务");
  });

  test("while the catalog is unknown every unit shows, marked 未知, none active", () => {
    const [main] = describeStatus({ ...STATUS, catalogReady: false }).routes;
    expect(main.rows.every((row) => row.health.text === "未知" && !row.active)).toBe(true);
  });

  test("limited units show their load; unlimited ones show none; affinity reads as one line", () => {
    const view = describeStatus(STATUS);
    expect(view.routes[0].rows.map((row) => row.load)).toEqual([null, "2/3"]);
    expect(view.affinity).toBe("12 条 · 命中 63%（5/8）");
    expect(describeStatus({ ...STATUS, affinity: undefined }).affinity).toBe("—");
    expect(
      describeStatus({ ...STATUS, affinity: { entries: 0, ttlMs: 1, lookups: 0, hits: 0, hitRate: null } }).affinity,
    ).toBe("0 条 · 命中 —（0/0）");
  });

  test("route rows expose Glicko-like rating, RD and intelligence", () => {
    const rows = STATUS.routes.default.map((row, index) => ({
      ...row,
      intelligence: index === 0 ? "excellent" : "medium",
      rating: index === 0 ? 0.4 : -0.2,
      rd: index === 0 ? 0.2 : 0.8,
      routingScore: index === 0 ? 0.55 : 0.4,
    }));
    const [main] = describeStatus({ ...STATUS, routes: { ...STATUS.routes, default: rows } }).routes;
    expect(main.rows.map((row) => [row.intelligence, row.rating, row.rd, row.routingScore])).toEqual([
      ["优秀", "0.400", "0.200", "0.550"],
      ["中等", "-0.200", "0.800", "0.400"],
    ]);
  });

  test("per-model table is busiest first and reports Bayesian completions", () => {
    const view = describeStatus({
      ...STATUS,
      perf: {
        "p/busy": { ttftMs: 900, totalMs: 12_000, samples: 120, imputedSamples: 4, tokens: 0 },
        "p/light": { ttftMs: 200, totalMs: 800, samples: 5, imputedSamples: 1, tokens: 0 },
      },
    });
    expect(view.models.map((row) => [row.model, row.samples, row.imputed])).toEqual([
      ["p/busy", "120", "4"],
      ["p/light", "5", "1"],
    ]);
  });

  test("per-model latency and speed come from the window, per model", () => {
    const status = {
      ...STATUS,
      perf: {
        "p/big": { ttftMs: 640, tokensPerSecond: 37.42, totalMs: 4_600, samples: 12, tokens: 900 },
        "q/text": { ttftMs: 2_400, tokensPerSecond: null, totalMs: 900, samples: 3, tokens: 0 },
      },
    };
    const view = describeStatus(status);
    const [main] = view.routes;
    expect(main.rows.map((row) => [row.model, row.ttft, row.speed, row.total])).toEqual([
      ["p/big", "640 毫秒", "37.4 tok/s", "4.6 秒"],
      ["p/big", "640 毫秒", "37.4 tok/s", "4.6 秒"],
    ]);
    // Keyed by model: another model's samples never show on these rows.
    const [elsewhere] = describeStatus({
      ...STATUS,
      perf: { "q/text": { ttftMs: 2_400, tokensPerSecond: 12, totalMs: 900, samples: 3, tokens: 90 } },
    }).routes;
    expect(elsewhere.rows.map((row) => [row.ttft, row.speed, row.total])).toEqual([
      ["—", "—", "—"],
      ["—", "—", "—"],
    ]);
  });

  test("the per-model table lists every model with samples, busiest first", () => {
    const view = describeStatus({
      ...STATUS,
      perf: {
        "p/small": { ttftMs: 300, tokensPerSecond: 20, totalMs: 1_100, samples: 2, tokens: 40 },
        "p/busy": { ttftMs: 900, tokensPerSecond: 44.44, totalMs: 75_000, samples: 9, tokens: 400 },
        "p/nospeed": { ttftMs: 1_200, tokensPerSecond: null, totalMs: 900, samples: 4, tokens: null, ttftSamples: 4, tokenSamples: 0, speedSamples: 0 },
      },
    });
    expect(view.models.map((row) => [row.model, row.ttft, row.speed, row.total, row.samples, row.tokens])).toEqual([
      ["p/busy", "900 毫秒", "44.4 tok/s", "1 分 15 秒", "9", "400"],
      ["p/nospeed", "1.2 秒", "—", "900 毫秒", "4", "—"],
      ["p/small", "300 毫秒", "20.0 tok/s", "1.1 秒", "2", "40"],
    ]);
  });

  test("unknown token usage is a dash and coverage exposes missing telemetry", () => {
    const view = describeStatus({
      ...STATUS,
      perf: { "p/a": { ttftMs: 500, totalMs: 1_000, samples: 10, ttftSamples: 9, tokenSamples: 3, speedSamples: 2, tokens: null } },
    });
    expect(view.models[0].tokens).toBe("—");
    expect(view.models[0].coverage).toBe("首字 9/10 · usage 3/10 · 速度 2/10");
  });

  test("a model with no samples shows dashes", () => {
    const [main] = describeStatus({ ...STATUS, perf: undefined }).routes;
    expect(main.rows.map((row) => [row.ttft, row.speed, row.total])).toEqual(main.rows.map(() => ["—", "—", "—"]));
    expect(describeStatus({ ...STATUS, perf: undefined }).models).toEqual([]);
  });

  test("relative times read naturally", () => {
    expect(relative("2026-10-20T12:29:00.000Z", NOW)).toBe("29 分 0 秒后");
    expect(relative("2026-10-20T11:59:00.000Z", NOW)).toBe("1 分 0 秒前");
    expect(relative(null, NOW)).toBe("—");
  });
});

describe("page content", () => {
  const html = renderStatusPage(STATUS, { statusPath: STATUS_PATH, nowMs: NOW });

  test("renders the load tag of a limited unit and the affinity counters", () => {
    expect(html).toContain('<span class="tag load">并发 2/3</span>');
    expect(html.match(/tag load/g)).toHaveLength(1);
    expect(html).toContain('<b id="affinity">12 条 · 命中 63%（5/8）</b>');
  });

  test("renders contiguous rows without the not-applicable unit", () => {
    const vision = html.slice(html.indexOf("lazy/vision"));
    expect(vision).not.toContain(">q<");
    expect(html).toContain("29 分 0 秒后");
  });

  test("holds no account data, no inline code and nothing external", () => {
    expect(html).not.toMatch(EMAIL);
    expect(html).not.toContain("credentialId");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script>|<style>|\sstyle=|\son\w+=/);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
  });

  test("escapes every server-side value", () => {
    const hostile = `"><script>alert(1)</script>`;
    const page = renderStatusPage(
      { ...STATUS, routes: { default: [{ ...STATUS.routes.default[1], unit: hostile, model: hostile }] } },
      { statusPath: hostile, nowMs: NOW },
    );
    expect(page).not.toContain("<script>alert(1)");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`&'`)).toBe("&amp;&#39;");
  });

  test("the browser script assigns data with textContent only", async () => {
    for (const name of ["client.js", "view.js"]) {
      const source = await Bun.file(new URL(`../lib/lazy-router/status-page/${name}`, import.meta.url)).text();
      expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    }
  });
});
