import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { expandPrescriptionSetItems } from "../expand-prescription-sets";

function item(over: Partial<PrescriptionItem> & { movementId: string }): PrescriptionItem {
  return { kind: "accessory", sets: 1, reps: 12, ...over };
}

describe("expandPrescriptionSetItems", () => {
  it("fans a multi-set accessory into N single-set items, preserving order + fields", () => {
    const out = expandPrescriptionSetItems([
      item({ movementId: "m", kind: "main", sets: 1, reps: 5 }),
      item({ movementId: "acc", movementName: "Curl", sets: 4, reps: 12 }),
    ]);
    expect(out).toHaveLength(5);
    expect(out[0]).toMatchObject({ movementId: "m", kind: "main", sets: 1 });
    for (let i = 1; i < 5; i++) {
      expect(out[i]).toMatchObject({ movementId: "acc", movementName: "Curl", sets: 1, reps: 12 });
    }
  });

  it("passes through items with sets <= 1 or no sets unchanged (warmups, cardio)", () => {
    const warm = item({ movementId: "w", kind: "warmup", sets: 1 });
    const cardio = { movementId: "c", kind: "cardio_z2", durationMin: 30 } as unknown as PrescriptionItem;
    const out = expandPrescriptionSetItems([warm, cardio]);
    expect(out).toEqual([warm, cardio]);
  });

  it("expands every multi-set strength kind (back_off, tendon), not just accessory", () => {
    const out = expandPrescriptionSetItems([
      item({ movementId: "b", kind: "back_off", sets: 3, reps: 8 }),
      item({ movementId: "t", kind: "tendon", sets: 2, reps: 20 }),
    ]);
    expect(out.filter((i) => i.kind === "back_off")).toHaveLength(3);
    expect(out.filter((i) => i.kind === "tendon")).toHaveLength(2);
    expect(out.every((i) => i.sets === 1)).toBe(true);
  });

  it("is a no-op for an already-expanded (all 1-set) prescription", () => {
    const items = [
      item({ movementId: "a", sets: 1 }),
      item({ movementId: "a", sets: 1 }),
    ];
    expect(expandPrescriptionSetItems(items)).toEqual(items);
  });
});
