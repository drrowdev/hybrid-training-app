/**
 * ADR 0027 Lever B — synergist credit redirects the aesthetic gap-fill toward
 * genuinely under-trained muscles, without changing item count or total set
 * volume (redirect-only).
 */
import { describe, expect, it } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import {
  MAIN_LIFT_NOMINAL_SETS,
  SYNERGIST_CREDIT,
  computeWeeklyCompoundCredit,
} from "../synergist-credit";
import type { Archetype, DayTemplate, StrengthRole } from "../archetypes";
import type { AccessoryProfile } from "../accessory-roles";

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "shoulder_scapular",
    secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [],
    functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? false,
    isCompound: over.isCompound ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
  };
}

function strengthDay(role: StrengthRole, secondaryRole?: StrengthRole): DayTemplate {
  return {
    kind: "strength",
    dayIndex: 0,
    role,
    title: role,
    candidateSlugs: [],
    priority: "anchor",
    rank: 0,
    ...(secondaryRole ? { secondaryRole } : {}),
  } as DayTemplate;
}

function archetypeWithDays(days: DayTemplate[]): Archetype {
  return { days } as unknown as Archetype;
}

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 6, setsPerItem: 3, repRange: { min: 10, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

describe("computeWeeklyCompoundCredit", () => {
  it("sums role credit × nominal sets across the week's strength days", () => {
    const arch = archetypeWithDays([
      strengthDay("horizontal_press"),
      strengthDay("horizontal_press"),
      strengthDay("deadlift"),
    ]);
    const credit = computeWeeklyCompoundCredit(arch);
    // triceps: 2 bench days × 0.5 × 3 = 3
    expect(credit.get("triceps")).toBeCloseTo(2 * SYNERGIST_CREDIT.horizontal_press.triceps! * MAIN_LIFT_NOMINAL_SETS);
    expect(credit.get("triceps")).toBeCloseTo(3);
    // forearms: 1 deadlift × 0.5 × 3 = 1.5
    expect(credit.get("forearms")).toBeCloseTo(1.5);
  });

  it("counts secondaryRole on dual-main-lift days", () => {
    const arch = archetypeWithDays([strengthDay("squat", "horizontal_press")]);
    const credit = computeWeeklyCompoundCredit(arch);
    // triceps comes ONLY from the secondary horizontal_press: 0.5 × 3 = 1.5
    expect(credit.get("triceps")).toBeCloseTo(1.5);
  });

  it("never credits biceps, rear_delts or calves (no main lift trains them)", () => {
    const arch = archetypeWithDays([
      strengthDay("squat"),
      strengthDay("horizontal_press"),
      strengthDay("deadlift"),
      strengthDay("vertical_press"),
    ]);
    const credit = computeWeeklyCompoundCredit(arch);
    expect(credit.get("biceps")).toBeUndefined();
    expect(credit.get("rear_delts")).toBeUndefined();
    expect(credit.get("calves")).toBeUndefined();
  });
});

describe("ADR 0027 Lever B — aesthetic gap-fill redirect", () => {
  const TRI_ISO = mv({ id: "t1", slug: "tri-pushdown", primaryMuscles: ["triceps"], isCompound: false, stimToFatigueScore: 3 });
  const REAR_ISO = mv({ id: "r1", slug: "rear-fly", primaryMuscles: ["rear_delts"], isCompound: false, stimToFatigueScore: 3 });

  it("without credit, the first-listed equal-gap muscle (triceps) is filled first", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [TRI_ISO, REAR_ISO],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { triceps: 6, rear_delts: 6 },
      maxItems: 8,
    });
    const aesthetic = picks.filter((p) => p.reason === "aesthetic");
    expect(aesthetic[0]!.slug).toBe("tri-pushdown");
  });

  it("WITH credit on triceps, the gap-fill redirects to the uncovered rear_delts first", () => {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: [TRI_ISO, REAR_ISO],
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: { triceps: 6, rear_delts: 6 },
      maxItems: 8,
      compoundCoverageCredit: new Map([["triceps", 4.5]]),
    });
    const aesthetic = picks.filter((p) => p.reason === "aesthetic");
    expect(aesthetic[0]!.slug).toBe("rear-fly");
  });
});

describe("ADR 0027 Lever B — volume-invariant", () => {
  // A broad isolation catalog so the aesthetic budget (cap) binds before the
  // gaps are exhausted — the case where redirect must not change volume.
  const CATALOG: CatalogMovement[] = [
    mv({ id: "sd", slug: "lateral-raise", primaryMuscles: ["side_delts"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "rd", slug: "rear-fly", primaryMuscles: ["rear_delts"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "bi", slug: "db-curl", primaryMuscles: ["biceps"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "tr", slug: "tri-pushdown", primaryMuscles: ["triceps"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "ca", slug: "calf-raise", primaryMuscles: ["calves"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "ab", slug: "cable-crunch", primaryMuscles: ["abs"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "ha", slug: "leg-curl", primaryMuscles: ["hamstrings"], isCompound: false, stimToFatigueScore: 3 }),
    mv({ id: "la", slug: "pulldown", primaryMuscles: ["lats"], isCompound: false, stimToFatigueScore: 3 }),
  ];
  const targets = {
    side_delts: 6, rear_delts: 6, biceps: 6, triceps: 6, calves: 6, abs: 6, hamstrings: 6, lats: 6,
  };

  function aestheticVolume(credit?: Map<string, number>) {
    const picks = pickAccessoriesForSession({
      profile: PROFILE,
      weekDeloadScale: 1.0,
      catalog: CATALOG,
      weekAccessoryHistory: [],
      filters: EMPTY_FILTERS,
      perMuscleTargets: targets,
      maxItems: 3,
      aestheticMaxItems: 3,
      compoundCoverageCredit: credit,
    });
    const aesthetic = picks.filter((p) => p.reason === "aesthetic");
    return { count: aesthetic.length, sets: aesthetic.reduce((s, p) => s + p.sets, 0) };
  }

  it("credit changes WHICH muscle is filled but not item count or total sets", () => {
    const base = aestheticVolume();
    const credited = aestheticVolume(
      new Map([["triceps", 4.5], ["lats", 2.25], ["hamstrings", 1.2]]),
    );
    expect(credited.count).toBe(base.count);
    expect(credited.sets).toBe(base.sets);
    // Budget binds at 3 items → both fill exactly the cap.
    expect(base.count).toBe(3);
  });
});
