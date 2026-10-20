// Reasoning-effort normalization.
//
// Two steps, kept separate so each is testable on its own:
//   1. policy → target level: a "capped" route entry gets min(requested, medium)
//      (medium when the client asked for nothing); an entry naming a level
//      (e.g. "low") always gets that level; every other entry gets high.
//   2. target → a level the model accepts: the gateway rejects efforts outside a
//      model's list instead of clamping, so step down to the nearest supported
//      level at or below the target, or to the lowest one when none is lower.
//      A model without reasoning gets no effort at all (the field is omitted).

/** Every level the gateway understands, weakest first. "none" turns reasoning off. */
export const EFFORT_LADDER = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Route-entry effort policies (besides a fixed level from EFFORT_LADDER). */
export const EFFORT_POLICY = Object.freeze({ CAPPED: "capped", HIGH: "high" });

/** The ceiling for capped entries, and the level they use when the client sent none. */
export const CAPPED_CEILING = "medium";

/** The level for entries that are not capped. */
export const UNCAPPED_LEVEL = "high";

/** The effort a liveness probe asks for when the model insists on one. */
export const PROBE_LEVEL = "low";

const rank = (level) => EFFORT_LADDER.indexOf(level);

/** True for a level on the ladder. */
export function isEffortLevel(level) {
  return rank(level) !== -1;
}

/** The weaker of two levels. */
export function minEffort(a, b) {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Step 1: the level a route entry asks for.
 * @param {string|undefined} policy  EFFORT_POLICY value or a fixed EFFORT_LADDER level from the route table
 * @param {string|undefined} requested  the client's level, if any
 */
export function targetEffort(policy, requested) {
  if (isEffortLevel(policy)) return policy;
  if (policy !== EFFORT_POLICY.CAPPED) return UNCAPPED_LEVEL;
  return isEffortLevel(requested) ? minEffort(requested, CAPPED_CEILING) : CAPPED_CEILING;
}

/**
 * Step 2: fit a level to what the model supports.
 * @param {string} level
 * @param {{reasoning: boolean, efforts?: string[], canDisable?: boolean}|undefined} traits
 * @returns {string|undefined} the level to send, or undefined to omit effort entirely
 */
export function fitEffort(level, traits) {
  if (!traits) return level; // unknown model: let the gateway decide
  if (!traits.reasoning) return undefined;

  const supported = supportedLevels(traits);
  if (supported.length === 0) return level;
  if (supported.includes(level)) return level;

  const lower = supported.filter((candidate) => rank(candidate) < rank(level));
  return lower.length > 0 ? lower[lower.length - 1] : supported[0];
}

/** The model's accepted levels in ladder order, including "none" when reasoning can be switched off. */
export function supportedLevels(traits) {
  const levels = new Set(traits.efforts ?? []);
  if (traits.canDisable) levels.add("none");
  return EFFORT_LADDER.filter((level) => levels.has(level));
}

/** Both steps: the effort to send for one candidate. */
export function resolveEffort({ policy, requested, traits }) {
  return fitEffort(targetEffort(policy, requested), traits);
}

/** The effort a probe sends: as little as the model allows, never "none" for a model that needs one. */
export function probeEffort(traits) {
  if (!traits?.reasoning) return undefined;
  return fitEffort(PROBE_LEVEL, { ...traits, canDisable: false });
}
