/**
 * Experience-tier mapping — canonical ordinal scale used by every
 * movement-selection surface (accessory picker, main-lift resolver,
 * power-emphasis potentiation, cardio archetype materialiser).
 *
 * Tier values (must stay in lockstep with `packages/db/drizzle/0057_movement_experience_bands.sql`):
 *
 * | Tier            | Value | DeclaredExperience           |
 * |-----------------|-------|------------------------------|
 * | Beginner        | 0     | beginner_lt_6m               |
 * | Novice          | 1     | novice_6m_2y                 |
 * | Intermediate    | 2     | intermediate_2y_5y           |
 * | Advanced        | 3     | advanced_5y_10y              |
 * | Highly advanced | 4     | highly_advanced_10y_plus     |
 *
 * `null` input → `null` output, which every filter treats as
 * "no filter, allow everything" — matches the conservative default
 * shipped in PR #143.
 *
 * See `experience-tier-scope.md` §3 Option B + §5.2.
 */
import type { DeclaredExperience } from "@hta/engine";

export const TIER_BEGINNER = 0 as const;
export const TIER_NOVICE = 1 as const;
export const TIER_INTERMEDIATE = 2 as const;
export const TIER_ADVANCED = 3 as const;
export const TIER_HIGHLY_ADVANCED = 4 as const;

export const TIER_MIN = TIER_BEGINNER;
export const TIER_MAX = TIER_HIGHLY_ADVANCED;

const DECLARED_TO_TIER: Record<DeclaredExperience, number> = {
  beginner_lt_6m: TIER_BEGINNER,
  novice_6m_2y: TIER_NOVICE,
  intermediate_2y_5y: TIER_INTERMEDIATE,
  advanced_5y_10y: TIER_ADVANCED,
  highly_advanced_10y_plus: TIER_HIGHLY_ADVANCED,
};

/**
 * Convert a declared-experience string into the ordinal tier number.
 * `null` / `undefined` → `null` (meaning "no filter, allow everything").
 *
 * Every selection surface that wants to gate movements by experience
 * MUST go through this helper so the scale stays in one place.
 */
export function declaredExperienceToTier(
  exp: DeclaredExperience | null | undefined,
): number | null {
  if (exp == null) return null;
  const t = DECLARED_TO_TIER[exp];
  return typeof t === "number" ? t : null;
}

/**
 * True when `tier` falls inside the inclusive band `[min, max]`. A null
 * `tier` (no declaration) always returns `true` — the conservative
 * "allow everything" default.
 */
export function tierInBand(
  tier: number | null,
  min: number,
  max: number,
): boolean {
  if (tier == null) return true;
  return tier >= min && tier <= max;
}
