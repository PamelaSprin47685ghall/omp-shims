// Gateway-only, provider-neutral sequencing of downstream Chat SSE content.
import { isGatewayProcess } from "../lib/gateway-process.js";
import { wrapServe } from "../lib/inbound.js";
import { withReasoningOrder } from "../lib/reasoning-order.js";

export function install(config, context) {
  if (!isGatewayProcess() || config?.enabled === false) return;
  wrapServe((handler) => withReasoningOrder(handler, {
    maxBufferBytes: config.maxBufferBytes ?? 16 * 1024 * 1024,
  }));
  context.log?.("reasoning-order: two-phase Chat SSE enabled");
}
