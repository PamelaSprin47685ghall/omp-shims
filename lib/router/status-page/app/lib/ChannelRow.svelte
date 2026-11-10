<script>
import { Accordion, AccordionContent, AccordionItem, AccordionToggle } from "framework7-svelte";
import PrimaryMetric from "./PrimaryMetric.svelte";
import StatusBadge from "./StatusBadge.svelte";
import UnitList from "./UnitList.svelte";

let { channel, openItems = new Set(), onToggleItem = () => {} } = $props();

const accordionId = $derived(`channel:${channel.id}`);
const accordionDomId = $derived(`status-acc-${channel.id.replace(/[^A-Za-z0-9_-]/g, "-")}`);
const opened = $derived(openItems.has(accordionId));
const perfIds = ["M13", "M14", "M15", "M16", "M17", "M18", "M19"];
</script>

<article class="channel-row" aria-label={channel.model}>
  <header class="channel-head">
    <h4 class="channel-model status-mono">{channel.model}</h4>
    <div class="channel-badges">
      <StatusBadge label={`effort ${channel.effort}`} tone="muted" />
      <StatusBadge label={`可用 ${channel.available} / ${channel.totalUnits}`} tone={channel.available > 0 ? "positive" : "muted"} />
    </div>
  </header>

  <UnitList {channel} />

  <Accordion class="status-accordion channel-diagnostics">
    <AccordionItem
      opened={opened}
      onAccordionOpen={() => onToggleItem(accordionId, true)}
      onAccordionClose={() => onToggleItem(accordionId, false)}
    >
      <AccordionToggle>
        <button
          type="button"
          class="accordion-button"
          aria-expanded={opened}
          aria-controls={accordionDomId}
        >
          <span>诊断与并发</span>
          <span class="sr-only">：{channel.model}</span>
        </button>
      </AccordionToggle>
      <AccordionContent>
        <div id={accordionDomId}>
          <div class="status-metric-grid">
            {#each perfIds as id (id)}
              <PrimaryMetric metric={channel.perf[id]} compact />
            {/each}
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</article>
