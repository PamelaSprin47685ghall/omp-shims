<script>
import EmptyState from "./EmptyState.svelte";
import { formatAbsolute, formatAge } from "./relative.js";
import StatusBadge from "./StatusBadge.svelte";

let { snapshot } = $props();

const capacity = $derived(snapshot.capacity);
</script>

<section class="status-table-section" aria-labelledby="capacity-heading">
  <h3 id="capacity-heading">账号并发（M21）</h3>
  {#if !capacity.available}
    <EmptyState title="共享并发状态不可用" detail={capacity.reason ?? "未知原因"} />
  {:else if capacity.rows.length === 0}
    <EmptyState title="暂无并发租约" detail="没有账号正在持有并发槽位。" />
  {:else}
    <p class="status-table-summary">
      活跃 {capacity.liveCount} · 过期 {capacity.staleCount} · 过期租约不计入活跃容量
    </p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="账号并发租约表，可横向滚动">
      <table class="status-table">
        <caption class="sr-only">按账号的并发租约，过期行不计入活跃容量</caption>
        <thead>
          <tr>
            <th scope="col">账号</th>
            <th scope="col">模型</th>
            <th scope="col" class="is-numeric">并发</th>
            <th scope="col">作用域</th>
            <th scope="col">Worker</th>
            <th scope="col">更新</th>
          </tr>
        </thead>
        <tbody>
          {#each capacity.rows as row, index (`${row.unitRef}:${row.scope}:${row.model ?? ""}:${row.worker}:${index}`)}
            <tr class:is-stale={row.stale}>
              <th scope="row">{row.displayName}</th>
              <td class="status-mono">{row.model ?? "—"}</td>
              <td class="is-numeric">
                {#if row.max === 0}
                  不限
                {:else}
                  {row.held}/{row.max}
                {/if}
                {#if row.stale}
                  <StatusBadge label="已过期" tone="warning" title={`${row.ageMs} ms`} />
                {/if}
              </td>
              <td>{row.scope === "unit" ? "账号" : "账号+模型"}</td>
              <td class="status-mono">{row.worker}</td>
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
