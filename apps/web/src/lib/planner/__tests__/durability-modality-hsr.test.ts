/**
 * ADR 0034 — modality- & pattern-aware durability floor.
 *
 * Verifies the HSR region preferences in `pickAccessoriesForSession`:
 *   - Phase 1: a running-impact block steers its FIRST weekly HSR to the
 *     Achilles/calf region.
 *   - Phase 2: HSR fills not claimed by the running preference prefer the day's
 *     main-lift pattern region (hinge → posterior, squat → knee).
 *   - Soft preference: falls back to any in-role HSR when no region match exists.
 *   - Byte-identical when the new signals are omitted.
 */
import { describe, expect, it } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import { defaultMuscleTargets } from "../focus-muscle-targets";
import type { AccessoryProfile } from "../accessory-roles";

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? [],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "lumbar_trunk",
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

// Three HSR candidates in distinct tendon regions, plus enough floor movements
// to satisfy the rest of DC-O4 so the HSR slot is reached.
const CATALOG: CatalogMovement[] = [
  mv({ id: "hsr-calf", slug: "hsr-calf-raise", bulletproofRoles: ["hsr"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "hsr-knee", slug: "slow-front-squat", bulletproofRoles: ["hsr"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr-hinge", slug: "slow-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["traps"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["traps"] }),
  mv({ id: "plyo1", slug: "pogo-hop", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
];

// Endurance-like profile: 2 weekly HSR (floor 1 + 1 extra), so a week spans two
// HSR fills — enough to see Phase 1 (calf) then Phase 2 (pattern).
const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 0, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [{ role: "hsr", count: 1 }] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

type Hist = Parameters<typeof pickAccessoriesForSession>[0]["weekAccessoryHistory"];

function runDay(opts: {
  history: Hist;
  runningCardio?: boolean;
  dayPrimaryRole?: string;
}) {
  return pickAccessoriesForSession({
    profile: PROFILE,
    weekDeloadScale: 1.0,
    catalog: CATALOG,
    weekAccessoryHistory: opts.history,
    filters: EMPTY_FILTERS,
    perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
    maxItems: 6,
    runningCardio: opts.runningCardio,
    dayPrimaryRole: opts.dayPrimaryRole,
  });
}

function record(history: Hist, picks: ReturnType<typeof pickAccessoriesForSession>) {
  for (const p of picks) {
    const c = CATALOG.find((m) => m.id === p.movementId)!;
    history.push({
      movementId: c.id,
      bulletproofRoles: c.bulletproofRoles,
      functionalRoles: c.functionalRoles,
      primaryMuscles: c.primaryMuscles,
      sets: p.sets,
    });
  }
}

const hsrSlug = (picks: ReturnType<typeof pickAccessoriesForSession>) =>
  picks.find((p) => /hsr|slow/.test(p.slug))?.slug;

describe("durability floor — modality & pattern HSR (ADR 0034)", () => {
  it("Phase 1: a running block takes the calf/Achilles HSR on the first HSR day", () => {
    const history: Hist = [];
    const picks = runDay({ history, runningCardio: true, dayPrimaryRole: "squat" });
    expect(hsrSlug(picks)).toBe("hsr-calf-raise");
  });

  it("Phase 2 (after Phase 1): the second weekly HSR follows the day's pattern (hinge → RDL)", () => {
    const history: Hist = [];
    record(history, runDay({ history, runningCardio: true, dayPrimaryRole: "squat" }));
    // Second strength day — deadlift pattern; calf already taken last session.
    const picks2 = runDay({ history, runningCardio: true, dayPrimaryRole: "deadlift" });
    expect(hsrSlug(picks2)).toBe("slow-rdl");
  });

  it("Phase 2 (no running): squat day prefers knee HSR, deadlift day distributes to calf (ADR 0042 — no redundant axial-hinge RDL)", () => {
    const squatPicks = runDay({ history: [], runningCardio: false, dayPrimaryRole: "squat" });
    expect(hsrSlug(squatPicks)).toBe("slow-front-squat");

    // ADR 0042 — the deadlift main already maxes the posterior chain, so its
    // durability HSR distributes to a distinct tendon (calf/Achilles) instead of
    // stacking a second axial hinge (RDL).
    const hingePicks = runDay({ history: [], runningCardio: false, dayPrimaryRole: "deadlift" });
    expect(hsrSlug(hingePicks)).toBe("hsr-calf-raise");
    expect(hsrSlug(hingePicks)).not.toBe("slow-rdl");
  });

  it("soft preference: falls back to an in-role HSR when no region match exists (press day, no shoulder HSR)", () => {
    const picks = runDay({ history: [], runningCardio: false, dayPrimaryRole: "vertical_press" });
    // No shoulder-region HSR in the catalog → still fills the HSR slot.
    expect(hsrSlug(picks)).toBeDefined();
  });

  it("byte-identical when the new signals are omitted (deterministic catalog-order pick)", () => {
    const without = runDay({ history: [] });
    const alsoWithout = runDay({ history: [] });
    expect(hsrSlug(without)).toBe(hsrSlug(alsoWithout));
    // With no preference the first-in-catalog HSR (hsr-calf-raise) wins by order.
    expect(hsrSlug(without)).toBe("hsr-calf-raise");
  });
});
