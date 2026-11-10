<script>
import { Button } from "framework7-svelte";
import { formatRelativePast } from "./relative.js";

let {
  snapshot,
  connection,
  versionMismatch = null,
  nowMs = Date.parse(snapshot.generatedAt),
  onRetry = undefined,
} = $props();

const banners = $derived.by(() => {
  const items = [];
  if (versionMismatch) {
    items.push({
      key: "version",
      level: "error",
      title: "页面已更新",
      message: "页面已更新，请刷新后继续。刷新前不再应用新的状态响应。",
      action: "reload",
    });
  }

  if (connection.state === "offline") {
    items.push({
      key: "offline",
      level: "info",
      title: "离线",
      message: "离线，显示上次快照。",
      action: null,
    });
  } else if (connection.state === "timeout") {
    items.push({
      key: "timeout",
      level: "warning",
      title: "刷新超时",
      message: "刷新超时，正在重试。",
      action: onRetry ? "retry" : null,
    });
  } else if (connection.state === "stale") {
    items.push({
      key: "stale",
      level: "warning",
      title: "刷新暂时失败",
      message: "刷新暂时失败，页面保留上次成功的状态；将自动重试。",
      action: onRetry ? "retry" : null,
    });
  }

  for (const notice of snapshot.notices ?? []) {
    if (versionMismatch && notice.code === "version_mismatch") continue;
    if ((connection.state === "stale" || connection.state === "timeout") && notice.code === "snapshot_stale") {
      continue;
    }
    items.push({
      key: `notice:${notice.code}`,
      level: notice.level === "error" ? "error" : notice.level === "warning" ? "warning" : "info",
      title: notice.title,
      message: notice.message,
      action: notice.action,
    });
  }
  return items;
});

function reload() {
  window.location.reload();
}
</script>

{#if banners.length > 0}
  <div class="status-banners">
    {#each banners as banner, index (`${banner.key}:${index}`)}
      <div
        class="status-banner level-{banner.level}"
        role={banner.level === "info" ? "status" : "alert"}
        aria-live={banner.level === "info" ? "polite" : "assertive"}
      >
        <div class="status-banner-copy">
          <strong>{banner.title}</strong>
          <span>{banner.message}</span>
          {#if connection.lastGoodAt && banner.key !== "version"}
            <span class="status-banner-meta">
              上次成功：<time datetime={connection.lastGoodAt}>{formatRelativePast(connection.lastGoodAt, nowMs)}</time>
            </span>
          {/if}
        </div>
        {#if banner.action === "retry" && onRetry}
          <Button type="button" class="button-small" onClick={onRetry}>重试</Button>
        {:else if banner.action === "reload"}
          <Button type="button" class="button-small" onClick={reload}>刷新页面</Button>
        {/if}
      </div>
    {/each}
  </div>
{/if}
