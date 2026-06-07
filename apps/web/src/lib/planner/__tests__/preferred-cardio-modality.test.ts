import { describe, it, expect } from "vitest";

import {
  normalizeCardioModality,
  sanitizePreferredModalities,
  resolvePreferredCardioModality,
  blockUsesRunningCardio,
  type CardioCatalogEntry,
} from "../preferred-cardio-modality";

/**
 * Catalog fixture mirroring the real seed coverage matrix (ADR 0017):
 *  - running / cycling / rowing: full ladder (z2, threshold, vo2, alactic)
 *  - swimming: z2 only
 * Equipment + experienceMin set to exercise the filters.
 */
const CATALOG: CardioCatalogEntry[] = [
  // running (default vehicle) — full ladder, no machine needed
  { slug: "run-easy-z2", modality: "running", cardioKind: "cardio_z2", equipment: "shoes", experienceMin: null },
  { slug: "run-threshold", modality: "running", cardioKind: "cardio_threshold", equipment: "shoes", experienceMin: 1 },
  { slug: "run-vo2-4x4", modality: "running", cardioKind: "cardio_vo2", equipment: "shoes", experienceMin: 2 },
  { slug: "run-hill-sprints", modality: "running", cardioKind: "cardio_alactic", equipment: "outdoor-hill", experienceMin: 2 },
  // cycling — full ladder. Indoor needs a bike machine; outdoor needs none.
  { slug: "bike-indoor-z2", modality: "cycling", cardioKind: "cardio_z2", equipment: "stationary-bike", experienceMin: null },
  { slug: "bike-outdoor-easy", modality: "cycling", cardioKind: "cardio_z2", equipment: "road-bike", experienceMin: null },
  { slug: "bike-indoor-threshold", modality: "cycling", cardioKind: "cardio_threshold", equipment: "stationary-bike", experienceMin: 1 },
  { slug: "bike-indoor-vo2-4x4", modality: "cycling", cardioKind: "cardio_vo2", equipment: "stationary-bike", experienceMin: 2 },
  { slug: "bike-indoor-sprints", modality: "cycling", cardioKind: "cardio_alactic", equipment: "stationary-bike", experienceMin: 2 },
  // rowing — full ladder, erg machine
  { slug: "erg-z2", modality: "rowing", cardioKind: "cardio_z2", equipment: "erg", experienceMin: null },
  { slug: "erg-intervals-500", modality: "rowing", cardioKind: "cardio_vo2", equipment: "erg", experienceMin: 2 },
  // swimming — z2 only (no threshold/vo2/alactic in catalog)
  { slug: "swim-easy", modality: "swimming", cardioKind: "cardio_z2", equipment: "pool", experienceMin: null },
];

const ALL_GEAR = ["treadmill", "rower", "bike_air", "bike_recumbent", "ski_erg", "elliptical"] as const;

function resolve(over: Partial<Parameters<typeof resolvePreferredCardioModality>[0]>) {
  return resolvePreferredCardioModality({
    defaultSlug: "run-easy-z2",
    cardioKind: "cardio_z2",
    preferred: ["cycling"],
    ownedCardio: ALL_GEAR,
    userTier: 4,
    catalog: CATALOG,
    ...over,
  });
}

describe("normalizeCardioModality", () => {
  it("maps seed synonyms + hyphen variants to canonical tokens", () => {
    expect(normalizeCardioModality("running")).toBe("running");
    expect(normalizeCardioModality("bike")).toBe("cycling");
    expect(normalizeCardioModality("biking")).toBe("cycling");
    expect(normalizeCardioModality("row")).toBe("rowing");
    expect(normalizeCardioModality("ski-erg")).toBe("ski_erg");
    expect(normalizeCardioModality("Stairmaster")).toBe("stair");
  });
  it("returns null for un-substitutable modalities", () => {
    expect(normalizeCardioModality("jump-rope")).toBeNull();
    expect(normalizeCardioModality("other")).toBeNull();
    expect(normalizeCardioModality("")).toBeNull();
    expect(normalizeCardioModality(null)).toBeNull();
  });
});

describe("sanitizePreferredModalities", () => {
  it("drops unknown tokens, de-dupes, preserves rank order", () => {
    expect(
      sanitizePreferredModalities(["cycling", "pickleball", "cycling", "rowing"]),
    ).toEqual(["cycling", "rowing"]);
  });
  it("returns [] for null/empty", () => {
    expect(sanitizePreferredModalities(null)).toEqual([]);
    expect(sanitizePreferredModalities([])).toEqual([]);
  });
});

describe("resolvePreferredCardioModality — identity invariants", () => {
  it("empty preference returns the default slug, not substituted", () => {
    const r = resolve({ preferred: [] });
    expect(r).toEqual({ slug: "run-easy-z2", substituted: false, modality: null });
  });
  it("null preference returns the default slug", () => {
    expect(resolve({ preferred: null }).slug).toBe("run-easy-z2");
  });
  it("cardio_other is never substituted", () => {
    const r = resolve({ cardioKind: "cardio_other", preferred: ["cycling"] });
    expect(r.substituted).toBe(false);
    expect(r.slug).toBe("run-easy-z2");
  });
  it("preferring the default's own modality keeps the exact default slug", () => {
    const r = resolve({ defaultSlug: "run-easy-z2", preferred: ["running"] });
    expect(r).toEqual({ slug: "run-easy-z2", substituted: false, modality: "running" });
  });
});

