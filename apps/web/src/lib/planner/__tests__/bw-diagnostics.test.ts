import { describe, expect, it } from "vitest";
import type { BwProgress, MovementFamily, MovementNode } from "@hta/db";
import {
  DIAGNOSTIC_THRESHOLDS,
  runDiagnostics,
  severityOf,
  type RecentSessionRecord,
  type RunDiagnosticsInput,
} from "../bw-diagnostics";

// ── Fixtures ──────────────────────────────────────────────────────────

const NOW = new Date("2026-06-15T12:00:00Z");

function node(
  id: string,
  family: MovementFamily,
  overrides: Partial<MovementNode> = {},
): MovementNode {
  return {
    id,
    family,
    nodeKey: overrides.nodeKey ?? `${family}_${id}`,
    displayName: overrides.displayName ?? `${family} ${id}`,
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

function progress(
  family: MovementFamily,
  currentNodeId: string,
  overrides: Partial<BwProgress> = {},
): BwProgress {
  return {
    userId: "u",
    family,
    currentNodeId,
    accumulatedTutSeconds: overrides.accumulatedTutSeconds ?? 0,
    weeksAtNode: overrides.weeksAtNode ?? 0,
    cleanRepHistory: overrides.cleanRepHistory ?? [],
    targetExternalLoadKg: null,
    updatedAt: overrides.updatedAt ?? new Date(0),
  };
}

function emptyProgressMap(): Record<MovementFamily, BwProgress | null> {
  return {
    push_h: null,
    push_v: null,
    pull_h: null,
    pull_v: null,
    squat_unilateral: null,
    squat_bilateral: null,
    hinge: null,
    core_anti_flexion: null,
    core_anti_rotation: null,
    planche: null,
    lever_front: null,
    lever_back: null,
    muscle_up: null,
    handstand: null,
    human_flag: null,
  };
}

function daysAgo(days: number, ref: Date = NOW): string {
  return new Date(ref.getTime() - days * 86_400_000).toISOString();
}

function baseInput(
  overrides: Partial<RunDiagnosticsInput> = {},
): RunDiagnosticsInput {
  return {
    bwProgressByFamily: overrides.bwProgressByFamily ?? emptyProgressMap(),
    nodeById: overrides.nodeById ?? {},
    progressionEventsLast90Days: overrides.progressionEventsLast90Days ?? [],
    recentSessionsLast30Days: overrides.recentSessionsLast30Days ?? [],
    now: overrides.now ?? NOW,
  };
}

// ── stall_at_node ─────────────────────────────────────────────────────

describe("stall_at_node detection", () => {
  it("does not fire below the soft week threshold", () => {
    const n = node("n1", "push_h", { difficultyAnchor: 15 });
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", {
      weeksAtNode: DIAGNOSTIC_THRESHOLDS.STALL_WEEKS_SOFT - 1,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: { n1: n } }),
    );
    expect(out.find((r) => r.signal.kind === "stall_at_node")).toBeUndefined();
  });

  it("fires as 'soft' at exactly STALL_WEEKS_SOFT", () => {
    const n = node("n1", "push_h");
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", {
      weeksAtNode: DIAGNOSTIC_THRESHOLDS.STALL_WEEKS_SOFT,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: { n1: n } }),
    );
    const sig = out.find((r) => r.signal.kind === "stall_at_node");
    expect(sig?.signal.kind).toBe("stall_at_node");
    if (sig?.signal.kind === "stall_at_node") expect(sig.signal.severity).toBe("soft");
  });

  it("escalates to 'hard' at STALL_WEEKS_HARD", () => {
    const n = node("n1", "push_h");
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", {
      weeksAtNode: DIAGNOSTIC_THRESHOLDS.STALL_WEEKS_HARD,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: { n1: n } }),
    );
    const sig = out.find((r) => r.signal.kind === "stall_at_node");
    if (sig?.signal.kind === "stall_at_node") expect(sig.signal.severity).toBe("hard");
  });

  it("suppresses when a progression event landed in the last 28 days", () => {
    const n = node("n1", "push_h");
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", { weeksAtNode: 5 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n1: n },
        progressionEventsLast90Days: [
          { family: "push_h", occurredAt: daysAgo(20), reason: "over_completed_2_weeks" },
        ],
      }),
    );
    expect(out.find((r) => r.signal.kind === "stall_at_node")).toBeUndefined();
  });

  it("still fires when the only progression event is older than 28 days", () => {
    const n = node("n1", "push_h");
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", { weeksAtNode: 5 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n1: n },
        progressionEventsLast90Days: [
          { family: "push_h", occurredAt: daysAgo(45), reason: "over_completed_2_weeks" },
        ],
      }),
    );
    expect(out.some((r) => r.signal.kind === "stall_at_node")).toBe(true);
  });

  it("ignores progression events for a different family", () => {
    const n1 = node("n1", "push_h");
    const map = emptyProgressMap();
    map.push_h = progress("push_h", "n1", { weeksAtNode: 5 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n1 },
        progressionEventsLast90Days: [
          { family: "pull_h", occurredAt: daysAgo(10), reason: "over_completed_2_weeks" },
        ],
      }),
    );
    expect(out.some((r) => r.signal.kind === "stall_at_node")).toBe(true);
  });
});

