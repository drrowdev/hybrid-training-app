import { describe, expect, it } from "vitest";
import type { MovementFamily, MovementNode } from "@hta/db";
import { bwPrescription } from "../bw-prescription";

/**
 * Synthetic MovementNode factory. We don't hit the DB in unit tests —
 * the matrix is pure and only reads a handful of node fields.
 */
function makeNode(overrides: Partial<MovementNode> = {}): MovementNode {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    family: "push_h",
    nodeKey: "push_up",
    displayName: "Push-Up",
    prerequisites: [],
    externalLoadCapable: false,
    isometricCapable: false,
    unilateral: false,
    defaultTempoSeconds: 4,
    tutPerRepSeconds: 4,
    difficultyAnchor: 30,
    createdAt: new Date(),
    ...overrides,
  } as MovementNode;
}

const WEEKS = [0, 1, 2, 3] as const;
const ARCHETYPES = [
  "strength_anchor",
  "hypertrophy_anchor",
  "endurance_anchor",
  "concurrent_hybrid",
  "rebuild",
  "maintenance",
] as const;

// ─── Decision 1 — prescriptionType ────────────────────────────────────────

describe("bwPrescription · prescriptionType (decision 1)", () => {
  it("returns isometric_hold for skill families with isometric_capable nodes", () => {
    for (const family of ["planche", "lever_front", "lever_back", "human_flag", "handstand"] as MovementFamily[]) {
      const out = bwPrescription({
        node: makeNode({ family, isometricCapable: true, difficultyAnchor: 55 }),
        family,
        archetype: "strength_anchor",
        bucket: "main",
        weekIndex: 0,
      });
      expect(out.prescriptionType).toBe("isometric_hold");
      expect(typeof out.holdSeconds).toBe("number");
      expect(out.reps).toBeUndefined();
    }
  });

  it("returns isometric_hold when node_key includes _hold", () => {
    const out = bwPrescription({
      node: makeNode({ nodeKey: "l_sit_hold", isometricCapable: true }),
      family: "core_anti_flexion",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
    });
    expect(out.prescriptionType).toBe("isometric_hold");
  });

  it("returns tempo_reps for advanced nodes (anchor >= 60) outside endurance", () => {
    for (const archetype of ["strength_anchor", "hypertrophy_anchor", "concurrent_hybrid"] as const) {
      const out = bwPrescription({
        node: makeNode({ difficultyAnchor: 65 }),
        family: "push_h",
        archetype,
        bucket: "main",
        weekIndex: 0,
      });
      expect(out.prescriptionType).toBe("tempo_reps");
    }
  });

  it("falls back to plain reps for endurance even on advanced nodes", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 75 }),
      family: "push_h",
      archetype: "endurance_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.prescriptionType).toBe("reps");
  });

  it("returns reps for ordinary nodes below the tempo threshold", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "pull_v",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.prescriptionType).toBe("reps");
  });
});

// ─── Decision 2 — sets × reps / hold by archetype × week ─────────────────

