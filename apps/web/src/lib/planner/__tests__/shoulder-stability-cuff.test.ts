/**
 * ADR 0035 — shoulder-stability (rotator-cuff) durability for pressers.
 *
 * Verifies the conditional `shoulder_stability` functional requirement in
 * `pickAccessoriesForSession`:
 *   - a pressing block seats a cuff item,
 *   - a non-pressing / default-off block does NOT,
 *   - an already-credited cuff (from history) satisfies the requirement,
 *   - the cuff pick is additive (doesn't evict the existing functional floor).
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

const CATALOG: CatalogMovement[] = [
  // Cuff candidates tagged with a NON-aesthetic primary muscle so they can only
  // enter via the shoulder_stability functional requirement (not the rear-delt
  // aesthetic gap-fill) — isolates the ADR 0035 behaviour under test.
  mv({ id: "cuff1", slug: "external-rotation-band", functionalRoles: ["shoulder_stability"], primaryRegion: "shoulder_scapular", primaryMuscles: ["rotator_cuff"] }),
  mv({ id: "cuff2", slug: "prone-y-raise", functionalRoles: ["shoulder_stability"], primaryRegion: "shoulder_scapular", primaryMuscles: ["rotator_cuff"] }),
  mv({ id: "hip1", slug: "hip-abduction", functionalRoles: ["hip_stabilizer"], primaryRegion: "hip_pelvis", primaryMuscles: ["glutes"] }),
  // An aesthetic filler so there's always something for leftover budget.
  mv({ id: "lr1", slug: "lateral-raise", functionalRoles: [], primaryRegion: "shoulder_scapular", primaryMuscles: ["side_delts"] }),
];

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 1, setsPerItem: 3, repRange: { min: 12, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: { hip_stabilizer: 1 } },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

type Hist = Parameters<typeof pickAccessoriesForSession>[0]["weekAccessoryHistory"];

function run(opts: { history?: Hist; pressingMainLift?: boolean }) {
  return pickAccessoriesForSession({
    profile: PROFILE,
    weekDeloadScale: 1.0,
    catalog: CATALOG,
    weekAccessoryHistory: opts.history ?? [],
    filters: EMPTY_FILTERS,
    perMuscleTargets: defaultMuscleTargets().targetsByMuscle,
    maxItems: 6,
    pressingMainLift: opts.pressingMainLift,
  });
}

const hasCuff = (picks: ReturnType<typeof pickAccessoriesForSession>) =>
  picks.some((p) => /rotation|prone-/.test(p.slug));
const hasHip = (picks: ReturnType<typeof pickAccessoriesForSession>) =>
  picks.some((p) => p.slug === "hip-abduction");

describe("durability floor — shoulder-stability for pressers (ADR 0035)", () => {
  it("a pressing block seats a cuff (shoulder_stability) item", () => {
    expect(hasCuff(run({ pressingMainLift: true }))).toBe(true);
  });

  it("default-off (no pressing main lift) does NOT add a cuff item", () => {
    expect(hasCuff(run({ pressingMainLift: false }))).toBe(false);
    expect(hasCuff(run({}))).toBe(false);
  });

  it("the cuff requirement is additive — it doesn't evict the existing functional floor", () => {
    const picks = run({ pressingMainLift: true });
    expect(hasHip(picks)).toBe(true);
    expect(hasCuff(picks)).toBe(true);
  });

  it("an already-credited cuff in the week's history satisfies the requirement (no duplicate)", () => {
    const history: Hist = [
      {
        movementId: "cuff1",
        bulletproofRoles: [],
        functionalRoles: ["shoulder_stability"],
        primaryMuscles: ["rear_delts"],
        sets: 3,
      },
    ];
    const picks = run({ history, pressingMainLift: true });
    // The week already has its cuff work; this day shouldn't add another.
    expect(picks.some((p) => p.movementId === "cuff1" || p.movementId === "cuff2")).toBe(false);
  });
});
