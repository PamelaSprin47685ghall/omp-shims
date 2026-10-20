import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lazyRouterHandler } from "../features/lazy-router.js";
import { escapeHtml, renderStatusPage } from "../lib/lazy-router/status-page.js";

const STATUS_PATH = "/v1/lazy/status";
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

/** The router's inbound handler over a gateway that demands a token everywhere. */
function inbound() {
  const gatewayCalls = [];
  const gateway = async (request) => {
    gatewayCalls.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  };
  const router = {
    status: () => Response.json({ period: "offPeak", routes: {} }),
    advertisedModels: () => [],
    handles: () => false,
  };
  const handle = lazyRouterHandler(gateway, { router, dispatcher: { bind() {} }, statusPath: STATUS_PATH });
  const send = (method, path, headers = {}) => handle(new Request(`http://gateway.test${path}`, { method, headers }));
  return { send, gatewayCalls };
}

describe("status page at /", () => {
  test("GET / serves the HTML page without a token", async () => {
    const { send, gatewayCalls } = inbound();
    const response = await send("GET", "/", { accept: "text/html" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain(`content="${STATUS_PATH}"`);
    expect(gatewayCalls).toEqual([]);
  });

  test("HEAD / answers the same headers with no body", async () => {
    const response = await inbound().send("HEAD", "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("");
  });

  test("the status JSON stays JSON whatever the client accepts", async () => {
    const response = await inbound().send("GET", STATUS_PATH, { accept: "text/html" });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).period).toBe("offPeak");
  });

  test("everything else still goes through the gateway's authentication", async () => {
    const { send, gatewayCalls } = inbound();
    for (const [method, path] of [
      ["POST", "/"],
      ["GET", "/v1/models"],
      ["GET", "/index.html"],
      ["GET", `${STATUS_PATH}/x`],
    ]) {
      expect((await send(method, path)).status).toBe(401);
    }
    expect(gatewayCalls).toEqual(["POST /", "GET /v1/models", "GET /index.html", `GET ${STATUS_PATH}/x`]);
  });
});

describe("page content", () => {
  const { html, headers } = renderStatusPage({ statusPath: STATUS_PATH });

  test("holds no account data and loads nothing external", () => {
    expect(html).not.toMatch(EMAIL);
    expect(html).not.toContain("credentialId");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=/);
  });

  test("renders data through textContent only", () => {
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(html).toContain("textContent");
  });

  test("the CSP allows exactly the page's own inline style and script", () => {
    const hashOf = (kind) => {
      const content = html.match(new RegExp(`<${kind}>([\\s\\S]*?)</${kind}>`))[1];
      return `'sha256-${createHash("sha256").update(content).digest("base64")}'`;
    };
    const policy = headers["content-security-policy"];
    expect(policy).toContain(`script-src ${hashOf("script")}`);
    expect(policy).toContain(`style-src ${hashOf("style")}`);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("unsafe-inline");
  });

  test("the server-side value is escaped", () => {
    expect(escapeHtml(`"><script>x</script>&'`)).toBe("&quot;&gt;&lt;script&gt;x&lt;/script&gt;&amp;&#39;");
    const hostile = renderStatusPage({ statusPath: `"><script>alert(1)</script>` }).html;
    expect(hostile).not.toContain("<script>alert(1)");
  });
});