describe("bwPrescription · matrix (decision 2)", () => {
  it("strength_anchor reps follow 5/4/3/5 × 5/5/5/3 sets, RIR 2/1/1/3", () => {
    const expected = [
      { sets: 5, reps: 5, rir: 2 },
      { sets: 5, reps: 4, rir: 1 },
      { sets: 5, reps: 3, rir: 1 },
      { sets: 3, reps: 5, rir: 3 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({ difficultyAnchor: 30 }),
        family: "pull_v",
        archetype: "strength_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.prescriptionType).toBe("reps");
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.reps).toBe(expected[w]!.reps);
      expect(out.targetRir).toBe(expected[w]!.rir);
    }
  });

  it("strength_anchor holds follow 6/8/10/6 sec × 5/5/5/3 sets", () => {
    const expected = [
      { sets: 5, hold: 6 },
      { sets: 5, hold: 8 },
      { sets: 5, hold: 10 },
      { sets: 3, hold: 6 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({ isometricCapable: true, nodeKey: "tuck_planche_hold", difficultyAnchor: 55 }),
        family: "planche",
        archetype: "strength_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.prescriptionType).toBe("isometric_hold");
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.holdSeconds).toBe(expected[w]!.hold);
    }
  });

  it("hypertrophy_anchor reps follow 8/10/12/8 × 4/4/4/3 sets, RIR 2/1/1/3", () => {
    const expected = [
      { sets: 4, reps: 8, rir: 2 },
      { sets: 4, reps: 10, rir: 1 },
      { sets: 4, reps: 12, rir: 1 },
      { sets: 3, reps: 8, rir: 3 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({ difficultyAnchor: 25 }),
        family: "squat_unilateral",
        archetype: "hypertrophy_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.reps).toBe(expected[w]!.reps);
      expect(out.targetRir).toBe(expected[w]!.rir);
    }
  });

  it("hypertrophy_anchor holds follow 10/14/18/10 sec × 4/4/4/3 sets", () => {
    const expected = [
      { sets: 4, hold: 10 },
      { sets: 4, hold: 14 },
      { sets: 4, hold: 18 },
      { sets: 3, hold: 10 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({ isometricCapable: true, nodeKey: "front_lever_tuck_hold", difficultyAnchor: 55 }),
        family: "lever_front",
        archetype: "hypertrophy_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.holdSeconds).toBe(expected[w]!.hold);
    }
  });

  it("endurance_anchor reps follow 15/20/25/15 × 3/3/3/2 sets, RIR 3/2/2/4", () => {
    const expected = [
      { sets: 3, reps: 15, rir: 3 },
      { sets: 3, reps: 20, rir: 2 },
      { sets: 3, reps: 25, rir: 2 },
      { sets: 2, reps: 15, rir: 4 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({ difficultyAnchor: 25 }),
        family: "push_h",
        archetype: "endurance_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.prescriptionType).toBe("reps");
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.reps).toBe(expected[w]!.reps);
      expect(out.targetRir).toBe(expected[w]!.rir);
    }
  });

  it("endurance_anchor on isometric_capable nodes uses tutPerRep × {3,4,5,3} × {3,3,3,2}", () => {
    const tut = 4;
    const expected = [
      { sets: 3, seconds: 12 },
      { sets: 3, seconds: 16 },
      { sets: 3, seconds: 20 },
      { sets: 2, seconds: 12 },
    ];
    for (const w of WEEKS) {
      const out = bwPrescription({
        node: makeNode({
          isometricCapable: true,
          nodeKey: "tuck_front_lever_hold",
          difficultyAnchor: 55,
          tutPerRepSeconds: tut,
        }),
        family: "lever_front",
        archetype: "endurance_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.prescriptionType).toBe("isometric_hold");
      expect(out.sets).toBe(expected[w]!.sets);
      expect(out.holdSeconds).toBe(expected[w]!.seconds);
    }
  });

  it("mixed / unrecognised archetype falls through to hypertrophy defaults", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 25 }),
      family: "pull_v",
      // arbitrary string — should normalise to "mixed" and use hypertrophy row
      archetype: "custom",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.sets).toBe(4);
    expect(out.reps).toBe(8);
    expect(out.targetRir).toBe(2);
  });
});

// ─── Decision 3 — tempoEccentricSec ───────────────────────────────────────

describe("bwPrescription · tempo (decision 3)", () => {
  it("strength uses node default tempo (weeks 0-2)", () => {
    for (const w of [0, 1, 2] as const) {
      const out = bwPrescription({
        node: makeNode({ defaultTempoSeconds: 4 }),
        family: "push_h",
        archetype: "strength_anchor",
        bucket: "main",
        weekIndex: w,
      });
      expect(out.tempoEccentricSec).toBe(4);
    }
  });

  it("hypertrophy uses max(4, default + 1)", () => {
    const out = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 4 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.tempoEccentricSec).toBe(5);
  });

  it("hypertrophy clamps tempo to 4 when default is lower", () => {
    const out = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 2 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.tempoEccentricSec).toBe(4);
  });

  it("endurance uses min(3, default)", () => {
    const out = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 4 }),
      family: "push_h",
      archetype: "endurance_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.tempoEccentricSec).toBe(3);
  });

  it("deload week (3) subtracts 1 second across archetypes", () => {
    const s = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 4 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 3,
    });
    expect(s.tempoEccentricSec).toBe(3);

    const h = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 4 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 3,
    });
    expect(h.tempoEccentricSec).toBe(4); // max(4, 5) → 5, then −1 = 4
  });

  it("tempo never drops below 1 second on deload", () => {
    const out = bwPrescription({
      node: makeNode({ defaultTempoSeconds: 1 }),
      family: "push_h",
      archetype: "endurance_anchor",
      bucket: "main",
      weekIndex: 3,
    });
    expect(out.tempoEccentricSec).toBeGreaterThanOrEqual(1);
  });
});

// ─── Decision 4 — restSeconds ─────────────────────────────────────────────

describe("bwPrescription · rest (decision 4)", () => {
  it("strength + skill gets 180s rest", () => {
    const out = bwPrescription({
      node: makeNode({ isometricCapable: true, difficultyAnchor: 55, nodeKey: "lever_hold" }),
      family: "lever_front",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.restSeconds).toBe(180);
  });

  it("strength + non-skill gets 150s rest", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.restSeconds).toBe(150);
  });

  it("hypertrophy gets 90s rest", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.restSeconds).toBe(90);
  });

  it("endurance gets 60s rest", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "endurance_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.restSeconds).toBe(60);
  });

  it("deload week preserves the base rest target", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 3,
    });
    expect(out.restSeconds).toBe(150);
  });
});

