import { describe, it, expect } from "vitest";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import { COMMERCIAL_GYM_PRESET, BODYWEIGHT_ONLY_PRESET } from "@/lib/settings/equipment-presets";
import {
  classifyAssistanceCandidate,
  buildAssistancePlanner,
  type AssistanceSlot,
} from "../assistance-resolver";

/** Minimal CatalogMovement factory — only the fields the resolver reads matter. */
function mv(partial: Partial<CatalogMovement> & { id: string; slug: string; pattern: string }): CatalogMovement {
  return {
    displayName: partial.slug,
    primaryMuscles: [],
    secondaryMuscles: [],
    primaryRegion: "",
    secondaryRegions: [],
    bulletproofRoles: [],
    functionalRoles: [],
    isSupported: true,
    isCompound: false,
    isLoadable: false,
    eccentricLoadScore: null,
    stimToFatigueScore: null,
    highStrainTendon: false,
    experienceMin: 0,
    experienceMax: 4,
    equipment: "bodyweight",
    ...partial,
  } as CatalogMovement;
}

describe("classifyAssistanceCandidate", () => {
  it("classifies press pattern as push", () => {
    expect(classifyAssistanceCandidate(mv({ id: "1", slug: "dip", pattern: "press" }))).toBe("push");
  });

  it("classifies triceps isolation as push, biceps isolation as pull", () => {
    expect(
      classifyAssistanceCandidate(mv({ id: "1", slug: "pushdown", pattern: "isolation", primaryMuscles: ["triceps"] })),
    ).toBe("push");
    expect(
      classifyAssistanceCandidate(mv({ id: "2", slug: "curl", pattern: "isolation", primaryMuscles: ["biceps"] })),
    ).toBe("pull");
  });

  it("does not slot a grip-only (forearms) isolation as pull", () => {
    // Captains of Crush etc. give no back/biceps stimulus → unclassified, not pull.
    expect(
      classifyAssistanceCandidate(mv({ id: "1", slug: "gripper", pattern: "isolation", primaryMuscles: ["forearms"] })),
    ).toBeNull();
    // a hammer curl is still pull via its biceps primary
    expect(
      classifyAssistanceCandidate(
        mv({ id: "2", slug: "hammer-curl", pattern: "isolation", primaryMuscles: ["biceps", "forearms"] }),
      ),
    ).toBe("pull");
  });

  it("classifies pull pattern and pull-tagged movements as pull", () => {
    expect(classifyAssistanceCandidate(mv({ id: "1", slug: "row", pattern: "pull", primaryMuscles: ["lats"] }))).toBe("pull");
    expect(
      classifyAssistanceCandidate(
        mv({ id: "2", slug: "chinup", pattern: "squat", primaryMuscles: ["lats"], functionalRoles: ["pull"] as never }),
      ),
    ).toBe("pull");
  });

  it("keeps a unilateral row in pull, not core (anti_rotation role must not win)", () => {
    // deriveAccessoryRoles tags every unilateral press/pull/carry as anti_rotation;
    // a single-arm row is still a PULL.
    expect(
      classifyAssistanceCandidate(
        mv({
          id: "1",
          slug: "single-arm-db-row",
          displayName: "Single-Arm DB Row",
          pattern: "pull",
          primaryMuscles: ["lats", "mid_back", "biceps"],
          functionalRoles: ["anti_rotation"] as never,
        }),
      ),
    ).toBe("pull");
  });

  it("does NOT treat rear-delt / scapular prehab as a pull (face pull, band pull-apart)", () => {
    // Face Pull is `pull` pattern but trains only rear delts → not primary pull.
    expect(
      classifyAssistanceCandidate(
        mv({ id: "1", slug: "face-pull", displayName: "Face Pull", pattern: "pull", primaryMuscles: ["rear_delts", "mid_back"] }),
      ),
    ).toBeNull();
    // Band Pull-Apart is a rear-delt isolation → not pull.
    expect(
      classifyAssistanceCandidate(
        mv({ id: "2", slug: "band-pull-apart", displayName: "Band Pull-Apart", pattern: "isolation", primaryMuscles: ["rear_delts", "mid_back"] }),
      ),
    ).toBeNull();
    // Shrug (traps only) → not pull.
    expect(
      classifyAssistanceCandidate(mv({ id: "3", slug: "shrug", displayName: "Barbell Shrug", pattern: "isolation", primaryMuscles: ["traps"] })),
    ).toBeNull();
  });

  it("classifies single-leg + core as single_leg_or_core", () => {
    expect(
      classifyAssistanceCandidate(mv({ id: "1", slug: "bss", pattern: "squat", functionalRoles: ["single_leg"] as never })),
    ).toBe("single_leg_or_core");
    expect(
      classifyAssistanceCandidate(mv({ id: "2", slug: "plank", pattern: "isolation", functionalRoles: ["anti_extension"] as never })),
    ).toBe("single_leg_or_core");
    expect(
      classifyAssistanceCandidate(mv({ id: "3", slug: "back-ext", pattern: "hinge", primaryRegion: "lumbar_trunk" })),
    ).toBe("single_leg_or_core");
    // name keyword overrides a bilateral squat/hinge pattern
    expect(
      classifyAssistanceCandidate(mv({ id: "4", slug: "lunge", displayName: "Walking Lunge", pattern: "squat" })),
    ).toBe("single_leg_or_core");
  });

  it("returns null for excluded patterns and unclassifiable movements", () => {
    expect(classifyAssistanceCandidate(mv({ id: "1", slug: "run", pattern: "cardio" }))).toBeNull();
    expect(classifyAssistanceCandidate(mv({ id: "2", slug: "clean", pattern: "olympic" }))).toBeNull();
    // bilateral back squat: squat pattern, no core/single-leg signal → not assistance
    expect(
      classifyAssistanceCandidate(mv({ id: "3", slug: "squat", pattern: "squat", primaryMuscles: ["quads", "glutes"] })),
    ).toBeNull();
  });
});

