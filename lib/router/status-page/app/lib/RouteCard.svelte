<script>
import { Card, CardContent } from "framework7-svelte";
import ChannelRow from "./ChannelRow.svelte";
import EmptyState from "./EmptyState.svelte";
import StatusBadge from "./StatusBadge.svelte";
import StrategyTree from "./StrategyTree.svelte";

let { route, openItems = new Set(), onToggleItem = () => {} } = $props();

const stateMeta = $derived(
  route.state === "alive"
    ? { label: "可用", tone: "positive" }
    : route.state === "cooling"
      ? { label: "冷却", tone: "warning" }
      : route.state === "loading"
        ? { label: "目录加载中", tone: "muted" }
        : { label: "空", tone: "muted" },
);
</script>

<Card class="route-card" aria-label={`${route.title} ${route.id}`}>
  <CardContent>
    <header class="route-head">
      <div class="route-title-row">
        <h3 class="route-title">{route.title}</h3>
        <StatusBadge label={stateMeta.label} tone={stateMeta.tone} />
      </div>
      <p class="route-id status-mono">{route.id}</p>
      <p class="route-counts">
        可用 {route.available} / {route.totalUnits} 个账号 · {route.channels.length} 个通道
      </p>
    </header>

    <p class="route-strategy">{route.strategy}</p>

    {#if route.graph}
      <StrategyTree graph={route.graph} />
    {/if}

    <div class="route-channels">
      {#if route.channels.length === 0}
        {#if route.state === "loading"}
          <EmptyState title="目录加载中" detail="目录就绪后将显示候选通道。" />
        {:else}
          <EmptyState title="这个组合当前没有候选通道" detail="检查模型目录或账号健康。" />
        {/if}
      {:else}
        {#each route.channels as channel, index (`${channel.id}:${index}`)}
          <ChannelRow {channel} {openItems} {onToggleItem} />
        {/each}
      {/if}
    </div>
  </CardContent>
</Card>
