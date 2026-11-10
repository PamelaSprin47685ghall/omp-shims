const RESET_CONTENT = `
  <div class="status-reset">
    <p id="status-reset-consequence">重置只清空累计 Token 统计与上报次数；评分、账号健康、路由前缀亲和、并发实证都不受影响。</p>
    <label for="status-reset-token">Gateway 管理 Token</label>
    <input id="status-reset-token" type="password" autocomplete="off"
           spellcheck="false" aria-describedby="status-reset-help">
    <p id="status-reset-help">Token 只用于本次请求，不保存、不写日志。</p>
    <p class="status-reset-error" role="alert" hidden></p>
  </div>`;

function isLoopbackHost() {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function secureEnough() {
  if (typeof location === "undefined") return false;
  return location.protocol === "https:" || isLoopbackHost();
}

function makeResetId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function showResetToast(f7, text) {
  const toast = f7.toast.create({
    text,
    closeTimeout: 4000,
    cssClass: "status-toast",
  });
  toast.open();
  toast.el?.setAttribute("role", "status");
  toast.el?.setAttribute("aria-live", "polite");
}

function statusMessage(status) {
  if (status === 401) return "管理 Token 无效，未执行重置。";
  if (status === 403) return "重置仅允许通过 HTTPS 或本机回环地址。";
  if (status === 409) return "另一个重置刚刚完成，正在刷新当前统计。";
  if (status === 405) return "服务器不接受该重置请求。";
  if (status === 503) return "计数服务暂不可用，数值未变，请稍后重试。";
  return `重置失败（HTTP ${status}），数值未变。`;
}

/**
 * Framework7 Dialog reset flow. The token lives only in this function's local
 * scope; it is cleared before the request settles and never logged.
 */
export function openResetDialog({ f7, resetPath, onSuccess, onConflict }) {
  let pending = false;
  let closed = false;
  const previousFocus = typeof document !== "undefined" ? document.activeElement : null;

  const dialog = f7.dialog.create({
    title: "重置累计 Token 统计",
    content: RESET_CONTENT,
    closeByBackdrop: false,
    destroyOnClose: true,
    buttons: [
      { text: "取消", keyCodes: [27] },
      {
        text: "重置",
        strong: true,
        close: false,
        onClick: (instance) => {
          void submit(instance);
        },
      },
    ],
    on: {
      closed() {
        closed = true;
        dialog.el?.removeEventListener("keydown", trapFocus);
        document.querySelector(".page")?.removeAttribute("inert");
        document.querySelector(".page")?.removeAttribute("aria-hidden");
        document.querySelector(".status-skip")?.removeAttribute("inert");
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
          previousFocus.focus();
        }
      },
    },
  });

  function trapFocus(event) {
    if (event.key !== "Tab" || !dialog.el) return;
    const focusable = [...dialog.el.querySelectorAll("button, input, [href], [tabindex]")].filter(
      (node) => !node.disabled && node.getAttribute("tabindex") !== "-1" && node.offsetParent !== null,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function setError(message) {
    const node = dialog.el?.querySelector(".status-reset-error");
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
  }

  function setBusy(busy) {
    const buttons = dialog.el?.querySelectorAll(".dialog-button") ?? [];
    for (const button of buttons) button.disabled = busy;
    dialog.el?.setAttribute("aria-busy", busy ? "true" : "false");
  }

  async function submit(instance) {
    if (pending || closed) return;

    const input = instance.el?.querySelector("#status-reset-token");
    const token = typeof input?.value === "string" ? input.value : "";
    if (input) input.value = "";
    setError("");

    if (token.length === 0) {
      setError("请输入 Gateway 管理 Token。");
      input?.focus();
      return;
    }
    if (!secureEnough()) {
      setError("重置仅允许通过 HTTPS 或本机回环地址。");
      return;
    }

    pending = true;
    setBusy(true);
    try {
      const response = await fetch(resetPath, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-lazy-reset": "token-totals",
        },
        body: JSON.stringify({ resetId: makeResetId() }),
      });

      if (!response.ok) {
        setError(statusMessage(response.status));
        if (response.status === 409) onConflict?.();
        return;
      }

      const data = await response.json();
      closed = true;
      instance.close();
      showResetToast(f7, "累计 Token 统计已重置。");
      onSuccess?.(data);
    } catch {
      setError("网络错误，未确认重置结果；数值可能未变，请刷新后重试。");
    } finally {
      pending = false;
      if (!closed) setBusy(false);
    }
  }

  dialog.open();
  if (dialog.el) {
    dialog.el.setAttribute("role", "dialog");
    dialog.el.setAttribute("aria-modal", "true");
    dialog.el.setAttribute("aria-describedby", "status-reset-consequence status-reset-help");
    const title = dialog.el.querySelector(".dialog-title");
    if (title) {
      title.id = "status-reset-dialog-title";
      dialog.el.setAttribute("aria-labelledby", title.id);
    }
    dialog.el.addEventListener("keydown", trapFocus);
    document.querySelector(".page")?.setAttribute("inert", "");
    document.querySelector(".page")?.setAttribute("aria-hidden", "true");
    document.querySelector(".status-skip")?.setAttribute("inert", "");
    requestAnimationFrame(() => {
      dialog.el?.querySelector("#status-reset-token")?.focus();
    });
  }
  return dialog;
}
