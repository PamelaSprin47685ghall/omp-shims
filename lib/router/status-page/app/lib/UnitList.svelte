<script>
import { List, ListItem } from "framework7-svelte";
import PrimaryMetric from "./PrimaryMetric.svelte";
import StatusBadge from "./StatusBadge.svelte";

let { channel } = $props();

const healthTone = $derived((unit) =>
  unit.health === "alive"
    ? "positive"
    : unit.health === "cooling"
      ? "warning"
      : unit.health === "busy"
        ? "normal"
        : "muted",
);
</script>

{#if channel.units.length === 0}
  <p class="status-inline-empty" role="status">这个通道当前没有账号候选。</p>
{:else}
  <List class="unit-list" ul={true}>
    {#each channel.units as unit, index (`${unit.unitRef}:${index}`)}
      <ListItem class="unit-item">
        <div class="unit-head">
          <span class="unit-name status-mono">{unit.displayName}</span>
          <StatusBadge label={unit.healthLabel} tone={healthTone(unit)} />
          {#if unit.stale}
            <StatusBadge label="容量/心跳已过期" tone="warning" />
          {/if}
        </div>
        <div class="status-metric-grid unit-metrics">
          <PrimaryMetric metric={unit.metrics.M20} compact />
          <PrimaryMetric metric={unit.metrics.M21} compact />
          <PrimaryMetric metric={unit.metrics.M22} compact />
          <PrimaryMetric metric={unit.metrics.M23} compact />
        </div>
        {#if unit.capacity}
          <p class="unit-capacity status-muted">
            租约 {unit.capacity.max === 0 ? "不限" : `${unit.capacity.held}/${unit.capacity.max}`}
            · {unit.capacity.scope === "unit" ? "账号" : "账号+模型"}
            {#if unit.capacity.stale}· 已过期{/if}
          </p>
        {/if}
      </ListItem>
    {/each}
  </List>
{/if}
