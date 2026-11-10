<script>
import EmptyState from "./EmptyState.svelte";
import { formatAbsolute, formatAge, formatRelativeFuture } from "./relative.js";
import StatusBadge from "./StatusBadge.svelte";

let { snapshot, nowMs } = $props();

const health = $derived(snapshot.health);

const labels = {
  alive: { text: "可用", tone: "positive" },
  cooling: { text: "冷却", tone: "warning" },
  busy: { text: "繁忙", tone: "normal" },
  unknown: { text: "待检查", tone: "muted" },
};

function labelFor(state) {
  return labels[state] ?? labels.unknown;
}

function nextProbe(row) {
  return row.nextProbeAt ?? row.probeLeaseUntil ?? row.until ?? null;
}
</script>

<section class="status-table-section" aria-labelledby="health-heading">
  <h3 id="health-heading">账号健康（M20 / M22 / M23）</h3>
  {#if !health.available}
    <EmptyState title="共享健康状态不可用" detail={health.reason ?? "未知原因"} />
  {:else if health.rows.length === 0}
    <EmptyState title="暂无健康记录" detail="账号探测写入共享健康表后显示。" />
  {:else}
    <div class="table-wrap" tabindex="0" role="region" aria-label="账号健康表，可横向滚动">
      <table class="status-table">
        <caption class="sr-only">共享账号健康、下次探测与冷却原因</caption>
        <thead>
          <tr>
            <th scope="col">账号</th>
            <th scope="col">模型</th>
            <th scope="col">健康</th>
            <th scope="col">下次探测</th>
            <th scope="col">原因</th>
            <th scope="col">更新</th>
          </tr>
        </thead>
        <tbody>
          {#each health.rows as row, index (`${row.unitRef}:${index}`)}
            <tr>
              <th scope="row">{row.displayName}</th>
              <td class="status-mono">{row.model}</td>
              <td>
                <StatusBadge label={labelFor(row.health).text} tone={labelFor(row.health).tone} />
              </td>
              <td>
                {#if nextProbe(row)}
                  <time datetime={nextProbe(row)} title={formatAbsolute(nextProbe(row))}>
                    {formatRelativeFuture(nextProbe(row), nowMs)}
                  </time>
                {:else}
                  —<span class="sr-only">无数据</span>
                {/if}
              </td>
              <td class="status-reason">{row.reason ?? "—"}{#if !row.reason}<span class="sr-only">无数据</span>{/if}</td>
              <td>
                <time datetime={row.updatedAt} title={formatAbsolute(row.updatedAt)}>
                  {formatAge(row.ageMs)}
                </time>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
