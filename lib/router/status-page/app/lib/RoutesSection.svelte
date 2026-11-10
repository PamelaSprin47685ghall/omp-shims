<script>
import EmptyState from "./EmptyState.svelte";
import RouteCard from "./RouteCard.svelte";

let { snapshot, openItems = new Set(), onToggleItem = () => {} } = $props();
</script>

<section class="status-routes" aria-labelledby="routes-heading">
  <h2 id="routes-heading" tabindex="-1">路由</h2>
  {#if snapshot.routes.length === 0}
    <EmptyState
      title={snapshot.catalog.ready ? "没有可选路由" : "目录加载中"}
      detail={snapshot.catalog.ready ? "检查模型目录或账号健康。" : "目录就绪后将显示路由与候选通道。"}
    />
  {:else}
    {#each snapshot.routes as route, index (`${route.id}:${index}`)}
      <RouteCard {route} {openItems} {onToggleItem} />
    {/each}
  {/if}
</section>
