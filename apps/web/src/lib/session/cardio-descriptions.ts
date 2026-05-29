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
