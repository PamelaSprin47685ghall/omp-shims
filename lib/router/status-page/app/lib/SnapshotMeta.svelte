<script>
import { formatAbsolute, formatRelativePast } from "./relative.js";

let { snapshot, nowMs } = $props();

const metric = $derived(snapshot.metrics.M27);
</script>

<footer class="status-footer" role="contentinfo">
  <p>
    上次更新
    <time datetime={snapshot.generatedAt} title={formatAbsolute(snapshot.generatedAt)}>
      {formatRelativePast(snapshot.generatedAt, nowMs)}
    </time>
    <span class="status-muted">· 快照 {snapshot.snapshotId}</span>
  </p>
  <details class="status-disclosure">
    <summary>快照诊断</summary>
    <dl class="status-dl">
      <dt>快照</dt>
      <dd class="status-mono">{snapshot.snapshotId}</dd>
      <dt>构建</dt>
      <dd class="status-mono">{snapshot.buildVersion}</dd>
      <dt>回答者</dt>
      <dd class="status-mono">{snapshot.answeredBy}</dd>
      <dt>结构版本</dt>
      <dd>{snapshot.schemaVersion}</dd>
      <dt>Token 纪元</dt>
      <dd class="status-mono">{snapshot.epoch.id}</dd>
      <dt>纪元开始</dt>
      <dd><time datetime={snapshot.epoch.since ?? ""}>{formatAbsolute(snapshot.epoch.since)}</time></dd>
      <dt>{metric.label}</dt>
      <dd data-metric={metric.id} title={metric.exact}>{metric.value}</dd>
      <dt>共享状态</dt>
      <dd>{snapshot.store.mode}{snapshot.store.available ? "" : ` · ${snapshot.store.reason ?? "不可用"}`}</dd>
    </dl>
  </details>
</footer>