// ── aesthetics_drift_upper_strong ─────────────────────────────────────

describe("aesthetics_drift_upper_strong", () => {
  function upperHeavyMap(): {
    map: Record<MovementFamily, BwProgress | null>;
    nodes: Record<string, MovementNode>;
  } {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    // Big upper anchors.
    const upperPairs: Array<[MovementFamily, number]> = [
      ["push_h", 60],
      ["push_v", 50],
      ["pull_h", 60],
      ["pull_v", 60],
    ];
    for (const [fam, anchor] of upperPairs) {
      const id = `${fam}_n`;
      nodes[id] = node(id, fam, { difficultyAnchor: anchor });
      map[fam] = progress(fam, id);
    }
    return { map, nodes };
  }

  it("does not fire below the 2.5× ratio", () => {
    const { map, nodes } = upperHeavyMap();
    // Lower sum = 100 → upper sum 230 / 100 = 2.3, below threshold.
    const sq = node("sq", "squat_bilateral", { difficultyAnchor: 50 });
    const hi = node("hi", "hinge", { difficultyAnchor: 50 });
    nodes.sq = sq;
    nodes.hi = hi;
    map.squat_bilateral = progress("squat_bilateral", "sq");
    map.hinge = progress("hinge", "hi");
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "aesthetics_drift_upper_strong"),
    ).toBeUndefined();
  });

  it("fires above 2.5× and lists lagging lower families", () => {
    const { map, nodes } = upperHeavyMap();
    // Lower sum = 18 → ratio 230 / 18 = 12.7 — well above threshold.
    const sq = node("sq", "squat_bilateral", { difficultyAnchor: 10 });
    const hi = node("hi", "hinge", { difficultyAnchor: 8 });
    nodes.sq = sq;
    nodes.hi = hi;
    map.squat_bilateral = progress("squat_bilateral", "sq");
    map.hinge = progress("hinge", "hi");
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    const sig = out.find(
      (r) => r.signal.kind === "aesthetics_drift_upper_strong",
    );
    expect(sig).toBeDefined();
    if (sig?.signal.kind === "aesthetics_drift_upper_strong") {
      expect(sig.signal.ratio).toBeGreaterThan(
        DIAGNOSTIC_THRESHOLDS.AESTHETICS_DRIFT_RATIO,
      );
      // Both bilateral squat (anchor 10) and hinge (anchor 8) below
      // LOWER_LAGGING_ANCHOR = 20.
      expect(sig.signal.lowerFamiliesLagging).toContain("squat_bilateral");
      expect(sig.signal.lowerFamiliesLagging).toContain("hinge");
      expect(sig.signal.lowerFamiliesLagging).toContain("squat_unilateral");
    }
    expect(sig?.intervention.actionable?.href).toContain("bias=lower");
  });

  it("treats missing lower-family rows as lagging", () => {
    const { map, nodes } = upperHeavyMap();
    // No lower rows set at all.
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    const sig = out.find(
      (r) => r.signal.kind === "aesthetics_drift_upper_strong",
    );
    if (sig?.signal.kind === "aesthetics_drift_upper_strong") {
      expect(sig.signal.lowerFamiliesLagging.length).toBe(3);
    }
  });

  it("does not fire when everything is empty", () => {
    const out = runDiagnostics(baseInput());
    expect(
      out.find((r) => r.signal.kind === "aesthetics_drift_upper_strong"),
    ).toBeUndefined();
  });
});

// ── aesthetics_drift_pull_dominant ────────────────────────────────────

