/**
 * Educational "how to execute" copy keyed by cardio prescription kind.
 *
 * Surfaces at the top of the cardio card on the live session page so
 * the user knows how to actually run the workout (warm-up, work,
 * recovery, cool-down). Concise — 2-4 sentences per kind. Engine
 * vocabulary (`cardio_vo2`, `cardio_z2`) stays internal; the copy
 * speaks plain language.
 *
 * Adding a new kind: register it in `CARDIO_DESCRIPTIONS`. Anything
 * unmapped falls back to `GENERIC_CARDIO_DESCRIPTION`.
 */

import type { PrescriptionItemKind } from "@hta/db";

/** Subset of `PrescriptionItemKind` we explicitly describe. */
export type CardioDescriptionKind =
  | "cardio_vo2"
  | "cardio_z2"
  | "cardio_threshold"
  | "cardio_alactic"
  | "cardio_external";

export const CARDIO_DESCRIPTIONS: Record<CardioDescriptionKind, string> = {
  cardio_vo2:
    "Warm up 10–15 min at easy pace. Then perform the prescribed intervals at 90–95% of HRmax — hard but sustainable, you shouldn't be able to hold a conversation. Recover easy between intervals (jog or walk). Cool down 5–10 min easy.",
  cardio_z2:
    "Steady aerobic pace. Stay below 70% of HRmax — you should be able to hold a full conversation. Keep effort easy enough that you finish feeling refreshed, not fatigued. This builds your aerobic base without compromising recovery.",
  cardio_threshold:
    "Sustained effort at the upper edge of comfortable — RPE 7, around lactate threshold. You should be breathing hard but still in control. Warm up 10 min easy, then hold the prescribed pace, then cool down 5 min easy.",
  cardio_alactic:
    "Run/bike easy for the prescribed duration, then add the alactic finisher: short, sharp bursts of 10–15 sec at near-max effort with ~100–150 sec easy recovery between reps. Keep each rep brief — these are explosive sprints, not full sprints to exhaustion.",
  cardio_external:
    "Follow your external program's plan for this session. Log it back here when you're done so the engine can account for the load.",
};

export const GENERIC_CARDIO_DESCRIPTION =
  "Follow the prescribed intensity and duration. Adjust pace to match the target HR or RPE. Warm up easy for 5–10 minutes before the main effort and cool down easy afterwards.";

/**
 * One-sentence form of each cardio description, used for compact
 * surfaces where the full "How to do it" paragraph would dominate the
 * card. The in-session card keeps the longer `CARDIO_DESCRIPTIONS`
 * paragraphs — these short forms exist so callers can pick a
 * recognisable opening line per cardio kind without falling back to
 * the long body.
 *
 * Adding a new kind: register it here AND in `CARDIO_DESCRIPTIONS`.
 */
export const CARDIO_ONE_LINERS: Record<CardioDescriptionKind, string> = {
  cardio_vo2:
    "Hard intervals at 90–95% HRmax with full easy recovery.",
  cardio_z2:
    "Steady aerobic pace — easy enough to hold a conversation.",
  cardio_threshold:
    "Sustained hard effort just under your lactate threshold.",
  cardio_alactic:
    "Short, near-max efforts with long full recoveries between.",
  cardio_external:
    "Follow your external program's plan for this session.",
};

export const GENERIC_CARDIO_ONE_LINER =
  "Cardio session — follow the prescribed intensity and duration.";

/**
 * Placeholder protocol note the platform adapter stamps on a
 * `cardio_external` item ONLY when the engine supplied no prescription
 * note of its own (genuinely opaque external cardio). When the engine
 * DOES supply a note it becomes the card description and this generic
 * line is suppressed. Exported so the adapter and the render layer agree
 * on the exact string — render surfaces skip it rather than showing it
 * as a redundant "Protocol" row (e.g. on plans materialised before the
 * note started driving the description).
 */
export const EXTERNAL_CARDIO_DISPLAY_NOTE =
  "Display-only — log the actual session so the engine can account for the load.";

/**
 * Resolve a description for any prescription item kind. Returns the
 * generic fallback for unknown / non-cardio kinds rather than null —
 * callers always render something so the user is never left without
 * guidance.
 */
export function describeCardioKind(
  kind: PrescriptionItemKind | string | null | undefined,
): string {
  if (!kind) return GENERIC_CARDIO_DESCRIPTION;
  if (kind in CARDIO_DESCRIPTIONS) {
    return CARDIO_DESCRIPTIONS[kind as CardioDescriptionKind];
  }
  return GENERIC_CARDIO_DESCRIPTION;
}

/**
 * Short one-sentence description for the Today hero card. Mirrors
 * `describeCardioKind` but returns the brief form. Falls back to the
 * generic one-liner so the hero never renders a blank description for
 * an unrecognised cardio kind.
 */
export function cardioOneLinerForKind(
  kind: PrescriptionItemKind | string | null | undefined,
): string {
  if (!kind) return GENERIC_CARDIO_ONE_LINER;
  if (kind in CARDIO_ONE_LINERS) {
    return CARDIO_ONE_LINERS[kind as CardioDescriptionKind];
  }
  return GENERIC_CARDIO_ONE_LINER;
}
