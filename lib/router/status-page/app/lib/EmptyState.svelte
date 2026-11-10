<script>
let { title, detail = undefined } = $props();
</script>

<div class="status-empty" role="status">
  <p class="status-empty-title">{title}</p>
  {#if detail}
    <p class="status-empty-detail">{detail}</p>
  {/if}
</div>
