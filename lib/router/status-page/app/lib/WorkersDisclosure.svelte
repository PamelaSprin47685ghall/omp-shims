<script>
import { Accordion, AccordionContent, AccordionItem, AccordionToggle } from "framework7-svelte";
import EmptyState from "./EmptyState.svelte";
import { formatAbsolute, formatAge } from "./relative.js";
import StatusBadge from "./StatusBadge.svelte";

let { snapshot, openItems = new Set(), onToggleItem = () => {} } = $props();

const opened = $derived(openItems.has("workers"));
</script>

<Accordion class="status-accordion">
  <AccordionItem
    opened={opened}
    onAccordionOpen={() => onToggleItem("workers", true)}
    onAccordionClose={() => onToggleItem("workers", false)}
  >
    <AccordionToggle>
      <button
        type="button"
        class="accordion-button"
        aria-expanded={opened}
        aria-controls="status-workers-content"
      >
        <span>按 worker 在途（M04）</span>
        <StatusBadge label={`${snapshot.workers.length} 个 worker`} tone="muted" />
      </button>
    </AccordionToggle>
    <AccordionContent>
      <div id="status-workers-content">
      {#if snapshot.workers.length === 0}
        <EmptyState title="尚无 worker 心跳" detail="心跳写共享存储后显示按 worker 的在途请求。" />
      {:else}
        <div class="table-wrap" tabindex="0" role="region" aria-label="按 worker 在途请求表，可横向滚动">
          <table class="status-table">
            <caption class="sr-only">按 worker 的在途上游请求</caption>
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col" class="is-numeric">在途</th>
                <th scope="col">心跳</th>
                <th scope="col">目录</th>
                <th scope="col">版本</th>
              </tr>
            </thead>
            <tbody>
              {#each snapshot.workers as worker, index (`${worker.worker}:${index}`)}
                <tr class:is-stale={worker.stale}>
                  <th scope="row" class="status-mono">{worker.worker}</th>
                  <td class="is-numeric" data-metric={worker.metric.id} title={worker.metric.exact}>
                    <span>{worker.metric.value}</span>
                    {#if worker.metric.detail}
                      <span class="status-inline-detail status-muted">{worker.metric.detail}</span>
                    {/if}
                  </td>
                  <td>
                    <time datetime={worker.heartbeatAt} title={formatAbsolute(worker.heartbeatAt)}>
                      {formatAge(worker.ageMs)}
                    </time>
                    {#if worker.stale}
                      <StatusBadge label="已过期" tone="warning" title={`${worker.ageMs} ms`} />
                    {/if}
                  </td>
                  <td>{worker.catalogReady ? "就绪" : "目录加载中"}</td>
                  <td>
                    <span class="status-mono">{worker.buildVersion}</span>
                    {#if worker.viewSchema !== 3}
                      <StatusBadge label="结构不匹配" tone="warning" />
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      </div>
    </AccordionContent>
  </AccordionItem>
</Accordion>
