/**
 * ADR 0043 — focus-muscle sub-pattern diversity.
 *
 * A declared `forearms` focus spread across the week must span DISTINCT
 * functional sub-patterns (flexion → extension → rotation → grip) rather than
 * stacking the same one. The pre-existing within-week movement-id variety only
 * stops the SAME movement twice — two different wrist-FLEXION curls would still
 * both seat. This test proves the new sub-pattern penalty steers the second
 * focus day onto a different sub-pattern even when another same-sub-pattern
 * movement (a different id) is available.
 */
import { describe, expect, it } from "vitest";
import { pickAccessoriesForSession, type CatalogMovement } from "../accessory-picker";
import type { AccessoryProfile } from "../accessory-roles";

function mv(over: Partial<CatalogMovement> & { id: string; slug: string }): CatalogMovement {
  return {
    id: over.id,
    slug: over.slug,
    displayName: over.displayName ?? over.slug,
    primaryMuscles: over.primaryMuscles ?? ["forearms"],
    secondaryMuscles: over.secondaryMuscles ?? [],
    primaryRegion: over.primaryRegion ?? "elbow_forearm",
    secondaryRegions: over.secondaryRegions ?? [],
    bulletproofRoles: over.bulletproofRoles ?? [],
    functionalRoles: over.functionalRoles ?? [],
    isSupported: over.isSupported ?? false,
    isCompound: over.isCompound ?? false,
    eccentricLoadScore: over.eccentricLoadScore ?? null,
    stimToFatigueScore: over.stimToFatigueScore ?? null,
    highStrainTendon: over.highStrainTendon ?? false,
    pattern: over.pattern ?? "isolation",
  };
}

// Two wrist-FLEXION curls (distinct ids, same sub-pattern) + one extension + one
// rotation. Movement-id variety alone could pick the second flexion on day 2;
// only the sub-pattern penalty forces a different pattern.
const CATALOG: CatalogMovement[] = [
  mv({ id: "wrist-curl-db", slug: "wrist-curl-db" }),
  mv({ id: "wrist-curl-bb", slug: "wrist-curl-bb" }),
  mv({ id: "reverse-wrist-curl", slug: "reverse-wrist-curl" }),
  mv({ id: "db-pronation-supination", slug: "db-pronation-supination" }),
];

const PROFILE: AccessoryProfile = {
  aesthetic: { itemsPerSession: 0, setsPerItem: 2, repRange: { min: 12, max: 15 }, biasSupported: false },
  functional: { weeklyRoleRequirements: {} },
  durability: { extras: [] },
};

const EMPTY_FILTERS = {
  blockedRegions: new Set<string>(),
  concurrentStressActive: false,
  recentlyUsedMovementIds: new Set<string>(),
  tendinopathyActive: false,
};

type Hist = Parameters<typeof pickAccessoriesForSession>[0]["weekAccessoryHistory"];

function runDay(history: Hist) {
  return pickAccessoriesForSession({
    profile: PROFILE,
    weekDeloadScale: 1.0,
    catalog: CATALOG,
    weekAccessoryHistory: history,
    filters: EMPTY_FILTERS,
    // forearms aesthetic target 0 → the AESTHETIC gap-fill seats no forearm work,
    // so the focus MEV floor (one item per session) is the only seater. Mirrors a
    // low-accessory endurance block where the cross-day focus picks are what must
    // diversify sub-patterns.
    perMuscleTargets: { forearms: 0 },
    maxItems: 4,
    focusMuscles: ["forearms"],
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

const SUBPATTERN: Record<string, string> = {
  "wrist-curl-db": "flexion",
  "wrist-curl-bb": "flexion",
  "reverse-wrist-curl": "extension",
  "db-pronation-supination": "rotation",
};

describe("ADR 0043 — focus sub-pattern diversity", () => {
  it("a second focus day picks a DIFFERENT sub-pattern, not just a different movement", () => {
    const history: Hist = [];
    const day1 = runDay(history);
    record(history, day1);
    const day1Slug = day1.find((p) => p.movementId.includes("wrist") || p.movementId.includes("pronation"))!.movementId;
    const day1Sub = SUBPATTERN[day1Slug];

    const day2 = runDay(history);
    const day2Slug = day2.find((p) => p.movementId.includes("wrist") || p.movementId.includes("pronation"))!.movementId;
    const day2Sub = SUBPATTERN[day2Slug];

    expect(day1Sub).toBeDefined();
    expect(day2Sub).toBeDefined();
    // The week spans two distinct forearm sub-patterns rather than two flexions.
    expect(day2Sub).not.toBe(day1Sub);
  });
});
