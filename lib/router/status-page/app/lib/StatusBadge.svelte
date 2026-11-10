<script>
let { label, tone = "muted", title = undefined } = $props();
</script>

<span class="status-badge tone-{tone}" {title}>
  <span class="status-badge-dot" aria-hidden="true"></span>
  <span>{label}</span>
</span>