describe("aesthetics_drift_pull_dominant", () => {
  it("fires when pull/push ratio exceeds 1.6", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.ph = node("ph", "pull_h", { difficultyAnchor: 50 });
    nodes.pv = node("pv", "pull_v", { difficultyAnchor: 50 });
    nodes.psh = node("psh", "push_h", { difficultyAnchor: 25 });
    nodes.psv = node("psv", "push_v", { difficultyAnchor: 25 });
    map.pull_h = progress("pull_h", "ph");
    map.pull_v = progress("pull_v", "pv");
    map.push_h = progress("push_h", "psh");
    map.push_v = progress("push_v", "psv");
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    const sig = out.find(
      (r) => r.signal.kind === "aesthetics_drift_pull_dominant",
    );
    expect(sig).toBeDefined();
  });

  it("does not fire at exactly 1.6", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.ph = node("ph", "pull_h", { difficultyAnchor: 40 });
    nodes.pv = node("pv", "pull_v", { difficultyAnchor: 40 });
    nodes.psh = node("psh", "push_h", { difficultyAnchor: 25 });
    nodes.psv = node("psv", "push_v", { difficultyAnchor: 25 });
    map.pull_h = progress("pull_h", "ph");
    map.pull_v = progress("pull_v", "pv");
    map.push_h = progress("push_h", "psh");
    map.push_v = progress("push_v", "psv");
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    // pull = 80, push = 50, ratio = 1.6 — strictly > check.
    expect(
      out.find((r) => r.signal.kind === "aesthetics_drift_pull_dominant"),
    ).toBeUndefined();
  });

  it("does not fire when push is zero (cannot compute meaningful ratio)", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.ph = node("ph", "pull_h", { difficultyAnchor: 40 });
    map.pull_h = progress("pull_h", "ph");
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "aesthetics_drift_pull_dominant"),
    ).toBeUndefined();
  });
});

// ── tendon_load_undercooked ───────────────────────────────────────────

describe("tendon_load_undercooked", () => {
  it("fires when skill node TUT < anchor × 8 after 3 weeks", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    const tuck = node("tuck", "planche", {
      difficultyAnchor: 40,
      isometricCapable: true,
    });
    const adv = node("adv", "planche", {
      difficultyAnchor: 60,
      isometricCapable: true,
      prerequisites: ["tuck"],
    });
    nodes.tuck = tuck;
    nodes.adv = adv;
    map.planche = progress("planche", "adv", {
      weeksAtNode: 4,
      accumulatedTutSeconds: 100, // need 60 × 8 = 480
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    const sig = out.find((r) => r.signal.kind === "tendon_load_undercooked");
    expect(sig).toBeDefined();
    if (sig?.signal.kind === "tendon_load_undercooked") {
      expect(sig.signal.tutDeficitSeconds).toBe(380);
      expect(sig.signal.family).toBe("planche");
    }
    expect(sig?.intervention.copy).toContain(tuck.displayName);
  });

  it("does not fire below the min anchor (50)", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.n = node("n", "planche", {
      difficultyAnchor: 45,
      isometricCapable: true,
    });
    map.planche = progress("planche", "n", {
      weeksAtNode: 4,
      accumulatedTutSeconds: 0,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "tendon_load_undercooked"),
    ).toBeUndefined();
  });

  it("does not fire before 3 weeks at node", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.n = node("n", "planche", {
      difficultyAnchor: 60,
      isometricCapable: true,
    });
    map.planche = progress("planche", "n", {
      weeksAtNode: 2,
      accumulatedTutSeconds: 0,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "tendon_load_undercooked"),
    ).toBeUndefined();
  });

  it("does not fire when TUT is already at the bank-time bar", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.n = node("n", "lever_front", {
      difficultyAnchor: 60,
      isometricCapable: true,
    });
    map.lever_front = progress("lever_front", "n", {
      weeksAtNode: 4,
      accumulatedTutSeconds: 60 * 8,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "tendon_load_undercooked"),
    ).toBeUndefined();
  });

  it("ignores non-isometric-capable nodes", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.n = node("n", "planche", {
      difficultyAnchor: 60,
      isometricCapable: false,
    });
    map.planche = progress("planche", "n", {
      weeksAtNode: 4,
      accumulatedTutSeconds: 0,
    });
    const out = runDiagnostics(
      baseInput({ bwProgressByFamily: map, nodeById: nodes }),
    );
    expect(
      out.find((r) => r.signal.kind === "tendon_load_undercooked"),
    ).toBeUndefined();
  });
});

// ── cns_overreach_risk ────────────────────────────────────────────────

