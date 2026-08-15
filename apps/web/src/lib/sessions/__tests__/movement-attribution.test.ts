/**
 * Regression tests for the owner-reported bug "swapping a main lift lowers the
 * set # by 1" (deadlift → barbell hip thrust).
 *
 * A mid-workout swap is forward-only: the prescription item's `movementId` is
 * retargeted but `set_logs.movement_id` keeps the ORIGINAL movement, because the
 * lifter really did perform deadlifts and rewriting the log would falsify
 * training history. Every attribution path therefore has to accept a logged set
 * whose movement matches the item's CURRENT movement *or* its `meta.swappedFrom`
 * lineage — DC-K4: the override is recorded and warned about, it must never
 * silently erase what the lifter did.
 *
 * Plan §6.9 — these rules have exactly one home (`movement-attribution.ts`) and
 * every consumer imports it.
 */
import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  buildLoggedSetAttribution,
  buildLoggedSetIdsByItemIndex,
  firstLoggedSetIdByItemIndex,
  groupOwnsLoggedSet,
  itemAcceptsMovementId,
  movementIdentityKey,
  movementIdsForItem,
  swappedFromMovementId,
  type AttributableLoggedSet,
} from "../movement-attribution";
import {
  attributionInputForGroup,
  attributionInputsForGroups,
  groupPrescriptionByMovement,
} from "../movement-grouping";
import { matchPrescriptionItems } from "../prescription-progress";

const DEADLIFT = "mv-deadlift";
const HIP_THRUST = "mv-hip-thrust";

function item(over: Partial<PrescriptionItem> & { movementId: string }): PrescriptionItem {
  return {
    kind: "main",
    movementSlug: over.movementId,
    movementName: over.movementId,
    sets: 1,
    reps: 5,
    ...over,
  } as PrescriptionItem;
}

/** Mirrors `applySwapToItem` in `prescription-mutations` (forward-only swap). */
function swapped(
  from: PrescriptionItem,
  toMovementId: string,
  toName = toMovementId,
): PrescriptionItem {
  return {
    ...from,
    movementId: toMovementId,
    movementSlug: toMovementId,
    movementName: toName,
    meta: {
      ...(from.meta ?? {}),
      swappedFrom: {
        movementId: from.movementId,
        movementName: from.movementName ?? from.movementId,
      },
    },
  } as PrescriptionItem;
}

