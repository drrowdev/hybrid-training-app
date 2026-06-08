/**
 * ADR 0041 — HSR tendon-adaptation dose + advanced-tier loadable preference.
 *
 *  #1 Rep-based HSR is prescribed at 8 reps (heavy enough to reach the ~70% 1RM
 *     tendon-adaptation threshold — Morrison & Cook 2022), not the ~14-rep
 *     hypertrophy midpoint it used to inherit.
 *  #2 Advanced tiers (5y+/10y+) get the externally-loaded variant of a
 *     bodyweight floor pick (weighted pull-up) instead of bodyweight × 12.
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
import {
  carriesExternalLoad,
  type CatalogMovement,
} from "../accessory-picker";
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
const PRIMARY = { id: "front-squat", slug: "front-squat", displayName: "Front Squat" };
const SECONDARY = { id: "ohp-standing", slug: "ohp-standing", displayName: "Standing Overhead Press" };

function accessoriesFor(experience: DeclaredExperience | null): PrescriptionItem[] {
  const activeDays = foldDualMainLifts(
    ENDURANCE_ANCHOR,
    daysForFrequency(ENDURANCE_ANCHOR, 6, false),
  );
  const day = activeDays.find((d): d is StrengthDay => d.kind === "strength")!;
  const items = assemblePrescriptionItems(
    ENDURANCE_ANCHOR, 0, day, PRIMARY, undefined,
    new Map(), CATALOG, [], 1.0, false,
    undefined, undefined, false, experience, NO_LIMITS, SECONDARY, ["forearms"], 1.0,
    new Set<string>(), "standard", "none", "low", undefined, undefined, true, 2,
  );
  return items.filter((i) => i.kind === "accessory");
}

const slugOf = (it: PrescriptionItem) => it.movementSlug;

describe("ADR 0041 — carriesExternalLoad", () => {
  const mk = (equipment: string | null): CatalogMovement =>
    ({ equipment } as CatalogMovement);
  it("treats pure-bodyweight equipment as not externally loaded", () => {
    for (const eq of ["bar", "rings", "bar-or-rings", "bar-neutral", null, ""]) {
      expect(carriesExternalLoad(mk(eq))).toBe(false);
    }
  });
  it("treats belt / barbell / cable / machine equipment as externally loaded", () => {
    for (const eq of ["bar-belt", "barbell", "cable-pulldown", "cable-row", "machine-row", "dumbbell"]) {
      expect(carriesExternalLoad(mk(eq))).toBe(true);
    }
  });
});

describe("ADR 0041 — HSR rep dose", () => {
  it("prescribes rep-based HSR at 8 reps for everyone (heavy enough for tendon adaptation)", () => {
    const acc = accessoriesFor(null);
    const hsr = acc.filter((it) => slugOf(it)?.includes("hsr"));
    expect(hsr.length).toBeGreaterThan(0);
    for (const it of hsr) {
      // Rep-based HSR (calf raise) carries reps; hold-based tendon work would not.
      if (it.reps != null) expect(it.reps).toBe(8);
    }
  });
});

describe("ADR 0041 — advanced-tier loadable preference", () => {
  it("a non-advanced athlete gets the bodyweight pull", () => {
    const pulls = accessoriesFor(null).filter((it) => slugOf(it)?.includes("pull-up"));
    expect(pulls.some((it) => slugOf(it) === "pull-up-overhand")).toBe(true);
    expect(pulls.some((it) => slugOf(it) === "weighted-pull-up")).toBe(false);
  });
  it("an advanced athlete gets the weighted (externally-loaded) pull", () => {
    const pulls = accessoriesFor("highly_advanced_10y_plus").filter((it) =>
      slugOf(it)?.includes("pull-up"),
    );
    expect(pulls.some((it) => slugOf(it) === "weighted-pull-up")).toBe(true);
  });
});
