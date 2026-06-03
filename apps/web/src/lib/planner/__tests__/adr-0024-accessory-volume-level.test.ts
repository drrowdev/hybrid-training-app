/**
 * ADR 0024 — per-block accessory volume level (`training_blocks.accessory_volume`).
 *
 * Pins the cross-archetype AMOUNT lever and its regression guarantees:
 *
 *   - `medium` is the byte-identical identity on EVERY archetype — explicit
 *     `"medium"` equals the call that omits the arg, so the golden master and
 *     every ADR 0011/0015/0016/0020/0022 pin stay green.
 *   - `low` trims exactly ONE aesthetic movement on archetypes whose aesthetic
 *     base is ≥ 2 (Strength / Hypertrophy / Concurrent) and is a no-op on the
 *     already-minimal ones (Endurance / Rebuild base 1, Maintenance base 0).
 *   - the level only moves AESTHETIC accessories — main lifts, cardio,
 *     durability and functional accessories are identical across all 3 levels.
 *   - composition + floors of `accessoryVolumeCandidates` are unit-pinned,
 *     including the `medium` + secondary-`muscle` ladder that must reproduce
 *     the exact pre-ADR-0024 ADR 0020 three-rung ladder.
 */
import { describe, it, expect } from "vitest";
import {
  STRENGTH_ANCHOR,
  ENDURANCE_ANCHOR,
  REBUILD,
  HYPERTROPHY_ANCHOR,
  CONCURRENT_HYBRID,
  MAINTENANCE,
  type Archetype,
  type StrengthDay,
} from "../archetypes";
import { assemblePrescriptionItems } from "../assemble-prescription";
import type { CatalogMovement } from "../accessory-picker";
import {
  resolveAccessoryVolumeLevel,
  accessoryVolumeTilt,
  accessoryVolumeCandidates,
  ACCESSORY_VOLUME_VALUES,
  type AccessoryVolumeLevel,
} from "../accessory-volume";
import type { SecondaryFocus } from "../secondary-focus";

const PRIMARY = { id: "p", slug: "p-slug", displayName: "Primary" };

const AESTHETIC_MUSCLES: { muscle: string; region: string }[] = [
  { muscle: "side_delts", region: "shoulder_scapular" },
  { muscle: "rear_delts", region: "shoulder_scapular" },
  { muscle: "biceps", region: "elbow_forearm" },
  { muscle: "triceps", region: "elbow_forearm" },
  { muscle: "calves", region: "foot_ankle_calf" },
  { muscle: "hamstrings", region: "hip_glute" },
];

// Two distinct movements per muscle (12 total) so the per-session VOLUME
// budget — not the catalog size or the per-muscle target — is the binding
// constraint. That lets a ±1 item budget delta show up as a ±1 aesthetic-item
// delta in the materialised day for every archetype, including hypertrophy
// (budget 8) and a high tilt (budget 9).
const CATALOG: CatalogMovement[] = AESTHETIC_MUSCLES.flatMap(({ muscle, region }, idx) =>
  [0, 1].map((n) => ({
    id: `${muscle}-${n}`,
    slug: `${muscle}-mv-${n}`,
    displayName: `${muscle} movement ${n}`,
    primaryMuscles: [muscle],
    secondaryMuscles: [],
    primaryRegion: region,
    secondaryRegions: [],
    bulletproofRoles: [],
    functionalRoles: [],
    isSupported: idx % 2 === 0,
    isCompound: false,
    eccentricLoadScore: null,
    stimToFatigueScore: null,
    highStrainTendon: false,
  })),
) as CatalogMovement[];

function firstStrengthDay(a: Archetype): StrengthDay | undefined {
  return a.days.find((d): d is StrengthDay => d.kind === "strength");
}

/**
 * Materialise a strength day at the given accessory-volume level. Mirrors the
 * production positional call; only `secondaryFocus` (21st) and
 * `accessoryVolume` (22nd) vary here. Returns `null` for archetypes with no
 * strength day.
 */
function strengthDayItems(
  archetype: Archetype,
  level: AccessoryVolumeLevel,
  secondary: SecondaryFocus = "none",
) {
  const day = firstStrengthDay(archetype);
  if (!day) return null;
  return assemblePrescriptionItems(
    archetype,
    0,
    day,
    PRIMARY,
    undefined,
    new Map(),
    CATALOG,
    [],
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
    new Set(),
    "standard",
    secondary,
    level,
  );
}

