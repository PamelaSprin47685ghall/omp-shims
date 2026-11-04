// Incremental server-sent-events parsing, for judging a held-back stream.

/** One parsed SSE event: its `event:` name (if any) and its JSON `data` (or the raw text). */
/** @typedef {{name?: string, data: any}} SseEvent */

/** Splits a byte stream's text into complete SSE events, carrying partial events across chunks. */
export class SseScanner {
  constructor() {
    this.pending = "";
  }

  /**
   * Feed decoded text; returns the events completed by it.
   * @returns {SseEvent[]}
   */
  push(text) {
    if (text.indexOf("\r") !== -1) text = text.replace(/\r\n/g, "\n");
    this.pending = this.pending === "" ? text : this.pending + text;
    const blocks = this.pending.split("\n\n");
    this.pending = blocks.pop() ?? "";
    const events = [];
    for (const block of blocks) {
      const event = parseBlock(block);
      if (event !== undefined) events.push(event);
    }
    return events;
  }
}

function parseBlock(block) {
  let name;
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const rest = line.slice(5);
      // SSE allows exactly one optional space; only pay trimStart for others.
      data.push(rest.length > 0 && rest.charCodeAt(0) <= 32 ? rest.trimStart() : rest);
    }
  }
  if (name === undefined && data.length === 0) return undefined; // comment / keep-alive
  const text = data.join("\n");
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { ...(name ? { name } : {}), data: parsed };
}
