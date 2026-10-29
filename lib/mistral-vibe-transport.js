// Mistral Vibe provider-specific transport, preserving historical assistant
// thinking before OMP's stock OpenAI serializer discards it.
// Delegate to the original OpenAI stream transport; other providers unchanged.

import { streamSimple as streamVendorHost } from "../vendor/earendil-works-pi-ai/index.js";

export const MISTRAL_VIBE_NATIVE_API = "mistral-vibe-native";

function visibleText(message) {
  return message.content.filter((block) =>
    block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0
  ).map((block) => block.text).join("");
}

/** Match serialized assistant history to the exact original source, fail closed. */
export function withMistralThinkingHistory(payload, context) {
  if (!payload || !Array.isArray(payload.messages) || !Array.isArray(context?.messages)) return undefined;
  const source = context.messages.filter((msg) => msg?.role === "assistant" && Array.isArray(msg.content));
  let cursor = 0;
  let changed = false;
  const messages = payload.messages.map((target) => {
    if (target?.role !== "assistant") return target;
    while (cursor < source.length) {
      const original = source[cursor++];
      const text = visibleText(original);
      const thinking = original.content.filter((block) =>
        block?.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0
      );
      // Some OMP compat profiles discard thinking, others incorrectly flatten
      // thinking into visible assistant text. Identify both exact wire shapes.
      const flattenedThinking = thinking.map((block) => block.thinking).join("\n\n");
      const serialized = typeof target.content === "string" ? target.content : "";
      if (serialized !== text && serialized !== flattenedThinking + text) continue;
      const sourceCalls = original.content.filter((block) => block?.type === "toolCall");
      const destCalls = Array.isArray(target.tool_calls) ? target.tool_calls : [];
      if (sourceCalls.length !== destCalls.length) continue;
      if (sourceCalls.some((call,i) => call.name !== destCalls[i]?.function?.name)) continue;
      if (!thinking.length) return target;
      if (target.content !== null && typeof target.content !== "string") return target;
      const content = thinking.map((block) => ({
        type: "thinking",
        thinking: [{ type: "text", text: block.thinking }],
        ...(typeof block.thinkingSignature === "string" && block.thinkingSignature
          ? { signature: block.thinkingSignature } : {}),
      }));
      if (text) content.push({ type: "text", text });
      changed = true;
      return { ...target, content };
    }
    return target;
  });
  return changed ? { ...payload, messages } : undefined;
}

/** Delegate to OMP's real OpenAI transport, correcting only Mistral payload. */
export function streamMistralVibe(model, context, options = {}) {
  const userPayload = options.onPayload;
  return streamVendorHost({ ...model, api: "openai-completions" }, context, {
    ...options,
    onPayload: async (payload, innerModel) => {
      const prior = (await userPayload?.(payload, innerModel)) ?? payload;
      return withMistralThinkingHistory(prior, context) ?? prior;
    },
  });
}