describe("resolvePreferredCardioModality — substitution across the ladder", () => {
  it("cycling preferred, Z2 day → a cycling Z2 slug", () => {
    const r = resolve({ cardioKind: "cardio_z2", preferred: ["cycling"] });
    expect(r.substituted).toBe(true);
    expect(r.modality).toBe("cycling");
    // lowest slug among feasible cycling z2 candidates
    expect(r.slug).toBe("bike-indoor-z2");
  });
  it("cycling preferred, VO2 day → cycling VO2 slug", () => {
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["cycling"],
    });
    expect(r.slug).toBe("bike-indoor-vo2-4x4");
    expect(r.substituted).toBe(true);
  });
  it("swimming preferred, Z2 day → swim", () => {
    const r = resolve({ cardioKind: "cardio_z2", preferred: ["swimming"] });
    expect(r.slug).toBe("swim-easy");
    expect(r.modality).toBe("swimming");
  });
});

describe("resolvePreferredCardioModality — fallback chain", () => {
  it("swimming preferred, VO2 day → falls back to default (no swim VO2)", () => {
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["swimming"],
    });
    expect(r.substituted).toBe(false);
    expect(r.slug).toBe("run-vo2-4x4");
    expect(r.modality).toBeNull();
  });
  it("ranked [swimming, cycling], VO2 day → skips swimming, lands cycling", () => {
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["swimming", "cycling"],
    });
    expect(r.slug).toBe("bike-indoor-vo2-4x4");
    expect(r.modality).toBe("cycling");
  });
});

describe("resolvePreferredCardioModality — equipment filter", () => {
  it("excludes machine-gated candidates the user can't run; keeps outdoor", () => {
    // Only treadmill owned → indoor bike (any_bike) excluded, road-bike ok.
    const r = resolve({
      cardioKind: "cardio_z2",
      preferred: ["cycling"],
      ownedCardio: ["treadmill"],
    });
    expect(r.slug).toBe("bike-outdoor-easy");
    expect(r.substituted).toBe(true);
  });
  it("falls back when every candidate in the modality needs unowned gear", () => {
    // Rowing VO2 needs an erg; user owns only a treadmill → no feasible row.
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["rowing"],
      ownedCardio: ["treadmill"],
    });
    expect(r.substituted).toBe(false);
    expect(r.slug).toBe("run-vo2-4x4");
  });
  it("empty owned gear shows everything (gym assumption)", () => {
    const r = resolve({
      cardioKind: "cardio_z2",
      preferred: ["cycling"],
      ownedCardio: [],
    });
    expect(r.substituted).toBe(true);
    expect(r.modality).toBe("cycling");
  });
});

describe("resolvePreferredCardioModality — experience-tier filter", () => {
  it("excludes a VO2 candidate above the user's tier → falls back", () => {
    // bike VO2 requires tier 2; user is tier 1.
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["cycling"],
      userTier: 1,
    });
    expect(r.substituted).toBe(false);
    expect(r.slug).toBe("run-vo2-4x4");
  });
  it("null tier allows any candidate", () => {
    const r = resolve({
      defaultSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      preferred: ["cycling"],
      userTier: null,
    });
    expect(r.slug).toBe("bike-indoor-vo2-4x4");
  });
});

describe("blockUsesRunningCardio (ADR 0034)", () => {
  const shared = {
    ownedCardio: ALL_GEAR,
    userTier: 4 as number | null,
    catalog: CATALOG,
  };
  const z2Day = { cardioKind: "cardio_z2" as const, defaultSlug: "run-easy-z2" };
  const vo2Day = { cardioKind: "cardio_vo2" as const, defaultSlug: "run-vo2-4x4" };

  it("returns true when no modality preference is set (all cardio is running default)", () => {
    expect(blockUsesRunningCardio([z2Day, vo2Day], { ...shared, preferred: [] })).toBe(true);
  });

  it("returns false when a full-ladder modality (cycling) substitutes every day away from running", () => {
    expect(
      blockUsesRunningCardio([z2Day, vo2Day], { ...shared, preferred: ["cycling"] }),
    ).toBe(false);
  });

  it("returns true when a z2-only modality (swimming) still falls back to running on interval days", () => {
    // swimming covers z2 but not vo2 → the vo2 day stays on running.
    expect(
      blockUsesRunningCardio([z2Day, vo2Day], { ...shared, preferred: ["swimming"] }),
    ).toBe(true);
  });

  it("ignores external / unzoned cardio days", () => {
    const externalDay = { cardioKind: "cardio_other" as const, defaultSlug: "whatever" };
    expect(
      blockUsesRunningCardio([externalDay], { ...shared, preferred: [] }),
    ).toBe(false);
  });

  it("returns true when running is the explicit top preference", () => {
    expect(
      blockUsesRunningCardio([z2Day], { ...shared, preferred: ["running", "cycling"] }),
    ).toBe(true);
  });
});
