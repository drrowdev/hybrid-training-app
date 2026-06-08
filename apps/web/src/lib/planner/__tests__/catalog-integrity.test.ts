/**
 * Catalog-integrity guards — defense-in-depth so the two Quick-workout
 * leak classes (and their cousins) can't silently return:
 *
 *   1. EQUIPMENT — every machine/cable-tagged movement must be filtered
 *      out for a user with no machines. The slug-only heuristic missed
 *      most machines (reverse pec deck, pendulum squat, …); the DB
 *      `equipment` tag is now authoritative via `resolveRequiredEquipment`.
 *
 *   2. PATTERN — the aesthetic (hypertrophy muscle-gap) pass must never
 *      prescribe a non-hypertrophy movement (cardio / plyometric /
 *      Olympic / tendon / carry / drill) as a rep-based filler. That was
 *      the "Erg Row — Threshold @ 4×12" bug, generalised.
 *
 * These run against the REAL seed catalog (`SEED_MOVEMENTS`), so a new
 * movement with a missing/typo'd tag fails CI here rather than in prod.
 */
import { describe, it, expect } from "vitest";
import type { NewMovement } from "@hta/db";
import { SEED_MOVEMENTS } from "@hta/db/seeds/movements";
import {
  pickAccessoriesForSession,
  type CatalogMovement,
} from "../accessory-picker";
import type { AccessoryProfile } from "../accessory-roles";
import {
  resolveRequiredEquipment,
  isEquipmentAvailable,
} from "../equipment-requirements";
import { COMMERCIAL_GYM_PRESET, CUSTOM_EMPTY_PRESET } from "@/lib/settings/equipment-presets";

/** Patterns the seed catalog is allowed to use (typo guard). */
const KNOWN_PATTERNS = new Set([
  "squat",
  "hinge",
  "press",
  "pull",
  "carry",
  "isolation",
  "cardio",
  "plyometric",
  "olympic",
  "tendon",
  "cuff",
  "drill",
]);

/** Patterns eligible for the aesthetic (hypertrophy) muscle-gap slot. */
const AESTHETIC_ELIGIBLE = new Set(["squat", "hinge", "press", "pull", "isolation", "cuff"]);

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
  };
}

const CATALOG = SEED_MOVEMENTS.map(toCatalog);
const BY_SLUG = new Map(CATALOG.map((m) => [m.slug, m]));

describe("seed catalog — pattern hygiene", () => {
  it("every movement uses a known pattern", () => {
    for (const m of SEED_MOVEMENTS) {
      expect(KNOWN_PATTERNS.has(m.pattern), `${m.slug}: unknown pattern '${m.pattern}'`).toBe(true);
    }
  });

  it("every movement carries an equipment tag (or explicit bodyweight)", () => {
    // A null/empty equipment tag means the filter can only fall back to
    // slug inference. Bodyweight movements should say so explicitly.
    for (const m of SEED_MOVEMENTS) {
      expect(
        typeof m.equipment === "string" && m.equipment.length > 0,
        `${m.slug}: missing equipment tag`,
      ).toBe(true);
    }
  });
});

describe("seed catalog — equipment leak guard", () => {
  // A tag that unambiguously denotes a gym machine or cable station, with
  // no bodyweight/free alternative. Such a movement must be unavailable to
  // a user who owns no machines.
  const looksMachineOrCable = (tag: string): boolean => {
    const t = tag.toLowerCase();
    if (t.includes("bodyweight") || t.includes("or-bw") || t.includes("bw-or")) return false;
    return /machine|cable|smith/.test(t);
  };

  it("every machine/cable movement is filtered out for a no-machine inventory", () => {
    const leaked: string[] = [];
    for (const m of SEED_MOVEMENTS) {
      if (!m.equipment || !looksMachineOrCable(m.equipment)) continue;
      const req = resolveRequiredEquipment({
        slug: m.slug,
        pattern: m.pattern,
        equipment: m.equipment,
      });
      // Must resolve to a hard machine/cable requirement…
      if (req.kind === "bodyweight_or_generic") {
        leaked.push(`${m.slug} (${m.equipment}) → bodyweight_or_generic`);
        continue;
      }
      // …and that requirement must reject an empty (bodyweight-only) inventory.
      if (isEquipmentAvailable(req, CUSTOM_EMPTY_PRESET)) {
        leaked.push(`${m.slug} (${m.equipment}) → available to empty inventory`);
      }
    }
    expect(leaked, `machine/cable movements leaked to a no-equipment user:\n${leaked.join("\n")}`).toEqual([]);
  });
});

