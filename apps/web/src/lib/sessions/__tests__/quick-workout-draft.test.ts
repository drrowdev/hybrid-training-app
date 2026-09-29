import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import {
  quickDraftMovementIds,
  quickDraftPrescription,
  sameMovementIds,
} from "../quick-workout-draft";

const item = (movementId: string, kind: PrescriptionItem["kind"]): PrescriptionItem => ({
  movementId,
  movementName: movementId,
  kind,
  reps: 5,
});

const items = [
  item("squat", "warmup"),
  item("squat", "main"),
  item("squat", "main"),
  item("row", "accessory"),
  item("curl", "accessory"),
];

describe("quick workout drafts", () => {
  it("lists each movement once, in order", () => {
    expect(quickDraftMovementIds(items)).toEqual(["squat", "row", "curl"]);
  });

  it("removes every item of a removed movement, including its warm-ups", () => {
    const rx = quickDraftPrescription(items, ["squat", "curl"]);
    expect(rx.items.map((i) => i.movementId)).toEqual(["row"]);
    expect(rx.userEdited).toBe(true);
  });

  it("leaves the draft untouched when nothing is removed", () => {
    const rx = quickDraftPrescription(items, []);
    expect(rx.items).toEqual(items);
    expect(rx.userEdited).toBeUndefined();
  });

  it("compares reviewed movement lists by order", () => {
    expect(sameMovementIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameMovementIds(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameMovementIds(["a"], ["a", "b"])).toBe(false);
  });
});
