<script>
import { Card, CardContent } from "framework7-svelte";
import PrimaryMetric from "./PrimaryMetric.svelte";
import { formatAbsolute } from "./relative.js";
import TokenLedgerCell from "./TokenLedgerCell.svelte";
import WorkersDisclosure from "./WorkersDisclosure.svelte";

let { snapshot, openItems = new Set(), onToggleItem = () => {} } = $props();

const epoch = $derived(snapshot.tokenTotals?.epoch ?? snapshot.epoch);

/* M05 is built as four "label count" segments. Render them as a small
   breakdown so the performance cell carries the same visual weight as the
   other three; anything unexpected falls back to the generic metric. */
const channelParts = $derived.by(() => {
  const metric = snapshot.metrics.M05;
  if (!metric.available) return [];
  const parts = metric.value.split(" · ").map((segment) => {
    const match = /^(\S+)\s+(.+)$/.exec(segment);
    if (!match) return null;
    const tone =
      match[1] === "可用" ? "positive" : match[1] === "冷却" ? "warning" : match[1] === "繁忙" ? "muted" : "normal";
    return { key: match[1], label: match[1], value: match[2], tone };
  });
  return parts.length === 4 && parts.every(Boolean) ? parts : [];
});
</script>

<section class="status-overview-section" aria-labelledby="overview-heading">
  <Card class="status-primary-dashboard">
    <CardContent>
      <header class="status-dashboard-head">
        <h2 id="overview-heading" class="status-dashboard-title">系统概览</h2>
        <p class="status-dashboard-meta">
          <span>
            快照
            <time datetime={snapshot.generatedAt} title={formatAbsolute(snapshot.generatedAt)}>
              {formatAbsolute(snapshot.generatedAt)}
            </time>
          </span>
          {#if epoch?.since}
            <span>
              统计自
              <time datetime={epoch.since} title={formatAbsolute(epoch.since)}>
                {formatAbsolute(epoch.since)}
              </time>
            </span>
          {/if}
        </p>
      </header>

      <div class="status-dashboard-grid">
        <section class="status-dashboard-cell" aria-labelledby="dashboard-period">
          <h3 id="dashboard-period" class="status-dashboard-cell-title">运行状态</h3>
          <div class="status-dashboard-cell-body">
            <PrimaryMetric metric={snapshot.metrics.M01} />
            <PrimaryMetric metric={snapshot.metrics.M02} />
          </div>
        </section>

        <section class="status-dashboard-cell" aria-labelledby="dashboard-in-flight">
          <h3 id="dashboard-in-flight" class="status-dashboard-cell-title">在途请求</h3>
          <div class="status-dashboard-cell-body">
            <PrimaryMetric metric={snapshot.metrics.M03} />
          </div>
          <div class="status-dashboard-cell-foot">
            <WorkersDisclosure {snapshot} {openItems} {onToggleItem} />
          </div>
        </section>

        <section class="status-dashboard-cell" aria-labelledby="dashboard-channels">
          <h3 id="dashboard-channels" class="status-dashboard-cell-title">性能</h3>
          <div class="status-dashboard-cell-body">
            {#if channelParts.length === 4}
              <div class="status-channel-breakdown" data-metric={snapshot.metrics.M05.id} title={snapshot.metrics.M05.exact}>
                <p class="status-channel-caption">{snapshot.metrics.M05.label}</p>
                <div class="status-channel-grid">
                  {#each channelParts as part (part.key)}
                    <div class="status-channel-stat tone-{part.tone}">
                      <span class="status-channel-value">{part.value}</span>
                      <span class="status-channel-label">{part.label}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <PrimaryMetric metric={snapshot.metrics.M05} />
            {/if}
          </div>
        </section>

        <section class="status-dashboard-cell" aria-labelledby="dashboard-tokens">
          <TokenLedgerCell {snapshot} />
        </section>
      </div>
    </CardContent>
  </Card>
</section>