const POOL: CatalogMovement[] = [
  mv({ id: "p1", slug: "dip", pattern: "press" }),
  mv({ id: "p2", slug: "incline-db-press", pattern: "press" }),
  mv({ id: "p3", slug: "pushup", pattern: "press" }),
  mv({ id: "l1", slug: "chinup", pattern: "pull", primaryMuscles: ["lats", "biceps"] }),
  mv({ id: "l2", slug: "row-db", pattern: "pull", primaryMuscles: ["lats", "mid_back"] }),
  mv({ id: "l3", slug: "curl", pattern: "isolation", primaryMuscles: ["biceps"] }),
  mv({ id: "s1", slug: "bss", pattern: "squat", functionalRoles: ["single_leg"] as never }),
  mv({ id: "s2", slug: "plank", pattern: "isolation", functionalRoles: ["anti_extension"] as never }),
  mv({ id: "s3", slug: "hanging-leg-raise", pattern: "isolation", primaryMuscles: ["abs"] }),
];

describe("buildAssistancePlanner", () => {
  it("resolves each category to a movement of that category", () => {
    const planner = buildAssistancePlanner({ catalog: POOL, filters: { blockedRegions: new Set() } });
    const session = planner("s0-c1-w1-squat");
    const push = session("push", 0);
    const pull = session("pull", 1);
    const legs = session("single_leg_or_core", 2);
    expect(["p1", "p2", "p3"]).toContain(push!.movementId);
    expect(["l1", "l2", "l3"]).toContain(pull!.movementId);
    expect(["s1", "s2", "s3"]).toContain(legs!.movementId);
  });

  it("is deterministic for the same session ref + slot", () => {
    const planner = buildAssistancePlanner({ catalog: POOL, filters: { blockedRegions: new Set() } });
    const a = planner("ref-A")("push", 0);
    const b = planner("ref-A")("push", 0);
    expect(a!.movementId).toBe(b!.movementId);
  });

  it("rotates across sessions (not every session picks the same push)", () => {
    const planner = buildAssistancePlanner({ catalog: POOL, filters: { blockedRegions: new Set() } });
    const picks = new Set(
      ["r1", "r2", "r3", "r4", "r5", "r6"].map((ref) => planner(ref)("push", 0)!.movementId),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("does not repeat a movement across slots within one session when the pool allows", () => {
    const planner = buildAssistancePlanner({ catalog: POOL, filters: { blockedRegions: new Set() } });
    const session = planner("ref-dedup");
    const a = session("push", 0)!.movementId;
    const b = session("push", 1)!.movementId;
    const c = session("push", 2)!.movementId;
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("excludes the anchored main lifts", () => {
    const planner = buildAssistancePlanner({
      catalog: POOL,
      filters: { blockedRegions: new Set() },
      excludeMovementIds: new Set(["p1", "p2", "p3"]),
    });
    expect(planner("ref")("push", 0)).toBeUndefined();
  });

  it("drops movements that load a blocked region", () => {
    const catalog: CatalogMovement[] = [
      mv({ id: "p1", slug: "dip", pattern: "press", primaryRegion: "shoulder_scapular" }),
    ];
    const planner = buildAssistancePlanner({
      catalog,
      filters: { blockedRegions: new Set(["shoulder_scapular"]) },
    });
    expect(planner("ref")("push", 0)).toBeUndefined();
  });

  it("respects equipment availability (bodyweight-only drops a cable movement)", () => {
    const catalog: CatalogMovement[] = [
      mv({ id: "cab", slug: "cable-row", pattern: "pull", primaryMuscles: ["lats"], equipment: "cable" }),
      mv({ id: "bw", slug: "pullup", pattern: "pull", primaryMuscles: ["lats", "biceps"], equipment: "bodyweight" }),
    ];
    const planner = buildAssistancePlanner({
      catalog,
      equipment: BODYWEIGHT_ONLY_PRESET,
      filters: { blockedRegions: new Set() },
    });
    // Only the bodyweight pull survives (no cable station in a bodyweight setup).
    const picks = new Set(["a", "b", "c", "d"].map((r) => planner(r)("pull", 0)!.movementId));
    expect(picks).toEqual(new Set(["bw"]));
  });

  it("returns undefined for a category with no candidates", () => {
    const planner = buildAssistancePlanner({
      catalog: [mv({ id: "p1", slug: "dip", pattern: "press" })],
      equipment: COMMERCIAL_GYM_PRESET,
      filters: { blockedRegions: new Set() },
    });
    expect(planner("ref")("pull", 0)).toBeUndefined();
  });
});

describe("buildAssistancePlanner — experience unlock floor", () => {
  // A pull slot with a universal staple (tier 0-4), an intermediate-only
  // variant (min 2) and an advanced-only variant (min 3). The staple must
  // survive at EVERY tier; skill variants only unlock as the tier rises.
  const TIERED_PULL: CatalogMovement[] = [
    mv({ id: "staple", slug: "db-row-single-arm", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 0 }),
    mv({ id: "skill2", slug: "meadows-row", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 2 }),
    mv({ id: "skill3", slug: "archer-pull-up", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 3 }),
  ];

  function pullPicks(experience: Parameters<typeof buildAssistancePlanner>[0]["experience"]): Set<string> {
    const planner = buildAssistancePlanner({
      catalog: TIERED_PULL,
      filters: { blockedRegions: new Set() },
      experience,
    });
    // Sample many refs so the uniform rotation surfaces the whole eligible pool.
    return new Set(
      Array.from({ length: 40 }, (_, i) => planner(`ref-${i}`)("pull", 0)?.movementId).filter(Boolean) as string[],
    );
  }

  it("beginner (tier 0) sees only the universal staple — no skill variants", () => {
    expect(pullPicks("beginner_lt_6m")).toEqual(new Set(["staple"]));
  });

  it("novice (tier 1) still excludes the min-2 and min-3 variants", () => {
    expect(pullPicks("novice_6m_2y")).toEqual(new Set(["staple"]));
  });

  it("intermediate (tier 2) unlocks the min-2 variant but not min-3", () => {
    expect(pullPicks("intermediate_2y_5y")).toEqual(new Set(["staple", "skill2"]));
  });

  it("advanced (tier 3) keeps the staple AND unlocks every variant", () => {
    const picks = pullPicks("advanced_5y_10y");
    expect(picks.has("staple")).toBe(true); // north-star: staple never stripped
    expect(picks).toEqual(new Set(["staple", "skill2", "skill3"]));
  });

  it("highly-advanced (tier 4) never strips the staple", () => {
    expect(pullPicks("highly_advanced_10y_plus").has("staple")).toBe(true);
  });

  it("null experience is byte-identical to no gate (full pool, no filtering)", () => {
    expect(pullPicks(null)).toEqual(new Set(["staple", "skill2", "skill3"]));
    expect(pullPicks(undefined)).toEqual(new Set(["staple", "skill2", "skill3"]));
  });
});

// Guard against accidental enum drift.
const _slots: AssistanceSlot[] = ["push", "pull", "single_leg_or_core"];
void _slots;
