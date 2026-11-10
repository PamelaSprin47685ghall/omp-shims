// Security contract for the status page: CSP, template escaping, XSS, URL
// allowlist, and the no-inline-script / no-native-dialog rules.
//
// Static scans always run. Render tests load the committed build; a missing
// build is an interface gap reported by the failure, not a skip.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CREDENTIAL,
  EMAIL,
  HOSTILE_REASONS,
  SCRIPT_TAG,
  TEMPLATE_BREAK,
  UNICODE_LINE_SEPARATOR,
} from "./fixtures/xss-names.mjs";

const APP_ROOT = new URL("../lib/router/status-page/app/", import.meta.url).pathname;
const PAGE_URL = new URL("../lib/router/status-page.mjs", import.meta.url);
const SSPAGE_MODULE = "../lib/router/status-page.mjs";

const EXACT_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

async function loadPage() {
  return await import(SSPAGE_MODULE);
}

async function fixtureSnapshot(overrides) {
  const [{ buildSnapshot }, { snapshotInput }] = await Promise.all([
    import("../lib/router/status-page/snapshot.mjs"),
    import("./fixtures/status-v3.mjs"),
  ]);
  return buildSnapshot(snapshotInput(overrides));
}

function appFiles(extension) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(`.${extension}`)) found.push(path);
    }
  };
  visit(APP_ROOT);
  return found;
}

async function renderDocument(snapshot, options = {}) {
  const { renderStatusPage } = await loadPage();
  return renderStatusPage(snapshot, options);
}

function templateDocument(html) {
  const matches = [...html.matchAll(/<template id="status-snapshot">([\s\S]*?)<\/template>/g)];
  expect(matches.length).toBe(1);
  return matches[0][1];
}

