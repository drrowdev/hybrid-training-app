/**
 * ADR 0020 — secondary-focus volume tilt (engine integration).
 *
 * Three guarantees, all exercised through the real `assemblePrescriptionItems`
 * with a live accessory catalog:
 *
 *   1. NO-OP GOLDEN MASTER — `secondaryFocus: "none"` (explicit) is
 *      byte-identical to omitting the argument, on every archetype's first
 *      strength day. This is the engine-regression guard: every existing call
 *      site defaults to `"none"`, so no existing block's prescription moves.
 *   2. TILT FIRES — `secondaryFocus: "muscle"` raises accessory hypertrophy
 *      volume on the two v1 volume-direction archetypes (strength_anchor,
 *      endurance_anchor): more aesthetic working sets than the no-tilt build.
 *   3. TILT IS SCOPED — `"muscle"` is a no-op on archetypes outside the v1 set
 *      (hypertrophy_anchor owns its own dial; concurrent/maintenance/rebuild
 *      don't tilt), and the duration governor keeps a tilted day within the
 *      75-minute hard cap.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  HYPERTROPHY_ANCHOR,
  CONCURRENT_HYBRID,
  MAINTENANCE,
  REBUILD,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import { assemblePrescriptionItems } from "../assemble-prescription";
import type { CatalogMovement, WeekAccessoryHistoryItem } from "../accessory-picker";
import { SESSION_HARD_CAP_MIN } from "../secondary-focus";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import type { SecondaryFocus } from "../secondary-focus";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };

const CATALOG: CatalogMovement[] = [
  {
    id: "lr1", slug: "db-lateral-raise", displayName: "DB Lateral Raise",
    primaryMuscles: ["side_delts"], secondaryMuscles: [], primaryRegion: "shoulder_scapular",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "bi1", slug: "db-curl", displayName: "DB Curl",
    primaryMuscles: ["biceps"], secondaryMuscles: [], primaryRegion: "elbow_forearm",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "tri1", slug: "rope-pushdown", displayName: "Rope Pushdown",
    primaryMuscles: ["triceps"], secondaryMuscles: [], primaryRegion: "elbow_forearm",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: true,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "calf1", slug: "standing-calf-raise", displayName: "Standing Calf Raise",
    primaryMuscles: ["calves"], secondaryMuscles: [], primaryRegion: "foot_ankle_calf",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: false,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "ham1", slug: "leg-curl", displayName: "Leg Curl",
    primaryMuscles: ["hamstrings"], secondaryMuscles: [], primaryRegion: "hip_thigh",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: true,
    isCompound: false, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
  {
    id: "row1", slug: "chest-supported-row", displayName: "Chest-Supported Row",
    primaryMuscles: ["traps"], secondaryMuscles: ["biceps"], primaryRegion: "upper_back",
    secondaryRegions: [], bulletproofRoles: [], functionalRoles: [], isSupported: true,
    isCompound: true, eccentricLoadScore: null, stimToFatigueScore: null, highStrainTendon: false,
  },
];

function firstStrengthDay(a: Archetype): StrengthDay {
  return a.days.find((d): d is StrengthDay => d.kind === "strength")!;
}

function assemble(
  archetype: Archetype,
  secondary: SecondaryFocus | undefined,
  weekIndex = 0,
) {
  const day = firstStrengthDay(archetype);
  const weekAccessoryHistory: WeekAccessoryHistoryItem[] = [];
  const args = [
    archetype,
    weekIndex,
    day,
    PRIMARY,
    undefined,
    new Map(),
    CATALOG,
    weekAccessoryHistory,
    1.0,
    false,
    undefined,
    undefined,
    false,
    null,
    undefined,
    undefined,
    [],
    1.0,
    new Set<string>(),
    "standard" as const,
  ] as const;
  return secondary === undefined
    ? assemblePrescriptionItems(...args)
    : assemblePrescriptionItems(...args, secondary);
}

function aestheticSetTotal(
  archetype: Archetype,
  secondary: SecondaryFocus | undefined,
): number {
  return assemble(archetype, secondary)
    .filter((i) => i.kind === "accessory")
    .reduce((n, i) => n + (i.sets ?? 0), 0);
}

const ALL: Array<[string, Archetype]> = [
  ["strength_anchor", STRENGTH_ANCHOR],
  ["endurance_anchor", ENDURANCE_ANCHOR],
  ["hypertrophy_anchor", HYPERTROPHY_ANCHOR],
  ["concurrent_hybrid", CONCURRENT_HYBRID],
  ["maintenance", MAINTENANCE],
  ["rebuild", REBUILD],
];

describe("ADR 0020 — no-op golden master", () => {
  it.each(ALL)(
    "%s: secondaryFocus 'none' is byte-identical to omitting the argument",
    (_name, archetype) => {
      for (const weekIndex of [0, 1, 2, 3]) {
        const omitted = assemble(archetype, undefined, weekIndex);
        const explicitNone = assemble(archetype, "none", weekIndex);
        expect(explicitNone).toEqual(omitted);
      }
    },
  );

  it.each(ALL)(
    "%s: intensity-direction secondaries (strength/cardio) are a no-op too",
    (_name, archetype) => {
      const base = assemble(archetype, "none");
      expect(assemble(archetype, "strength")).toEqual(base);
      expect(assemble(archetype, "cardio")).toEqual(base);
    },
  );
});

describe("ADR 0020 — muscle tilt fires on the v1 volume-direction archetypes", () => {
  it("strength_anchor: muscle secondary adds accessory hypertrophy volume", () => {
    const none = aestheticSetTotal(STRENGTH_ANCHOR, "none");
    const muscle = aestheticSetTotal(STRENGTH_ANCHOR, "muscle");
    expect(none).toBeGreaterThan(0);
    expect(muscle).toBeGreaterThan(none);
  });

  it("endurance_anchor: muscle secondary adds accessory hypertrophy volume", () => {
    const none = aestheticSetTotal(ENDURANCE_ANCHOR, "none");
    const muscle = aestheticSetTotal(ENDURANCE_ANCHOR, "muscle");
    expect(muscle).toBeGreaterThan(none);
  });
});

describe("ADR 0020 — muscle tilt is scoped + governed", () => {
  it("hypertrophy_anchor: muscle secondary is a no-op (owns its own dial)", () => {
    expect(assemble(HYPERTROPHY_ANCHOR, "muscle")).toEqual(
      assemble(HYPERTROPHY_ANCHOR, "none"),
    );
  });

  it("concurrent_hybrid / maintenance / rebuild: muscle secondary is a no-op", () => {
    for (const a of [CONCURRENT_HYBRID, MAINTENANCE, REBUILD]) {
      expect(assemble(a, "muscle")).toEqual(assemble(a, "none"));
    }
  });

  it("a tilted strength day stays within the 75-minute hard cap", () => {
    for (const a of [STRENGTH_ANCHOR, ENDURANCE_ANCHOR]) {
      const mins = estimateSessionMinutes(assemble(a, "muscle"));
      expect(mins).not.toBeNull();
      expect(mins!).toBeLessThanOrEqual(SESSION_HARD_CAP_MIN);
    }
  });
});
