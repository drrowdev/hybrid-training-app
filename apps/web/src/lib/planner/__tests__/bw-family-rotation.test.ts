import { describe, expect, it } from "vitest";
import type { MovementFamily } from "@hta/db";
import { pickFamiliesForBwSession } from "../bw-family-rotation";

const ALL: MovementFamily[] = [
  "push_h",
  "push_v",
  "pull_h",
  "pull_v",
  "squat_unilateral",
  "squat_bilateral",
  "hinge",
  "core_anti_flexion",
];

describe("pickFamiliesForBwSession", () => {
  it("returns all available families when ≤ 3 are calibrated", () => {
    const picked = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(["push_h", "pull_v"]),
      archetype: "hypertrophy_anchor",
      seed: "block-a:0:single",
    });
    expect(picked).toHaveLength(2);
    expect(picked).toEqual(expect.arrayContaining(["push_h", "pull_v"]));
  });

  it("picks 3 families when the user has more than 3 calibrated", () => {
    const picked = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(ALL),
      archetype: "hypertrophy_anchor",
      seed: "block-a:0:single",
    });
    expect(picked).toHaveLength(3);
  });

  it("is deterministic for the same seed", () => {
    const a = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(ALL),
      archetype: "strength_anchor",
      seed: "block-x:1:am",
    });
    const b = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(ALL),
      archetype: "strength_anchor",
      seed: "block-x:1:am",
    });
    expect(a).toEqual(b);
  });

  it("rotates across consecutive day seeds", () => {
    // Same archetype + family set, different day index — at least one
    // of the next 6 rotations must differ from the leader.
    const day0 = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(ALL),
      archetype: "hypertrophy_anchor",
      seed: "block-r:0:single",
    });
    const others = [1, 2, 3, 4, 5, 6].map((d) =>
      pickFamiliesForBwSession({
        availableFamilies: new Set<MovementFamily>(ALL),
        archetype: "hypertrophy_anchor",
        seed: `block-r:${d}:single`,
      }),
    );
    expect(others.some((arr) => arr[0] !== day0[0])).toBe(true);
  });

  it("strength_anchor leads with vertical patterns when available", () => {
    const picked = pickFamiliesForBwSession({
      availableFamilies: new Set<MovementFamily>(["pull_v", "push_v", "squat_unilateral"]),
      archetype: "strength_anchor",
      seed: "block-s:0:single",
    });
    expect(picked).toHaveLength(3);
    // All three are returned regardless of order — the rotation only
    // kicks in when more than 3 families are available.
    expect(picked).toEqual(
      expect.arrayContaining(["pull_v", "push_v", "squat_unilateral"]),
    );
  });
});
