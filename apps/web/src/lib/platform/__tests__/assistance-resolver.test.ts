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

  it("classifies single-leg, core and carry into their granular slots", () => {
    expect(
      classifyAssistanceCandidate(mv({ id: "1", slug: "bss", pattern: "squat", functionalRoles: ["single_leg"] as never })),
    ).toBe("single_leg");
    expect(
      classifyAssistanceCandidate(mv({ id: "2", slug: "plank", pattern: "isolation", functionalRoles: ["anti_extension"] as never })),
    ).toBe("core");
    expect(
      classifyAssistanceCandidate(mv({ id: "3", slug: "back-ext", pattern: "hinge", primaryRegion: "lumbar_trunk" })),
    ).toBe("core");
    // name keyword overrides a bilateral squat/hinge pattern
    expect(
      classifyAssistanceCandidate(mv({ id: "4", slug: "lunge", displayName: "Walking Lunge", pattern: "squat" })),
    ).toBe("single_leg");
    // loaded carries get their own slot
    expect(
      classifyAssistanceCandidate(mv({ id: "5", slug: "farmer", displayName: "Farmer Carry", pattern: "carry" })),
    ).toBe("carry");
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

  it("resolves HYROX sub-pools: vertical→pull-up, horizontal→row, overhead→shoulder press, prehab→calf", () => {
    const cat: CatalogMovement[] = [
      mv({ id: "pu", slug: "pull-up", displayName: "Pull-Up (overhand)", pattern: "pull", primaryMuscles: ["lats", "biceps"] }),
      mv({ id: "rw", slug: "bb-row", displayName: "Barbell Row (overhand)", pattern: "pull", primaryMuscles: ["lats", "mid_back"] }),
      mv({ id: "ohp", slug: "ohp", displayName: "Standing Overhead Press", pattern: "press", primaryMuscles: ["front_delts", "triceps"] }),
      mv({ id: "bench", slug: "bench", displayName: "Bench Press (flat)", pattern: "press", primaryMuscles: ["chest", "triceps"] }),
      mv({ id: "calf", slug: "calf", displayName: "Standing Calf Raise", pattern: "isolation", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
    ];
    const planner = buildAssistancePlanner({ catalog: cat, filters: { blockedRegions: new Set() } });
    const s = planner("ref-1");
    expect(s("pull_vertical", 0)!.movementId).toBe("pu"); // pull-up, not row
    expect(s("pull_horizontal", 1)!.movementId).toBe("rw"); // row, not pull-up
    expect(s("push_overhead", 2)!.movementId).toBe("ohp"); // OHP, never bench
    expect(s("prehab", 3)!.movementId).toBe("calf");
  });

  it("HYROX sub-pools fall back to the general pool when the specific variant is unavailable", () => {
    // Only a row exists (no vertical pull) and only a bench (no overhead press).
    const cat: CatalogMovement[] = [
      mv({ id: "rw", slug: "row", displayName: "DB Row", pattern: "pull", primaryMuscles: ["lats"] }),
      mv({ id: "bench", slug: "bench", displayName: "Bench Press", pattern: "press", primaryMuscles: ["chest"] }),
    ];
    const planner = buildAssistancePlanner({ catalog: cat, filters: { blockedRegions: new Set() } });
    const s = planner("ref-1");
    expect(s("pull_vertical", 0)!.movementId).toBe("rw"); // falls back to the row
    expect(s("push_overhead", 1)!.movementId).toBe("bench"); // falls back to the bench
  });

  it("5/3/1's single_leg_or_core union still includes calf prehab (pool unchanged)", () => {
    const cat: CatalogMovement[] = [
      mv({ id: "bss", slug: "bss", displayName: "Bulgarian Split Squat", pattern: "squat", functionalRoles: ["single_leg"] as never }),
      mv({ id: "calf", slug: "calf", displayName: "Standing Calf Raise", pattern: "isolation", primaryMuscles: ["calves"], primaryRegion: "foot_ankle_calf" }),
    ];
    const planner = buildAssistancePlanner({ catalog: cat, filters: { blockedRegions: new Set() } });
    const s = planner("ref-1");
    // Both the unilateral lower AND the calf are reachable via the 5/3/1 union.
    const picks = new Set([s("single_leg_or_core", 0)?.movementId, s("single_leg_or_core", 1)?.movementId]);
    expect(picks).toContain("bss");
    expect(picks).toContain("calf");
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

  // Isolate the GATE from F1 ranking: test each movement ALONE so selection
  // ranking can't suppress it — if it's eligible it's the only pick, otherwise
  // the slot is empty.
  function eligibleAlone(
    id: string,
    experience: Parameters<typeof buildAssistancePlanner>[0]["experience"],
  ): boolean {
    const only = TIERED_PULL.filter((m) => m.id === id);
    const planner = buildAssistancePlanner({ catalog: only, filters: { blockedRegions: new Set() }, experience });
    return planner("ref")("pull", 0)?.movementId === id;
  }

  it("beginner (tier 0): only the staple is eligible; both skill variants gated out", () => {
    expect(eligibleAlone("staple", "beginner_lt_6m")).toBe(true);
    expect(eligibleAlone("skill2", "beginner_lt_6m")).toBe(false);
    expect(eligibleAlone("skill3", "beginner_lt_6m")).toBe(false);
  });

  it("novice (tier 1) still gates out the min-2 and min-3 variants", () => {
    expect(eligibleAlone("skill2", "novice_6m_2y")).toBe(false);
    expect(eligibleAlone("skill3", "novice_6m_2y")).toBe(false);
  });

  it("intermediate (tier 2) unlocks the min-2 variant but not min-3", () => {
    expect(eligibleAlone("skill2", "intermediate_2y_5y")).toBe(true);
    expect(eligibleAlone("skill3", "intermediate_2y_5y")).toBe(false);
  });

  it("advanced (tier 3) makes every variant eligible, staple included", () => {
    expect(eligibleAlone("staple", "advanced_5y_10y")).toBe(true);
    expect(eligibleAlone("skill2", "advanced_5y_10y")).toBe(true);
    expect(eligibleAlone("skill3", "advanced_5y_10y")).toBe(true);
  });

  it("null experience gates nothing — every variant is eligible", () => {
    for (const id of ["staple", "skill2", "skill3"]) {
      expect(eligibleAlone(id, null)).toBe(true);
      expect(eligibleAlone(id, undefined)).toBe(true);
    }
  });
});

describe("buildAssistancePlanner — F1 staples-first ranking", () => {
  // A pull slot with one universal staple (band 0) and two niche variants
  // (band 2 / 3). All eligible for an advanced lifter — F1 must still lead with
  // the staple, never the niche.
  const POOL_F1: CatalogMovement[] = [
    mv({ id: "staple", slug: "db-row-single-arm", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 0 }),
    mv({ id: "niche2", slug: "meadows-row", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 2 }),
    mv({ id: "niche3", slug: "kroc-row", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 3 }),
  ];

  function pickCounts(experience: Parameters<typeof buildAssistancePlanner>[0]["experience"]) {
    const planner = buildAssistancePlanner({ catalog: POOL_F1, filters: { blockedRegions: new Set() }, experience });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      const id = planner(`ref-${i}`)("pull", 0)!.movementId;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }

  it("advanced lifter overwhelmingly gets the foundational staple, not the niche rows", () => {
    const c = pickCounts("advanced_5y_10y");
    // The staple dominates; the niche variants are heavily suppressed.
    expect(c.staple ?? 0).toBeGreaterThan(55);
    expect((c.niche2 ?? 0) + (c.niche3 ?? 0)).toBeLessThan(5);
  });

  it("never prefers a higher-band (more advanced) variant over the staple", () => {
    const c = pickCounts("highly_advanced_10y_plus");
    expect(c.staple ?? 0).toBeGreaterThan((c.niche2 ?? 0) + (c.niche3 ?? 0));
  });

  it("rotates freely among EQUALLY-foundational staples (no single fixed pick)", () => {
    const equalStaples: CatalogMovement[] = [
      mv({ id: "a", slug: "chin-up", pattern: "pull", primaryMuscles: ["lats", "biceps"], experienceMin: 0 }),
      mv({ id: "b", slug: "bb-row", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 0 }),
      mv({ id: "c", slug: "cable-row", pattern: "pull", primaryMuscles: ["lats"], experienceMin: 0 }),
    ];
    const planner = buildAssistancePlanner({ catalog: equalStaples, filters: { blockedRegions: new Set() } });
    const picks = new Set(
      Array.from({ length: 12 }, (_, i) => planner(`r-${i}`)("pull", 0)!.movementId),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});

// Guard against accidental enum drift.
const _slots: AssistanceSlot[] = ["push", "pull", "single_leg", "core", "carry"];
void _slots;
