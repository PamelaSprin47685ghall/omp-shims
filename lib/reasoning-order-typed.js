// Typed-event reordering for Anthropic Messages and OpenAI Responses SSE.
// Content channels are read from protocol types, never inferred from prose.
// A thinking block can be streamed. Text, tool use and their lifecycle frames
// are held until all later thinking has arrived, then reindexed coherently.

const encoder = new TextEncoder();
function parse(block) {
  const lines = block.split("\n");
  const data = lines.filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart()).join("\n");
  let value;
  try { value = JSON.parse(data); } catch { value = undefined; }
  return { lines, value, name: lines.find((line) => line.startsWith("event:"))?.slice(6).trim() };
}
function toWire(record, value = record.value) {
  if (value === undefined) return record.lines.join("\n") + "\n\n";
  return [...record.lines.filter((l) => !l.startsWith("data:")),
    "data: " + JSON.stringify(value)].join("\n") + "\n\n";
}
function category(record, protocol, origins) {
  const d = record.value;
  if (record.lines.some((line) => line.trim() === "data: [DONE]")) return "terminal";
  const type = d?.type ?? record.name;
  if (protocol === "messages") {
    if (type === "message_delta" || type === "message_stop" || type === "error") return "terminal";
    if (!type?.startsWith("content_block_")) return "preamble";
    const i = d?.index;
    if (type === "content_block_start") {
      const kind = ["thinking", "redacted_thinking"].includes(d?.content_block?.type) ? "thinking" : "body";
      if (Number.isInteger(i)) origins.set(i, kind);
      return kind;
    }
    if (Number.isInteger(i) && origins.has(i)) return origins.get(i);
    const thought = d?.delta?.type === "thinking_delta" || d?.delta?.type === "signature_delta";
    return thought ? "thinking" : "body";
  }
  if (type === "response.completed" || type === "response.failed" ||
      type === "response.incomplete" || type === "error") return "terminal";
  if (!type?.startsWith("response.")) return "preamble";
  if (type === "response.created" || type === "response.in_progress" ||
      type === "response.queued") return "preamble";
  const i = d?.output_index;
  if (type.startsWith("response.output_item.")) {
    const kind = d?.item?.type === "reasoning" ? "thinking" :
      d?.item?.type ? "body" : origins.get(i) ?? "body";
    if (Number.isInteger(i)) origins.set(i, kind);
    return kind;
  }
  if (/^response\.(reasoning|reasoning_summary)/.test(type)) {
    if (Number.isInteger(i)) origins.set(i, "thinking");
    return "thinking";
  }
  if (/^response\.(output_text|function_call_arguments|refusal)/.test(type)) {
    if (Number.isInteger(i)) origins.set(i, "body");
    return "body";
  }
  if (Number.isInteger(i)) {
    if (!origins.has(i)) {
      const partType = typeof d?.part?.type === "string" ? d.part.type : "";
      origins.set(i, /^(reasoning|reasoning_summary_text|summary_text)$/.test(partType)
        ? "thinking" : "body");
    }
    return origins.get(i);
  }
  return "preamble";
}

/** Every content index is reallocated in the order delivered to the client. */
export function orderTypedStream(source, protocol, { maxBufferBytes = 16 * 1024 * 1024 } = {}) {
  if (protocol !== "messages" && protocol !== "responses")
    throw new TypeError("Unsupported typed SSE protocol");
  const decoder = new TextDecoder();
  const origins = new Map();
  const thought = new Map();
  const visible = new Map();
  const deferred = [];
  let nextThought = 0;
  let pending = "";
  let bufferedBytes = 0;
  let sequence = 0;
  const flushTo = (controller, record, kind) => {
    let value = record.value;
    if (value && typeof value === "object") {
      value = { ...value };
      const prop = protocol === "messages" ? "index" : "output_index";
      const index = value[prop];
      if (Number.isInteger(index)) {
        const remapped = kind === "thinking" ? thought.get(index)
          : thought.size + visible.get(index);
        if (Number.isInteger(remapped)) value[prop] = remapped;
      }
      if (protocol === "responses" && Number.isInteger(value.sequence_number))
        value.sequence_number = sequence++;
      if (protocol === "responses" &&
          (value.type ?? record.name) === "response.completed" &&
          Array.isArray(value.response?.output)) {
        const output = value.response.output;
        value.response = { ...value.response, output: [
          ...output.filter((x) => x?.type === "reasoning"),
          ...output.filter((x) => x?.type !== "reasoning"),
        ] };
      }
    }
    controller.enqueue(encoder.encode(toWire(record, value)));
  };
  const defer = (record) => {
    const bytes = encoder.encode(toWire(record)).byteLength;
    bufferedBytes += bytes;
    if (bufferedBytes > maxBufferBytes)
      throw new RangeError("reasoning-order visible buffer exceeded limit");
    deferred.push(record);
  };
  const release = (controller) => {
    for (const record of deferred) flushTo(controller, record, "body");
    deferred.length = 0;
    bufferedBytes = 0;
  };
  const one = (block, controller) => {
    const record = parse(block);
    const kind = category(record, protocol, origins);
    const index = protocol === "messages" ? record.value?.index : record.value?.output_index;
    if (kind === "thinking") {
      if (Number.isInteger(index) && !thought.has(index)) thought.set(index, nextThought++);
      flushTo(controller, record, "thinking");
    } else if (kind === "body") {
      if (Number.isInteger(index) && !visible.has(index)) visible.set(index, visible.size);
      defer(record);
    } else if (kind === "terminal") {
      release(controller);
      flushTo(controller, record, "terminal");
    } else {
      flushTo(controller, record, "preamble");
    }
  };
  return source.pipeThrough(new TransformStream({
    transform(bytes, controller) {
      pending += decoder.decode(bytes, { stream: true });
      pending = pending.replace(/\r\n/g, "\n");
      for (;;) {
        const at = pending.indexOf("\n\n");
        if (at < 0) break;
        const block = pending.slice(0, at);
        pending = pending.slice(at + 2);
        one(block, controller);
      }
      if (pending.length > 1024 * 1024) throw new RangeError("reasoning-order SSE event too large");
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) one(pending, controller);
      release(controller);
    },
  }));
}