function aestheticItems(items: NonNullable<ReturnType<typeof strengthDayItems>>) {
  return items.filter(
    (i) => i.kind === "accessory" && i.intensityLabel === "aesthetic",
  );
}

const ALL: { name: string; archetype: Archetype }[] = [
  { name: "strength_anchor", archetype: STRENGTH_ANCHOR },
  { name: "endurance_anchor", archetype: ENDURANCE_ANCHOR },
  { name: "rebuild", archetype: REBUILD },
  { name: "hypertrophy_anchor", archetype: HYPERTROPHY_ANCHOR },
  { name: "concurrent_hybrid", archetype: CONCURRENT_HYBRID },
  { name: "maintenance", archetype: MAINTENANCE },
];

// Archetypes whose aesthetic base is ≥ 2 — where `low` has a movement to trim.
const TRIMMABLE = new Set(["strength_anchor", "hypertrophy_anchor", "concurrent_hybrid"]);

// ── Identity (medium == default) ─────────────────────────────────────────

describe("ADR 0024 — `medium` is the byte-identical identity", () => {
  for (const { name, archetype } of ALL) {
    it(`${name}: explicit "medium" equals the omitted-arg default`, () => {
      const day = firstStrengthDay(archetype);
      if (!day) return; // no strength day → nothing to assemble
      const explicitMedium = strengthDayItems(archetype, "medium");
      // Default call (no secondaryFocus / accessoryVolume args at all).
      const omitted = assemblePrescriptionItems(
        archetype, 0, day, PRIMARY,
        undefined, new Map(), CATALOG, [],
        1.0, false, undefined, undefined, false, null,
        undefined, undefined, [], 1.0, new Set(),
        "standard",
      );
      expect(explicitMedium).toEqual(omitted);
    });
  }
});

// ── Low trims breadth where there is breadth to trim ─────────────────────

describe("ADR 0024 — `low` trims exactly one aesthetic movement (breadth)", () => {
  for (const { name, archetype } of ALL) {
    it(`${name}: ${TRIMMABLE.has(name) ? "drops one aesthetic" : "no-op (already minimal)"}`, () => {
      const day = firstStrengthDay(archetype);
      if (!day) return;
      const med = aestheticItems(strengthDayItems(archetype, "medium")!);
      const low = aestheticItems(strengthDayItems(archetype, "low")!);
      if (TRIMMABLE.has(name)) {
        expect(med.length).toBeGreaterThanOrEqual(2);
        expect(low.length).toBe(med.length - 1);
      } else {
        expect(low.length).toBe(med.length);
      }
    });
  }
});

// ── The level only moves AESTHETIC accessories ───────────────────────────

describe("ADR 0024 — main lifts, cardio, durability & functional are level-invariant", () => {
  for (const { name, archetype } of ALL) {
    it(`${name}: non-aesthetic items identical across low / medium / high`, () => {
      const day = firstStrengthDay(archetype);
      if (!day) return;
      const nonAesthetic = (lvl: AccessoryVolumeLevel) =>
        strengthDayItems(archetype, lvl)!.filter(
          (i) => !(i.kind === "accessory" && i.intensityLabel === "aesthetic"),
        );
      const med = nonAesthetic("medium");
      expect(nonAesthetic("low")).toEqual(med);
      expect(nonAesthetic("high")).toEqual(med);
    });
  }
});

// ── High never shrinks the aesthetic block below medium ──────────────────

describe("ADR 0024 — `high` adds aesthetic volume (bounded by the duration governor)", () => {
  for (const name of TRIMMABLE) {
    const archetype = ALL.find((a) => a.name === name)!.archetype;
    it(`${name}: high aesthetic count ≥ medium`, () => {
      const med = aestheticItems(strengthDayItems(archetype, "medium")!);
      const high = aestheticItems(strengthDayItems(archetype, "high")!);
      expect(high.length).toBeGreaterThanOrEqual(med.length);
    });
  }
});

// ── Config + composition units ───────────────────────────────────────────

