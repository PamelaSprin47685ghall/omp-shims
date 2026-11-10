<script>
let { rows } = $props();
</script>

<div class="table-wrap" tabindex="0" role="region" aria-label="模型诊断表，可横向滚动">
  <table class="status-table status-diagnostics-table">
    <caption class="sr-only">近 30 分钟各模型的完整样本、删失样本与耗时诊断</caption>
    <thead>
      <tr>
        <th scope="col">模型</th>
        <th scope="col" class="is-numeric">完整样本</th>
        <th scope="col" class="is-numeric">删失样本</th>
        <th scope="col" class="is-numeric">升级前混合</th>
        <th scope="col" class="is-numeric">完整耗时均值</th>
        <th scope="col" class="is-numeric">TTFT 样本</th>
        <th scope="col" class="is-numeric">速度样本</th>
        <th scope="col" class="is-numeric">tokens/s</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, index (`${row.model}:${index}`)}
        <tr>
          <th scope="row" class="status-mono">{row.model}</th>
          <td class="is-numeric">{row.completeSamples}</td>
          <td class="is-numeric">{row.imputedSamples}</td>
          <td class="is-numeric">{row.legacyMixedSamples}</td>
          <td class="is-numeric" title={row.exact}>
            {row.meanTotalText}{#if row.meanTotalMs === null}<span class="sr-only">无数据</span>{/if}
          </td>
          <td class="is-numeric">{row.ttftSamples}</td>
          <td class="is-numeric">{row.speedSamples}</td>
          <td class="is-numeric">
            {row.tokensPerSecond === null ? "—" : row.tokensPerSecond.toFixed(1)}
            {#if row.tokensPerSecond === null}<span class="sr-only">无数据</span>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
