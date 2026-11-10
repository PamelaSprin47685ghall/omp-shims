<script>
import { App, Navbar, Page } from "framework7-svelte";
import Banner from "./lib/Banner.svelte";
import DiagnosticsSection from "./lib/DiagnosticsSection.svelte";
import Overview from "./lib/Overview.svelte";
import ResetAction from "./lib/ResetAction.svelte";
import RoutesSection from "./lib/RoutesSection.svelte";
import SecondaryMetrics from "./lib/SecondaryMetrics.svelte";
import SnapshotMeta from "./lib/SnapshotMeta.svelte";
import StatusButton from "./lib/StatusButton.svelte";

let {
  snapshot,
  nowMs,
  connection,
  jsReady,
  versionMismatch = null,
  refreshing = false,
  onRefresh = undefined,
  onResetSuccess = undefined,
  openItems = new Set(),
  onToggleItem = () => {},
} = $props();

const refreshReady = $derived(jsReady && typeof onRefresh === "function");

const connectionText = $derived(
  refreshing
    ? "刷新中"
    : connection.state === "offline"
      ? "离线"
      : connection.state === "timeout" || connection.state === "stale"
        ? "重试中"
        : connection.state === "live"
          ? "已连接"
          : "服务端快照",
);
</script>

{#snippet navRight()}
  <span
    class="status-live"
    class:is-warning={connection.state !== "live" && connection.state !== "server"}
    aria-label={`连接状态：${connectionText}`}
  >
    <span class="status-live-dot" aria-hidden="true"></span>
    <span>{connectionText}</span>
  </span>
  <StatusButton
    className="status-refresh"
    disabled={!refreshReady}
    onclick={onRefresh}
    ariaLabel="立即刷新状态"
  >
    刷新
  </StatusButton>
{/snippet}

{#snippet fixed()}
  <Navbar
    title="Lazy · 路由观测"
    right={navRight}
    data-f7-slot="fixed"
    role="banner"
    aria-label="Lazy 路由观测页眉"
  />
{/snippet}

{#snippet overlays()}
  <Banner {snapshot} {connection} {versionMismatch} {nowMs} onRetry={onRefresh} />
{/snippet}

<App theme="md" name="omp-status" darkMode="auto">
  <Page fixedContent={fixed} staticContent={overlays}>
    <main id="main-content" class="status-main" tabindex="-1">
      <h1 class="sr-only">Lazy 路由观测</h1>
      <Overview {snapshot} {openItems} {onToggleItem} />
      <SecondaryMetrics {snapshot} {nowMs} />
      <RoutesSection {snapshot} {openItems} {onToggleItem} />
      <DiagnosticsSection {snapshot} />
      <ResetAction {jsReady} {onResetSuccess} />
      <SnapshotMeta {snapshot} {nowMs} />
      <div id="status-announcer" class="sr-only" role="status" aria-live="polite"></div>
    </main>
  </Page>
</App>
