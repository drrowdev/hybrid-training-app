/**
 * Methodology regression guard — classify the REAL seed catalog into the three
 * 5/3/1 assistance slots and assert the buckets match Wendler's intent:
 *   - Push  = pressing + chest/shoulder/triceps isolation
 *   - Pull  = rows / pulldowns / chins / curls (must train lats or biceps)
 *   - Single-leg / core = unilateral lower + trunk/ab work + carries
 *
 * These caught two real bugs during the ADR 0047 build: unilateral rows leaking
 * into core (via the over-broad anti_rotation role) and rear-delt PREHAB (face
 * pulls, band pull-aparts, shrugs) masquerading as primary pull. Keep them honest.
 */
import { describe, it, expect } from "vitest";
import type { NewMovement } from "@hta/db";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import { classifyAssistanceCandidate, type AssistanceSlot } from "../assistance-resolver";

function toCatalog(m: NewMovement): CatalogMovement {
  return {
    id: m.slug,
    slug: m.slug,
    displayName: m.displayName,
    primaryMuscles: (m.primaryMuscles ?? []) as string[],
    secondaryMuscles: (m.secondaryMuscles ?? []) as string[],
    primaryRegion: m.primaryRegion as string,
    secondaryRegions: (m.secondaryRegions ?? []) as string[],
    bulletproofRoles: (m.bulletproofRoles ?? []) as never,
    functionalRoles: (m.functionalRoles ?? []) as never,
    isSupported: m.isSupported ?? false,
    isCompound: m.isCompound ?? false,
    isLoadable: m.bodyWeightLoaded ?? false,
    eccentricLoadScore: m.eccentricLoadScore ?? null,
    stimToFatigueScore: m.stimToFatigueScore ?? null,
    highStrainTendon: m.highStrainTendon ?? false,
    experienceMin: m.experienceMin ?? 0,
    experienceMax: m.experienceMax ?? 4,
    pattern: m.pattern,
    equipment: m.equipment ?? null,
  };
}

const CATALOG = SEED_MOVEMENTS.map(toCatalog);
const BY_NAME = new Map(CATALOG.map((m) => [m.displayName, m]));
const slotOf = (name: string): AssistanceSlot | null => {
  const m = BY_NAME.get(name);
  if (!m) throw new Error(`seed movement not found: ${name}`);
  return classifyAssistanceCandidate(m);
};

describe("5/3/1 assistance classification — real seed catalog", () => {
  it("puts representative push movements in push", () => {
    for (const n of ["Parallel Bar Dip", "DB Bench Press (flat)", "Tricep Pushdown (rope)", "Standing Overhead Press", "Push-Up"]) {
      expect(slotOf(n), n).toBe("push");
    }
  });

  it("puts real pulls (rows, pulldowns, chins, curls) in pull — including unilateral rows", () => {
    for (const n of ["Chin-Up", "Barbell Row (overhand)", "Lat Pulldown (wide grip)", "Barbell Curl", "Single-Arm DB Row", "Kroc Row", "Meadows Row", "Archer Pull-Up"]) {
      expect(slotOf(n), n).toBe("pull");
    }
  });

  it("puts unilateral lower movements in single_leg", () => {
    for (const n of ["Bulgarian Split Squat (DB)", "Pistol Squat", "Single-Leg RDL"]) {
      expect(slotOf(n), n).toBe("single_leg");
    }
  });

  it("puts trunk movements in core", () => {
    for (const n of ["Plank", "Hanging Leg Raise", "Pallof Press"]) {
      expect(slotOf(n), n).toBe("core");
    }
  });

  it("puts loaded carries in their own carry slot", () => {
    for (const n of ["Farmer Carry (DB)", "Farmer Carry (Trap Bar)"]) {
      expect(slotOf(n), n).toBe("carry");
    }
  });

  it("routes calf isolations to prehab — NOT single_leg (even when named 'Single-Leg')", () => {
    for (const n of ["Standing Calf Raise", "Seated Calf Raise", "Single-Leg Calf Raise"]) {
      expect(slotOf(n), n).toBe("prehab");
    }
  });

  it("does NOT classify rear-delt / scapular PREHAB or shrugs as pull (Wendler treats these as shoulder health)", () => {
    for (const n of ["Face Pull", "Band Pull-Apart", "Y-Raise", "Rear Delt Fly (DB)", "Reverse Pec Deck", "Barbell Shrug"]) {
      expect(slotOf(n), n).not.toBe("pull");
    }
  });

  it("never mis-slots a unilateral row/press into core", () => {
    for (const n of ["Single-Arm DB Row", "Single-Arm Pulldown", "Half-Kneeling Landmine Press", "Z-Press"]) {
      expect(slotOf(n), n).not.toBe("core");
    }
  });

  it("every catalog movement in the pull bucket actually trains lats or biceps", () => {
    const offenders = CATALOG.filter(
      (m) => classifyAssistanceCandidate(m) === "pull" && !m.primaryMuscles.some((mu) => mu === "lats" || mu === "biceps"),
    ).map((m) => m.displayName);
    expect(offenders).toEqual([]);
  });

  it("excludes conditioning / power / drill / tendon / cuff patterns from all buckets", () => {
    const leaked = CATALOG.filter(
      (m) => ["cardio", "olympic", "plyometric", "drill", "tendon", "cuff"].includes(m.pattern ?? "") && classifyAssistanceCandidate(m) !== null,
    ).map((m) => m.displayName);
    expect(leaked).toEqual([]);
  });
});