describe("ADR 0024 config helpers", () => {
  it("resolveAccessoryVolumeLevel collapses unknown/null/legacy to medium", () => {
    expect(resolveAccessoryVolumeLevel(null)).toBe("medium");
    expect(resolveAccessoryVolumeLevel(undefined)).toBe("medium");
    expect(resolveAccessoryVolumeLevel("")).toBe("medium");
    expect(resolveAccessoryVolumeLevel("bogus")).toBe("medium");
    expect(resolveAccessoryVolumeLevel("low")).toBe("low");
    expect(resolveAccessoryVolumeLevel("medium")).toBe("medium");
    expect(resolveAccessoryVolumeLevel("high")).toBe("high");
  });

  it("exposes exactly low / medium / high", () => {
    expect([...ACCESSORY_VOLUME_VALUES]).toEqual(["low", "medium", "high"]);
  });

  it("accessoryVolumeTilt: low {-1,0}, medium {0,0}, high {+1,+1}", () => {
    expect(accessoryVolumeTilt("low")).toEqual({ itemsPerSessionDelta: -1, setsPerItemDelta: 0 });
    expect(accessoryVolumeTilt("medium")).toEqual({ itemsPerSessionDelta: 0, setsPerItemDelta: 0 });
    expect(accessoryVolumeTilt("high")).toEqual({ itemsPerSessionDelta: 1, setsPerItemDelta: 1 });
  });

  const NO_SECONDARY = { itemsPerSessionDelta: 0, setsPerItemDelta: 0 };

  it("medium + no secondary is a single byte-identical candidate (no-op)", () => {
    expect(
      accessoryVolumeCandidates({
        aestheticBaseItems: 2,
        baseSetsPerItem: 3,
        level: "medium",
        secondary: NO_SECONDARY,
      }),
    ).toEqual([{ itemBonus: 0, setBonus: 0 }]);
  });

  it("medium + secondary muscle reproduces the pre-ADR-0024 three-rung ladder", () => {
    // ADR 0020 secondary `muscle` tilt = {+1 item, +1 set}; the governor ladder
    // is [full, trim item, trim set] = [{1,1},{0,1},{0,0}].
    expect(
      accessoryVolumeCandidates({
        aestheticBaseItems: 2,
        baseSetsPerItem: 3,
        level: "medium",
        secondary: { itemsPerSessionDelta: 1, setsPerItemDelta: 1 },
      }),
    ).toEqual([
      { itemBonus: 1, setBonus: 1 },
      { itemBonus: 0, setBonus: 1 },
      { itemBonus: 0, setBonus: 0 },
    ]);
  });

  it("low never strips the last aesthetic movement (item floor at 1)", () => {
    // base 1 (Endurance / Rebuild) → low is a no-op.
    expect(
      accessoryVolumeCandidates({
        aestheticBaseItems: 1,
        baseSetsPerItem: 2,
        level: "low",
        secondary: NO_SECONDARY,
      }),
    ).toEqual([{ itemBonus: 0, setBonus: 0 }]);
    // base 2 (Strength) → low drops exactly one.
    expect(
      accessoryVolumeCandidates({
        aestheticBaseItems: 2,
        baseSetsPerItem: 3,
        level: "low",
        secondary: NO_SECONDARY,
      }),
    ).toEqual([{ itemBonus: -1, setBonus: 0 }]);
  });

  it("never drops a movement below 2 working sets (depth floor)", () => {
    // A hypothetical -2 set tilt floors at base 2 → 2 (setBonus 0).
    const ladder = accessoryVolumeCandidates({
      aestheticBaseItems: 3,
      baseSetsPerItem: 2,
      level: "low",
      secondary: { itemsPerSessionDelta: 0, setsPerItemDelta: -2 },
    });
    for (const rung of ladder) {
      expect(2 + rung.setBonus).toBeGreaterThanOrEqual(2);
    }
  });

  it("archetypes with zero aesthetic items (Maintenance) are a full no-op at every level", () => {
    for (const level of ACCESSORY_VOLUME_VALUES) {
      expect(
        accessoryVolumeCandidates({
          aestheticBaseItems: 0,
          baseSetsPerItem: 2,
          level,
          secondary: { itemsPerSessionDelta: 1, setsPerItemDelta: 1 },
        }),
      ).toEqual([{ itemBonus: 0, setBonus: 0 }]);
    }
  });
});
