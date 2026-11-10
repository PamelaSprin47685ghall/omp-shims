<script>
let { graph } = $props();

function marker(node, index) {
  return node.type === "model" ? "◆" : `${index + 1}`;
}
</script>

{#snippet node(item, index)}
  <li class="tree-node" class:tree-leaf={item.type === "model"} class:tree-op={item.type !== "model"}>
    <span class="tree-marker" aria-hidden="true">{marker(item, index)}</span>
    <span class="tree-label">{item.label ?? item.model}</span>
    {#if item.children?.length}
      <ul class="tree-children">
        {#each item.children as child, childIndex (`${child.label ?? child.model ?? "node"}:${childIndex}`)}
          {@render node(child, childIndex)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<ul class="status-tree" aria-label="路由组合树">
  {@render node(graph, 0)}
</ul>
