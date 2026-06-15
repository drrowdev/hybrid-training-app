/**
 * 5/3/1 assistance INTENT (ADR 0047).
 *
 * 5/3/1 Forever prescribes assistance every training session across three
 * categories — Push, Pull, and Single-leg-or-Core — at roughly 25–50 reps each.
 * The engine is a pure methodology package with no movement catalog, so it emits
 * category-tagged INTENT slots (no concrete movement); the platform resolves each
 * to a real catalog movement (equipment / limitation / rotation filtered).
 *
 * Volume is modulated by the session's SUPPLEMENTAL template: when the
 * supplemental is volume-heavy (BBB 5×10, Widowmaker 1×20) the book says "keep
 * assistance light"; otherwise it's the standard ~3×10–15 per category.
 *
 * Source: 5/3/1 Forever (Wendler, 2017), assistance chapter + per-template notes.
 */
import type { PrescribedItem } from "@hta/program-core";
import type { SupplementalTemplateId } from "./supplemental";

export type AssistanceLevel = "none" | "light" | "standard" | "high";

/** The three 5/3/1 assistance categories (resolved to movements by the platform). */
export const ASSISTANCE_SLOT_CATEGORIES = ["push", "pull", "single_leg_or_core"] as const;
export type AssistanceSlotCategory = (typeof ASSISTANCE_SLOT_CATEGORIES)[number];

const SLOT_LABEL: Record<AssistanceSlotCategory, string> = {
  push: "Push assistance",
  pull: "Pull assistance",
  single_leg_or_core: "Single-leg / core assistance",
};

/**
 * Map a supplemental template to an assistance volume. Volume-heavy supplementals
 * (BBB, Widowmaker) drop assistance to LIGHT per the book ("keep assistance
 * light"); everything else — including `none` ("straight to assistance") — runs
 * the STANDARD per-category dose.
 */
export function assistanceLevelForSupplemental(id: SupplementalTemplateId): AssistanceLevel {
  switch (id) {
    case "bbb":
    case "widowmaker":
      return "light";
    default:
      return "standard";
  }
}

/** Per-category sets at a given volume. CP-1 [DEF→cal] — see ADR 0047 Calibration. */
const SETS_BY_VOLUME: Record<Exclude<AssistanceLevel, "none">, number> = {
  light: 2,
  standard: 3,
  high: 4,
};

/**
 * The user's GLOBAL accessory-volume preference (the same axis as
 * `profiles.effort_preference`: low = "Easier", standard = "Balanced", high =
 * "Harder"). Applied on top of the template-derived base assistance level so the
 * one global control scales 5/3/1 assistance volume too. `standard` is the
 * identity — Balanced users get byte-identical prescriptions.
 */
export type AssistanceVolumePref = "low" | "standard" | "high";

// Ordered assistance ladder used to shift a base level up/down one notch. `none`
// is intentionally OUTSIDE the ladder — a template that ships no assistance
// (jack-shit) stays at none regardless of the global preference, and the global
// preference never trims a real dose all the way to none (Easier floors at light,
// per the book always prescribing some assistance).
const ASSISTANCE_LADDER: readonly Exclude<AssistanceLevel, "none">[] = [
  "light",
  "standard",
  "high",
];

/**
 * Shift a template-derived base assistance level by the user's global accessory-
 * volume preference. Easier → one notch lighter (floored at light), Harder → one
 * notch heavier (capped at high), Balanced → unchanged. `none` is preserved.
 */
export function shiftAssistanceLevel(
  base: AssistanceLevel,
  pref: AssistanceVolumePref,
): AssistanceLevel {
  if (base === "none") return "none";
  const idx = ASSISTANCE_LADDER.indexOf(base);
  if (idx < 0) return base;
  const delta = pref === "low" ? -1 : pref === "high" ? 1 : 0;
  const next = Math.max(0, Math.min(ASSISTANCE_LADDER.length - 1, idx + delta));
  return ASSISTANCE_LADDER[next]!;
}

/**
 * Build the per-session assistance intent: one category-tagged slot for each of
 * Push / Pull / Single-leg-or-Core at the given volume. Returns `[]` only for
 * `volume === "none"` (an explicit opt-out). Items carry NO `movementId` — the
 * platform resolves each `assistanceCategory` to a concrete movement. Reps are a
 * 10–15 hypertrophy range.
 */
export function buildAssistanceIntent(volume: AssistanceLevel): PrescribedItem[] {
  if (volume === "none") return [];
  const sets = SETS_BY_VOLUME[volume];
  return ASSISTANCE_SLOT_CATEGORIES.map((category) => ({
    kind: "assistance" as const,
    name: SLOT_LABEL[category],
    assistanceCategory: category,
    sets,
    reps: 10,
    repsMax: 15,
  }));
}
