import { describe, expect, it } from "vitest";
import {
  countDistinctRehabMovements,
  isRehabItem,
  partitionRehabItems,
  prependRehabItems,
  unresolvedRehabItemIndices,
} from "./rehab-section";

type Item = {
  movementId: string;
  kind: string;
  meta?: Record<string, unknown>;
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

  it("requires every rehab item to be logged or explicitly skipped", () => {
    expect(
      unresolvedRehabItemIndices(
        [rehabA, main, rehabB],
        new Set([0]),
      ),
    ).toEqual([2]);
  });
});
