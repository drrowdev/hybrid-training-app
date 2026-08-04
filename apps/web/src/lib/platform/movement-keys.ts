/**
 * Movement-key + kind mapping between the program engines and the app.
 *
 * The `@hta/program-core` engines key strength movements by short slugs
 * ("squat" / "bench" / "deadlift" / "press" / "pullup") and emit
 * `PrescribedItemKind`s. The app anchors training maxes by `StrengthRole`
 * ("squat" / "horizontal_press" / "deadlift" / "vertical_press") — the user
 * picks a concrete variant per role — and renders `PrescriptionItem`s. This
 * module is the pure translation layer between the two vocabularies.
 */
import type { PrescribedItemKind } from "@hta/program-core";
import type { PrescriptionItemKind } from "@hta/db";
import { STRENGTH_ROLE_CANDIDATES, type StrengthRole } from "@/lib/planner/archetypes";

/** Engine movement key → the app StrengthRole its 1RM is anchored on. */
export const ENGINE_KEY_TO_ROLE: Record<string, StrengthRole> = {
  squat: "squat",
  bench: "horizontal_press",
  deadlift: "deadlift",
  press: "vertical_press",
};

/** The app StrengthRole → the engine movement key (inverse of the above). */
export const ROLE_TO_ENGINE_KEY: Record<StrengthRole, string> = {
  squat: "squat",
  horizontal_press: "bench",
  deadlift: "deadlift",
  vertical_press: "press",
};

/** Which StrengthRole a movement slug belongs to, via the archetype candidate lists. */
export function roleForSlug(slug: string): StrengthRole | undefined {
  for (const [role, slugs] of Object.entries(STRENGTH_ROLE_CANDIDATES) as [StrengthRole, string[]][]) {
    if (slugs.includes(slug)) return role;
  }
  return undefined;
}

/**
 * Bodyweight movement slug → engine movement key. These are NOT StrengthRoles
 * (they're prescribed off max reps, not a barbell 1RM), so they live outside the
 * archetype role system and outside ENGINE_KEY_TO_ROLE — keeping them out of the
 * 5/3/1 main-lift set and out of `computeTmAlignment` (no spurious tm_percent).
 * A movement only resolves here once the user has explicitly anchored it (e.g.
 * the Tactical Barbell Operator optional pull-up), so programs the user isn't
 * running are unaffected.
 */
export const BODYWEIGHT_ENGINE_KEY_BY_SLUG: Record<string, string> = {
  "pull-up-overhand": "pullup",
};

/**
 * Engine-owned movements with a fixed shared-catalog counterpart. These resolve
 * even when the user has no 1RM row, which lets unanchored Activation work
 * (circuits, jumps, core) materialise without inventing training-max records.
 * When a real 1RM exists for one of the barbell entries, `engineKeyForSlug`
 * anchors it under the exact engine key instead of folding it into a broad role.
 */
export const STATIC_ENGINE_MOVEMENTS: Record<
  string,
  { slug: string; displayName?: string }
> = {
  squat: { slug: "back-squat-high-bar", displayName: "Back Squat" },
  bench: { slug: "bench-press-flat", displayName: "Bench Press" },
  deadlift: { slug: "conventional-deadlift", displayName: "Deadlift" },
  press: { slug: "ohp-standing", displayName: "Overhead Press" },
  pushup: { slug: "push-up" },
  "plyo-pushup": { slug: "push-up", displayName: "Plyometric Push-up" },
  "goblet-squat": { slug: "goblet-squat" },
  "inverted-row": { slug: "inverted-row" },
  pullup: { slug: "pull-up-overhand", displayName: "Pull-up" },
  "hanging-leg-raise": { slug: "hanging-leg-raise" },
  "hanging-knee-raise": { slug: "hanging-knee-raise" },
  "toes-to-bar": { slug: "toes-to-bar" },
  // Legacy Activation plans used one knee-raise item named "Ab Triad".
  "ab-triad": { slug: "hanging-knee-raise", displayName: "Ab Triad" },
  "barbell-row": { slug: "bb-row-overhand", displayName: "Barbell Row" },
  "pendlay-row": { slug: "pendlay-row" },
  "rack-pull": { slug: "block-pull-deadlift", displayName: "Rack Pull" },
  "back-extension": { slug: "back-extension-45", displayName: "Back Extension" },
  "reverse-hyper": { slug: "reverse-hyper", displayName: "Reverse Hyperextension" },
  "weighted-pullup": { slug: "weighted-pull-up", displayName: "Weighted Pull-up" },
  "overhead-press": { slug: "ohp-standing", displayName: "Overhead Press" },
  "power-clean": { slug: "power-clean" },
  "push-press": { slug: "push-press" },
  "jump-squat": { slug: "jump-squat" },
};

/** The engine movement key a given movement slug maps to (via its role), or undefined. */
export function engineKeyForSlug(slug: string): string | undefined {
  return engineKeysForSlug(slug)[0];
}

/** Exact engine keys owned by a specific catalog movement (no broad role aliases). */
export function directEngineKeysForSlug(slug: string): string[] {
  const keys = new Set<string>();
  const bw = BODYWEIGHT_ENGINE_KEY_BY_SLUG[slug];
  if (bw) keys.add(bw);
  for (const [engineKey, movement] of Object.entries(STATIC_ENGINE_MOVEMENTS)) {
    if (movement.slug === slug) keys.add(engineKey);
  }
  return [...keys];
}

/**
 * Engine keys a slug can represent in isolation. Exact bindings win; broad
 * strength-role fallback is used only when no exact program binding exists.
 */
export function engineKeysForSlug(slug: string): string[] {
  const exact = directEngineKeysForSlug(slug);
  if (exact.length > 0) return exact;
  const role = roleForSlug(slug);
  return role ? [ROLE_TO_ENGINE_KEY[role]] : [];
}

/**
 * Program-core item kind → app PrescriptionItem kind, for the strength kinds we
 * materialise today. Kinds not in this map (conditioning / cardio / note) are
 * handled separately by the adapter (cardio mapping is a follow-up; notes fold
 * into the preceding item).
 */
export const STRENGTH_KIND_MAP: Partial<Record<PrescribedItemKind, PrescriptionItemKind>> = {
  warmup: "warmup",
  main: "main",
  amrap: "main",
  supplemental: "back_off",
  assistance: "accessory",
};

/**
 * The working-max basis each program family uses, as a percentage of the true
 * 1RM — used (Option A) to seed the user's per-movement `training_maxes.tm_percent`
 * at program creation so the engine's `percentOfTm` passes straight through the
 * app's "% of TM" renderer. 5/3/1 works off an 85% Training Max; Tactical Barbell
 * (and Green's TB-based strength) work off a percentage of the true 1RM.
 *
 * NOTE: for 5/3/1 the precise per-lift basis is the engine's stored, rounded
 * Training Max; the create action should prefer that exact value and fall back to
 * this default. See platform-integration-design.md.
 */
export const TM_BASIS_PERCENT_BY_FAMILY: Record<string, number> = {
  "531": 85,
  "tactical-barbell": 100,
  "tactical-barbell-green": 100,
  "tactical-barbell-zulu-ht": 100,
};

/** All engine strength keys the platform knows how to anchor to a 1RM. */
export const ANCHORABLE_ENGINE_KEYS = Object.keys(ENGINE_KEY_TO_ROLE);
