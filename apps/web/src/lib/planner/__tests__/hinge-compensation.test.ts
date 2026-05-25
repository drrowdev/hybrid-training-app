import { describe, expect, it } from "vitest";
import type { BwProgress, MovementNode } from "@hta/db";
import { maybeInjectHingeCompensation } from "../hinge-compensation";
import type { SessionModality } from "../session-modality";

const makeNode = (
  nodeKey: string,
  difficultyAnchor: number,
  isometricCapable = false,
): MovementNode => ({
  id: `node-${nodeKey}`,
  family: "hinge",
  nodeKey,
  displayName: nodeKey,
  prerequisites: [],
  externalLoadCapable: false,
  isometricCapable,
  unilateral: false,
  defaultTempoSeconds: 4,
  tutPerRepSeconds: 4,
  difficultyAnchor,
  createdAt: new Date(),
});

const makeProgress = (currentNodeId: string): BwProgress => ({
  userId: "user-1",
  family: "hinge",
  currentNodeId,
  accumulatedTutSeconds: 0,
  weeksAtNode: 0,
  cleanRepHistory: [],
  targetExternalLoadKg: null,
  updatedAt: new Date(),
});

const session = (
  modality: SessionModality,
  hasHingeMovement = false,
  weekIndex: 0 | 1 | 2 | 3 = 1,
) => ({
  hasHingeMovement,
  sessionModality: modality,
  weekIndex,
});

describe("maybeInjectHingeCompensation — gating", () => {
  it("skips when hinge is already covered", () => {
    const node = makeNode("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: makeProgress(node.id),
      currentNode: node,
      plannedSession: session("pure_hypertrophy", true),
    });
    expect(out.inject).toBe(false);
    expect(out.reason).toBe("skip_already_covered");
  });

  it("skips on restorative days", () => {
    const node = makeNode("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: makeProgress(node.id),
      currentNode: node,
      plannedSession: session("restorative"),
    });
    expect(out.inject).toBe(false);
    expect(out.reason).toBe("recovery_day");
  });

  it("skips on pure Z2 days", () => {
    const node = makeNode("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: makeProgress(node.id),
      currentNode: node,
      plannedSession: session("pure_z2_aerobic"),
    });
    expect(out.inject).toBe(false);
    expect(out.reason).toBe("recovery_day");
  });

  it("skips when the user has no progress state seeded", () => {
    const out = maybeInjectHingeCompensation({
      bwProgress: null,
      currentNode: null,
      plannedSession: session("pure_hypertrophy"),
    });
    expect(out.inject).toBe(false);
    expect(out.reason).toBe("no_progress_state");
  });
});

describe("maybeInjectHingeCompensation — per-node prescriptions", () => {
  const cases: Array<{
    nodeKey: string;
    anchor: number;
    expectReps?: number;
    expectSets: number;
    expectTempo: number;
    expectRir: number;
    cueIncludes: string;
  }> = [
    {
      nodeKey: "hip_hinge",
      anchor: 8,
      expectSets: 3,
      expectReps: 8,
      expectTempo: 4,
      expectRir: 2,
      cueIncludes: "Tempo hip-hinge",
    },
    {
      nodeKey: "single_leg_rdl_bw",
      anchor: 22,
      expectSets: 3,
      expectReps: 8,
      expectTempo: 4,
      expectRir: 2,
      cueIncludes: "Single-leg",
    },
    {
      nodeKey: "glute_ham_raise_assisted",
      anchor: 35,
      expectSets: 3,
      expectReps: 6,
      expectTempo: 5,
      expectRir: 1,
      cueIncludes: "Slow-resist",
    },
    {
      nodeKey: "nordic_curl_eccentric",
      anchor: 55,
      expectSets: 4,
      expectReps: 1,
      expectTempo: 6,
      expectRir: 1,
      cueIncludes: "Eccentric-only",
    },
    {
      nodeKey: "nordic_curl_concentric",
      anchor: 80,
      expectSets: 3,
      expectReps: 5,
      expectTempo: 4,
      expectRir: 1,
      cueIncludes: "Full ROM",
    },
  ];

  for (const c of cases) {
    it(`prescribes for ${c.nodeKey} (anchor ${c.anchor})`, () => {
      const node = makeNode(c.nodeKey, c.anchor, c.anchor >= 55);
      const out = maybeInjectHingeCompensation({
        bwProgress: makeProgress(node.id),
        currentNode: node,
        plannedSession: session("pure_hypertrophy"),
      });
      expect(out.inject).toBe(true);
      expect(out.movement?.nodeKey).toBe(c.nodeKey);
      expect(out.movement?.sets).toBe(c.expectSets);
      expect(out.movement?.reps).toBe(c.expectReps);
      expect(out.movement?.tempoEccentricSec).toBe(c.expectTempo);
      expect(out.movement?.targetRir).toBe(c.expectRir);
      expect(out.movement?.intensityCue).toContain(c.cueIncludes);
    });
  }
});

describe("maybeInjectHingeCompensation — deload shaping", () => {
  it("reduces sets and softens RIR + cue on deload week", () => {
    const node = makeNode("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: makeProgress(node.id),
      currentNode: node,
      plannedSession: session("pure_hypertrophy", false, 3),
    });
    expect(out.inject).toBe(true);
    expect(out.movement?.sets).toBe(2); // baseline 3 → deload 2
    expect(out.movement?.targetRir).toBe(3); // baseline 2 → deload 3
    expect(out.movement?.intensityCue).toContain("Quality over volume");
  });
});

describe("maybeInjectHingeCompensation — closest-by-anchor fallback", () => {
  it("falls back to the nearest canonical node when nodeKey is unknown", () => {
    const node = makeNode("future_unknown_node", 30);
    const out = maybeInjectHingeCompensation({
      bwProgress: makeProgress(node.id),
      currentNode: node,
      plannedSession: session("pure_hypertrophy"),
    });
    expect(out.inject).toBe(true);
    // anchor 30 is closest to single_leg_rdl_bw (22) vs glute_ham (35);
    // tie → first row wins. 35 is closer (|30-35|=5 vs |30-22|=8).
    expect(out.movement?.nodeKey).toBe("glute_ham_raise_assisted");
  });
});
