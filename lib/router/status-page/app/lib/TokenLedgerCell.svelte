<script>
import { formatAbsolute } from "./relative.js";

let { snapshot } = $props();

const metrics = $derived(snapshot.metrics);
const totals = $derived(snapshot.tokenTotals ?? { available: false, scope: null, epoch: null });
const epoch = $derived(totals.epoch ?? snapshot.epoch);
const tokenMetrics = $derived([metrics.M08, metrics.M09, metrics.M10, metrics.M11, metrics.M12]);
const unpriced = $derived((totals.officialValue?.models ?? []).filter((model) => !model.priced));
</script>

<div class="status-token-cell">
  <div class="status-token-head">
    <h3 id="dashboard-tokens" class="status-dashboard-cell-title">Token 账本</h3>
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
      </div>
    {/each}
  </dl>

  <details class="status-disclosure status-dashboard-details">
    <summary>统计纪元与官方价值</summary>
    <div class="status-dashboard-detail-body">
      <dl class="status-detail-list">
        <dt>统计自</dt>
        <dd>
          <time datetime={epoch?.since ?? ""}>{formatAbsolute(epoch?.since)}</time>
          <span class="status-mono status-epoch-id" title={epoch?.id ?? ""}>{epoch?.id ?? "—"}</span>
        </dd>
      </dl>

      <dl class="status-detail-list">
        {#each tokenMetrics as metric (metric.id)}
          {#if metric.detail}
            <dt>{metric.label}</dt>
            <dd>{metric.detail}</dd>
          {/if}
        {/each}
      </dl>

      {#if totals.officialValue}
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
      {/if}
    </div>
  </details>
</div>
