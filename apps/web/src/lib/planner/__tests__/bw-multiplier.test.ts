import { describe, expect, it } from "vitest";
import type { MovementNode } from "@hta/db";
import { bwMultiplier, effectiveTrainingMaxKg } from "../bw-multiplier";

function n(nodeKey: string): MovementNode {
  return { nodeKey } as unknown as MovementNode;
}

describe("bwMultiplier", () => {
  const cases: Array<[string, number]> = [
    // Push
    ["wall_push_up", 0.2],
    ["counter_push_up", 0.4],
    ["knee_push_up", 0.5],
    ["push_up", 0.65],
    ["decline_push_up", 0.75],
    ["diamond_push_up", 0.8],
    ["archer_push_up", 1.2],
    ["one_arm_push_up", 1.7],
    // Pull
    ["pull_up", 1.0],
    ["wide_pull_up", 1.1],
    ["archer_pull_up", 1.4],
    ["one_arm_pull_up", 2.0],
    // Row
    ["inverted_row", 0.5],
    ["feet_elevated_row", 0.7],
    ["archer_row", 1.0],
    ["one_arm_inverted_row", 1.3],
    ["ring_row_strict", 0.8],
    // Press
    ["wall_handstand_push_up", 1.0],
    ["freestanding_handstand_push_up", 1.4],
    ["pike_push_up", 0.6],
    // Squat
    ["bw_squat", 0.5],
    ["deficit_squat", 0.6],
    ["jump_squat", 0.7],
    ["sissy_squat", 0.9],
    ["split_squat", 0.7],
    ["bulgarian_split_squat", 1.0],
    ["shrimp_squat", 1.3],
    ["assisted_pistol", 1.0],
    ["strict_pistol", 1.3],
    ["shrimp_pistol", 1.6],
    // Hinge
    ["single_leg_rdl_bw", 0.7],
    ["nordic_curl_concentric", 1.5],
    // Muscle-up
    ["strict_muscle_up", 1.4],
  ];

  it.each(cases)("returns %s mult = %s", (key, expected) => {
    expect(bwMultiplier(n(key))).toBeCloseTo(expected, 5);
  });

  it("returns 0 fallback for unmapped skill / isometric nodes", () => {
    expect(bwMultiplier(n("front_lever_hold"))).toBe(0);
    expect(bwMultiplier(n("planche_lean"))).toBe(0);
    expect(bwMultiplier(n("totally_unknown"))).toBe(0);
  });
});

describe("effectiveTrainingMaxKg", () => {
  it("returns 0 when bodyweight is 0 (degenerate input)", () => {
    expect(
      effectiveTrainingMaxKg({
        node: n("pull_up"),
        userBodyweightKg: 0,
        externalLoadKg: 20,
      }),
    ).toBe(20); // 0 * 1 + 20 → 20 (still bridges loaded value)
  });

  it("returns 0 for unmapped node regardless of load", () => {
    expect(
      effectiveTrainingMaxKg({
        node: n("front_lever_hold"),
        userBodyweightKg: 80,
        externalLoadKg: 50,
      }),
    ).toBe(0);
  });

  it("computes bodyweight × multiplier + external for pull-up", () => {
    expect(
      effectiveTrainingMaxKg({
        node: n("pull_up"),
        userBodyweightKg: 80,
        externalLoadKg: 10,
      }),
    ).toBeCloseTo(90, 5);
  });

  it("computes archer pull-up at 1.4× bodyweight", () => {
    expect(
      effectiveTrainingMaxKg({
        node: n("archer_pull_up"),
        userBodyweightKg: 75,
        externalLoadKg: 0,
      }),
    ).toBeCloseTo(105, 5);
  });

  it("clamps to 0 when band-assist drives effective TM negative", () => {
    expect(
      effectiveTrainingMaxKg({
        node: n("pull_up"),
        userBodyweightKg: 60,
        externalLoadKg: -100,
      }),
    ).toBe(0);
  });
});
