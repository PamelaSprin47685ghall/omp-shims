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
    this.pending += text.replace(/\r\n/g, "\n");
    const blocks = this.pending.split("\n\n");
    this.pending = blocks.pop() ?? "";
    return blocks.map(parseBlock).filter((event) => event !== undefined);
  }
}

function parseBlock(block) {
  let name;
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (name === undefined && data.length === 0) return undefined; // comment / keep-alive
  const text = data.join("\n");
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { ...(name ? { name } : {}), data: parsed };
}
