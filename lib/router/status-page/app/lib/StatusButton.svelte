<script>
import { Button } from "framework7-svelte";

let {
  disabled = false,
  fill = false,
  className = "",
  children,
  onclick = undefined,
  ariaLabel = undefined,
  describedBy = undefined,
} = $props();
</script>

{#if disabled}
  <button
    type="button"
    class="button disabled {fill ? "button-fill" : ""} {className}"
    disabled
    aria-disabled="true"
    tabindex="-1"
    aria-label={ariaLabel}
    aria-describedby={describedBy}
  >
    {@render children?.()}
  </button>
{:else}
  <Button
    type="button"
    class={className}
    {fill}
    onClick={onclick}
    aria-label={ariaLabel}
    aria-describedby={describedBy}
  >
    {@render children?.()}
  </Button>
{/if}
