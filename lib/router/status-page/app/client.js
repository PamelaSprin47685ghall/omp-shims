import "framework7/css";
import "framework7/components/accordion/css";
import "framework7/components/card/css";
import "framework7/components/dialog/css";
import "framework7/components/toast/css";
import "./styles.css";
import Framework7 from "framework7";
import Accordion from "framework7/components/accordion";
import Dialog from "framework7/components/dialog";
import Toast from "framework7/components/toast";
import Framework7Svelte, { app as f7App } from "framework7-svelte";
import { hydrate } from "svelte";
import { startRefresh } from "./lib/refresh.js";
import Root from "./Root.svelte";

Framework7.use(Framework7Svelte);
Framework7.use([{ name: "status-modal-params", params: { modal: { queueDialogs: true } } }, Accordion, Dialog, Toast]);

function meta(name) {
  const node = document.querySelector(`meta[name="${name}"]`);
  const value = node?.getAttribute("content") ?? "";
  return value;
}

function announce(message) {
  const node = document.getElementById("status-announcer");
  if (node) node.textContent = message;
}

function showFatal(message) {
  const node = document.createElement("p");
  node.className = "status-fatal";
  node.setAttribute("role", "alert");
  node.textContent = message;
  document.body.append(node);
}

function exposeF7() {
  if (!f7App.f7) return false;
  window.f7 = f7App.f7;
  if (f7App.Framework7) window.Framework7 = f7App.Framework7;
  return true;
}

function wireSkipLink() {
  const link = document.querySelector(".status-skip");
  const main = document.getElementById("main-content");
  if (!link || !main) return;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: "start" });
    history.pushState(null, "", "#main-content");
  });
}

function readInitialSnapshot() {
  const template = document.getElementById("status-snapshot");
  if (!template) throw new Error("missing status snapshot template");
  const raw = template.content?.textContent ?? "";
  const snapshot = JSON.parse(raw);
  if (!snapshot || typeof snapshot !== "object" || snapshot.schemaVersion !== 3) {
    throw new Error("unsupported status snapshot schema");
  }
  if (typeof snapshot.snapshotId !== "string" || typeof snapshot.generatedAt !== "string") {
    throw new Error("incomplete status snapshot envelope");
  }
  const metaBuild = meta("status-build");
  const metaSnapshot = meta("status-snapshot");
  if (metaBuild && metaBuild !== snapshot.buildVersion) {
    throw new Error("status build meta does not match the embedded snapshot");
  }
  if (metaSnapshot && metaSnapshot !== snapshot.snapshotId) {
    throw new Error("status snapshot meta does not match the embedded snapshot");
  }
  return { snapshot, template };
}

function boot() {
  const root = document.getElementById("status-root");
  if (!root) throw new Error("missing status root");
  document.documentElement.dataset.js = "on";
  wireSkipLink();

  const statusPath = meta("lazy-status-path");
  const resetPath = meta("lazy-reset-path");
  if (!statusPath.startsWith("/") || !resetPath.startsWith("/")) {
    throw new Error("status bootstrap paths are not absolute");
  }

  const { snapshot, template } = readInitialSnapshot();
  const ssrHtml = root.innerHTML;
  let refresh = null;

  let app;
  try {
    app = hydrate(Root, {
      target: root,
      props: {
        initialSnapshot: snapshot,
        onRefresh: () => refresh?.retryNow(),
        onResetSuccess: () => refresh?.retryNow(),
      },
    });
  } catch (error) {
    root.innerHTML = ssrHtml;
    document.documentElement.dataset.js = "off";
    console.error("[status-page] hydration failed", error);
    showFatal("页面增强加载失败，服务端内容仍可阅读。请刷新重试。");
    return;
  }

  template.remove();
  app.setReady();
  exposeF7();
  queueMicrotask(exposeF7);
  requestAnimationFrame(exposeF7);

  refresh = startRefresh({
    initialSnapshot: snapshot,
    statusPath,
    onSnapshot(next) {
      const focused = document.activeElement;
      app.apply(next);
      queueMicrotask(() => {
        if (focused instanceof HTMLElement && focused !== document.body && !focused.isConnected) {
          const heading = document.getElementById("routes-heading");
          heading?.focus();
          announce("当前项已移除，已移动到路由标题。");
        }
      });
    },
    onConnection(next) {
      app.setConnection(next);
    },
    onBusy(next) {
      app.setRefreshing(next);
    },
    onVersionMismatch(next) {
      app.setVersionMismatch(next);
      announce("页面已更新，请刷新。");
    },
  });

  window.addEventListener("pagehide", () => refresh.stop(), { once: true });
}

try {
  boot();
} catch (error) {
  document.documentElement.dataset.js = "off";
  console.error("[status-page] boot failed", error);
  showFatal(
    error instanceof SyntaxError
      ? "状态快照解析失败，页面保留服务端内容。请刷新重试。"
      : "页面增强加载失败，服务端内容仍可阅读。请刷新重试。",
  );
}
