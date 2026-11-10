<script>
import { onMount } from "svelte";
import StatusApp from "./StatusApp.svelte";

let { initialSnapshot, initialOpenItems = new Set(), onRefresh = undefined, onResetSuccess = undefined } = $props();

// These props seed the client store once; later values arrive through exports.
// svelte-ignore state_referenced_locally
let snapshot = $state(initialSnapshot);
// svelte-ignore state_referenced_locally
let nowMs = $state(Date.parse(initialSnapshot.generatedAt));
// svelte-ignore state_referenced_locally
let connection = $state({
  state: "server",
  lastGoodAt: initialSnapshot.generatedAt,
  error: null,
});
let jsReady = $state(false);
let versionMismatch = $state(null);
let refreshing = $state(false);
// svelte-ignore state_referenced_locally
let openItems = $state(new Set(initialOpenItems));

function accordionIds(value) {
  const ids = new Set(["workers"]);
  for (const route of value.routes ?? []) {
    for (const channel of route.channels ?? []) ids.add(`channel:${channel.id}`);
  }
  return ids;
}

export function apply(next) {
  const valid = accordionIds(next);
  openItems = new Set([...openItems].filter((id) => valid.has(id)));
  snapshot = next;
}

export function setConnection(next) {
  connection = next;
}

export function tick(at) {
  nowMs = at;
}

export function setReady() {
  jsReady = true;
}

export function setVersionMismatch(next) {
  versionMismatch = next ?? { code: "version_mismatch" };
}

export function setRefreshing(next) {
  refreshing = next === true;
}

export function toggleItem(id, opened) {
  const next = new Set(openItems);
  if (opened) next.add(id);
  else next.delete(id);
  openItems = next;
}

onMount(() => {
  const timer = setInterval(() => {
    nowMs = Date.now();
  }, 1000);
  const onHide = () => clearInterval(timer);
  window.addEventListener("pagehide", onHide, { once: true });
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", onHide);
  };
});
</script>

<StatusApp
  {snapshot}
  {nowMs}
  {connection}
  {jsReady}
  {versionMismatch}
  {refreshing}
  {onRefresh}
  {onResetSuccess}
  {openItems}
  onToggleItem={toggleItem}
/>
