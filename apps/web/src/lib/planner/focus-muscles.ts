/**
 * Focus muscle groups — per-block aesthetic specialisation.
 *
 * User picks 0–2 from `FOCUS_MUSCLE_ALLOWLIST`; the planner biases
 * accessory selection toward those muscles via the
 * substitution-with-cap model (see `defaultMuscleTargets` in
 * `apps/web/src/lib/planner/actions.ts`). The engine pulls volume from
 * non-focus aesthetic muscles to preserve the substitution invariant:
 *   sum(biased targets) === sum(unbiased baseline) within ±1 set.
 *
 * Naming note: the allowlist uses `side_delts` (the canonical
 * `movements.primary_muscle` enum + `LANDMARKS` key in
 * `apps/web/src/lib/stats/muscle-volume.ts`). The UI labels this
 * "Medial delts" per the practitioner-language brief — they're the
 * same muscle, different vocabulary.
 *
 * Excluded muscles + rationale:
 *  - abs / core, lower_back, obliques — not appropriate as bias
 *    targets; trunk load is already saturated by every compound and
 *    biasing risks lumbar compression. (per Israetel 2017 MRV tables.)
 *  - adductors, abductors, hip flexors — high injury risk under
 *    voluntary high-volume work, low aesthetic relevance.
 *  - lats, mid_back, chest (full) — too coarse; their volume is
 *    driven by main lifts, not accessory bias.
 *
 * See migration 0079 for the DB-level CHECK constraints that enforce
 * the same allowlist + size cap server-side.
 */
import { z } from "zod";

/**
 * The 12 muscle groups a user can bias toward. Practitioner consensus
 * per Israetel 2017 (Renaissance Periodization volume landmarks) +
 * Schoenfeld 2017 (hypertrophy meta) — these are the muscles where
 * voluntary set-count bias produces measurable size response without
 * crossing into injury-risk territory.
 */
export const FOCUS_MUSCLE_ALLOWLIST = [
  "biceps",
  "triceps",
  "side_delts",
  "rear_delts",
  "front_delts",
  "calves",
  "glutes",
  "upper_chest",
  "traps",
  "forearms",
  "quads",
  "hamstrings",
] as const;

export type FocusMuscle = (typeof FOCUS_MUSCLE_ALLOWLIST)[number];

const FOCUS_MUSCLE_SET: ReadonlySet<string> = new Set(FOCUS_MUSCLE_ALLOWLIST);

/** Practitioner-vocabulary label shown in UI. */
export const FOCUS_MUSCLE_LABEL: Record<FocusMuscle, string> = {
  biceps: "Biceps",
  triceps: "Triceps",
  side_delts: "Medial delts",
  rear_delts: "Rear delts",
  front_delts: "Front delts",
  calves: "Calves",
  glutes: "Glutes",
  upper_chest: "Upper chest",
  traps: "Traps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
};

/** Maximum simultaneously-focused groups. Practitioner consensus —
 *  three or more dilutes the bias to baseline. */
export const FOCUS_MUSCLE_MAX = 2;

/**
 * Zod schema mirroring the DB CHECK constraints (migration 0079).
 *
 * The DB is the final guard, but Zod-validating server-side keeps the
 * RLS layer from getting a Postgres error and lets us surface a clean
 * "Pick up to 2 from the allowed list." message.
 */
export const focusMusclesSchema = z
  .array(z.enum(FOCUS_MUSCLE_ALLOWLIST as unknown as [FocusMuscle, ...FocusMuscle[]]))
  .max(FOCUS_MUSCLE_MAX)
  .default([])
  .transform((arr) => {
    // De-duplicate while preserving order so a malformed form post that
    // sends ["biceps","biceps"] is normalised to ["biceps"] rather than
    // bloating the array (the size CHECK would otherwise trip on 2x
    // duplicates of the same muscle).
    const seen = new Set<FocusMuscle>();
    const out: FocusMuscle[] = [];
    for (const m of arr) {
      if (seen.has(m)) continue;
      seen.add(m);
      out.push(m);
    }
    return out;
  });

/** True when `m` is a valid focus muscle. */
export function isFocusMuscle(m: string): m is FocusMuscle {
  return FOCUS_MUSCLE_SET.has(m);
}

/** Format a focus-muscle list as a human-readable string for UI badges. */
export function formatFocusMuscles(muscles: readonly string[]): string {
  return muscles
    .filter(isFocusMuscle)
    .map((m) => FOCUS_MUSCLE_LABEL[m])
    .join(", ");
}

/**
 * The "Shoulders" UI parent group. The underlying enum has
 * front/medial/rear separately, but users think "shoulders" — the
 * wizard chip expands inline to show the three variants so users don't
 * accidentally pick the wrong delt head. The Plan-page edit modal uses
 * the same grouping.
 */
export const SHOULDER_FOCUS_VARIANTS: readonly FocusMuscle[] = [
  "side_delts",
  "rear_delts",
  "front_delts",
] as const;
