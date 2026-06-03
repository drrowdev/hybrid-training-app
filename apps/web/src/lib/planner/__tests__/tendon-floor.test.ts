/**
 * Tendon-floor guarantee — cross-archetype CI invariant (ADR 0024 addendum).
 *
 * Locks the promise that the engine ALWAYS ships the DC-O4 weekly
 * connective-tissue floor (heavy isometric, HSR, plyometric, 2× carry) for
 * every archetype × frequency × accessory-volume level × week, across the
 * experienced, beginner-ramp and tendinopathy contexts — so the Low/Med/High
 * volume lever (or any future engine change) can never silently drop below it.
 *
 * The driver mirrors the production week-assembly path (foldDualMainLifts →
 * assemblePrescriptionItems with the real 22-arg signature and a shared
 * weekAccessoryHistory) and checks the materialised week against the
 * context-aware floor from `tendon-floor.ts`. Plyometrics are clinically
 * suppressed for beginner/novice and tendinopathy contexts, so those contexts
 * are held to the non-plyometric floor only — exactly what the picker delivers.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  REBUILD,
  HYPERTROPHY_ANCHOR,
  CONCURRENT_HYBRID,
  MAINTENANCE,
  daysForFrequency,
  minDaysForArchetype,
  maxDaysForArchetype,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import { foldDualMainLifts } from "../main-lift-folding";
import { assemblePrescriptionItems } from "../assemble-prescription";
import type { CatalogMovement } from "../accessory-picker";
import type { AccessoryVolumeLevel } from "../accessory-volume";
import type { LimitationsContext } from "../limitations-context";
import type { DeclaredExperience } from "@hta/engine";
import type { PrescriptionItem } from "@hta/db";
import { type BulletproofRole } from "../accessory-roles";
import {
  contextualFloor,
  countFloorRoles,
  checkTendonFloor,
  emptyFloorCount,
  type FloorContext,
} from "../tendon-floor";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };
const SECONDARY = { id: "s", slug: "s-slug", displayName: "Secondary" };

// Rich catalog: multiple candidates for EVERY bulletproof role so the binding
// constraint is the engine budget/ordering, NOT fixture poverty. Plus an
// aesthetic spread, plus the rebuild tendon-day slugs tagged hsr.
const AESTHETIC_MUSCLES: { muscle: string; region: string }[] = [
  { muscle: "side_delts", region: "shoulder_scapular" },
  { muscle: "rear_delts", region: "shoulder_scapular" },
  { muscle: "biceps", region: "elbow_forearm" },
  { muscle: "triceps", region: "elbow_forearm" },
  { muscle: "calves", region: "foot_ankle_calf" },
  { muscle: "hamstrings", region: "hip_glute" },
];

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    displayName: over.slug,
    primaryMuscles: [],
    secondaryMuscles: [],
    primaryRegion: "lumbar_trunk",
    secondaryRegions: [],
    bulletproofRoles: [],
    functionalRoles: [],
    isSupported: false,
    isCompound: false,
    eccentricLoadScore: null,
    stimToFatigueScore: null,
    highStrainTendon: false,
    ...over,
  } as CatalogMovement;
}

const BULLETPROOF_CATALOG: CatalogMovement[] = [
  mv({ id: "iso1", slug: "wall-sit", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "iso2", slug: "spanish-squat-hold", bulletproofRoles: ["heavy_isometric"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr1", slug: "tempo-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "hsr2", slug: "tempo-calf", bulletproofRoles: ["hsr"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "hsr3", slug: "hsr-leg-press", bulletproofRoles: ["hsr"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "hsr4", slug: "hsr-rdl", bulletproofRoles: ["hsr"], primaryRegion: "hamstring_posterior", primaryMuscles: ["hamstrings"] }),
  mv({ id: "plyo1", slug: "pogo-hops", bulletproofRoles: ["plyometric_low"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "plyo2", slug: "box-jump", bulletproofRoles: ["plyometric_high"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "carry1", slug: "farmer-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["forearms"] }),
  mv({ id: "carry2", slug: "suitcase-carry", bulletproofRoles: ["carry"], functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["obliques"] }),
  mv({ id: "carry3", slug: "front-rack-carry", bulletproofRoles: ["carry"], primaryRegion: "lumbar_trunk", primaryMuscles: ["abs"] }),
  // functional-role candidates the archetypes ask for
  mv({ id: "sl1", slug: "split-squat", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["quads"] }),
  mv({ id: "sl2", slug: "step-up", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["glutes"] }),
  mv({ id: "hip1", slug: "hip-airplane", functionalRoles: ["hip_stabilizer"], primaryRegion: "hip_glute", primaryMuscles: ["glutes"] }),
  mv({ id: "hip2", slug: "monster-walk", functionalRoles: ["hip_stabilizer"], primaryRegion: "hip_glute", primaryMuscles: ["glutes"] }),
  mv({ id: "af1", slug: "tib-raise", functionalRoles: ["ankle_foot"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "af2", slug: "heel-walk", functionalRoles: ["ankle_foot"], primaryRegion: "foot_ankle_calf", primaryMuscles: ["calves"] }),
  mv({ id: "ar1", slug: "pallof-press", functionalRoles: ["anti_rotation"], primaryRegion: "lumbar_trunk", primaryMuscles: ["abs"] }),
  mv({ id: "lm1", slug: "loaded-cossack", functionalRoles: ["loaded_mobility"], primaryRegion: "hip_glute", primaryMuscles: ["adductors"] }),
];

const AESTHETIC_CATALOG: CatalogMovement[] = AESTHETIC_MUSCLES.flatMap(({ muscle, region }) =>
  [0, 1].map((n) =>
    mv({ id: `${muscle}-${n}`, slug: `${muscle}-mv-${n}`, primaryMuscles: [muscle], primaryRegion: region }),
  ),
);

const CATALOG = [...BULLETPROOF_CATALOG, ...AESTHETIC_CATALOG];
const ROLE_BY_SLUG: ReadonlyMap<string, readonly BulletproofRole[]> = new Map(
  CATALOG.map((m) => [m.slug, m.bulletproofRoles]),
);

const ALL: { name: string; archetype: Archetype }[] = [
  { name: "strength_anchor", archetype: STRENGTH_ANCHOR },
  { name: "endurance_anchor", archetype: ENDURANCE_ANCHOR },
  { name: "rebuild", archetype: REBUILD },
  { name: "hypertrophy_anchor", archetype: HYPERTROPHY_ANCHOR },
  { name: "concurrent_hybrid", archetype: CONCURRENT_HYBRID },
  { name: "maintenance", archetype: MAINTENANCE },
];

const LEVELS: AccessoryVolumeLevel[] = ["low", "medium", "high"];

function limitations(tendinopathyActive: boolean): LimitationsContext {
  return {
    blockedRegions: new Set(),
    blockedMuscles: new Set(),
    blockedMovementIds: new Set(),
    allowedMovementIds: new Set(),
    tendinopathyActive,
  };
}

/** Materialise one full week and collect its accessory + tendon items. */
function weekItems(
  archetype: Archetype,
  freq: number,
  level: AccessoryVolumeLevel,
  weekIndex: number,
  experience: DeclaredExperience | null,
  tendinopathyActive: boolean,
): PrescriptionItem[] {
  const activeDays = foldDualMainLifts(archetype, daysForFrequency(archetype, freq, false));
  const weekAccessoryHistory: {
    movementId: string;
    bulletproofRoles: BulletproofRole[];
    functionalRoles: never[];
    primaryMuscles: string[];
    sets: number;
  }[] = [];
  const movementBySlug = new Map<string, { id: string; slug: string; display_name: string }>();
  for (const d of activeDays) {
    if (d.kind === "tendon") movementBySlug.set(d.movementSlug, { id: d.movementSlug, slug: d.movementSlug, display_name: d.movementSlug });
  }
  const ctx = limitations(tendinopathyActive);
  const collected: PrescriptionItem[] = [];
  for (const day of activeDays) {
    if (day.kind === "cardio") continue;
    let movement = PRIMARY;
    let secondaryMovement: typeof SECONDARY | undefined;
    if (day.kind === "strength") {
      if ((day as StrengthDay).secondaryRole) secondaryMovement = SECONDARY;
    } else if (day.kind === "tendon") {
      movement = { id: day.movementSlug, slug: day.movementSlug, displayName: day.movementSlug };
    }
    const items = assemblePrescriptionItems(
      archetype,
      weekIndex,
      day,
      movement,
      undefined,
      movementBySlug,
      CATALOG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      weekAccessoryHistory as any,
      1.0,
      false,
      undefined,
      undefined,
      false,
      experience,
      ctx,
      secondaryMovement,
      [],
      1.0,
      new Set(),
      "standard",
      "none",
      level,
    );
    collected.push(...items);
  }
  return collected;
}

