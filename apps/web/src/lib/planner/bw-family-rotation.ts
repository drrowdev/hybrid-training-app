/**
 * Per-session family selection for bodyweight main lifts.
 *
 * Why a deterministic rotation
 * ────────────────────────────
 * For a barbell user, the planner pins one main lift per strength day
 * (squat / horizontal_press / deadlift / vertical_press) via the user's
 * Training Max. Bodyweight users have no TM — instead they have a
 * `bw_progress` pointer per movement family. Phase 3 picks **three**
 * families per session from the user's `bw_progress` rows, biased by
 * archetype, rotated session-by-session so consecutive sessions don't
 * over-train the same families.
 *
 * The rotation is seeded by (block_id, dayIndex, slot) so a re-render
 * of the plan produces the same selection — deterministic generation
 * is the same invariant the rest of the planner already maintains.
 *
 * Citations:
 *   - Bodyweight addendum principle 5 — skill work is neurologically
 *     demanding even when "light"; rotate to give each family CNS
 *     recovery between sessions.
 *   - Schoenfeld 2017 + Helms 2018 — frequency 2× / week per pattern
 *     is the practitioner-consensus minimum effective dose; three
 *     patterns per session × N sessions/week clears that threshold
 *     for the prioritised families.
 *
 * Pure module. No I/O, no DB, no React.
 */
import type { MovementFamily } from "@hta/db";
import type { ArchetypeId } from "./archetypes";

/**
 * Archetype-biased priority order for family selection. Phase 3 ships
 * the simple version: a static priority list per archetype. Phase 5
 * (mixed-modal classifier) will refine this with user-provided skill
 * goals once those land.
 *
 * Each list is intentionally longer than 3 — the rotation cycles
 * through whichever entries the user actually has `bw_progress` rows
 * for, in this order, skipping families they haven't calibrated.
 */
const ARCHETYPE_FAMILY_PRIORITY: Record<string, ReadonlyArray<MovementFamily>> = {
  // Strength bias — vertical patterns + unilateral squat lead, skill
  // families if present.
  strength_anchor: [
    "pull_v",
    "push_v",
    "squat_unilateral",
    "muscle_up",
    "planche",
    "lever_front",
    "handstand",
    "push_h",
    "pull_h",
    "squat_bilateral",
    "hinge",
    "core_anti_flexion",
  ],
  // Hypertrophy bias — balanced family rotation, moderate-rep patterns
  // first so volume accumulates across the canonical push/pull/squat.
  hypertrophy_anchor: [
    "push_h",
    "pull_v",
    "squat_unilateral",
    "push_v",
    "pull_h",
    "squat_bilateral",
    "hinge",
    "core_anti_flexion",
    "core_anti_rotation",
    "planche",
    "lever_front",
  ],
  // Endurance bias — horizontal patterns + bilateral squat lead, the
  // higher-rep-friendly families.
  endurance_anchor: [
    "push_h",
    "pull_h",
    "squat_bilateral",
    "squat_unilateral",
    "push_v",
    "pull_v",
    "core_anti_flexion",
    "hinge",
    "core_anti_rotation",
  ],
  // Hybrid / rebuild / maintenance / custom — fall back to the
  // hypertrophy list (decision 2 mirrors `bw-prescription.ts`).
  concurrent_hybrid: [
    "push_h",
    "pull_v",
    "squat_unilateral",
    "push_v",
    "pull_h",
    "squat_bilateral",
    "hinge",
    "core_anti_flexion",
  ],
  rebuild: [
    "push_h",
    "pull_h",
    "squat_bilateral",
    "core_anti_flexion",
    "hinge",
    "pull_v",
    "push_v",
  ],
  maintenance: [
    "push_h",
    "pull_v",
    "squat_unilateral",
    "push_v",
    "pull_h",
    "squat_bilateral",
  ],
};

function priorityFor(archetype: ArchetypeId | string): ReadonlyArray<MovementFamily> {
  return (
    ARCHETYPE_FAMILY_PRIORITY[archetype] ??
    ARCHETYPE_FAMILY_PRIORITY.hypertrophy_anchor!
  );
}

/**
 * Deterministic 32-bit string hash (FNV-1a). Used as the rotation seed
 * so re-generating the same (block, day, slot) tuple picks the same
 * families. No crypto — collisions don't matter, we just need a stable
 * spread across days.
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick three families for one bodyweight main-lift session.
 *
 * Inputs:
 *   - `availableFamilies` — set of families the user has a `bw_progress`
 *     row for (passed in by the caller from the DB).
 *   - `archetype` — drives the priority list.
 *   - `seed` — block_id + dayIndex + slot stringified, hashed inside.
 *
 * Returns up to 3 families. Returns fewer when the user has fewer than
 * 3 calibrated families (the caller decides whether to fall back to
 * accessory-only — current Phase 3 contract: emit whatever we have).
 */
export function pickFamiliesForBwSession(args: {
  availableFamilies: ReadonlySet<MovementFamily>;
  archetype: ArchetypeId | string;
  seed: string;
}): MovementFamily[] {
  const priority = priorityFor(args.archetype);
  const eligible = priority.filter((f) => args.availableFamilies.has(f));
  if (eligible.length <= 3) return [...eligible];

  // Rotate the eligible list by `hash % eligible.length` so consecutive
  // sessions land on different leading families. Then take the first 3.
  const offset = fnv1a(args.seed) % eligible.length;
  const rotated = [...eligible.slice(offset), ...eligible.slice(0, offset)];
  return rotated.slice(0, 3);
}
