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

/** The engine movement key a given movement slug maps to (via its role), or undefined. */
export function engineKeyForSlug(slug: string): string | undefined {
  const role = roleForSlug(slug);
  return role ? ROLE_TO_ENGINE_KEY[role] : undefined;
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
