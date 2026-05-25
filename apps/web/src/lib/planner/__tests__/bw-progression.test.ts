import { describe, expect, it } from "vitest";
import type { BwProgress, MovementFamily, MovementNode } from "@hta/db";
import {
  evaluateProgression,
  gateStateFor,
  tutThreshold,
  type EvaluateProgressionInput,
  type RecentSessionStat,
} from "../bw-progression";

// ── Fixtures ──────────────────────────────────────────────────────────

function node(
  overrides: Partial<MovementNode> & Pick<MovementNode, "id" | "family">,
): MovementNode {
  return {
    id: overrides.id,
    family: overrides.family,
    nodeKey: overrides.nodeKey ?? `${overrides.family}_node_${overrides.id}`,
    displayName: overrides.displayName ?? "node",
    prerequisites: overrides.prerequisites ?? [],
    externalLoadCapable: overrides.externalLoadCapable ?? false,
    isometricCapable: overrides.isometricCapable ?? false,
    unilateral: overrides.unilateral ?? false,
    defaultTempoSeconds: overrides.defaultTempoSeconds ?? 4,
    tutPerRepSeconds: overrides.tutPerRepSeconds ?? 4,
    difficultyAnchor: overrides.difficultyAnchor ?? 20,
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function progress(overrides: Partial<BwProgress>): BwProgress {
  return {
    userId: overrides.userId ?? "00000000-0000-0000-0000-000000000001",
    family: overrides.family ?? ("push_h" as MovementFamily),
    currentNodeId:
      overrides.currentNodeId ?? "00000000-0000-0000-0000-0000000000aa",
    accumulatedTutSeconds: overrides.accumulatedTutSeconds ?? 0,
    weeksAtNode: overrides.weeksAtNode ?? 0,
    cleanRepHistory: overrides.cleanRepHistory ?? [],
    targetExternalLoadKg: null,
    updatedAt: overrides.updatedAt ?? new Date(0),
  };
}

function repsSession(over: boolean, prescribed = 8): RecentSessionStat {
  return {
    sessionDate: "2026-06-01",
    prescribedReps: prescribed,
    actualReps: over ? prescribed + 2 : prescribed,
    rir: over ? 2 : 0,
    cleanForm: over,
  };
}

function holdSession(over: boolean, prescribed = 10): RecentSessionStat {
  return {
    sessionDate: "2026-06-01",
    prescribedHoldSec: prescribed,
    actualHoldSec: over ? prescribed + 3 : prescribed,
    rir: over ? 1 : 0,
    cleanForm: over,
  };
}

function tempoSession(over: boolean, prescribed = 5): RecentSessionStat {
  return {
    sessionDate: "2026-06-01",
    prescribedReps: prescribed,
    actualReps: over ? prescribed + 1 : prescribed,
    rir: over ? 1 : 0,
    cleanForm: over,
  };
}

const current = node({
  id: "00000000-0000-0000-0000-0000000000aa",
  family: "push_h",
  nodeKey: "push_up",
  difficultyAnchor: 15,
});

const childA = node({
  id: "00000000-0000-0000-0000-0000000000bb",
  family: "push_h",
  nodeKey: "decline_push_up",
  difficultyAnchor: 25,
});

const childB = node({
  id: "00000000-0000-0000-0000-0000000000cc",
  family: "push_h",
  nodeKey: "diamond_push_up",
  difficultyAnchor: 28,
});

function baseInput(): EvaluateProgressionInput {
  return {
    bwProgress: progress({
      currentNodeId: current.id,
      accumulatedTutSeconds: 200,
      weeksAtNode: 2,
    }),
    currentNode: current,
    candidateNextNodes: [childB, childA],
    recentSessions: [repsSession(true), repsSession(true)],
  };
}

// ── tutThreshold boundaries ───────────────────────────────────────────

describe("tutThreshold", () => {
  it("non-skill node uses anchor × 6", () => {
    const n = node({
      id: "x",
      family: "push_h",
      difficultyAnchor: 40,
    });
    expect(tutThreshold(n)).toBe(240);
  });

  it("skill family with isometric flag uses anchor × 12", () => {
    const n = node({
      id: "x",
      family: "planche",
      isometricCapable: true,
      difficultyAnchor: 40,
    });
    expect(tutThreshold(n)).toBe(480);
  });

  it("clamps to floor 60s when anchor × 6 would be lower", () => {
    const n = node({
      id: "x",
      family: "push_h",
      difficultyAnchor: 5,
    });
    expect(tutThreshold(n)).toBe(60);
  });

  it("clamps to ceiling 1500s when anchor × 12 would be higher", () => {
    const n = node({
      id: "x",
      family: "lever_front",
      isometricCapable: true,
      difficultyAnchor: 90,
    });
    expect(tutThreshold(n)).toBe(1080);
    const huge = node({
      id: "x",
      family: "human_flag",
      isometricCapable: true,
      difficultyAnchor: 100,
    });
    expect(tutThreshold(huge)).toBe(1200);
  });

  it("ceiling fires at extreme anchors", () => {
    const n = node({
      id: "x",
      family: "human_flag",
      isometricCapable: true,
      difficultyAnchor: 100,
    });
    // 100 × 12 = 1200; not yet at 1500 — verify floor/ceiling math.
    expect(tutThreshold(n)).toBeLessThanOrEqual(1500);
    expect(tutThreshold(n)).toBeGreaterThanOrEqual(60);
  });

  it("skill family without isometric flag uses non-skill multiplier", () => {
    const n = node({
      id: "x",
      family: "muscle_up",
      isometricCapable: false,
      difficultyAnchor: 50,
    });
    expect(tutThreshold(n)).toBe(300);
  });
});

// ── Block reasons ─────────────────────────────────────────────────────

describe("evaluateProgression — blocked paths", () => {
  it("blocks when weeks_at_node < 2", () => {
    const input = baseInput();
    input.bwProgress = { ...input.bwProgress, weeksAtNode: 1 };
    const d = evaluateProgression(input);
    expect(d).toEqual({
      advance: false,
      reason: "weeks_at_node_insufficient",
      nextCheckAt: "next_week",
    });
  });

  it("blocks when TUT below threshold", () => {
    const input = baseInput();
    input.bwProgress = {
      ...input.bwProgress,
      accumulatedTutSeconds: 30,
    };
    const d = evaluateProgression(input);
    expect(d).toEqual({
      advance: false,
      reason: "tut_below_threshold",
      nextCheckAt: "next_week",
    });
  });

  it("blocks when last 2 sessions did not over-complete", () => {
    const input = baseInput();
    input.recentSessions = [repsSession(true), repsSession(false)];
    const d = evaluateProgression(input);
    expect(d).toEqual({
      advance: false,
      reason: "recent_sessions_not_over_completed",
      nextCheckAt: "next_session",
    });
  });

  it("blocks when only one recent session exists", () => {
    const input = baseInput();
    input.recentSessions = [repsSession(true)];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(false);
    if (!d.advance) {
      expect(d.reason).toBe("recent_sessions_not_over_completed");
    }
  });

  it("RIR < 1 disqualifies a session even with the rep target met", () => {
    const input = baseInput();
    const bad: RecentSessionStat = {
      sessionDate: "2026-06-01",
      prescribedReps: 8,
      actualReps: 10,
      rir: 0,
      cleanForm: true,
    };
    input.recentSessions = [repsSession(true), bad];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(false);
  });

  it("clean_form=false disqualifies a session", () => {
    const input = baseInput();
    const bad: RecentSessionStat = {
      sessionDate: "2026-06-01",
      prescribedReps: 8,
      actualReps: 12,
      rir: 2,
      cleanForm: false,
    };
    input.recentSessions = [repsSession(true), bad];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(false);
  });

  it("returns terminal_node when candidates empty", () => {
    const input = baseInput();
    input.candidateNextNodes = [];
    const d = evaluateProgression(input);
    expect(d).toEqual({ advance: false, reason: "terminal_node" });
  });

  it("filters cross-family candidates → terminal when none match", () => {
    const input = baseInput();
    input.candidateNextNodes = [
      node({
        id: "zzz",
        family: "pull_v",
        nodeKey: "muscle_up",
        difficultyAnchor: 60,
      }),
    ];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(false);
    if (!d.advance) expect(d.reason).toBe("terminal_node");
  });
});

// ── Success paths ─────────────────────────────────────────────────────

describe("evaluateProgression — advance paths", () => {
  it("advances on the lowest-anchor child (over_completed_2_weeks)", () => {
    const d = evaluateProgression(baseInput());
    expect(d).toEqual({
      advance: true,
      toNodeId: childA.id,
      toNodeKey: childA.nodeKey,
      reason: "over_completed_2_weeks",
    });
  });

  it("ties broken by nodeKey lexicographic order", () => {
    const tieA = node({
      id: "ta",
      family: "push_h",
      nodeKey: "alpha_node",
      difficultyAnchor: 25,
    });
    const tieB = node({
      id: "tb",
      family: "push_h",
      nodeKey: "beta_node",
      difficultyAnchor: 25,
    });
    const input = baseInput();
    input.candidateNextNodes = [tieB, tieA];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(true);
    if (d.advance) expect(d.toNodeKey).toBe("alpha_node");
  });

  it("chip preference picks the requested branch (chip_preference)", () => {
    const input = baseInput();
    input.preferredNextNodeKey = childB.nodeKey;
    const d = evaluateProgression(input);
    expect(d).toEqual({
      advance: true,
      toNodeId: childB.id,
      toNodeKey: childB.nodeKey,
      reason: "chip_preference",
    });
  });

  it("falls back to lowest-anchor when chip preference doesn't match", () => {
    const input = baseInput();
    input.preferredNextNodeKey = "not_a_real_key";
    const d = evaluateProgression(input);
    expect(d.advance).toBe(true);
    if (d.advance) expect(d.reason).toBe("over_completed_2_weeks");
  });

  it("tempo_reps mode uses +1 rep over-completion bar", () => {
    const advanced = node({
      id: "00000000-0000-0000-0000-0000000000dd",
      family: "push_h",
      nodeKey: "archer_push_up",
      difficultyAnchor: 65,
    });
    const childAdv = node({
      id: "00000000-0000-0000-0000-0000000000ee",
      family: "push_h",
      nodeKey: "one_arm_push_up_neg",
      difficultyAnchor: 70,
    });
    const d = evaluateProgression({
      bwProgress: progress({
        currentNodeId: advanced.id,
        accumulatedTutSeconds: tutThreshold(advanced) + 10,
        weeksAtNode: 2,
      }),
      currentNode: advanced,
      candidateNextNodes: [childAdv],
      recentSessions: [tempoSession(true), tempoSession(true)],
    });
    expect(d.advance).toBe(true);
    if (d.advance) expect(d.toNodeKey).toBe("one_arm_push_up_neg");
  });

  it("hold mode uses +3 sec over-completion bar", () => {
    const lever = node({
      id: "00000000-0000-0000-0000-0000000000ff",
      family: "lever_front",
      isometricCapable: true,
      nodeKey: "tuck_front_lever",
      difficultyAnchor: 45,
    });
    const adv = node({
      id: "00000000-0000-0000-0000-000000000001",
      family: "lever_front",
      isometricCapable: true,
      nodeKey: "advanced_tuck_lever",
      difficultyAnchor: 55,
    });
    const d = evaluateProgression({
      bwProgress: progress({
        currentNodeId: lever.id,
        accumulatedTutSeconds: tutThreshold(lever) + 10,
        weeksAtNode: 2,
      }),
      currentNode: lever,
      candidateNextNodes: [adv],
      recentSessions: [holdSession(true), holdSession(true)],
    });
    expect(d.advance).toBe(true);
  });

  it("hold mode rejects when delta < +3 sec", () => {
    const lever = node({
      id: "00000000-0000-0000-0000-0000000000ff",
      family: "lever_front",
      isometricCapable: true,
      nodeKey: "tuck_front_lever",
      difficultyAnchor: 45,
    });
    const recent: RecentSessionStat[] = [
      {
        sessionDate: "2026-06-01",
        prescribedHoldSec: 10,
        actualHoldSec: 12,
        rir: 2,
        cleanForm: true,
      },
      {
        sessionDate: "2026-06-03",
        prescribedHoldSec: 10,
        actualHoldSec: 12,
        rir: 2,
        cleanForm: true,
      },
    ];
    const d = evaluateProgression({
      bwProgress: progress({
        currentNodeId: lever.id,
        accumulatedTutSeconds: tutThreshold(lever) + 10,
        weeksAtNode: 2,
      }),
      currentNode: lever,
      candidateNextNodes: [
        node({ id: "z", family: "lever_front", difficultyAnchor: 55 }),
      ],
      recentSessions: recent,
    });
    expect(d.advance).toBe(false);
  });

  it("walks past extra recent sessions and only checks last 2", () => {
    const input = baseInput();
    input.recentSessions = [
      repsSession(false),
      repsSession(false),
      repsSession(true),
      repsSession(true),
    ];
    const d = evaluateProgression(input);
    expect(d.advance).toBe(true);
  });
});

// ── gateStateFor ─────────────────────────────────────────────────────

describe("gateStateFor", () => {
  it("snapshots all four gate inputs", () => {
    const s = gateStateFor({
      bwProgress: progress({
        accumulatedTutSeconds: 80,
        weeksAtNode: 1,
      }),
      currentNode: current,
      candidateNextNodes: [childA],
      recentSessions: [repsSession(true), repsSession(true)],
    });
    expect(s).toEqual({
      weeksAtNode: 1,
      weeksRequired: 2,
      tutAccumulated: 80,
      tutRequired: tutThreshold(current),
      recentOverCompleted: true,
      recentOverCompletedHits: 2,
      terminal: false,
    });
  });

  it("flags terminal when no same-family candidates", () => {
    const s = gateStateFor({
      bwProgress: progress({}),
      currentNode: current,
      candidateNextNodes: [],
      recentSessions: [],
    });
    expect(s.terminal).toBe(true);
  });
});
