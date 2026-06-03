import { describe, it, expect } from "vitest";
import type { Muscle, Prescription, PrescriptionItem } from "@hta/db";
import type { MovementGroup } from "../movement-grouping";
import {
  buildSupersetByMovementId,
  accessoryMovementIds,
  segmentAccessoryGroups,
} from "../superset-cards";

function acc(movementId: string): PrescriptionItem {
  return {
    movementId,
    movementSlug: movementId,
    movementName: movementId,
    kind: "accessory",
    sets: 3,
    reps: 12,
  } as PrescriptionItem;
}

function rx(items: PrescriptionItem[]): Prescription {
  return { items } as Prescription;
}

// Minimal antagonist muscle map for the test movements.
const MUSCLES: Record<string, Muscle[]> = {
  curl: ["biceps"],
  pushdown: ["triceps"],
  legext: ["quads"],
  legcurl: ["hamstrings"],
  calf: ["calves"],
  lateral: ["side_delts"],
};
const resolver = (movementId: string): readonly Muscle[] => MUSCLES[movementId] ?? [];

function grp(movementId: string): MovementGroup {
  return {
    movementId,
    movementName: movementId,
    movementSlug: movementId,
    itemIndices: [0],
    items: [acc(movementId)],
    slotBuckets: { warmup: [], working: [], accessory: [0] },
  };
}

describe("buildSupersetByMovementId", () => {
  it("tags a reciprocal antagonist pair, keyed by movementId", () => {
    const map = buildSupersetByMovementId(rx([acc("curl"), acc("pushdown")]), resolver);
    expect(map.get("curl")?.slot).toBe("A1");
    expect(map.get("pushdown")?.slot).toBe("A2");
    expect(map.get("curl")?.groupId).toBe(map.get("pushdown")?.groupId);
  });

  it("does not tag accessories with no antagonist", () => {
    const map = buildSupersetByMovementId(rx([acc("calf"), acc("lateral")]), resolver);
    expect(map.size).toBe(0);
  });

  it("returns empty for empty / null prescription", () => {
    expect(buildSupersetByMovementId(null, resolver).size).toBe(0);
    expect(buildSupersetByMovementId(rx([]), resolver).size).toBe(0);
  });
});

describe("accessoryMovementIds", () => {
  it("collects distinct accessory movement ids", () => {
    expect(accessoryMovementIds(rx([acc("curl"), acc("pushdown"), acc("curl")]))).toEqual([
      "curl",
      "pushdown",
    ]);
  });
});

describe("segmentAccessoryGroups", () => {
  it("returns all solo when the membership map is empty", () => {
    const groups = [grp("curl"), grp("pushdown"), grp("calf")];
    const segs = segmentAccessoryGroups(groups, new Map());
    expect(segs).toHaveLength(3);
    expect(segs.every((s) => s.kind === "solo")).toBe(true);
  });

  it("clusters a pair and pulls A2 adjacent to A1 even when separated", () => {
    const groups = [grp("curl"), grp("calf"), grp("pushdown")];
    const map = buildSupersetByMovementId(
      rx([acc("curl"), acc("calf"), acc("pushdown")]),
      resolver,
    );
    const segs = segmentAccessoryGroups(groups, map);
    // curl(A1)+pushdown(A2) cluster emitted at curl's position, then calf solo.
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: "superset" });
    if (segs[0].kind === "superset") {
      expect(segs[0].groups.map((g) => g.movementId)).toEqual(["curl", "pushdown"]);
    }
    expect(segs[1]).toMatchObject({ kind: "solo" });
    if (segs[1].kind === "solo") expect(segs[1].group.movementId).toBe("calf");
  });

  it("orders A1 before A2 even when A2 appears first in the list", () => {
    const groups = [grp("pushdown"), grp("curl")];
    const map = buildSupersetByMovementId(rx([acc("curl"), acc("pushdown")]), resolver);
    const segs = segmentAccessoryGroups(groups, map);
    expect(segs).toHaveLength(1);
    if (segs[0].kind === "superset") {
      expect(segs[0].groups.map((g) => g.movementId)).toEqual(["curl", "pushdown"]);
    }
  });

  it("renders a widowed member solo when its partner is absent from the list", () => {
    const groups = [grp("curl"), grp("calf")]; // pushdown (curl's partner) trimmed
    const map = buildSupersetByMovementId(
      rx([acc("curl"), acc("pushdown"), acc("calf")]),
      resolver,
    );
    const segs = segmentAccessoryGroups(groups, map);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.kind === "solo")).toBe(true);
  });
});
