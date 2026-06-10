/**
 * Green Protocol → Tactical Barbell II session-library bridge.
 *
 * Several Green Protocol conditioning slots are GENERIC ("Hill", "Speed", "SE") —
 * GP names the category and lets the athlete pick a concrete session. This module
 * maps those generic GP conditioning ids to the matching TB2 named sessions from
 * `@hta/tb-conditioning`, so the app can offer a real pick-list (with full
 * prescriptions) for a given conditioning day.
 *
 * Specific GP sessions (LSS, Long Run, Tempo, the named interval formats, etc.)
 * are self-contained and return no substitutions.
 */
import { suggestForGreenSlot, type TbNamedSession, type GreenSlot } from "@hta/tb-conditioning";

/** Map a Green Protocol conditioning session id to a TB2-library slot, if it's generic. */
const GENERIC_SLOT_OF: Record<string, GreenSlot> = {
  // Hill family → hill-based work-capacity / SE sessions.
  hill: "hill",
  "vert-ladder": "hill",
  peggy: "hill",
  // Generic speed slot → run/sprint intervals.
  speed: "speed",
  // Strength-endurance → SE circuits + GC.
  se: "se",
};

/**
 * TB2 sessions that can fill a Green Protocol conditioning day, or an empty array
 * when the GP session is specific (e.g. LSS, Tempo, Long Run) and needs no
 * substitution.
 */
export function suggestTbSessions(greenConditioningId: string): TbNamedSession[] {
  const slot = GENERIC_SLOT_OF[greenConditioningId];
  return slot ? suggestForGreenSlot(slot) : [];
}

/** Whether a Green Protocol conditioning session is a generic slot with TB2 options. */
export function isGenericSlot(greenConditioningId: string): boolean {
  return greenConditioningId in GENERIC_SLOT_OF;
}
