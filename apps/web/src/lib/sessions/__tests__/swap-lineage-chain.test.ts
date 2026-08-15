/**
 * Chained-swap lineage (DC-K4 — never silently discard the lifter's work).
 *
 * A mid-workout swap is forward-only: the prescription item is retargeted but
 * `set_logs.movement_id` keeps the movement actually performed. Attribution
 * therefore relies on the item's swap lineage.
 *
 * `meta.swappedFrom` records only the ORIGINAL-original, so for a chained
 * A -> B -> C swap the INTERMEDIATE movement B was forgotten and any set logged
 * against B during its window silently vanished from the card and from the
 * "X of N" progress chip. `meta.swapLineage` records the whole chain.
 */
import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { applyPrescriptionSwap } from "../prescription-mutations";
import {
  itemAcceptsMovementId,
  movementIdsForItem,
} from "../movement-attribution";

const DEADLIFT = { id: "mv-deadlift", slug: "deadlift", displayName: "Deadlift" };
const HIP_THRUST = {
  id: "mv-hip-thrust",
  slug: "barbell-hip-thrust",
  displayName: "Barbell Hip Thrust",
};
const RDL = { id: "mv-rdl", slug: "rdl", displayName: "Romanian Deadlift" };

function mainItem(): PrescriptionItem {
  return {
    movementId: DEADLIFT.id,
    movementSlug: DEADLIFT.slug,
    movementName: DEADLIFT.displayName,
    kind: "main",
    sets: 1,
    reps: 5,
    percentTm: 85,
  } as PrescriptionItem;
}

function swapOnce(
  items: PrescriptionItem[],
  to: { id: string; slug: string; displayName: string },
): PrescriptionItem[] {
  return applyPrescriptionSwap(
    { items } as never,
    { itemIndex: 0, newMovement: to, swappedAt: "2026-01-01T00:00:00.000Z" },
  ).items as PrescriptionItem[];
}

describe("[DC-K4] chained swap keeps the intermediate movement attributable", () => {
  it("accepts sets logged against A, B and C after A -> B -> C", () => {
    const afterFirst = swapOnce([mainItem()], HIP_THRUST);
    const afterSecond = swapOnce(afterFirst, RDL);
    const item = afterSecond[0]!;

    expect(item.movementId).toBe(RDL.id);
    // The original-original is still recorded for back-compat consumers.
    expect(
      (item.meta as Record<string, { movementId?: string }>).swappedFrom
        ?.movementId,
    ).toBe(DEADLIFT.id);

    // All three are attributable — the intermediate is the regression guard.
    expect(itemAcceptsMovementId(item, DEADLIFT.id)).toBe(true);
    expect(itemAcceptsMovementId(item, HIP_THRUST.id)).toBe(true);
    expect(itemAcceptsMovementId(item, RDL.id)).toBe(true);
    expect(itemAcceptsMovementId(item, "mv-unrelated")).toBe(false);
  });

  it("returns a deduped, order-stable accept-set", () => {
    const item = swapOnce(swapOnce([mainItem()], HIP_THRUST), RDL)[0]!;
    const ids = movementIdsForItem(item);
    expect(ids[0]).toBe(RDL.id);
    expect([...ids].sort()).toEqual(
      [DEADLIFT.id, HIP_THRUST.id, RDL.id].sort(),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not duplicate an entry when swapping back to a prior movement", () => {
    const item = swapOnce(swapOnce([mainItem()], HIP_THRUST), DEADLIFT)[0]!;
    const ids = movementIdsForItem(item);
    expect(new Set(ids).size).toBe(ids.length);
    expect(itemAcceptsMovementId(item, HIP_THRUST.id)).toBe(true);
    expect(itemAcceptsMovementId(item, DEADLIFT.id)).toBe(true);
  });

  it("stays correct for an item swapped before swapLineage existed", () => {
    // Legacy shape: `swappedFrom` present, no `swapLineage`.
    const legacy = {
      ...mainItem(),
      movementId: HIP_THRUST.id,
      meta: {
        swappedFrom: {
          movementId: DEADLIFT.id,
          movementName: DEADLIFT.displayName,
        },
        swappedAt: "2025-01-01T00:00:00.000Z",
      },
    } as PrescriptionItem;

    const item = swapOnce([legacy], RDL)[0]!;
    expect(itemAcceptsMovementId(item, DEADLIFT.id)).toBe(true);
    expect(itemAcceptsMovementId(item, HIP_THRUST.id)).toBe(true);
    expect(itemAcceptsMovementId(item, RDL.id)).toBe(true);
  });
});