function rx(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

function log(
  id: string,
  movementId: string,
  prescriptionItemIndex: number | null,
  setKind = "working",
): AttributableLoggedSet {
  return { id, movementId, prescriptionItemIndex, setKind };
}

describe("swap lineage primitives", () => {
  it("reads meta.swappedFrom.movementId", () => {
    const original = item({ movementId: DEADLIFT });
    expect(swappedFromMovementId(original)).toBeNull();
    expect(swappedFromMovementId(swapped(original, HIP_THRUST))).toBe(DEADLIFT);
  });

  it("DC-K4: a swapped item accepts sets logged against the ORIGINAL movement", () => {
    const swappedItem = swapped(item({ movementId: DEADLIFT }), HIP_THRUST);
    expect(movementIdsForItem(swappedItem)).toEqual([HIP_THRUST, DEADLIFT]);
    expect(itemAcceptsMovementId(swappedItem, DEADLIFT)).toBe(true);
    expect(itemAcceptsMovementId(swappedItem, HIP_THRUST)).toBe(true);
    expect(itemAcceptsMovementId(swappedItem, "mv-other")).toBe(false);
  });

  it("keeps un-swapped identity keys equal to the plain movement id", () => {
    expect(movementIdentityKey(item({ movementId: DEADLIFT }))).toBe(DEADLIFT);
  });

  it("gives a swapped block its own identity so it cannot merge with an existing block", () => {
    expect(movementIdentityKey(swapped(item({ movementId: DEADLIFT }), HIP_THRUST))).toBe(
      `swap:${DEADLIFT}>${HIP_THRUST}`,
    );
  });

  it("re-merges when swapped back to the original movement (A → B → A)", () => {
    const back = { ...swapped(item({ movementId: DEADLIFT }), HIP_THRUST), movementId: DEADLIFT };
    expect(movementIdentityKey(back)).toBe(DEADLIFT);
  });
});

describe("buildLoggedSetIdsByItemIndex — no logged row is dropped", () => {
  it("keeps EVERY set logged at one prescription_item_index, not just the first", () => {
    const prescription = rx([item({ movementId: DEADLIFT }), item({ movementId: DEADLIFT })]);
    const sets = [log("s1", DEADLIFT, 0), log("s2", DEADLIFT, 0), log("s3", DEADLIFT, 1)];

    const byIndex = buildLoggedSetIdsByItemIndex(prescription, sets);
    expect(byIndex[0]).toEqual(["s1", "s2"]);
    expect(byIndex[1]).toEqual(["s3"]);
    // The lossy first-only projection is still available for "scroll to entry"
    // links, but it is NOT what attribution uses.
    expect(firstLoggedSetIdByItemIndex(byIndex)).toEqual({ 0: "s1", 1: "s3" });
  });

  it("claims a row with a NULL prescription_item_index via lineage after a swap", () => {
    const prescription = rx([swapped(item({ movementId: DEADLIFT }), HIP_THRUST)]);
    const byIndex = buildLoggedSetIdsByItemIndex(prescription, [log("s1", DEADLIFT, null)]);
    expect(byIndex[0]).toEqual(["s1"]);
  });

  it("ignores warm-up rows in the movement fallback", () => {
    const prescription = rx([item({ movementId: DEADLIFT })]);
    const byIndex = buildLoggedSetIdsByItemIndex(prescription, [
      log("w1", DEADLIFT, null, "warmup"),
    ]);
    expect(byIndex[0]).toBeUndefined();
  });
});

describe("card attribution survives a swap (owner bug: set count drops by 1)", () => {
  /**
   * Three main blocks; the deadlift block carries an EXTRA logged set at one
   * index (the user logged 2 sets against 1 prescribed slot). Before the fix the
   * extra row survived only on the `set.movementId === group.movementId`
   * fallback and vanished the moment the item was retargeted to hip thrust.
   */
  function visibleSetCount(prescription: Prescription, sets: AttributableLoggedSet[]): number {
    const groups = groupPrescriptionByMovement(prescription);
    const byIndex = buildLoggedSetIdsByItemIndex(prescription, sets);
    const attribution = buildLoggedSetAttribution(attributionInputsForGroups(groups), byIndex);
    return groups.reduce(
      (total, group) =>
        total +
        sets.filter((set) =>
          groupOwnsLoggedSet(attribution, attributionInputForGroup(group), set),
        ).length,
      0,
    );
  }

  it("DC-K4: an EXTRA set logged at an index is still attributed after the swap", () => {
    const before = rx([
      item({ movementId: DEADLIFT }),
      item({ movementId: DEADLIFT }),
      item({ movementId: "mv-row" }),
    ]);
    const sets = [
      log("s1", DEADLIFT, 0),
      log("s2", DEADLIFT, 0), // the extra row — only the movement clause covered it
      log("s3", DEADLIFT, 1),
      log("s4", "mv-row", 2),
    ];
    expect(visibleSetCount(before, sets)).toBe(4);

    const after = rx([
      swapped(before.items[0]!, HIP_THRUST),
      swapped(before.items[1]!, HIP_THRUST),
      before.items[2]!,
    ]);
    expect(visibleSetCount(after, sets)).toBe(4);
  });

  it("DC-K4: a row with prescription_item_index = null survives the swap", () => {
    const before = rx([
      item({ movementId: DEADLIFT }),
      item({ movementId: DEADLIFT }),
      item({ movementId: "mv-row" }),
    ]);
    const sets = [
      log("s1", DEADLIFT, 0),
      log("s2", DEADLIFT, null), // legacy / off-plan row, no index link at all
      log("s3", "mv-row", 2),
    ];
    expect(visibleSetCount(before, sets)).toBe(3);

    const after = rx([
      swapped(before.items[0]!, HIP_THRUST),
      swapped(before.items[1]!, HIP_THRUST),
      before.items[2]!,
    ]);
    expect(visibleSetCount(after, sets)).toBe(3);
  });
});

describe("progress chip 'X of N' does not drop after a swap", () => {
  it("DC-K4: null-index rows keep matching their item through the swap", () => {
    const items = [
      item({ movementId: DEADLIFT }),
      item({ movementId: DEADLIFT }),
      item({ movementId: DEADLIFT }),
    ];
    const sets = [
      { movementId: DEADLIFT, setKind: "working", prescriptionItemIndex: 0 },
      { movementId: DEADLIFT, setKind: "working", prescriptionItemIndex: null },
      { movementId: DEADLIFT, setKind: "working", prescriptionItemIndex: 2 },
    ];
    expect(matchPrescriptionItems(rx(items), sets).size).toBe(3);

    const after = rx(items.map((it) => swapped(it, HIP_THRUST)));
    expect(matchPrescriptionItems(after, sets).size).toBe(3);
  });
});

describe("grouping: a swap into a movement already in the session keeps its own card", () => {
  it("does not merge the swapped block into the pre-existing block", () => {
    const before = rx([
      item({ movementId: DEADLIFT }),
      item({ movementId: DEADLIFT }),
      item({ movementId: HIP_THRUST, kind: "accessory" }),
    ]);
    expect(groupPrescriptionByMovement(before)).toHaveLength(2);

    const after = rx([
      swapped(before.items[0]!, HIP_THRUST),
      swapped(before.items[1]!, HIP_THRUST),
      before.items[2]!,
    ]);
    const groups = groupPrescriptionByMovement(after);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.itemIndices).toEqual([0, 1]);
    expect(groups[1]!.itemIndices).toEqual([2]);
    expect(groups[0]!.acceptedMovementIds).toEqual([HIP_THRUST, DEADLIFT]);
  });

  it("keeps ambiguous rows on their index-linked card only", () => {
    // Both cards accept HIP_THRUST after the swap, so an unlinked hip-thrust row
    // is ambiguous: the index link decides, nothing is double-counted.
    const prescription = rx([
      swapped(item({ movementId: DEADLIFT }), HIP_THRUST),
      item({ movementId: HIP_THRUST, kind: "accessory" }),
    ]);
    const sets = [log("s1", HIP_THRUST, 0), log("s2", HIP_THRUST, 1)];
    const groups = groupPrescriptionByMovement(prescription);
    const attribution = buildLoggedSetAttribution(
      attributionInputsForGroups(groups),
      buildLoggedSetIdsByItemIndex(prescription, sets),
    );
    const owned = groups.map((group) =>
      sets
        .filter((set) => groupOwnsLoggedSet(attribution, attributionInputForGroup(group), set))
        .map((set) => set.id),
    );
    expect(owned).toEqual([["s1"], ["s2"]]);
  });
});