describe("cns_overreach_risk", () => {
  function skillSession(daysAgoCount: number): RecentSessionRecord {
    return {
      sessionDate: daysAgo(daysAgoCount),
      movements: [
        { family: "planche", isSkillFocused: true, completed: true },
      ],
    };
  }

  it("fires at ≥ 5 skill-focused sessions in 14 days", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: [
          skillSession(1),
          skillSession(3),
          skillSession(5),
          skillSession(8),
          skillSession(12),
        ],
      }),
    );
    const sig = out.find((r) => r.signal.kind === "cns_overreach_risk");
    expect(sig).toBeDefined();
    if (sig?.signal.kind === "cns_overreach_risk") {
      expect(sig.signal.consecutiveSkillSessions).toBe(5);
    }
  });

  it("excludes sessions older than 14 days", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: [
          skillSession(1),
          skillSession(3),
          skillSession(20), // outside window
          skillSession(22), // outside window
          skillSession(5),
        ],
      }),
    );
    expect(
      out.find((r) => r.signal.kind === "cns_overreach_risk"),
    ).toBeUndefined();
  });

  it("does not count non-skill-focused sessions", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: Array.from({ length: 5 }).map((_, i) => ({
          sessionDate: daysAgo(i),
          movements: [
            { family: "pull_h" as MovementFamily, isSkillFocused: false, completed: true },
          ],
        })),
      }),
    );
    expect(
      out.find((r) => r.signal.kind === "cns_overreach_risk"),
    ).toBeUndefined();
  });

  it("does not count incomplete skill sessions", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: Array.from({ length: 5 }).map((_, i) => ({
          sessionDate: daysAgo(i),
          movements: [
            { family: "planche" as MovementFamily, isSkillFocused: true, completed: false },
          ],
        })),
      }),
    );
    expect(
      out.find((r) => r.signal.kind === "cns_overreach_risk"),
    ).toBeUndefined();
  });
});

// ── hinge_gap_active ──────────────────────────────────────────────────

describe("hinge_gap_active", () => {
  it("fires when no hinge work in 14 days", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: [
          {
            sessionDate: daysAgo(2),
            movements: [
              { family: "push_h", isSkillFocused: false, completed: true },
            ],
          },
          {
            sessionDate: daysAgo(20),
            movements: [
              { family: "hinge", isSkillFocused: false, completed: true },
            ],
          },
        ],
      }),
    );
    expect(out.some((r) => r.signal.kind === "hinge_gap_active")).toBe(true);
  });

  it("does not fire when hinge work is recent", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: [
          {
            sessionDate: daysAgo(3),
            movements: [
              { family: "hinge", isSkillFocused: false, completed: true },
            ],
          },
        ],
      }),
    );
    expect(
      out.find((r) => r.signal.kind === "hinge_gap_active"),
    ).toBeUndefined();
  });

  it("fires when there are no sessions at all", () => {
    const out = runDiagnostics(baseInput());
    expect(out.some((r) => r.signal.kind === "hinge_gap_active")).toBe(true);
  });

  it("ignores incomplete hinge entries", () => {
    const out = runDiagnostics(
      baseInput({
        recentSessionsLast30Days: [
          {
            sessionDate: daysAgo(2),
            movements: [
              { family: "hinge", isSkillFocused: false, completed: false },
            ],
          },
        ],
      }),
    );
    expect(out.some((r) => r.signal.kind === "hinge_gap_active")).toBe(true);
  });
});

// ── regression_risk ───────────────────────────────────────────────────

