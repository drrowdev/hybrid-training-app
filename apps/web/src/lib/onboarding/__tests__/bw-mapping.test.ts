/**
 * Boundary-value tests for the bodyweight-assessment mapping helpers.
 *
 * Pins the rep landmark cutoffs so a future tweak to the table can't
 * silently shift where new users land. Covers skip-path defaults
 * (null inputs → no rows in `resolveFamilyNodes`) and chip overrides.
 */
import { describe, it, expect } from "vitest";
import {
  mapPushUpRepsToPushHNode,
  mapPullUpRepsToPullVNode,
  mapSquatRepsToSquatBilateralNode,
  mapPlankSecondsToCoreAntiFlexionNode,
  FAMILY_ENTRY_NODE,
  CHIP_NODE_MAP,
  resolveFamilyNodes,
  resolveAllFamilyNodes,
  BW_SKILL_CHIPS,
} from "../bw-mapping";

describe("mapPushUpRepsToPushHNode", () => {
  it.each([
    [0, "wall_push_up"],
    [1, "counter_push_up"],
    [2, "counter_push_up"],
    [3, "knee_push_up"],
    [7, "knee_push_up"],
    [8, "push_up"],
    [14, "push_up"],
    [15, "decline_push_up"],
    [24, "decline_push_up"],
    [25, "diamond_push_up"],
    [200, "diamond_push_up"],
  ])("reps=%i → %s", (reps, expected) => {
    expect(mapPushUpRepsToPushHNode(reps)).toBe(expected);
  });
});

describe("mapPullUpRepsToPullVNode", () => {
  it.each([
    [0, "dead_hang"],
    [1, "scapular_pull"],
    [2, "negative_pull_up"],
    [4, "negative_pull_up"],
    [5, "pull_up"],
    [9, "pull_up"],
    [10, "wide_pull_up"],
    [50, "wide_pull_up"],
  ])("reps=%i → %s", (reps, expected) => {
    expect(mapPullUpRepsToPullVNode(reps)).toBe(expected);
  });
});

describe("mapSquatRepsToSquatBilateralNode", () => {
  it.each([
    [0, "bw_squat"],
    [24, "bw_squat"],
    [25, "deficit_squat"],
    [200, "deficit_squat"],
  ])("reps=%i → %s", (reps, expected) => {
    expect(mapSquatRepsToSquatBilateralNode(reps)).toBe(expected);
  });
});

describe("mapPlankSecondsToCoreAntiFlexionNode", () => {
  it.each([
    [0, "dead_bug"],
    [14, "dead_bug"],
    [15, "plank"],
    [44, "plank"],
    [45, "hollow_body_hold"],
    [600, "hollow_body_hold"],
  ])("seconds=%i → %s", (s, expected) => {
    expect(mapPlankSecondsToCoreAntiFlexionNode(s)).toBe(expected);
  });
});

describe("resolveFamilyNodes (skip paths)", () => {
  it("returns an empty map when every rep test is null and no chips", () => {
    const m = resolveFamilyNodes(
      {
        pushUpMaxReps: null,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      [],
    );
    expect(m.size).toBe(0);
  });

  it("emits only the families the user provided signal for", () => {
    const m = resolveFamilyNodes(
      {
        pushUpMaxReps: 8,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      [],
    );
    expect(m.get("push_h")).toBe("push_up");
    expect(m.has("pull_v")).toBe(false);
    expect(m.size).toBe(1);
  });
});

describe("resolveFamilyNodes (chip overrides)", () => {
  it("pistol_squat lands the user on strict_pistol in squat_unilateral", () => {
    const m = resolveFamilyNodes(
      {
        pushUpMaxReps: null,
        pullUpMaxReps: null,
        squatMaxReps: 30, // would normally produce deficit_squat (squat_bilateral)
        plankHoldSeconds: null,
      },
      ["pistol_squat"],
    );
    expect(m.get("squat_unilateral")).toBe("strict_pistol");
    // The bilateral mapping is still emitted alongside.
    expect(m.get("squat_bilateral")).toBe("deficit_squat");
  });

  it("one_arm_push_up overrides a low-rep push_h mapping", () => {
    const m = resolveFamilyNodes(
      {
        pushUpMaxReps: 2,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      ["one_arm_push_up"],
    );
    expect(m.get("push_h")).toBe("one_arm_push_up");
  });

  it("l_sit overrides the plank mapping in core_anti_flexion", () => {
    const m = resolveFamilyNodes(
      {
        pushUpMaxReps: null,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: 30,
      },
      ["l_sit"],
    );
    expect(m.get("core_anti_flexion")).toBe("l_sit");
  });

  it("every chip in BW_SKILL_CHIPS resolves to a CHIP_NODE_MAP entry", () => {
    for (const chip of BW_SKILL_CHIPS) {
      expect(CHIP_NODE_MAP[chip]).toBeDefined();
    }
  });
});

describe("resolveAllFamilyNodes", () => {
  it("seeds every family — signal families flagged true, others use entry node", () => {
    const all = resolveAllFamilyNodes(
      {
        pushUpMaxReps: 8,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      [],
    );
    const families = new Set(all.map((r) => r.family));
    for (const f of Object.keys(FAMILY_ENTRY_NODE)) {
      expect(families.has(f as keyof typeof FAMILY_ENTRY_NODE)).toBe(true);
    }
    const pushH = all.find((r) => r.family === "push_h")!;
    expect(pushH.nodeKey).toBe("push_up");
    expect(pushH.fromSignal).toBe(true);

    const pullV = all.find((r) => r.family === "pull_v")!;
    expect(pullV.nodeKey).toBe(FAMILY_ENTRY_NODE.pull_v);
    expect(pullV.fromSignal).toBe(false);
  });

  it("uses every family's entry node when the user skips everything", () => {
    const all = resolveAllFamilyNodes(
      {
        pushUpMaxReps: null,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      [],
    );
    for (const row of all) {
      expect(row.nodeKey).toBe(FAMILY_ENTRY_NODE[row.family]);
      expect(row.fromSignal).toBe(false);
    }
  });

  it("chip-only families come back as signal rows", () => {
    const all = resolveAllFamilyNodes(
      {
        pushUpMaxReps: null,
        pullUpMaxReps: null,
        squatMaxReps: null,
        plankHoldSeconds: null,
      },
      ["tuck_planche", "human_flag"],
    );
    const planche = all.find((r) => r.family === "planche")!;
    expect(planche.nodeKey).toBe("tuck_planche");
    expect(planche.fromSignal).toBe(true);

    const flag = all.find((r) => r.family === "human_flag")!;
    expect(flag.nodeKey).toBe("vertical_flag");
    expect(flag.fromSignal).toBe(true);
  });
});

describe("FAMILY_ENTRY_NODE", () => {
  it("covers every catalog family", () => {
    const expected = [
      "push_h",
      "push_v",
      "pull_h",
      "pull_v",
      "squat_unilateral",
      "squat_bilateral",
      "hinge",
      "core_anti_flexion",
      "core_anti_rotation",
      "planche",
      "lever_front",
      "lever_back",
      "muscle_up",
      "handstand",
      "human_flag",
    ];
    for (const f of expected) {
      expect((FAMILY_ENTRY_NODE as Record<string, string>)[f]).toBeTruthy();
    }
  });
});
