<script>
import { app } from "framework7-svelte";
import { openResetDialog } from "./reset-dialog.js";
import StatusButton from "./StatusButton.svelte";

let { jsReady = false, onResetSuccess = undefined } = $props();

let statusText = $state("");

function resetPath() {
  const node = document.querySelector('meta[name="lazy-reset-path"]');
  return node?.getAttribute("content") ?? "";
}

function onResetClick() {
  const f7 = app.f7;
  if (!f7) {
    statusText = "页面尚未就绪，请稍后重试。";
    return;
  }
  const path = resetPath();
  if (!path.startsWith("/")) {
    statusText = "重置路径不可用，请刷新页面。";
    return;
  }
  openResetDialog({
    f7,
    resetPath: path,
    onSuccess() {
      statusText = "累计 Token 统计已重置，正在刷新。";
      onResetSuccess?.();
    },
    onConflict() {
      statusText = "另一个重置刚刚完成，正在刷新当前统计。";
      onResetSuccess?.();
    },
  });
}
</script>

<section class="status-reset-section" aria-labelledby="reset-heading">
  <h2 id="reset-heading">重置累计 Token 统计</h2>
  <p id="reset-explanation">
    重置会创建新的 Token 统计纪元，只清空累计 Token 与上报次数；评分、账号健康、路由前缀亲和、并发实证均不受影响。
    该操作需要 Gateway 管理 Token，并通过 HTTPS 或本机回环地址执行。
  </p>
  <StatusButton
    className="status-reset-button"
    fill={true}
    disabled={!jsReady}
    onclick={onResetClick}
    describedBy="reset-explanation"
  >
    重置 Token 统计…
  </StatusButton>
  <p class="status-muted">
    {jsReady
      ? "重置需要 Gateway 管理 Token，并通过 HTTPS 或本机回环地址执行。"
      : "重置需要 JavaScript；服务端内容无需 JavaScript 即可阅读。"}
  </p>
  <p class="sr-only" role="status" aria-live="polite">{statusText}</p>
</section>