describe("tendon-floor guarantee — DC-O4 weekly floor invariant", () => {
  const contexts: { label: string; experience: DeclaredExperience | null; tendinopathy: boolean }[] = [
    { label: "experienced", experience: null, tendinopathy: false },
    { label: "beginner ramp", experience: "beginner_lt_6m", tendinopathy: false },
    { label: "tendinopathy active", experience: null, tendinopathy: true },
  ];

  for (const { label, experience, tendinopathy } of contexts) {
    describe(label, () => {
      for (const { name, archetype } of ALL) {
        const min = minDaysForArchetype(archetype);
        const max = maxDaysForArchetype(archetype, false);
        for (let freq = min; freq <= max; freq++) {
          // Skip frequencies with no strength/tendon days (nothing to floor).
          const days = foldDualMainLifts(archetype, daysForFrequency(archetype, freq, false));
          if (!days.some((d) => d.kind === "strength" || d.kind === "tendon")) continue;
          for (const level of LEVELS) {
            it(`${name} freq=${freq} ${level} meets the contextual floor every week`, () => {
              const floorCtx: FloorContext = { tendinopathyActive: tendinopathy, experience };
              const floor = contextualFloor(floorCtx);
              for (let w = 0; w < archetype.weeks; w++) {
                const count = countFloorRoles(weekItems(archetype, freq, level, w, experience, tendinopathy), ROLE_BY_SLUG);
                const check = checkTendonFloor(count, floor);
                expect(
                  check.met,
                  `${name} freq=${freq} ${level} week ${w}: unmet ${check.deficits.map((d) => `${d.role} ${d.have}/${d.need}`).join(", ")}`,
                ).toBe(true);
              }
            });
          }
        }
      }
    });
  }
});

