/**
 * Slot semantics for the planner. Pure helper extracted from
 * `actions.ts` so it can be imported from both the server-action
 * module ("use server" — async exports only) and from tests /
 * non-server code paths.
 *
 * See feat/slot-semantics for the architectural rationale.
 */

export type PlannedSlot = "single" | "am" | "pm";

/**
 * Coerce a planned-session `slot` value against the user's two-a-day
 * preference. When `allowsTwoADays === false` no row may carry an
 * AM/PM tag — those slots are only meaningful when a day actually
 * pairs two sessions. This is belt-and-suspenders next to the
 * curated archetype data: if any archetype ever sneaks an AM/PM slot
 * into its single-day `days` array, this layer still produces a
 * valid row.
 *
 * Returns the input untouched when `allowsTwoADays === true`. Returns
 * `"single"` for any non-single input when `allowsTwoADays === false`.
 */
export function sanitiseSlotForMode(
  slot: PlannedSlot | null | undefined,
  allowsTwoADays: boolean,
): PlannedSlot {
  if (allowsTwoADays) return slot ?? "single";
  return "single";
}
