// Reasoning-effort normalization.
//
// The work has two separate steps:
//   1. policy to target level: a "capped" entry gets min(requested, medium),
//      or medium when the client asked for nothing. An entry naming a level
//      gets that level. Every other entry gets high.
//   2. target to a level the model accepts: the gateway rejects an effort
//      outside a model's list instead of clamping it. Step down to the nearest
//      supported level at or below the target, or to the lowest one. A model
//      without reasoning gets no effort at all.

/** Every level the gateway understands, weakest first. */
export const EFFORT_LADDER = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Route-entry effort policies, besides a fixed ladder level. */
export const EFFORT_POLICY = Object.freeze({ CAPPED: "capped", HIGH: "high" });

/** The ceiling for a capped entry, and its level when the client sent none. */
export const CAPPED_CEILING = "medium";

/** The level for an entry that is not capped. */
export const UNCAPPED_LEVEL = "high";

/** The effort a liveness probe asks for when the model requires one. */
export const PROBE_LEVEL = "low";

/** Ladder position, or -1 for an unknown value. */
function rank(level) {
  return EFFORT_LADDER.indexOf(level);
}

/** True for a level on the ladder. */
export function isEffortLevel(level) {
  return rank(level) !== -1;
}

/** The weaker of two levels. */
export function minEffort(left, right) {
  return rank(left) <= rank(right) ? left : right;
}

/**
 * Step 1: the level a route entry asks for.
 * @param {string|undefined} policy a policy value or a fixed ladder level
 * @param {string|undefined} requested the client's level
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
 * @returns {string|undefined} the level to send, or undefined to omit effort
 */
export function fitEffort(level, traits) {
  if (!traits) return level;
  if (!traits.reasoning) return undefined;

  const supported = supportedLevels(traits);
  if (supported.length === 0) return level;
  if (supported.includes(level)) return level;

  const lower = supported.filter((candidate) => rank(candidate) < rank(level));
  return lower.length > 0 ? lower[lower.length - 1] : supported[0];
}

/** The model's accepted levels in ladder order, including "none". */
export function supportedLevels(traits) {
  const levels = new Set(traits.efforts ?? []);
  if (traits.canDisable) levels.add("none");
  return EFFORT_LADDER.filter((level) => levels.has(level));
}

/** Both steps: the effort to send for one candidate. */
export function resolveEffort({ policy, requested, traits }) {
  return fitEffort(targetEffort(policy, requested), traits);
}

/** The effort a probe sends: as little as the model allows. */
export function probeEffort(traits) {
  if (!traits?.reasoning) return undefined;
  return fitEffort(PROBE_LEVEL, { ...traits, canDisable: false });
}