describe("CSP and headers", () => {
  test("the exported CSP is the exact S3 string", async () => {
    const { CONTENT_SECURITY_POLICY } = await loadPage();
    expect(CONTENT_SECURITY_POLICY).toBe(EXACT_CSP);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'unsafe-inline'");
  });

  test("the page response carries no-store, nosniff, no-referrer and noindex", async () => {
    const snapshot = await fixtureSnapshot();
    const { createStatusPage } = await loadPage();
    const handler = createStatusPage({ statusView: () => snapshot });
    const response = handler("GET", "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(EXACT_CSP);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const html = await response.text();
    expect(html).toMatch(/<meta[^>]+name="robots"[^>]+content="noindex/i);
  });

  test("assets are immutable and unknown page assets are 404 no-store", async () => {
    const snapshot = await fixtureSnapshot();
    const { createStatusPage, STATUS_MANIFEST } = await loadPage();
    const handler = createStatusPage({ statusView: () => snapshot });
    const asset = handler("GET", `/assets/lazy-status/${STATUS_MANIFEST.entry}`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(asset.headers.get("content-type")).toBe("text/javascript; charset=utf-8");

    const css = handler("GET", `/assets/lazy-status/${STATUS_MANIFEST.css[0]}`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");

    for (const path of [
      "/assets/lazy-status/nope.js",
      "/assets/lazy-status/../manifest.json",
      "/assets/lazy-status/assets%2F..%2Fserver%2Fstatus-page.ssr.mjs",
    ]) {
      const missing = handler("GET", path);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("no-store");
    }

    const head = handler("HEAD", "/assets/lazy-status/nope.js");
    expect(head.status).toBe(404);
    const headPage = handler("HEAD", "/");
    expect(headPage.status).toBe(200);
    expect(await headPage.text()).toBe("");
  });

  test("statusAssetDir serves retained hashed assets and nothing else", async () => {
    const snapshot = await fixtureSnapshot();
    const { createStatusPage } = await loadPage();
    const directory = mkdtempSync(join(tmpdir(), "omp-status-asset-dir-"));
    try {
      writeFileSync(join(directory, "status-page.retained.js"), "/* retained */");
      writeFileSync(join(directory, "notes.txt"), "not an asset");
      const handler = createStatusPage({ statusView: () => snapshot, assetDir: directory });
      const retained = handler("GET", "/assets/lazy-status/status-page.retained.js");
      expect(retained.status).toBe(200);
      expect(await retained.text()).toBe("/* retained */");
      expect(handler("GET", "/assets/lazy-status/notes.txt").status).toBe(404);
      expect(handler("GET", "/assets/lazy-status/../status-page.retained.js").status).toBe(404);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("template escaping and XSS", () => {
  test("hostile labels stay data: escaped in the template and escaped in HTML", async () => {
    const snapshot = await fixtureSnapshot({
      routes: [
        {
          id: "lazy/pro",
          title: TEMPLATE_BREAK,
          state: "alive",
          strategy: SCRIPT_TAG,
          graph: null,
          channels: [
            {
              model: "fixture-provider/fixture-model-a",
              effort: "high",
              units: [
                {
                  unitKey: "fixture-provider/acct-a",
                  displayName: SCRIPT_TAG,
                  provider: "fixture-provider",
                  model: "fixture-provider/fixture-model-a",
                  health: "cooling",
                  reason: HOSTILE_REASONS.join(" "),
                },
              ],
            },
          ],
        },
      ],
    });
    const html = await renderDocument(snapshot, {
      basePath: "/ops",
      statusPath: "/v1/lazy/status",
      resetPath: "/v1/lazy/token-totals/reset",
    });

    const embedded = templateDocument(html);
    expect(embedded).not.toContain("<");
    expect(embedded).not.toContain("</template>");
    expect(embedded).toContain("\\u003c");
    const parsed = JSON.parse(embedded);
    expect(parsed.snapshotId).toBe(snapshot.snapshotId);
    expect(parsed.routes[0].title).toBe(TEMPLATE_BREAK);

    expect(html).not.toContain(SCRIPT_TAG);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });

  test("U+2028 and U+2029 are escaped in the template", async () => {
    const snapshot = await fixtureSnapshot({
      routes: [
        {
          id: "lazy/pro",
          title: UNICODE_LINE_SEPARATOR,
          state: "alive",
          strategy: "x",
          graph: null,
          channels: [],
        },
      ],
    });
    const embedded = templateDocument(await renderDocument(snapshot));
    expect(embedded).toContain("\\u2028");
    expect(embedded).toContain("\\u2029");
    expect(embedded).not.toContain("\u2028");
    expect(JSON.parse(embedded).routes[0].title).toBe(UNICODE_LINE_SEPARATOR);
  });

  test("no inline script survives, and the one module script has a source", async () => {
    const snapshot = await fixtureSnapshot();
    const html = await renderDocument(snapshot);
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)];
    expect(inline).toEqual([]);
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
    expect(scripts.length).toBe(1);
    expect(scripts[0][0]).toContain('type="module"');
    expect(scripts[0][0]).toContain("/assets/lazy-status/");
    expect(html).not.toContain("javascript:");
  });

  test("the app source has no {@html} and no HTML injection sink", () => {
    const files = appFiles("svelte");
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect({ file, html: source.includes("{@html") }).toEqual({ file, html: false });
    }
    const clientFiles = [...appFiles("js"), ...appFiles("svelte")];
    for (const file of clientFiles) {
      const source = readFileSync(file, "utf8");
      expect({ file, prompt: /\bprompt\s*\(/.test(source) }).toEqual({ file, prompt: false });
      expect({ file, confirm: /\bconfirm\s*\(/.test(source) }).toEqual({ file, confirm: false });
      expect({ file, alert: /\bwindow\.alert\s*\(/.test(source) }).toEqual({ file, alert: false });
      expect({ file, eval: /\beval\s*\(/.test(source) }).toEqual({ file, eval: false });
    }
  });

  test("the page is Material Design only", async () => {
    const snapshot = await fixtureSnapshot();
    const html = await renderDocument(snapshot);
    expect(html).toMatch(/<html[^>]*lang="zh-CN"/);
    expect(html).toMatch(/<html[^>]*class="md"/);
    expect(html).not.toContain('theme="ios"');
    expect(html).not.toContain('theme="auto"');
    const appSource = appFiles("svelte")
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(appSource).not.toContain('theme="ios"');
    expect(appSource).not.toContain('theme="auto"');
  });

  test("without JavaScript the reset button is disabled and explained", async () => {
    const snapshot = await fixtureSnapshot();
    const html = await renderDocument(snapshot);
    const button = html.match(/<button[^>]*class="[^"]*status-reset-button[^"]*"[^>]*>/);
    expect(button).not.toBe(null);
    expect(button[0]).toContain('disabled=""');
    expect(button[0]).toContain('aria-disabled="true"');
    expect(button[0]).toContain('aria-describedby="reset-explanation"');
    expect(html).toContain('id="reset-explanation"');
    expect(html).toContain("<noscript");
    expect(html).toContain("重置 Token 统计");
  });
});

describe("URL allowlist and reset safety", () => {
  test("cooling reasons never carry a URL, e-mail, credential or control character", async () => {
    const snapshot = await fixtureSnapshot({
      routes: [
        {
          id: "lazy/pro",
          title: "专业路由",
          state: "alive",
          strategy: "x",
          graph: null,
          channels: [
            {
              model: "fixture-provider/fixture-model-a",
              effort: "high",
              units: [
                {
                  unitKey: "fixture-provider/acct-a",
                  displayName: "unit",
                  provider: "fixture-provider",
                  model: "fixture-provider/fixture-model-a",
                  health: "cooling",
                  reason: `${EMAIL} ${CREDENTIAL} https://upstream.example/?token=secret ${SCRIPT_TAG}`,
                },
              ],
            },
          ],
        },
      ],
    });
    const html = await renderDocument(snapshot);
    expect(html).not.toContain(EMAIL);
    expect(html).not.toContain(CREDENTIAL);
    expect(html).not.toContain("upstream.example");
    expect(html).not.toContain("javascript:");
  });

  test("the reset dialog uses Framework7 and holds no token in storage", () => {
    const source = readFileSync(join(APP_ROOT, "lib", "reset-dialog.js"), "utf8");
    expect(source).toContain("f7.dialog.create");
    expect(source).toContain('title: "重置累计 Token 统计"');
    expect(source).toContain("closeByBackdrop: false");
    expect(source).toContain("destroyOnClose: true");
    expect(source).toContain('type="password"');
    expect(source).toContain('autocomplete="off"');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(source).not.toMatch(/\bprompt\s*\(|\bconfirm\s*\(/);
    expect(source).toContain('"x-lazy-reset": "token-totals"');
    expect(source).toContain('"content-type": "application/json"');
    expect(source).toMatch(/authorization:\s*`Bearer \$\{token\}`/);
  });

  test("the fixture snapshot leaks no fixture secret or raw identity", async () => {
    const snapshot = await fixtureSnapshot();
    const text = JSON.stringify(snapshot);
    for (const value of [EMAIL, CREDENTIAL, "upstream.example", "acct-a", "acct-b", "credential", "apiKey"]) {
      expect({ value, found: text.includes(value) }).toEqual({ value, found: false });
    }
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{6,}/);
  });

  test("base path prefixes every URL and no hardcoded page root leaks", async () => {
    const snapshot = await fixtureSnapshot();
    const { createStatusPage } = await loadPage();
    const handler = createStatusPage({ statusView: () => snapshot });
    const response = handler("GET", "/", { basePath: "/ops" });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('content="/ops/v1/lazy/status"');
    expect(html).toContain('content="/ops/v1/lazy/token-totals/reset"');
    expect(html).toContain('src="/ops/assets/lazy-status/');
    expect(html).toContain('href="/ops/assets/lazy-status/');
    expect(html).not.toMatch(/(?:src|href)="\/assets\/lazy-status\//);
  });

  test("static page source contains no secret-handling fallback", () => {
    const pageSource = readFileSync(PAGE_URL, "utf8");
    expect(pageSource).not.toContain("eval(");
    expect(pageSource).not.toMatch(/innerHTML\s*=/);
  });
});