describe("regression_risk", () => {
  it("fires when > 3 missed sessions for a family with positive TUT", () => {
    const map = emptyProgressMap();
    const cur = node("cur", "pull_v", { difficultyAnchor: 40, prerequisites: ["prev"] });
    const prev = node("prev", "pull_v", { difficultyAnchor: 30 });
    map.pull_v = progress("pull_v", "cur", { accumulatedTutSeconds: 300 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { cur, prev },
        recentSessionsLast30Days: Array.from({ length: 4 }).map((_, i) => ({
          sessionDate: daysAgo(i * 2),
          movements: [
            { family: "pull_v" as MovementFamily, isSkillFocused: false, completed: false },
          ],
        })),
      }),
    );
    const sig = out.find((r) => r.signal.kind === "regression_risk");
    expect(sig).toBeDefined();
    if (sig?.signal.kind === "regression_risk") {
      expect(sig.signal.family).toBe("pull_v");
      expect(sig.signal.missedSessions).toBe(4);
    }
    expect(sig?.intervention.copy).toContain(prev.displayName);
  });

  it("does not fire at exactly 3 missed sessions (> threshold)", () => {
    const map = emptyProgressMap();
    const n = node("n", "pull_v");
    map.pull_v = progress("pull_v", "n", { accumulatedTutSeconds: 100 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n },
        recentSessionsLast30Days: Array.from({ length: 3 }).map((_, i) => ({
          sessionDate: daysAgo(i),
          movements: [
            { family: "pull_v" as MovementFamily, isSkillFocused: false, completed: false },
          ],
        })),
      }),
    );
    expect(out.find((r) => r.signal.kind === "regression_risk")).toBeUndefined();
  });

  it("does not fire when accumulated TUT is zero", () => {
    const map = emptyProgressMap();
    const n = node("n", "pull_v");
    map.pull_v = progress("pull_v", "n", { accumulatedTutSeconds: 0 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n },
        recentSessionsLast30Days: Array.from({ length: 5 }).map((_, i) => ({
          sessionDate: daysAgo(i),
          movements: [
            { family: "pull_v" as MovementFamily, isSkillFocused: false, completed: false },
          ],
        })),
      }),
    );
    expect(out.find((r) => r.signal.kind === "regression_risk")).toBeUndefined();
  });

  it("severity escalates to 'hard' beyond 6 missed sessions", () => {
    const map = emptyProgressMap();
    const n = node("n", "pull_v");
    map.pull_v = progress("pull_v", "n", { accumulatedTutSeconds: 200 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: { n },
        recentSessionsLast30Days: Array.from({ length: 7 }).map((_, i) => ({
          sessionDate: daysAgo(i),
          movements: [
            { family: "pull_v" as MovementFamily, isSkillFocused: false, completed: false },
          ],
        })),
      }),
    );
    const sig = out.find((r) => r.signal.kind === "regression_risk");
    expect(sig).toBeDefined();
    if (sig) expect(severityOf(sig.signal)).toBe("hard");
  });
});

// ── Ranking + integration ─────────────────────────────────────────────

describe("runDiagnostics — ranking + composition", () => {
  it("returns hard signals before soft ones", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    const pushNode = node("p", "push_h");
    nodes.p = pushNode;
    map.push_h = progress("push_h", "p", { weeksAtNode: 6 }); // hard stall
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: nodes,
        // hinge gap is soft → should sort after the hard stall
      }),
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(severityOf(out[0]!.signal)).toBe("hard");
  });

  it("returns an empty array when nothing fires", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    // One small, balanced setup with recent hinge work — nothing should fire.
    const pn = node("pn", "push_h", { difficultyAnchor: 10 });
    const sn = node("sn", "squat_bilateral", { difficultyAnchor: 10 });
    const hn = node("hn", "hinge", { difficultyAnchor: 10 });
    nodes.pn = pn;
    nodes.sn = sn;
    nodes.hn = hn;
    map.push_h = progress("push_h", "pn", { weeksAtNode: 1 });
    map.squat_bilateral = progress("squat_bilateral", "sn", { weeksAtNode: 1 });
    map.hinge = progress("hinge", "hn", { weeksAtNode: 1 });
    const out = runDiagnostics(
      baseInput({
        bwProgressByFamily: map,
        nodeById: nodes,
        recentSessionsLast30Days: [
          {
            sessionDate: daysAgo(2),
            movements: [
              { family: "hinge", isSkillFocused: false, completed: true },
            ],
          },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it("composes multiple signals — upper-strong drift + hinge gap together", () => {
    const map = emptyProgressMap();
    const nodes: Record<string, MovementNode> = {};
    nodes.ph = node("ph", "pull_h", { difficultyAnchor: 60 });
    nodes.pv = node("pv", "pull_v", { difficultyAnchor: 60 });
    nodes.psh = node("psh", "push_h", { difficultyAnchor: 60 });
    nodes.psv = node("psv", "push_v", { difficultyAnchor: 60 });
    map.pull_h = progress("pull_h", "ph");
    map.pull_v = progress("pull_v", "pv");
    map.push_h = progress("push_h", "psh");
    map.push_v = progress("push_v", "psv");
    // No lower-body rows, no recent sessions → both signals fire.
    const out = runDiagnostics(baseInput({ bwProgressByFamily: map, nodeById: nodes }));
    expect(
      out.some((r) => r.signal.kind === "aesthetics_drift_upper_strong"),
    ).toBe(true);
    expect(out.some((r) => r.signal.kind === "hinge_gap_active")).toBe(true);
  });
});
