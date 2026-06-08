/**
 * Accessory role taxonomy + AccessoryProfile shape.
 *
 * Source of truth for the dynamic accessory picker (lib/planner/accessory-picker.ts).
 * Per docs/design/accessory-schema.md §19–25:
 *   - No archetype, week, or day template references a specific movement slug.
 *   - Selection is by role tag from the tagged movement catalog.
 *   - Many movements can satisfy the same role (a farmer carry is "carry",
 *     a suitcase carry is also "carry" AND "anti_rotation", etc.).
 */

/** Bulletproof roles — DC-O3 protocols + DC-O4 floor items. */
export const BULLETPROOF_ROLES = [
  "heavy_isometric",
  "hsr", // heavy slow resistance, Kongsgaard 2009
  "alfredson_eccentric", // symptomatic-only, Alfredson 1998
  "plyometric_low",
  "plyometric_high",
  "carry",
] as const;
export type BulletproofRole = (typeof BULLETPROOF_ROLES)[number];

/** Functional roles — movement-quality / carryover. */
export const FUNCTIONAL_ROLES = [
  "single_leg",
  "anti_rotation",
  "anti_extension",
  "loaded_mobility",
  "compound_assistance",
  "velocity_cued",
  "hip_stabilizer",
  "ankle_foot",
  /** Rotator-cuff / scapular-stability prehab for overhead & bench pressers (ADR 0035). */
  "shoulder_stability",
  /**
   * Horizontal / vertical PULL pattern (row, pulldown, pull-up, face-pull).
   * The four main-lift patterns (squat / horizontal_press / deadlift /
   * vertical_press) contain NO pull, so without a guaranteed pulling accessory
   * a whole block can ship zero back/biceps volume. ADR 0036 makes one weekly
   * pull a universal floor across every archetype for upper-body balance.
   */
  "pull",
  /** Olympic lift derivatives — triple-extension power. */
  "power_olympic",
  /** Jump-based stretch-shortening cycle work. */
  "power_plyometric",
  /** Loaded throw / explosive-intent ballistic variants. */
  "power_ballistic",
] as const;
export type FunctionalRole = (typeof FUNCTIONAL_ROLES)[number];

/**
 * Roles that the wizard's "Add power emphasis" toggle biases toward.
 * Read by the accessory picker when `powerEmphasis: true` — the picker
 * promotes movements tagged with any of these and trims high-rep
 * hypertrophy fillers (explosive intent vs hypertrophy stimulus per
 * Schoenfeld 2017 review).
 */
export const POWER_FUNCTIONAL_ROLES: readonly FunctionalRole[] = [
  "power_olympic",
  "power_plyometric",
  "power_ballistic",
] as const;

/**
 * DC-O4 weekly floor. Every archetype must hit these counts each week
 * regardless of emphasis; tendinopathy flag suppresses plyometric_*.
 */
export const DC_O4_FLOOR: Record<BulletproofRole, number> = {
  heavy_isometric: 1,
  hsr: 1,
  alfredson_eccentric: 0, // symptomatic-only, not part of floor
  plyometric_low: 1, // counted by either low or high
  plyometric_high: 0,
  carry: 2,
};

/** Sum of plyometric_low + plyometric_high must be ≥ this for the floor to count satisfied. */
export const FLOOR_PLYOMETRIC_TOTAL = 1;

/**
 * Per-session accessory budget reserved for the DC-O4 durability floor +
 * functional-role fills, held OUTSIDE the onboarding ramp. Sized so the
 * picker can always seat the weekly floor (heavy isometric / HSR / plyo /
 * 2× carry) plus an archetype's functional requirements across the week's
 * strength days. Heuristic magnitude (CP-3) — empirically sufficient: with a
 * full catalog every archetype × frequency × accessory-volume level meets the
 * floor at this reserve (see ADR 0024 addendum + tendon-floor invariant test).
 */
export const FLOOR_FUNCTIONAL_RESERVE = 4;

export type AccessoryAestheticProfile = {
  /** Number of aesthetic gap-fill items per strength session. */
  itemsPerSession: number;
  /** Default working sets per accessory item. */
  setsPerItem: number;
  /** Default rep range — inclusive. */
  repRange: { min: number; max: number };
  /** When true, picker prefers is_supported = true under concurrent load. */
  biasSupported: boolean;
};

export type AccessoryFunctionalProfile = {
  /** Weekly required count per functional role. Roles omitted = no requirement. */
  weeklyRoleRequirements: Partial<Record<FunctionalRole, number>>;
};

export type AccessoryDurabilityProfile = {
  /** Extras above the global DC-O4 floor — e.g. Endurance Focus adds Achilles hsr. */
  extras: { role: BulletproofRole; count: number }[];
};

export type AccessoryProfile = {
  aesthetic: AccessoryAestheticProfile;
  functional: AccessoryFunctionalProfile;
  durability: AccessoryDurabilityProfile;
};

/** All-zero profile — used by Custom blocks and as the default no-op. */
export const EMPTY_ACCESSORY_PROFILE: AccessoryProfile = {
  aesthetic: {
    itemsPerSession: 0,
    setsPerItem: 3,
    repRange: { min: 10, max: 15 },
    biasSupported: false,
  },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

/**
 * The full requirement vector for a week — DC-O4 floor + archetype extras.
 * Picker uses this as the durability deficit target.
 */
export function effectiveDurabilityFloor(
  profile: AccessoryProfile,
  tendinopathyActive: boolean,
  runningCardio = false,
): Record<BulletproofRole, number> {
  const floor: Record<BulletproofRole, number> = { ...DC_O4_FLOOR };
  if (tendinopathyActive || runningCardio) {
    // Plyometrics suppressed when a tendinopathy flag is active for the loaded
    // region, OR when the block's cardio is running-impact (review fix): a
    // runner already accumulates abundant reactive ground-contact loading
    // multiple sessions/week, so the low-impact plyometric floor is redundant
    // impact volume where it is least needed. The reactive-tendon stimulus the
    // floor exists to guarantee is already over-supplied by the running.
    floor.plyometric_low = 0;
    floor.plyometric_high = 0;
  }
  for (const e of profile.durability.extras) {
    floor[e.role] = (floor[e.role] ?? 0) + e.count;
  }
  return floor;
}
