<script>
import DiagnosticsTable from "./DiagnosticsTable.svelte";
import EmptyState from "./EmptyState.svelte";

let { snapshot } = $props();

const diagnostics = $derived(snapshot.diagnostics);
</script>

<section class="status-diagnostics" aria-labelledby="diagnostics-heading">
  <div class="status-section-head">
    <h2 id="diagnostics-heading">诊断</h2>
    <span class="status-muted">近 {diagnostics.windowMinutes} 分钟 · 完整与删失样本分开</span>
  </div>
  {#if !diagnostics.available}
    <EmptyState title="诊断数据不可用" detail={diagnostics.reason ?? "未知原因"} />
  {:else if diagnostics.rows.length === 0}
    <EmptyState title="暂无诊断样本" detail="完整或删失样本写入后显示。" />
  {:else}
    <DiagnosticsTable rows={diagnostics.rows} />
  {/if}
</section>
