/**
 * Auto-warmup ladder generator.
 *
 * The engine prepends a series of `kind: "warmup"` prescription items
 * before each main lift so the lifter rehearses the motor pattern and
 * connective tissue gets a sub-maximal exposure before the first
 * working set. Practitioner consensus + Baar 2017 tendon adaptation
 * literature.
 *
 * Pure: no DB, no IO. Inputs in, items out. Wired into the
 * prescription assembly in `lib/planner/actions.ts`.
 */
import type { PrescriptionItem } from "@hta/db";

export type WarmupScheme = {
  /** Number of warmup sets (0-5). 0 disables auto-warmups. */
  setCount: number;
  /** Percent of top working weight per warmup, in order. Length must match setCount. */
  percentLadder: number[];
  /** Reps per warmup set, in order. Length must match setCount. */
  repLadder: number[];
};

/** Practitioner-consensus default: 3-set ramp at 40/50/60% × 5/3/2. */
export const DEFAULT_WARMUP_SCHEME: WarmupScheme = {
  setCount: 3,
  percentLadder: [40, 50, 60],
  repLadder: [5, 3, 2],
};

/**
 * True iff `scheme` is structurally consistent: setCount in [0..5] and
 * both ladders' lengths equal setCount. setCount === 0 still requires
 * empty ladders for the schema to be "well-formed".
 */
export function isWellFormedScheme(scheme: unknown): scheme is WarmupScheme {
  if (!scheme || typeof scheme !== "object") return false;
  const s = scheme as Partial<WarmupScheme>;
  if (typeof s.setCount !== "number" || !Number.isFinite(s.setCount)) return false;
  if (!Number.isInteger(s.setCount) || s.setCount < 0 || s.setCount > 5) return false;
  if (!Array.isArray(s.percentLadder) || !Array.isArray(s.repLadder)) return false;
  if (s.percentLadder.length !== s.setCount) return false;
  if (s.repLadder.length !== s.setCount) return false;
  if (!s.percentLadder.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100)) {
    return false;
  }
  if (!s.repLadder.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 20)) {
    return false;
  }
  return true;
}

/**
 * Normalise a possibly-NULL / possibly-malformed stored scheme into a
 * usable one. Falls back to DEFAULT_WARMUP_SCHEME on any structural
 * issue; preserves the user's intent only when the payload is sound.
 */
export function resolveWarmupScheme(stored: unknown): WarmupScheme {
  if (stored == null) return DEFAULT_WARMUP_SCHEME;
  if (!isWellFormedScheme(stored)) return DEFAULT_WARMUP_SCHEME;
  return stored;
}

/** Round to nearest 0.5%. */
function roundHalfPct(pct: number): number {
  return Math.round(pct * 2) / 2;
}

/**
 * Generate the warmup prescription items for one main lift.
 *
 * @param mainMovementId  Movement ID of the main lift (warmups share it).
 * @param topWorkingPercent  % TM of the heaviest planned working set
 *                           for this movement (0-100). Warmups are
 *                           computed relative to the TOP set, not each
 *                           working set, so a 65/75/85 wave gets one
 *                           series of warmups built off 85%.
 * @param scheme  User's warmup configuration. Pass through
 *                `resolveWarmupScheme` to get a guaranteed-valid one.
 * @param baseMeta  Optional movement metadata (slug, name) copied onto
 *                  each generated item so the renderer doesn't have to
 *                  cross-reference the catalog.
 */
export function generateWarmupItems(
  mainMovementId: string,
  topWorkingPercent: number,
  scheme: WarmupScheme,
  baseMeta?: { movementSlug?: string; movementName?: string },
): PrescriptionItem[] {
  const resolved = isWellFormedScheme(scheme) ? scheme : DEFAULT_WARMUP_SCHEME;
  if (resolved.setCount <= 0) return [];
  if (!Number.isFinite(topWorkingPercent) || topWorkingPercent <= 0) return [];

  const items: PrescriptionItem[] = [];
  for (let i = 0; i < resolved.setCount; i++) {
    const pct = roundHalfPct((topWorkingPercent * resolved.percentLadder[i]!) / 100);
    items.push({
      movementId: mainMovementId,
      movementSlug: baseMeta?.movementSlug,
      movementName: baseMeta?.movementName,
      kind: "warmup",
      sets: 1,
      reps: resolved.repLadder[i]!,
      percentTm: pct,
      intensityLabel: `${pct}% TM`,
    });
  }
  return items;
}
