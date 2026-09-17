import { describe, expect, it } from "vitest";
import {
  countDistinctRehabMovements,
  isRehabItem,
  partitionRehabItems,
  prependRehabItems,
  unresolvedRehabItemIndices,
  type RehabAwareItem,
} from "./rehab-section";

type Item = RehabAwareItem & {
  kind: string;
};

const main: Item = { movementId: "squat", kind: "main" };
const rehabA: Item = {
  movementId: "adductor",
  kind: "tendon",
  meta: { rehab: true },
};
const rehabB: Item = {
  movementId: "hip-flexor",
  kind: "tendon",
  meta: { rehab: true },
};

describe("embedded rehab sections", () => {
  it("DC-J1 / DC-S2: keeps durability work identifiable inside the main session", () => {
    expect(isRehabItem(rehabA)).toBe(true);
    expect(partitionRehabItems([rehabA, main, rehabB])).toEqual({
      rehab: [rehabA, rehabB],
      core: [main],
    });
  });

  it("DC-J1 / DC-S2: places rehab first without duplicating an existing embedded section", () => {
    expect(prependRehabItems([rehabA, main], [rehabB])).toEqual([
      rehabB,
      main,
    ]);
  });

  it("counts rehab movements independently from their prescribed sets", () => {
    expect(countDistinctRehabMovements([rehabA, rehabA, rehabB, main])).toBe(2);
  });

  it("DC-J1 / DC-S2: counts dynamic and isometric variants separately without changing their sets", () => {
    const dynamic = { ...rehabA, reps: 8, repRange: { min: 8, max: 10 } };
    const hold = { ...rehabA, holdSec: { min: 20, max: 20 } };
    const items = [dynamic, dynamic, dynamic, hold, hold, hold, rehabB, rehabB, rehabB];
    expect(countDistinctRehabMovements(items)).toBe(3);
    expect(unresolvedRehabItemIndices(items, new Set())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps matched left/right prescriptions together for either work type", () => {
    for (const target of [{ reps: 10 }, { holdSec: { min: 20, max: 20 } }]) {
      expect(countDistinctRehabMovements([
        { ...rehabA, ...target, meta: { rehab: true, side: "left" } },
        { ...rehabA, ...target, meta: { rehab: true, side: "right" } },
      ])).toBe(1);
    }
  });

  it("distinguishes a combined rep-and-hold prescription without counting a rep range twice", () => {
    expect(countDistinctRehabMovements([
      { ...rehabA, reps: 10 },
      { ...rehabA, repRange: { min: 8, max: 10 } },
      { ...rehabA, holdSec: { min: 20, max: 20 } },
      { ...rehabA, reps: 10, holdSec: { min: 5, max: 5 } },
    ])).toBe(3);
  });

  it("requires every rehab item to be logged or explicitly skipped", () => {
    expect(
      unresolvedRehabItemIndices(
        [rehabA, main, rehabB],
        new Set([0]),
      ),
    ).toEqual([2]);
  });
});
