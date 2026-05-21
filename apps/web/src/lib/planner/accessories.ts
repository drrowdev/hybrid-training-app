/**
 * Hypertrophy accessories.
 *
 * Per-strength-pattern curated accessory pools. Each pool is a small set
 * (3-4 entries) of isolation/assistance movements that fill the per-muscle
 * volume gaps left by the main lift on that day.
 *
 * Design intent (docs/design/hypertrophy-accessories.md §5):
 *  - Curated, not user-customisable in v1. Quality over quantity.
 *  - Every entry has a stated muscle target tied to the DC-T1 22-muscle
 *    taxonomy via the `primary_muscle` on the catalog row.
 *  - Default sets x reps are isolation-friendly (3 × 10-15) with the
 *    occasional compound-assistance variant (3 × 8-12).
 *  - Rationale string explains WHY this accessory belongs on this day so
 *    the UI can surface "extra glute volume on quad day" tooltips.
 *
 * Compatibility:
 *  - Default ON for Hypertrophy Focus (the archetype that explicitly needs
 *    per-muscle volume to drive its outcome).
 *  - Default OFF for Strength / Endurance / Rebuild (those archetypes are
 *    happier without extra fatigue noise).
 *  - User can override per-day via the custom builder.
 */

import type { StrengthRole } from "./archetypes";

export type AccessoryTemplate = {
  /** Catalog slug. Must exist in the movements table. */
  slug: string;
  /** Display label shown alongside the checkbox. */
  label: string;
  /** Plain-English muscle target — used by the checkbox row + stats rollup. */
  muscleTarget: string;
  /** Default working sets. v1 doesn't progress these. */
  sets: number;
  /** Default rep range string (e.g. "10-15"). Persisted on the prescription. */
  reps: string;
  /** Why this movement belongs on this day. Surfaced as a tooltip. */
  rationale?: string;
};

export const ACCESSORY_POOLS: Record<StrengthRole, AccessoryTemplate[]> = {
  squat: [
    {
      slug: "leg-curl-lying",
      label: "Lying leg curl",
      muscleTarget: "hamstrings",
      sets: 3,
      reps: "10-15",
      rationale: "Quad-dominant day; hamstrings get little direct work from the squat itself.",
    },
    {
      slug: "calf-raise-standing",
      label: "Standing calf raise",
      muscleTarget: "calves",
      sets: 3,
      reps: "12-15",
    },
    {
      slug: "ab-wheel-kneeling",
      label: "Ab wheel (kneeling)",
      muscleTarget: "abs",
      sets: 3,
      reps: "8-12",
    },
    {
      slug: "glute-bridge-bb",
      label: "Barbell glute bridge",
      muscleTarget: "glutes",
      sets: 3,
      reps: "10-12",
      rationale: "Extra direct glute volume on quad day — hip extension under load.",
    },
  ],
  horizontal_press: [
    {
      slug: "cable-fly-mid",
      label: "Cable fly (mid)",
      muscleTarget: "chest",
      sets: 3,
      reps: "12-15",
      rationale: "Stretch-loaded chest isolation that the press's mid-range misses.",
    },
    {
      slug: "lateral-raise-db",
      label: "DB lateral raise",
      muscleTarget: "side delts",
      sets: 3,
      reps: "12-15",
      rationale: "Side delts get nothing from horizontal pressing — needs direct work.",
    },
    {
      slug: "pushdown-rope",
      label: "Tricep pushdown (rope)",
      muscleTarget: "triceps",
      sets: 3,
      reps: "10-15",
    },
    {
      slug: "face-pull",
      label: "Face pull",
      muscleTarget: "rear delts + mid back",
      sets: 3,
      reps: "12-15",
      rationale: "Posterior shoulder balance — counter to all the pressing volume.",
    },
  ],
  deadlift: [
    {
      slug: "leg-curl-lying",
      label: "Lying leg curl",
      muscleTarget: "hamstrings",
      sets: 3,
      reps: "10-15",
      rationale: "Direct hamstring work to complement the hinge stimulus.",
    },
    {
      slug: "back-extension-45",
      label: "45° back extension",
      muscleTarget: "lower back + glutes",
      sets: 3,
      reps: "10-12",
    },
    {
      slug: "bb-row-overhand",
      label: "Barbell row (overhand)",
      muscleTarget: "mid back + lats",
      sets: 3,
      reps: "8-12",
      rationale: "Upper-back assistance — different bar path than a separate pull day.",
    },
    {
      slug: "db-curl-standing",
      label: "Standing DB curl",
      muscleTarget: "biceps",
      sets: 3,
      reps: "10-12",
    },
  ],
  vertical_press: [
    {
      slug: "lateral-raise-db",
      label: "DB lateral raise",
      muscleTarget: "side delts",
      sets: 3,
      reps: "12-15",
      rationale: "Side-delt focus that the overhead press can't fully cover.",
    },
    {
      slug: "face-pull",
      label: "Face pull",
      muscleTarget: "rear delts + mid back",
      sets: 3,
      reps: "12-15",
    },
    {
      slug: "pushdown-rope",
      label: "Tricep pushdown (rope)",
      muscleTarget: "triceps",
      sets: 3,
      reps: "10-15",
    },
    {
      slug: "db-curl-standing",
      label: "Standing DB curl",
      muscleTarget: "biceps",
      sets: 3,
      reps: "10-12",
    },
  ],
};

/** Union of every accessory slug across all pools. Used by the planner to
 *  ensure the catalog rows are fetched alongside the main lifts. */
export function allAccessorySlugs(): string[] {
  const set = new Set<string>();
  for (const pool of Object.values(ACCESSORY_POOLS)) {
    for (const a of pool) set.add(a.slug);
  }
  return Array.from(set);
}

/** Returns the pool for a given strength role, or [] if none defined. */
export function accessoryPoolFor(role: StrengthRole): AccessoryTemplate[] {
  return ACCESSORY_POOLS[role] ?? [];
}
