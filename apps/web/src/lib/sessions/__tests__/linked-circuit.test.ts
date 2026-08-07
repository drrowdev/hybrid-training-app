import { describe, expect, it } from "vitest";
import type { MovementGroup } from "../movement-grouping";
import {
  buildLinkedCircuitByMovementId,
  circuitRoundFor,
  firstOpenCircuitMovementId,
  firstOpenMovementId,
} from "../linked-circuit";

function triadGroup(
  movementId: string,
  movementSlug: string,
  movementName: string,
  position: number,
  indices: number[],
): MovementGroup {
  return {
    movementId,
    movementName,
    movementSlug,
    itemIndices: indices,
    items: indices.map(() => ({
      movementId,
      movementSlug,
      movementName,
      kind: "accessory",
      sets: 1,
      reps: 5,
      circuit: {
        id: "tb-ab-triad",
        name: "AB Triad",
        position,
        size: 3,
        rounds: 3,
      },
    })),
    slotBuckets: {
      warmup: [],
      working: [],
      accessory: indices.map((_, index) => index),
    },
  };
}

const groups = [
  triadGroup(
    "leg",
    "hanging-leg-raise",
    "Hanging Leg Raise",
    0,
    [0, 1, 2],
  ),
  triadGroup(
    "knee",
    "hanging-knee-raise",
    "Hanging Knee Raise",
    1,
    [3, 4, 5],
  ),
  triadGroup("toes", "toes-to-bar", "Toes-to-Bar", 2, [6, 7, 8]),
];

describe("linked circuit navigation", () => {
  it("advances round-major while preserving granular movement slots", () => {
    const membership = buildLinkedCircuitByMovementId(groups);
    expect([...membership.keys()]).toEqual(["leg", "knee", "toes"]);
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        new Set(),
      ),
    ).toBe("leg");
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        new Set([0]),
      ),
    ).toBe("knee");
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        new Set([0, 3]),
      ),
    ).toBe("toes");
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        new Set([0, 3, 6]),
      ),
    ).toBe("leg");
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        groups,
        membership,
        new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      ),
    ).toBeNull();
  });

  it("restores the right movement and round after a reload", () => {
    const membership = buildLinkedCircuitByMovementId(groups);
    const covered = new Set([0, 3, 6, 1]);
    expect(firstOpenMovementId(groups, membership, covered)).toBe("knee");
    expect(circuitRoundFor(groups[1]!, membership.get("knee")!, covered)).toBe(
      2,
    );
  });

  it("does not link a partial triad", () => {
    const partial = groups.slice(0, 2);
    expect(buildLinkedCircuitByMovementId(partial).size).toBe(0);
  });

  it("links reordered legacy slots in canonical AB Triad order", () => {
    const legacy = [groups[1]!, groups[2]!, groups[0]!].map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const legacyItem = { ...item };
        delete legacyItem.circuit;
        return {
          ...legacyItem,
          notes:
            "AB Triad — 3 rounds: 5 hanging leg raises, 5 hanging knee raises, then 5 toes-to-bar.",
        };
      }),
    }));
    const membership = buildLinkedCircuitByMovementId(legacy);
    expect(membership.get("leg")?.position).toBe(0);
    expect(membership.get("knee")?.position).toBe(1);
    expect(membership.get("toes")?.position).toBe(2);
    expect(firstOpenMovementId(legacy, membership, new Set([0]))).toBe("knee");
    expect(
      firstOpenCircuitMovementId(
        "tb-ab-triad",
        legacy,
        membership,
        new Set([0, 3, 6]),
      ),
    ).toBe("leg");
  });

  it("does not infer a legacy circuit after a canonical member was swapped", () => {
    const swapped = groups.map((group) => {
      const legacyItems = group.items.map((item) => {
        const copy = { ...item };
        delete copy.circuit;
        return {
          ...copy,
          notes:
            "AB Triad — 3 rounds: 5 hanging leg raises, 5 hanging knee raises, then 5 toes-to-bar.",
        };
      });
      return {
        ...group,
        ...(group.movementId === "leg"
          ? { movementSlug: "sit-up", movementName: "Sit-up" }
          : {}),
        items: legacyItems,
      };
    });
    expect(buildLinkedCircuitByMovementId(swapped).size).toBe(0);
  });
});
