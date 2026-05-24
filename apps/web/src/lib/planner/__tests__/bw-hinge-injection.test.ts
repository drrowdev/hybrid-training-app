/**
 * Integration coverage for the createBlock → hinge-compensation
 * injection path. We test the small helper logic that decides whether
 * to inject — the createBlock action itself runs against Supabase
 * (covered separately by e2e), so this file pins the per-session
 * branch behaviour.
 */
import { describe, expect, it } from "vitest";
import type { BwProgress, MovementNode } from "@hta/db";
import { maybeInjectHingeCompensation } from "../hinge-compensation";

const node = (key: string, anchor: number): MovementNode => ({
  id: `n-${key}`,
  family: "hinge",
  nodeKey: key,
  displayName: key,
  prerequisites: [],
  externalLoadCapable: false,
  isometricCapable: false,
  unilateral: false,
  defaultTempoSeconds: 4,
  tutPerRepSeconds: 4,
  difficultyAnchor: anchor,
  createdAt: new Date(),
});

const progress = (n: MovementNode): BwProgress => ({
  userId: "u",
  family: "hinge",
  currentNodeId: n.id,
  accumulatedTutSeconds: 0,
  weeksAtNode: 0,
  cleanRepHistory: [],
  updatedAt: new Date(),
});

describe("Phase 5 integration — BW user hinge-compensation flow", () => {
  it("injects when hinge is NOT in rotation and modality permits", () => {
    const n = node("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: progress(n),
      currentNode: n,
      plannedSession: {
        hasHingeMovement: false,
        sessionModality: "pure_hypertrophy",
        weekIndex: 1,
      },
    });
    expect(out.inject).toBe(true);
    expect(out.reason).toBe("acknowledged_gap");
    expect(out.movement?.nodeKey).toBe("hip_hinge");
  });

  it("does NOT inject when hinge is already in rotation", () => {
    const n = node("hip_hinge", 8);
    const out = maybeInjectHingeCompensation({
      bwProgress: progress(n),
      currentNode: n,
      plannedSession: {
        hasHingeMovement: true,
        sessionModality: "pure_hypertrophy",
        weekIndex: 1,
      },
    });
    expect(out.inject).toBe(false);
    expect(out.reason).toBe("skip_already_covered");
  });

  it("does NOT inject on recovery days (restorative or pure Z2)", () => {
    const n = node("hip_hinge", 8);
    const restorative = maybeInjectHingeCompensation({
      bwProgress: progress(n),
      currentNode: n,
      plannedSession: {
        hasHingeMovement: false,
        sessionModality: "restorative",
        weekIndex: 1,
      },
    });
    expect(restorative.inject).toBe(false);
    expect(restorative.reason).toBe("recovery_day");

    const z2 = maybeInjectHingeCompensation({
      bwProgress: progress(n),
      currentNode: n,
      plannedSession: {
        hasHingeMovement: false,
        sessionModality: "pure_z2_aerobic",
        weekIndex: 1,
      },
    });
    expect(z2.inject).toBe(false);
    expect(z2.reason).toBe("recovery_day");
  });
});
