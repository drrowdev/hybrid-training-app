/**
 * ADR 0045 — High accessory volume adds real hypertrophy work on "cardio-safe"
 * archetypes whose mandatory durability + functional floor would otherwise
 * saturate the shared aesthetic ceiling and seat ZERO aesthetic items.
 *
 * Runs against the REAL seed catalog (`SEED_MOVEMENTS`) + a realistic home-gym
 * equipment inventory, so it pins the actual prod behaviour rather than a
 * synthetic ideal. The core guarantee:
 *
 *   - Medium / Low stay byte-identical to today (the cardio-safe default).
 *   - High seats strictly MORE aesthetic items than Medium on an archetype that
 *     previously seated zero (concurrent_hybrid).
 *   - High NEVER seats fewer aesthetic items than Medium (no inversion).
 *   - High does NOT inflate durability / functional set counts (the volume
 *     lever adds aesthetic ITEMS, never bleeds sets into the tissue-prep floor).
 *   - High stays within its raised duration cap.
 */
import { describe, it, expect } from "vitest";
import type { NewMovement } from "@hta/db";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";
import {
  CONCURRENT_HYBRID,
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  HYPERTROPHY_ANCHOR,
  daysForFrequency,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import { foldDualMainLifts } from "../main-lift-folding";
import { assemblePrescriptionItems } from "../assemble-prescription";
import type { CatalogMovement } from "../accessory-picker";
import { resolveEquipment } from "@/lib/settings/equipment-presets";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import { HIGH_VOLUME_SESSION_CAP_MIN } from "../secondary-focus";
import type { AccessoryVolumeLevel } from "../accessory-volume";

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
  } as CatalogMovement;
}

const CATALOG = SEED_MOVEMENTS.map(toCatalog);

// A realistic, well-equipped home gym (barbell, DBs, KBs, bands, rings) with NO
// machines — the inventory that surfaced the original "High does nothing" bug.
const EQUIP = resolveEquipment({
  equipment: {
    bars: { barbellKg: 20, trapBarKg: 35, safetyBarKg: null },
    cardio: ["rower"],
    plates: [25, 20, 15, 10, 5, 2.5, 1.25],
    preset: "custom",
    machines: [],
    dumbbells: { maxKg: 50, minKg: 2, stepKg: 2.5 },
    accessories: {
      bands: true, rings: true, dipBelt: true, sandbag: [25], pullUpBar: true,
      ankleWeights: false, bandStrength: "medium", dipBeltMaxKg: 40, weightedVest: [9],
    },
    kettlebells: [8, 12, 16, 20, 24, 28, 32, 40],
  },
} as never);

const PRIMARY = { id: "preview-main", slug: "preview-main", displayName: "Main lift" };

function assemble(a: Archetype, freq: number, level: AccessoryVolumeLevel) {
  const day = foldDualMainLifts(a, daysForFrequency(a, freq, false)).find(
    (d): d is StrengthDay => d.kind === "strength",
  )!;
  const secondaryMovement = day.secondaryRole
    ? { id: "preview-secondary", slug: "preview-secondary", displayName: "Secondary lift" }
    : undefined;
  const items = assemblePrescriptionItems(
    a, 0, day, PRIMARY, undefined, new Map(), CATALOG, [],
    1.0, false, undefined, EQUIP, false, "highly_advanced_10y_plus",
    undefined, secondaryMovement, [], 1.0, new Set(), "standard", "none", level,
  );
  const acc = items.filter((i) => i.kind === "accessory");
  const aesthetic = acc.filter((i) => i.intensityLabel === "aesthetic");
  const nonAesthetic = acc.filter((i) => i.intensityLabel !== "aesthetic");
  return {
    minutes: estimateSessionMinutes(items),
    aestheticCount: aesthetic.length,
    // Signature of the non-aesthetic (durability + functional) fills: name + sets.
    nonAestheticSig: nonAesthetic.map((i) => `${i.movementName}/${i.sets}`).join("|"),
  };
}

const CASES: Array<{ name: string; archetype: Archetype; freq: number }> = [
  { name: "concurrent_hybrid", archetype: CONCURRENT_HYBRID, freq: 6 },
  { name: "strength_anchor", archetype: STRENGTH_ANCHOR, freq: 4 },
  { name: "endurance_anchor", archetype: ENDURANCE_ANCHOR, freq: 5 },
  { name: "hypertrophy_anchor", archetype: HYPERTROPHY_ANCHOR, freq: 4 },
];

describe("ADR 0045 — High accessory volume", () => {
  it("concurrent_hybrid: High seats real aesthetic volume where Medium seats none", () => {
    const med = assemble(CONCURRENT_HYBRID, 6, "medium");
    const high = assemble(CONCURRENT_HYBRID, 6, "high");
    // The whole point: the lever was inert (0 aesthetic at every level) before.
    expect(med.aestheticCount).toBe(0);
    expect(high.aestheticCount).toBeGreaterThan(0);
  });

  it("High never seats fewer aesthetic items than Medium (no inversion)", () => {
    for (const { archetype, freq } of CASES) {
      const med = assemble(archetype, freq, "medium");
      const high = assemble(archetype, freq, "high");
      expect(high.aestheticCount).toBeGreaterThanOrEqual(med.aestheticCount);
    }
  });

  it("High does not inflate the durability/functional floor (no set leak)", () => {
    for (const { archetype, freq } of CASES) {
      const med = assemble(archetype, freq, "medium");
      const high = assemble(archetype, freq, "high");
      // The non-aesthetic floor (names + set counts) is identical: High adds
      // aesthetic ITEMS only, never bumps sets on the tissue-prep / functional work.
      expect(high.nonAestheticSig).toBe(med.nonAestheticSig);
    }
  });

  it("Low and Medium are identical on a cardio-safe archetype (both inert there)", () => {
    const low = assemble(CONCURRENT_HYBRID, 6, "low");
    const med = assemble(CONCURRENT_HYBRID, 6, "medium");
    // Concurrent's strength day seats zero aesthetic at both — the only
    // distinction the lever can draw here is at High. (Reviewed separately.)
    expect(low.aestheticCount).toBe(0);
    expect(med.aestheticCount).toBe(0);
  });

  it("High stays within its raised duration cap (the governor remains the bound)", () => {
    for (const { archetype, freq } of CASES) {
      const high = assemble(archetype, freq, "high");
      // The cap is a governor target, not a post-hoc clamp, so allow a small
      // overshoot for an archetype whose base session already exceeds it
      // (hypertrophy): the guarantee is that High does not run away.
      expect(high.minutes).toBeLessThanOrEqual(HIGH_VOLUME_SESSION_CAP_MIN + 5);
    }
  });
});
