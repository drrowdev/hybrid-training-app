/**
 * `applyModificationsToItems` — taper / recovery scaling of strength blocks.
 *
 * Regression: the bucket key used to be `${kind}::${movementId}`, which merges
 * two INDEPENDENT prescribed blocks whenever a mid-workout swap leaves them
 * carrying the same movement id (deadlift swapped to hip thrust on a day that
 * already mains hip thrust). A merged bucket is scaled once —
 * `Math.round(2 × 0.5) = 1` — so the taper deletes a lift that two separate
 * buckets would each have kept. DC-K4: a swap is an override that must be
 * recorded and warned about, never one that silently removes prescribed work.
 */
import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { applyModificationsToItems } from "../archetypes";
import type { ActiveModifications } from "../modifications-types";

const TAPER: ActiveModifications = {
  volumeScale: 0.5,
  intensityAction: "hold",
  strengthLoadScale: 0.5,
  cardioLoadScale: 0.6,
  source: "taper",
};

function main(movementId: string, meta?: Record<string, unknown>): PrescriptionItem {
  return {
    kind: "main",
    movementId,
    movementSlug: movementId,
    movementName: movementId,
    sets: 1,
    reps: 5,
    ...(meta ? { meta } : {}),
  } as PrescriptionItem;
}

function swapped(from: PrescriptionItem, toMovementId: string): PrescriptionItem {
  return {
    ...from,
    movementId: toMovementId,
    movementSlug: toMovementId,
    movementName: toMovementId,
    meta: {
      ...((from.meta as Record<string, unknown> | undefined) ?? {}),
      swappedFrom: { movementId: from.movementId, movementName: from.movementName },
    },
  } as PrescriptionItem;
}

describe("applyModificationsToItems — taper bucketing", () => {
  it("keeps one item per distinct block under a taper", () => {
    const items = [main("deadlift"), main("bench"), main("row")];
    expect(applyModificationsToItems(items, TAPER)).toHaveLength(3);
  });

  it("DC-K4: a swap into a movement already in the session does not lose a block", () => {
    const items = [main("deadlift"), main("bench"), main("hip-thrust")];
    expect(applyModificationsToItems(items, TAPER)).toHaveLength(3);

    // Deadlift → hip thrust. Two independent `main` blocks now share a movement
    // id; keyed on movementId alone they merge and the taper keeps ONE of them.
    const afterSwap = [swapped(items[0]!, "hip-thrust"), items[1]!, items[2]!];
    const out = applyModificationsToItems(afterSwap, TAPER);
    expect(out).toHaveLength(3);
    expect(out.map((it) => it.movementId).sort()).toEqual([
      "bench",
      "hip-thrust",
      "hip-thrust",
    ]);
  });

  it("still scales a genuine multi-set block proportionally", () => {
    const items = [main("deadlift"), main("deadlift"), main("deadlift"), main("deadlift")];
    expect(applyModificationsToItems(items, TAPER)).toHaveLength(2);
  });

  it("is a no-op when no modification is active", () => {
    const items = [main("deadlift"), main("bench")];
    expect(applyModificationsToItems(items, { ...TAPER, source: null })).toBe(items);
  });
});
