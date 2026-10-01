// Symmetric tool-call id mapping.
//
// Inbound ids are hashed so upstream stops rejecting calls whose ids collide in
// their first nine characters. The client sent those ids, so it must receive the
// same ones back: every id we mint is recorded, and the response is walked to
// put the originals back.
//
// The mapping is looked up by exact id value. Nothing is matched by pattern or
// by substring, so an id that merely resembles one we issued is only restored
// when it is genuinely that value.

const MAX_ENTRIES = 4096;

const hashedToOriginal = new Map();

/** Record that `hashed` was minted from `original`. */
export function remember(original, hashed) {
  if (typeof hashed !== "string" || hashed === original) return;
  // Re-insert to refresh recency, so a long conversation keeps live entries.
  hashedToOriginal.delete(hashed);
  hashedToOriginal.set(hashed, original);
  if (hashedToOriginal.size > MAX_ENTRIES) {
    hashedToOriginal.delete(hashedToOriginal.keys().next().value);
  }
}

/** The id we issued for `hashed`, or undefined. */
export function originalFor(hashed) {
  return hashedToOriginal.get(hashed);
}

export function size() {
  return hashedToOriginal.size;
}