describe("seed catalog — accessory-pattern leak guard", () => {
  const PROFILE: AccessoryProfile = {
    aesthetic: {
      itemsPerSession: 20,
      setsPerItem: 3,
      repRange: { min: 10, max: 15 },
      biasSupported: false,
    },
    functional: { weeklyRoleRequirements: {} },
    durability: { extras: [] },
  };

  // Drive a large aesthetic gap on every trackable muscle so the gap-fill
  // pass exercises the whole catalog.
  const ALL_MUSCLES = [
    "chest", "upper_chest", "front_delts", "side_delts", "rear_delts",
    "biceps", "triceps", "forearms", "traps", "lats", "mid_back",
    "lower_back", "abs", "obliques", "glutes", "quads", "hamstrings",
    "adductors", "abductors", "calves", "tibialis", "neck",
  ];
  const perMuscleTargets = Object.fromEntries(ALL_MUSCLES.map((mu) => [mu, 99]));

  const picks = pickAccessoriesForSession({
    profile: PROFILE,
    weekDeloadScale: 1.0,
    catalog: CATALOG,
    weekAccessoryHistory: [],
    filters: {
      blockedRegions: new Set<string>(),
      concurrentStressActive: false,
      recentlyUsedMovementIds: new Set<string>(),
      tendinopathyActive: false,
    },
    perMuscleTargets,
    maxItems: 40,
    equipment: COMMERCIAL_GYM_PRESET,
    experience: null,
  });

  it("the picker actually selected a broad set of accessories", () => {
    // Sanity: if this collapses to ~0 the leak assertions below are vacuous.
    expect(picks.length).toBeGreaterThan(10);
  });

  it("no aesthetic pick is a cardio / plyometric / Olympic / tendon / carry / drill movement", () => {
    const offenders: string[] = [];
    for (const p of picks) {
      if (p.reason !== "aesthetic") continue;
      const mv = BY_SLUG.get(p.slug);
      const pattern = mv?.pattern ?? "(unknown)";
      if (!AESTHETIC_ELIGIBLE.has(pattern)) {
        offenders.push(`${p.slug} [${pattern}]`);
      }
    }
    expect(offenders, `non-hypertrophy movements prescribed as aesthetic fillers:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no cardio movement is ever returned as an accessory (any reason)", () => {
    const cardioPicks = picks
      .filter((p) => BY_SLUG.get(p.slug)?.pattern === "cardio")
      .map((p) => p.slug);
    expect(cardioPicks).toEqual([]);
  });
});

describe("seed catalog — role-coverage floors", () => {
  const countBp = (role: string) =>
    SEED_MOVEMENTS.filter((m) => ((m.bulletproofRoles ?? []) as string[]).includes(role)).length;
  const countFn = (role: string) =>
    SEED_MOVEMENTS.filter((m) => ((m.functionalRoles ?? []) as string[]).includes(role)).length;

  // DC-O4 durability floor — every archetype must be able to seat these each
  // week. These were ALL zero in prod before migration 0088 (reseed wiped the
  // 0019 tagging). The numbers are the per-week floor from accessory-roles.ts.
  it("durability-floor bulletproof roles are covered", () => {
    expect(countBp("heavy_isometric"), "heavy_isometric").toBeGreaterThanOrEqual(1);
    expect(countBp("hsr"), "hsr").toBeGreaterThanOrEqual(1);
    expect(countBp("plyometric_low") + countBp("plyometric_high"), "plyometric").toBeGreaterThanOrEqual(1);
    expect(countBp("carry"), "carry").toBeGreaterThanOrEqual(2);
  });

  // Archetype functional requirements (max across archetypes): single_leg 1,
  // anti_rotation 1, hip_stabilizer 2, ankle_foot 2, loaded_mobility 1.
  it("archetype functional roles are covered", () => {
    expect(countFn("single_leg"), "single_leg").toBeGreaterThanOrEqual(1);
    expect(countFn("anti_rotation"), "anti_rotation").toBeGreaterThanOrEqual(1);
    expect(countFn("hip_stabilizer"), "hip_stabilizer").toBeGreaterThanOrEqual(2);
    expect(countFn("ankle_foot"), "ankle_foot").toBeGreaterThanOrEqual(2);
    expect(countFn("loaded_mobility"), "loaded_mobility").toBeGreaterThanOrEqual(1);
    // ADR 0035 — the conditional cuff-prehab requirement (1/wk for pressers).
    expect(countFn("shoulder_stability"), "shoulder_stability").toBeGreaterThanOrEqual(1);
  });

  // A user with no machines must still be able to seat the endurance_anchor
  // hip_stabilizer (2) + ankle_foot (2) requirements — i.e. ≥2 non-machine
  // candidates per role.
  it("hip_stabilizer + ankle_foot are satisfiable without machines", () => {
    const machineFree = (role: string) =>
      SEED_MOVEMENTS.filter((m) => {
        if (!((m.functionalRoles ?? []) as string[]).includes(role)) return false;
        const req = resolveRequiredEquipment({ slug: m.slug, pattern: m.pattern, equipment: m.equipment });
        return req.kind !== "machine" && req.kind !== "machine_generic";
      }).length;
    expect(machineFree("hip_stabilizer"), "hip_stabilizer machine-free").toBeGreaterThanOrEqual(2);
    expect(machineFree("ankle_foot"), "ankle_foot machine-free").toBeGreaterThanOrEqual(2);
    // ADR 0035 — a presser with no machines must still seat a cuff item
    // (band / DB / bar variants).
    expect(machineFree("shoulder_stability"), "shoulder_stability machine-free").toBeGreaterThanOrEqual(1);
  });
});