describe("tendon-floor pure helpers", () => {
  it("contextualFloor keeps the full plyometric floor for experienced lifters", () => {
    const floor = contextualFloor({ tendinopathyActive: false, experience: null });
    expect(floor.plyometric_low).toBe(1);
    expect(floor.heavy_isometric).toBe(1);
    expect(floor.hsr).toBe(1);
    expect(floor.carry).toBe(2);
  });

  it("contextualFloor suppresses plyometrics for beginner and novice tiers", () => {
    for (const experience of ["beginner_lt_6m", "novice_6m_2y"] as DeclaredExperience[]) {
      const floor = contextualFloor({ tendinopathyActive: false, experience });
      expect(floor.plyometric_low).toBe(0);
      expect(floor.plyometric_high).toBe(0);
      // Universal lines remain.
      expect(floor.heavy_isometric).toBe(1);
      expect(floor.carry).toBe(2);
    }
  });

  it("contextualFloor suppresses plyometrics when tendinopathy is active", () => {
    const floor = contextualFloor({ tendinopathyActive: true, experience: null });
    expect(floor.plyometric_low).toBe(0);
    expect(floor.plyometric_high).toBe(0);
  });

  it("countFloorRoles tallies only accessory + tendon items by mapped role", () => {
    const items: PrescriptionItem[] = [
      { movementId: "m1", movementSlug: "wall-sit", kind: "accessory" },
      { movementId: "m2", movementSlug: "tempo-rdl", kind: "tendon" },
      { movementId: "m3", movementSlug: "farmer-carry", kind: "accessory" },
      { movementId: "m4", movementSlug: "p-slug", kind: "main" }, // ignored kind
      { movementId: "m5", movementSlug: "wall-sit", kind: "warmup" }, // ignored kind
    ];
    const count = countFloorRoles(items, ROLE_BY_SLUG);
    expect(count.heavy_isometric).toBe(1);
    expect(count.hsr).toBe(1);
    expect(count.carry).toBe(1);
    expect(count.plyometric_low).toBe(0);
  });

  it("checkTendonFloor reports per-role deficits when below floor", () => {
    const floor = contextualFloor({ tendinopathyActive: false, experience: null });
    const count = emptyFloorCount();
    count.heavy_isometric = 1;
    count.hsr = 1;
    count.carry = 1; // one carry short (need 2)
    // no plyo (need 1)
    const check = checkTendonFloor(count, floor);
    expect(check.met).toBe(false);
    expect(check.deficits).toEqual([
      { role: "carry", have: 1, need: 2 },
      { role: "plyometric", have: 0, need: 1 },
    ]);
  });

  it("checkTendonFloor passes a plyo-free week when the contextual floor suppresses plyo", () => {
    const floor = contextualFloor({ tendinopathyActive: true, experience: null });
    const count = emptyFloorCount();
    count.heavy_isometric = 1;
    count.hsr = 1;
    count.carry = 2;
    const check = checkTendonFloor(count, floor);
    expect(check.met).toBe(true);
  });
});
