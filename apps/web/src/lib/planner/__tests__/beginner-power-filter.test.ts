/**
 * PR W1 — Beginner power-movement filter.
 *
 * Verifies `filterPowerForExperience` (and the `blocksPowerMovements`
 * predicate it delegates to) only suppresses plyometric / ballistic /
 * Olympic candidates for declared beginner tiers — leaving every other
 * tier (and null / undeclared) untouched.
 *
 * See `experience-tier-scope.md` §4 (Option A — light filter).
 */
import { describe, it, expect } from "vitest";
import {
  BEGINNER_TIERS,
  blocksPowerMovements,
  filterPowerForExperience,
  type CatalogMovement,
} from "../accessory-picker";

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

const PLYO = mv({
  id: "plyo1",
  slug: "broad-jump",
  functionalRoles: ["power_plyometric"],
});
const OLY = mv({
  id: "oly1",
  slug: "power-clean",
  functionalRoles: ["power_olympic"],
});
const BALLISTIC = mv({
  id: "bal1",
  slug: "kb-swing-russian",
  functionalRoles: ["power_ballistic"],
});
const NON_POWER = [
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"] }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"] }),
  mv({
    id: "carry1",
    slug: "farmer-carry",
    bulletproofRoles: ["carry"],
    primaryMuscles: ["forearms"],
  }),
];

describe("PR W1 — beginner power filter", () => {
  it("beginner_lt_6m drops power_plyometric candidates", () => {
    const out = filterPowerForExperience([PLYO, ...NON_POWER], "beginner_lt_6m");
    expect(out.map((m) => m.id)).not.toContain("plyo1");
    expect(out).toHaveLength(NON_POWER.length);
  });

  it("novice_6m_2y drops power_olympic candidates", () => {
    const out = filterPowerForExperience([OLY, ...NON_POWER], "novice_6m_2y");
    expect(out.map((m) => m.id)).not.toContain("oly1");
    expect(out).toHaveLength(NON_POWER.length);
  });

  it("beginner_lt_6m drops power_ballistic candidates", () => {
    const out = filterPowerForExperience([BALLISTIC, ...NON_POWER], "beginner_lt_6m");
    expect(out.map((m) => m.id)).not.toContain("bal1");
    expect(out).toHaveLength(NON_POWER.length);
  });

  it("intermediate_2y_5y — power candidates pass through unchanged", () => {
    const input = [PLYO, OLY, BALLISTIC, ...NON_POWER];
    const out = filterPowerForExperience(input, "intermediate_2y_5y");
    expect(out).toEqual(input);
  });

  it("advanced_5y_10y — power candidates pass through unchanged", () => {
    const input = [PLYO, OLY, BALLISTIC, ...NON_POWER];
    const out = filterPowerForExperience(input, "advanced_5y_10y");
    expect(out).toEqual(input);
  });

  it("highly_advanced_10y_plus — power candidates pass through unchanged", () => {
    const input = [PLYO, OLY, BALLISTIC, ...NON_POWER];
    const out = filterPowerForExperience(input, "highly_advanced_10y_plus");
    expect(out).toEqual(input);
  });

  it("null experience — filter is a no-op (legacy behaviour preserved)", () => {
    const input = [PLYO, OLY, BALLISTIC, ...NON_POWER];
    const out = filterPowerForExperience(input, null);
    expect(out).toEqual(input);
    expect(blocksPowerMovements(null)).toBe(false);
  });

  it("mixed catalog — beginner keeps non-power, drops every power-tagged row", () => {
    const input = [PLYO, OLY, BALLISTIC, ...NON_POWER];
    const out = filterPowerForExperience(input, "beginner_lt_6m");
    const ids = out.map((m) => m.id);
    expect(ids).not.toContain("plyo1");
    expect(ids).not.toContain("oly1");
    expect(ids).not.toContain("bal1");
    for (const np of NON_POWER) expect(ids).toContain(np.id);
    // Sanity-check the public set membership while we're here.
    expect(BEGINNER_TIERS.has("beginner_lt_6m")).toBe(true);
    expect(BEGINNER_TIERS.has("novice_6m_2y")).toBe(true);
  });
});
