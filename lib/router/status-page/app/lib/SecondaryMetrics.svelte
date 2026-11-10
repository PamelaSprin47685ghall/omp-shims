<script>
import CapacityTable from "./CapacityTable.svelte";
import HealthTable from "./HealthTable.svelte";
import PrimaryMetric from "./PrimaryMetric.svelte";

let { snapshot, nowMs } = $props();

const metrics = $derived(snapshot.metrics);
const diagnosticIds = $derived(
  snapshot.overview.secondary.find((group) => group.key === "routeDiagnostics")?.metricIds ?? [],
);
const firstPerf = $derived(
  snapshot.routes.flatMap((route) => route.channels).find((channel) => channel.perf)?.perf ?? null,
);
</script>

<section class="status-secondary" aria-labelledby="secondary-heading">
  <h2 id="secondary-heading">运行概览</h2>

  <div class="status-secondary-grid">
    <PrimaryMetric metric={metrics.M06} compact />
    <PrimaryMetric metric={metrics.M07} compact />
    <PrimaryMetric metric={metrics.M24} compact />
    <PrimaryMetric metric={metrics.M26} compact />
  </div>

  <div class="status-tables">
    <CapacityTable {snapshot} />
    <HealthTable {snapshot} {nowMs} />
  </div>

  <details class="status-disclosure status-diagnostic-key">
    <summary>路由诊断口径（M13–M19）</summary>
    <p>这些值在每个路由通道的「诊断与并发」中读取同一份全局后验，不在浏览器中汇总。</p>
    {#if firstPerf}
      <ul>
        {#each diagnosticIds as id (id)}
          {@const metric = firstPerf[id]}
          {#if metric}
            <li>
              <span>{metric.label}</span>
              <span class="status-muted">{metric.detail || metric.window}</span>
            </li>
          {/if}
        {/each}
      </ul>
    {:else}
      <p class="status-muted">暂无通道诊断样本。</p>
    {/if}
  </details>

  <p class="status-muted status-m25" data-metric={metrics.M25.id} title={metrics.M25.exact}>
    {metrics.M25.label}：{metrics.M25.value} · {metrics.M25.scope}
    {#if metrics.M25.reason}· {metrics.M25.reason}{/if}
  </p>
</section>
