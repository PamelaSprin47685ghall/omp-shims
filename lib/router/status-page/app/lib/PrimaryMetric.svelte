<script>
let { metric, compact = false, children } = $props();
</script>

<div class="status-metric" class:is-compact={compact} class:is-unavailable={!metric.available} data-metric={metric.id}>
  <div class="status-metric-label">{metric.label}</div>
  <div class="status-metric-value tone-{metric.tone}" title={metric.exact}>
    {metric.value}{#if !metric.available}<span class="sr-only">无数据</span>{/if}
  </div>
  {#if metric.detail}
    <p class="status-metric-detail">{metric.detail}</p>
  {/if}
  {#if metric.reason}
    <p class="status-metric-reason">{metric.reason}</p>
  {/if}
  {@render children?.()}
</div>