// ─── Decision 5 — intensityCue + notes ────────────────────────────────────

describe("bwPrescription · cues + notes (decision 5)", () => {
  it("deload weeks emit the quality-over-volume cue", () => {
    for (const archetype of ARCHETYPES) {
      const out = bwPrescription({
        node: makeNode(),
        family: "pull_v",
        archetype,
        bucket: "main",
        weekIndex: 3,
      });
      expect(out.intensityCue).toMatch(/quality|stop 3/i);
    }
  });

  it("tempo_reps cue references the slow eccentric", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 65 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.intensityCue.toLowerCase()).toContain("eccentric");
  });

  it("isometric_hold cue references effort, not failure", () => {
    const out = bwPrescription({
      node: makeNode({ isometricCapable: true, nodeKey: "planche_lean_hold", difficultyAnchor: 45 }),
      family: "planche",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.intensityCue.toLowerCase()).toMatch(/effort|hollow/);
  });

  it("notes are populated for advanced isometric-capable nodes (tendon reminder)", () => {
    const out = bwPrescription({
      node: makeNode({ isometricCapable: true, nodeKey: "front_lever_hold", difficultyAnchor: 60 }),
      family: "lever_front",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.notes).toBeDefined();
    expect(out.notes!.toLowerCase()).toMatch(/tendon|time-under-tension/);
  });

  it("notes are omitted for routine non-skill nodes", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 25 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    expect(out.notes).toBeUndefined();
  });
});

// ─── Decision 6 — sub-failure-friendly rep cap ────────────────────────────

describe("bwPrescription · rep cap for low-difficulty nodes (decision 6)", () => {
  it("does not cap when difficultyAnchor >= 20", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 25 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      cleanRepHistory: [{ reps: 2 }, { reps: 3 }, { reps: 2 }],
    });
    expect(out.reps).toBe(10);
  });

  it("does not cap when no history is present even on very-early nodes", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 10 }),
      family: "pull_v",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
    });
    expect(out.reps).toBe(10);
  });

  it("caps prescribed reps at 1.5× median of last 3 entries on early nodes", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 10 }),
      family: "pull_v",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      cleanRepHistory: [{ reps: 1 }, { reps: 2 }, { reps: 2 }],
    });
    // median(1,2,2) = 2 → cap = round(2 × 1.5) = 3; matrix wants 10 → 3
    expect(out.reps).toBe(3);
  });

  it("ignores non-rep entries (hold seconds) when computing the cap", () => {
    const out = bwPrescription({
      node: makeNode({ difficultyAnchor: 10 }),
      family: "pull_v",
      archetype: "hypertrophy_anchor",
      bucket: "main",
      weekIndex: 1,
      cleanRepHistory: [{ seconds: 5 }, { seconds: 6 }],
    });
    expect(out.reps).toBe(10);
  });
});

// ─── Back-off shaping ─────────────────────────────────────────────────────

describe("bwPrescription · back_off bucket", () => {
  it("strength back-off: 2 sets, RIR 3, +3 reps on main", () => {
    const main = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "main",
      weekIndex: 0,
    });
    const back = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "strength_anchor",
      bucket: "back_off",
      weekIndex: 0,
    });
    expect(back.sets).toBe(2);
    expect(back.targetRir).toBe(3);
    expect(back.reps).toBe((main.reps ?? 0) + 3);
  });

  it("strength back-off on hold: 2 sets, RIR 3, hold − 2 sec", () => {
    const back = bwPrescription({
      node: makeNode({ isometricCapable: true, nodeKey: "planche_hold", difficultyAnchor: 55 }),
      family: "planche",
      archetype: "strength_anchor",
      bucket: "back_off",
      weekIndex: 1, // main hold = 8s; back = max(3, 6)
    });
    expect(back.sets).toBe(2);
    expect(back.targetRir).toBe(3);
    expect(back.holdSeconds).toBe(6);
  });

  it("hypertrophy back-off: 2 sets, RIR 1", () => {
    const back = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "hypertrophy_anchor",
      bucket: "back_off",
      weekIndex: 0,
    });
    expect(back.sets).toBe(2);
    expect(back.targetRir).toBe(1);
  });

  it("endurance back-off: 1 set, RIR 0 (to failure)", () => {
    const back = bwPrescription({
      node: makeNode({ difficultyAnchor: 30 }),
      family: "push_h",
      archetype: "endurance_anchor",
      bucket: "back_off",
      weekIndex: 1,
    });
    expect(back.sets).toBe(1);
    expect(back.targetRir).toBe(0);
  });
});
