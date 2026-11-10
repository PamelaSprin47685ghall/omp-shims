<script>
import { formatAbsolute } from "./relative.js";

let { snapshot } = $props();

const metrics = $derived(snapshot.metrics);
const totals = $derived(snapshot.tokenTotals);
const unpriced = $derived((totals.officialValue?.models ?? []).filter((model) => !model.priced));

const tokenMetrics = $derived([metrics.M08, metrics.M09, metrics.M10, metrics.M11, metrics.M12]);
</script>

<div class="status-token-card">
  <div class="status-token-head">
    <h2 class="status-card-title">累计 Token</h2>
    <span class="status-scope">{totals.scope?.label ?? "含直连/非流式"}</span>
  </div>

  {#if !totals.available}
    <p class="status-warning" role="status">共享 Token 统计当前不可用，未知值显示为 —。</p>
  {/if}

  <dl class="status-token-list">
    {#each tokenMetrics as metric (metric.id)}
      <div class="status-token-row" class:is-unavailable={!metric.available} data-metric={metric.id}>
        <dt>{metric.label}</dt>
        <dd title={metric.exact}>
          {metric.value}{#if !metric.available}<span class="sr-only">无数据</span>{/if}
        </dd>
        {#if metric.detail}
          <dd class="status-token-detail">{metric.detail}</dd>
        {/if}
      </div>
    {/each}
  </dl>

  <div class="status-epoch">
    <span>统计自</span>
    <time datetime={totals.epoch?.since ?? ""}>{formatAbsolute(totals.epoch?.since)}</time>
    <span class="status-mono status-epoch-id" title={totals.epoch?.id ?? ""}>{totals.epoch?.id ?? "—"}</span>
  </div>

  {#if totals.officialValue}
    <details class="status-disclosure">
      <summary>官方价格等效价值详情</summary>
      <p>{totals.officialValue.note}</p>
      <p>
        {totals.officialValue.pricedModels}/{totals.officialValue.totalModels} 模型已定价 ·
        未定价 {totals.officialValue.unpricedModels} · 基准日 {totals.officialValue.ratesAsOf}
      </p>
      <ul>
        {#each totals.officialValue.models as model, index (model.model + ":" + index)}
          <li>
            <span class="status-mono">{model.model}</span>
            <span>{model.priced ? `USD $${model.valueUsd}` : "未定价，未估算"}</span>
            <span class="status-muted">{model.basis}</span>
          </li>
        {/each}
      </ul>
      {#if unpriced.length > 0}
        <p class="status-muted">未定价模型不会被猜测价格。</p>
      {/if}
    </details>
  {/if}
</div>
