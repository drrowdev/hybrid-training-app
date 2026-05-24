/**
 * Helpers for the movement-grouped logging view.
 *
 * Pure functions only — owns the grouping logic, the auto/manual
 * cursor model, the per-card completeness check, and the lookup of
 * the canonical logged set per prescription item index. The React
 * components in `components/session/Movement*.tsx` are thin wrappers
 * around these.
 */

import type { Prescription, PrescriptionItem } from "@hta/db";
import { PRESCRIPTION_STRENGTH_KINDS } from "./prescription-progress";

export type MovementGroup = {
  movementId: string;
  movementName: string;
  movementSlug: string | null;
  /** Prescription item indices belonging to this movement, in display order. */
  itemIndices: number[];
  /** The raw prescription items, same order as `itemIndices`. */
  items: PrescriptionItem[];
};

/**
 * Group strength prescription items by movementId, preserving the
 * order in which each movement first appears. Cardio items are
 * skipped — they're rendered elsewhere on the session page.
 */
export function groupPrescriptionByMovement(
  prescription: Prescription | null,
): MovementGroup[] {
  if (!prescription?.items?.length) return [];
  const byId = new Map<string, MovementGroup>();
  prescription.items.forEach((item, idx) => {
    if (!PRESCRIPTION_STRENGTH_KINDS.has(item.kind)) return;
    if (!item.movementId) return;
    const existing = byId.get(item.movementId);
    if (existing) {
      existing.itemIndices.push(idx);
      existing.items.push(item);
      return;
    }
    byId.set(item.movementId, {
      movementId: item.movementId,
      movementName: item.movementName ?? item.movementSlug ?? "Movement",
      movementSlug: item.movementSlug ?? null,
      itemIndices: [idx],
      items: [item],
    });
  });
  return Array.from(byId.values());
}

/**
 * Movement card state used to colour the header chip and decide
 * collapsed-by-default behaviour.
 */
export type MovementCardState = "not_started" | "in_progress" | "completed";

export function deriveCardState(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): MovementCardState {
  const total = group.itemIndices.length;
  if (total === 0) return "not_started";
  let done = 0;
  for (const idx of group.itemIndices) if (loggedItemIndices.has(idx)) done++;
  if (done === 0) return "not_started";
  if (done >= total) return "completed";
  return "in_progress";
}

/** Movement is "complete" when every prescribed item has ≥1 matching logged set. */
export function isMovementComplete(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): boolean {
  if (group.itemIndices.length === 0) return false;
  return group.itemIndices.every((idx) => loggedItemIndices.has(idx));
}

/**
 * Auto cursor — first un-logged item in display order. Returns the
 * LAST item index when every set is already logged (so the recap and
 * focus-view fall back to the last set rather than going out of
 * bounds).
 */
export function autoCursorForGroup(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): number {
  for (let i = 0; i < group.itemIndices.length; i++) {
    const idx = group.itemIndices[i]!;
    if (!loggedItemIndices.has(idx)) return i;
  }
  return Math.max(0, group.itemIndices.length - 1);
}

/**
 * Effective cursor — manual override wins until the user logs again.
 * `cursorSlot` is the position within the group (0-indexed), NOT the
 * raw prescription item index.
 */
export function effectiveCursor(
  autoCursor: number,
  manualCursor: number | null,
): number {
  return manualCursor ?? autoCursor;
}

/**
 * The last main-kind slot in a movement group. Used to flag the
 * top set as AMRAP for e1RM display and "× 5+" reps formatting.
 */
export function lastMainSlot(group: MovementGroup): number | null {
  let last: number | null = null;
  for (let i = 0; i < group.items.length; i++) {
    if (group.items[i]!.kind === "main") last = i;
  }
  return last;
}

export function bucketLabelForKind(
  kind: PrescriptionItem["kind"],
  position: number,
  total: number,
): string {
  const tag =
    kind === "warmup"
      ? "Warm-up"
      : kind === "main" || kind === "power_potentiation"
        ? "Working set"
        : kind === "back_off"
          ? "Back-off"
          : kind === "accessory"
            ? "Accessory"
            : kind === "tendon"
              ? "Tendon"
              : "Set";
  return `${tag} · Set ${position + 1} of ${total}`;
}

/** Round to nearest 2.5 kg plate (pure copy of the canonical helper). */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}
