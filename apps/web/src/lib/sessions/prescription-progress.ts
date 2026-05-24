/**
 * Helpers for reconciling logged sets against the planned prescription
 * items on the session detail page.
 *
 * The canonical link is `set_logs.prescription_item_index` (migration
 * 0036). For sets logged before that column existed — or for free-form
 * sets the user added via the "+ add movement" picker — we fall back
 * to a best-effort movement match: any non-warmup set on the same
 * movement counts the FIRST unsatisfied prescription item for that
 * movement as done.
 *
 * "Satisfied" here is intentionally lenient (≥1 logged set), not
 * "every prescribed rep landed". A prescription row showing ✓ means
 * "you've logged at least one set against this slot" — the user can
 * still tap it to log more, and the progress chip just counts items
 * not total sets.
 */

import type { Prescription } from "@hta/db";

export type LoggedSetForMatch = {
  movementId: string;
  setKind: string;
  prescriptionItemIndex: number | null;
  /** Set in migration 0037 — true when this row is a "skip with reason". */
  skipped?: boolean;
};

const STRENGTH_ITEM_KINDS = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
  "power_potentiation",
]);

/**
 * Returns the set of prescription item indices that have at least one
 * logged set against them. Items that point to a movement (strength)
 * are eligible; cardio items aren't matched here (cardio is tracked
 * via `cardio_logs`, not `set_logs`).
 */
export function matchPrescriptionItems(
  prescription: Prescription | null,
  loggedSets: LoggedSetForMatch[],
): Set<number> {
  return matchPrescriptionItemsDetailed(prescription, loggedSets).matched;
}

/**
 * Same as `matchPrescriptionItems` but also reports which of the
 * claimed indices were claimed by a "skipped" row. The dot strip + the
 * "All logged sets" table use this to render skipped slots with the
 * muted hollow-dashed treatment.
 */
export function matchPrescriptionItemsDetailed(
  prescription: Prescription | null,
  loggedSets: LoggedSetForMatch[],
): { matched: Set<number>; skipped: Set<number> } {
  const matched = new Set<number>();
  const skipped = new Set<number>();
  if (!prescription?.items?.length) return { matched, skipped };

  // First pass — explicit links win. An out-of-bounds index is treated
  // as "no link" (can happen after a swap reorders items).
  for (const s of loggedSets) {
    if (
      s.prescriptionItemIndex != null &&
      s.prescriptionItemIndex >= 0 &&
      s.prescriptionItemIndex < prescription.items.length
    ) {
      matched.add(s.prescriptionItemIndex);
      if (s.skipped) skipped.add(s.prescriptionItemIndex);
    }
  }

  // Second pass — fallback movement match for unlinked sets.
  const claimed = new Set(matched);
  for (const s of loggedSets) {
    const hasValidLink =
      s.prescriptionItemIndex != null &&
      s.prescriptionItemIndex >= 0 &&
      s.prescriptionItemIndex < prescription.items.length;
    if (hasValidLink) continue;
    if (s.setKind === "warmup") continue;
    for (let i = 0; i < prescription.items.length; i++) {
      if (claimed.has(i)) continue;
      const it = prescription.items[i]!;
      if (!STRENGTH_ITEM_KINDS.has(it.kind)) continue;
      if (it.movementId !== s.movementId) continue;
      claimed.add(i);
      matched.add(i);
      if (s.skipped) skipped.add(i);
      break;
    }
  }

  return { matched, skipped };
}

/**
 * Total count of strength items the user is being asked to log. Cardio
 * items live in a different table and are excluded from the "X of N"
 * chip on the prescription card.
 */
export function countStrengthPrescriptionItems(
  prescription: Prescription | null,
): number {
  if (!prescription?.items?.length) return 0;
  let n = 0;
  for (const it of prescription.items) {
    if (STRENGTH_ITEM_KINDS.has(it.kind)) n++;
  }
  return n;
}

export const PRESCRIPTION_STRENGTH_KINDS = STRENGTH_ITEM_KINDS;
