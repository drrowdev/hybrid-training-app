/**
 * Pure prescription mutators (Phase 2 A2).
 *
 * Kept out of ``actions.ts`` so the JSONB-mutation invariants can be
 * unit-tested without standing up a Supabase double. The server action
 * orchestrates auth + DB I/O; this helper owns the in-memory shape.
 */
import type { Prescription, PrescriptionItem } from "@hta/db";

export type SwappedFromMeta = {
  movementId: string;
  movementName: string;
};

export type ApplySwapInput = {
  itemIndex: number;
  newMovement: {
    id: string;
    slug: string;
    displayName: string;
  };
  /** ISO timestamp to stamp into ``meta.swappedAt``. Defaults to now. */
  swappedAt?: string;
};

/**
 * Returns a NEW prescription with item[itemIndex] swapped to the given
 * movement. Records ``meta.swappedFrom = { movementId, movementName }``
 * on the mutated item — preserving the very-first original through
 * subsequent re-swaps so the badge always shows the planner-prescribed
 * canonical lift, not whatever the last swap was.
 *
 * Throws on out-of-range index. Returns the original ``prescription``
 * reference unchanged when no items array exists (caller already
 * guarded against that — defensive).
 */
export function applyPrescriptionSwap(
  prescription: Prescription,
  input: ApplySwapInput,
): Prescription {
  const items = [...(prescription.items ?? [])];
  if (input.itemIndex < 0 || input.itemIndex >= items.length) {
    throw new RangeError(
      `applyPrescriptionSwap: itemIndex ${input.itemIndex} out of range (length ${items.length})`,
    );
  }
  const orig = items[input.itemIndex]!;
  const prevMeta = (orig.meta ?? {}) as Record<string, unknown>;
  const prevSwappedFrom = prevMeta.swappedFrom as SwappedFromMeta | undefined;
  // If we've already swapped this item, keep the original-original
  // recorded — chaining swaps shouldn't lose that lineage.
  const swappedFrom: SwappedFromMeta = prevSwappedFrom ?? {
    movementId: orig.movementId,
    movementName: orig.movementName ?? orig.movementSlug ?? "previous",
  };
  const nextItem: PrescriptionItem = {
    ...orig,
    movementId: input.newMovement.id,
    movementSlug: input.newMovement.slug,
    movementName: input.newMovement.displayName,
    meta: {
      ...prevMeta,
      swappedFrom,
      swappedAt: input.swappedAt ?? new Date().toISOString(),
    },
  };
  items[input.itemIndex] = nextItem;
  return { items };
}

/**
 * Returns the originally-prescribed movement display name for an item,
 * if a swap has been applied. ``null`` when the item is unmodified.
 */
export function originalMovementName(item: PrescriptionItem): string | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const swappedFrom = meta.swappedFrom as SwappedFromMeta | undefined;
  return swappedFrom?.movementName ?? null;
}

/** True when this prescription item has been swapped from its original. */
export function isSwapped(item: PrescriptionItem): boolean {
  return originalMovementName(item) != null;
}

/**
 * Returns a NEW prescription with every item belonging to `movementId` removed.
 * Used by the plan drawer's movement-level edit ("Remove movement"). A no-op
 * (same-shape new object) when the movement isn't present.
 */
export function removeMovementFromPrescription(
  prescription: Prescription,
  movementId: string,
): Prescription {
  const items = (prescription.items ?? []).filter((it) => it.movementId !== movementId);
  return { ...prescription, items };
}

/**
 * Returns a NEW prescription with `fromMovementId`'s items all retargeted to the
 * given movement (whole-movement swap, vs the per-item `applyPrescriptionSwap`).
 * Preserves each item's set/rep shape and records the swap lineage in meta.
 */
export function swapMovementInPrescription(
  prescription: Prescription,
  fromMovementId: string,
  newMovement: { id: string; slug: string; displayName: string },
  swappedAt?: string,
): Prescription {
  let next = { ...prescription, items: [...(prescription.items ?? [])] };
  const stamp = swappedAt ?? new Date().toISOString();
  next.items.forEach((it, i) => {
    if (it.movementId !== fromMovementId) return;
    next = applyPrescriptionSwap(next, {
      itemIndex: i,
      newMovement,
      swappedAt: stamp,
    });
  });
  return next;
}

export type AddMovementInput = {
  id: string;
  slug: string;
  displayName: string;
  /** Defaults to a standard 3×10 accessory. */
  sets?: number;
  reps?: number;
};

/**
 * Returns a NEW prescription with a movement appended as an accessory. Defaults
 * to 3×10 — the app's standard accessory dose — so a user can add a movement in
 * the plan drawer without a per-set wizard. Tagged `meta.userAdded` so the
 * origin is auditable.
 */
export function addMovementToPrescription(
  prescription: Prescription,
  movement: AddMovementInput,
): Prescription {
  const item: PrescriptionItem = {
    movementId: movement.id,
    movementSlug: movement.slug,
    movementName: movement.displayName,
    kind: "accessory",
    sets: movement.sets ?? 3,
    reps: movement.reps ?? 10,
    meta: { userAdded: true, addedAt: new Date().toISOString() },
  };
  return { ...prescription, items: [...(prescription.items ?? []), item] };
}
