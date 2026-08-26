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

import type { PrescriptionItem, PrescriptionItemKind } from "@hta/db";

/**
 * Subset of `PrescriptionItemKind` we explicitly describe.
 *
 * `cardio_external` is deliberately absent. It means the session comes from
 * outside the app, so there is no execution advice to give — and the copy that
 * used to sit here narrated what the app does with the result instead, which is
 * not something the lifter asked.
 */
export type CardioDescriptionKind =
  | "cardio_vo2"
  | "cardio_z2"
  | "cardio_threshold"
  | "cardio_alactic";

export const CARDIO_DESCRIPTIONS: Record<CardioDescriptionKind, string> = {
  cardio_vo2:
    "Warm up 10–15 min at easy pace. Then perform the prescribed intervals at 90–95% of HRmax — hard but sustainable, you shouldn't be able to hold a conversation. Recover easy between intervals (jog or walk). Cool down 5–10 min easy.",
  cardio_z2:
    "Steady aerobic pace. Stay below 70% of HRmax — you should be able to hold a full conversation. Keep effort easy enough that you finish feeling refreshed, not fatigued. This builds your aerobic base without compromising recovery.",
  cardio_threshold:
    "Sustained effort at the upper edge of comfortable — RPE 7, around lactate threshold. You should be breathing hard but still in control. Warm up 10 min easy, then hold the prescribed pace, then cool down 5 min easy.",
  cardio_alactic:
    "Run/bike easy for the prescribed duration, then add the alactic finisher: short, sharp bursts of 10–15 sec at near-max effort with ~100–150 sec easy recovery between reps. Keep each rep brief — these are explosive sprints, not full sprints to exhaustion.",
};

export const GENERIC_CARDIO_DESCRIPTION =
  "Follow the prescribed intensity and duration. Adjust pace to match the target HR or RPE. Warm up easy for 5–10 minutes before the main effort and cool down easy afterwards.";

/**
 * Placeholder prose earlier builds stamped onto a `cardio_external`
 * item's `protocolNote`. All of it said the same thing — "this session
 * comes from outside the app" — which the card already conveys, and one
 * of them was shredded into fake Intervals / Protocol rows by the note
 * parser.
 *
 * Producers no longer write any of it. These stay because plans
 * materialised before that change carry the strings in the database, and
 * every render surface has to recognise them as "no note". Keeping them
 * in one place is the point: the Today hero, the plan drawer and the
 * live session page each used to hand-roll this check, and each knew
 * about a different subset, so the boilerplate always leaked somewhere.
 */
export const EXTERNAL_CARDIO_DISPLAY_NOTE =
  "Display-only — log the actual session so the engine can account for the load.";

const LEGACY_EXTERNAL_NOTE_PATTERNS: readonly RegExp[] = [
  /^display-only\b/i,
  /^open (?:cardio|conditioning) — log any run, row, ride or other cardio\b/i,
  /^logged via .+\.$/i,
];

/**
 * The item's real protocol hint, or null when it carries nothing but
 * legacy placeholder prose.
 *
 * Only the known boilerplate is dropped. A `cardio_external` item CAN
 * carry a genuine protocol or HR target (HYROX, Green), and inferring
 * "unprescribed" from absent fields would have deleted it.
 */
export function cardioProtocolNote(
  item: Pick<PrescriptionItem, "protocolNote">,
): string | null {
  const note = item.protocolNote?.trim();
  if (!note) return null;
  return LEGACY_EXTERNAL_NOTE_PATTERNS.some((re) => re.test(note)) ? null : note;
}

/** Cardio that is executed outside the app — the day is reserved, the content isn't ours. */
export function isExternalCardio(
  kind: PrescriptionItemKind | string | null | undefined,
): boolean {
  return kind === "cardio_external";
}

/**
 * What to call this cardio card.
 *
 * Shared so the heading and the title-dedup that decides whether to SHOW
 * the heading resolve the same name. When they disagreed, an open
 * "Conditioning" day rendered a stray "Cardio" sub-heading under a
 * "Conditioning" title. `intensityLabel` is only consulted for external
 * cardio, where it holds the day's label ("Conditioning") or the source
 * ("Runna"); on prescribed kinds it can hold an intensity, not a name.
 */
export function cardioDisplayName(
  item: Pick<PrescriptionItem, "movementName" | "intensityLabel" | "kind">,
): string {
  const name = item.movementName?.trim();
  if (name) return name;
  if (isExternalCardio(item.kind)) {
    const label = item.intensityLabel?.trim();
    if (label) return label;
  }
  return "Cardio";
}

/**
 * How to execute this session, or null when there is nothing to say.
 *
 * External cardio returns null: the session comes from the lifter's own
 * program, so the app has no advice to offer and saying so would only
 * restate the card's own heading.
 */
export function describeCardioKind(
  kind: PrescriptionItemKind | string | null | undefined,
): string | null {
  if (isExternalCardio(kind)) return null;
  if (!kind) return GENERIC_CARDIO_DESCRIPTION;
  if (kind in CARDIO_DESCRIPTIONS) {
    return CARDIO_DESCRIPTIONS[kind as CardioDescriptionKind];
  }
  return GENERIC_CARDIO_DESCRIPTION;
}
