import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import {
  plannedSetClientId,
  planMissingPrescriptionSets,
} from "../fill-plan-sets";

const SESSION_ID = "11111111-1111-4111-a111-111111111111";

function rehabItems(count: number): PrescriptionItem[] {
  return Array.from({ length: count }, () => ({
    movementId: "hip-adduction",
    movementName: "Standing Banded Hip Adduction",
    kind: "tendon",
    sets: 1,
    reps: 15,
    meta: { rehab: true },
  }));
}

describe("planMissingPrescriptionSets", () => {
  it("derives stable distinct UUID idempotency keys per item copy", () => {
    const first = plannedSetClientId(
      SESSION_ID,
      2,
      0,
      "hip-adduction",
      "tendon",
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      plannedSetClientId(
        SESSION_ID,
        2,
        0,
        "hip-adduction",
        "tendon",
      ),
    ).toBe(first);
    expect(
      plannedSetClientId(
        SESSION_ID,
        2,
        1,
        "hip-adduction",
        "tendon",
      ),
    ).not.toBe(first);
    expect(
      plannedSetClientId(
        SESSION_ID,
        2,
        0,
        "hip-abduction",
        "tendon",
      ),
    ).not.toBe(first);
  });

  it("fills every expanded item instead of deduplicating by movement", () => {
    expect(
      planMissingPrescriptionSets(SESSION_ID, rehabItems(5), []),
    ).toEqual([
      { itemIndex: 0, copyIndex: 0, setIndex: 0, setKind: "tendon" },
      { itemIndex: 1, copyIndex: 0, setIndex: 1, setKind: "tendon" },
      { itemIndex: 2, copyIndex: 0, setIndex: 2, setKind: "tendon" },
      { itemIndex: 3, copyIndex: 0, setIndex: 3, setKind: "tendon" },
      { itemIndex: 4, copyIndex: 0, setIndex: 4, setKind: "tendon" },
    ]);
  });

  it("adds only missing sibling items after a partial first tap", () => {
    expect(
      planMissingPrescriptionSets(SESSION_ID, rehabItems(5), [
        {
          movement_id: "hip-adduction",
          set_kind: "tendon",
          set_index: 7,
          prescription_item_index: 0,
          client_log_id: null,
        },
      ]),
    ).toEqual([
      { itemIndex: 1, copyIndex: 0, setIndex: 8, setKind: "tendon" },
      { itemIndex: 2, copyIndex: 0, setIndex: 9, setKind: "tendon" },
      { itemIndex: 3, copyIndex: 0, setIndex: 10, setKind: "tendon" },
      { itemIndex: 4, copyIndex: 0, setIndex: 11, setKind: "tendon" },
    ]);
  });

  it("remains idempotent once every expanded item is present", () => {
    const existing = rehabItems(3).map((_, itemIndex) => ({
      movement_id: "hip-adduction",
      set_kind: "tendon",
      set_index: itemIndex,
      prescription_item_index: itemIndex,
      client_log_id: plannedSetClientId(
        SESSION_ID,
        itemIndex,
        0,
        "hip-adduction",
        "tendon",
      ),
    }));
    expect(
      planMissingPrescriptionSets(
        SESSION_ID,
        rehabItems(3),
        existing,
      ),
    ).toEqual([]);
  });

  it("supports one legacy collapsed item with sets greater than one", () => {
    const items: PrescriptionItem[] = [
      {
        ...rehabItems(1)[0]!,
        sets: 3,
      },
    ];
    expect(
      planMissingPrescriptionSets(SESSION_ID, items, []),
    ).toEqual([
      { itemIndex: 0, copyIndex: 0, setIndex: 0, setKind: "tendon" },
      { itemIndex: 0, copyIndex: 1, setIndex: 1, setKind: "tendon" },
      { itemIndex: 0, copyIndex: 2, setIndex: 2, setKind: "tendon" },
    ]);
  });

  it("refills a deleted middle copy of a collapsed legacy item", () => {
    const items: PrescriptionItem[] = [
      {
        ...rehabItems(1)[0]!,
        sets: 3,
      },
    ];
    const existing = [0, 2].map((copyIndex) => ({
      movement_id: "hip-adduction",
      set_kind: "tendon",
      set_index: copyIndex,
      prescription_item_index: 0,
      client_log_id: plannedSetClientId(
        SESSION_ID,
        0,
        copyIndex,
        "hip-adduction",
        "tendon",
      ),
    }));
    expect(
      planMissingPrescriptionSets(SESSION_ID, items, existing),
    ).toEqual([
      {
        itemIndex: 0,
        copyIndex: 1,
        setIndex: 3,
        setKind: "tendon",
      },
    ]);
  });

  it("fills a swapped movement at the same prescription item index", () => {
    const swappedItems: PrescriptionItem[] = [
      {
        ...rehabItems(1)[0]!,
        movementId: "hip-abduction",
        movementName: "Standing Banded Hip Abduction",
      },
    ];
    expect(
      planMissingPrescriptionSets(SESSION_ID, swappedItems, [
        {
          movement_id: "hip-adduction",
          set_kind: "tendon",
          set_index: 0,
          prescription_item_index: 0,
          client_log_id: plannedSetClientId(
            SESSION_ID,
            0,
            0,
            "hip-adduction",
            "tendon",
          ),
        },
      ]),
    ).toEqual([
      {
        itemIndex: 0,
        copyIndex: 0,
        setIndex: 1,
        setKind: "tendon",
      },
    ]);
  });
});
