/**
 * ADR 0042 — hinge-day durability de-dup + loaded floor-pull strength reps.
 *
 *  #1 The durability HSR on a HINGE main day (deadlift) no longer stacks a
 *     second axially-loaded hinge (the RDL the review flagged). The deadlift
 *     already maxes the posterior chain, so its complementary HSR steers to the
 *     knee tendon region instead.
 *  #2 A loaded floor pull (weighted pull-up) for an advanced athlete is dosed in
 *     a strength rep range (8), not the hypertrophy default.
 */
import { describe, it, expect } from "vitest";
import type { NewMovement } from "@hta/db";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";
import {
  ENDURANCE_ANCHOR,
  daysForFrequency,
  type StrengthDay,
} from "../archetypes";
import { foldDualMainLifts } from "../main-lift-folding";
import { assemblePrescriptionItems } from "../assemble-prescription";
import { type CatalogMovement } from "../accessory-picker";
import type { LimitationsContext } from "../limitations-context";
import type { PrescriptionItem } from "@hta/db";
import type { DeclaredExperience } from "@hta/engine";

function toCatalog(m: NewMovement): CatalogMovement {
  return {
    id: m.slug, slug: m.slug, displayName: m.displayName,
    primaryMuscles: (m.primaryMuscles ?? []) as string[],
    secondaryMuscles: (m.secondaryMuscles ?? []) as string[],
    primaryRegion: m.primaryRegion as string,
    secondaryRegions: (m.secondaryRegions ?? []) as string[],
    bulletproofRoles: (m.bulletproofRoles ?? []) as never,
    functionalRoles: (m.functionalRoles ?? []) as never,
    isSupported: m.isSupported ?? false, isCompound: m.isCompound ?? false,
    isLoadable: m.bodyWeightLoaded ?? false,
    eccentricLoadScore: m.eccentricLoadScore ?? null,
    stimToFatigueScore: m.stimToFatigueScore ?? null,
    highStrainTendon: m.highStrainTendon ?? false,
    experienceMin: m.experienceMin ?? 0, experienceMax: m.experienceMax ?? 4,
    pattern: m.pattern, equipment: m.equipment ?? null,
  };
}
const CATALOG = SEED_MOVEMENTS.map(toCatalog);
const NO_LIMITS: LimitationsContext = {
  blockedRegions: new Set(), blockedMuscles: new Set(),
  blockedMovementIds: new Set(), allowedMovementIds: new Set(), tendinopathyActive: false,
};

function accessoriesForRole(
  role: string,
  primary: { id: string; slug: string; displayName: string },
  experience: DeclaredExperience | null,
): PrescriptionItem[] {
  const activeDays = foldDualMainLifts(
    ENDURANCE_ANCHOR,
    daysForFrequency(ENDURANCE_ANCHOR, 6, false),
  );
  const day = activeDays.find(
    (d): d is StrengthDay => d.kind === "strength" && d.role === role,
  )!;
  const items = assemblePrescriptionItems(
    ENDURANCE_ANCHOR, 0, day, primary, undefined,
    new Map(), CATALOG, [], 1.0, false,
    undefined, undefined, false, experience, NO_LIMITS, undefined, [], 1.0,
    new Set<string>(), "standard", "none", "low", undefined, undefined, true, 2,
  );
  return items.filter((i) => i.kind === "accessory");
}

const slugOf = (it: PrescriptionItem) => it.movementSlug;
const DEADLIFT = { id: "trap-bar-deadlift", slug: "trap-bar-deadlift", displayName: "Trap Bar Deadlift" };

describe("ADR 0042 — hinge-day HSR de-dup", () => {
  it("does not stack an axial-hinge RDL HSR on the deadlift day", () => {
    const acc = accessoriesForRole("deadlift", DEADLIFT, null);
    expect(acc.some((it) => slugOf(it) === "hsr-rdl")).toBe(false);
  });
});

describe("ADR 0042 — loaded floor-pull strength reps", () => {
  it("doses a loaded (weighted) floor pull at the strength rep target", () => {
    const acc = accessoriesForRole("deadlift", DEADLIFT, "highly_advanced_10y_plus");
    const loadedPull = acc.find((it) => slugOf(it) === "weighted-pull-up");
    expect(loadedPull).toBeDefined();
    expect(loadedPull!.reps).toBe(8);
  });
});
