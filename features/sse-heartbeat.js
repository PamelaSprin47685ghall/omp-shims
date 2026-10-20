// SSE heartbeat: keep quiet event streams alive between the gateway and its
// clients.
//
// Every text/event-stream response the gateway sends (lazy or not) gets an SSE
// comment line, ": keep-alive", after `intervalMs` without any bytes, written
// only between events. See lib/sse-heartbeat.js.
//
// The wrap is installed before every other inbound wrap, so it is the
// outermost one: it sees the response only once the handlers inside have
// decided it (the lazy router's failover happens before the first byte, and
// stays that way).
//
// Config (~/.omp/shims.json):
//   "sse-heartbeat": {
//     "enabled": true,
//     "intervalMs": 15000            // idle time before a keep-alive comment
//   }

import { isGatewayProcess } from "../lib/gateway-process.js";
import { wrapServe } from "../lib/inbound.js";
import { DEFAULT_INTERVAL_MS, withSseHeartbeat } from "../lib/sse-heartbeat.js";

export function install(config, context) {
  if (config?.enabled === false) return;
  if (!isGatewayProcess()) {
    context.log?.("sse-heartbeat: not the auth-gateway process; staying off");
    return;
  }
  const intervalMs = Number(config.intervalMs) > 0 ? Number(config.intervalMs) : DEFAULT_INTERVAL_MS;
  wrapServe((handler) => withSseHeartbeat(handler, { intervalMs }));
  context.log?.("sse-heartbeat: enabled", { intervalMs });
}
