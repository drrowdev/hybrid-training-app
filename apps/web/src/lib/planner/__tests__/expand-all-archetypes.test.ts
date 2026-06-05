/**
 * Cross-archetype regression for the accessory-set expansion fix.
 *
 * The logging view treats one prescription item = one loggable set, so every
 * PERSISTED prescription must contain only single-set items. This pins that
 * invariant for EVERY archetype (not just strength_anchor), driving the REAL
 * shared assembler per strength day and applying the same
 * `expandPrescriptionSetItems` the storage boundaries use.
 *
 * It also asserts the fix is non-vacuous: across the archetypes, the raw
 * assembler output DOES contain multi-set items (so expansion is doing real
 * work), and expansion preserves the total set count + per-item duration.
 */
import { describe, it, expect } from "vitest";
import { ARCHETYPES, type StrengthDay, type Archetype } from "../archetypes";
import type { CatalogMovement } from "../accessory-picker";
import { assembleQuickStrengthItems } from "../quick-generate";
import { expandPrescriptionSetItems } from "../expand-prescription-sets";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";

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

// A catalog broad enough that every archetype's accessory gap-fill finds picks.
const CATALOG: CatalogMovement[] = [
  mv({ id: "sl1", slug: "bulgarian-split-squat", functionalRoles: ["single_leg"], primaryRegion: "knee", primaryMuscles: ["quads", "glutes"], isCompound: true }),
  mv({ id: "lr1", slug: "db-lateral-raise", primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lr2", slug: "cable-lateral-raise", isSupported: true, primaryMuscles: ["side_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "tri1", slug: "rope-pushdown", isSupported: true, primaryMuscles: ["triceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "bi1", slug: "db-curl", primaryMuscles: ["biceps"], primaryRegion: "elbow_forearm" }),
  mv({ id: "rd1", slug: "rear-delt-fly", primaryMuscles: ["rear_delts"], primaryRegion: "shoulder_scapular" }),
  mv({ id: "lat1", slug: "lat-pulldown", isSupported: true, primaryMuscles: ["lats"], primaryRegion: "shoulder_scapular", isCompound: true }),
  mv({ id: "calf1", slug: "seated-calf-raise", primaryMuscles: ["calves"], primaryRegion: "ankle_foot" }),
  mv({ id: "ham1", slug: "leg-curl", primaryMuscles: ["hamstrings"], primaryRegion: "knee", isSupported: true }),
  mv({ id: "abs1", slug: "ab-wheel", primaryMuscles: ["abs"], primaryRegion: "lumbar_trunk", functionalRoles: ["anti_extension"] }),
  mv({ id: "chest1", slug: "incline-db-press", primaryMuscles: ["chest"], primaryRegion: "shoulder_scapular", isCompound: true }),
  mv({ id: "row1", slug: "chest-supported-row", primaryMuscles: ["back"], primaryRegion: "shoulder_scapular", isSupported: true, isCompound: true, functionalRoles: ["compound_assistance"] }),
];

function strengthDays(a: Archetype): StrengthDay[] {
  return a.days.filter((d): d is StrengthDay => d.kind === "strength");
}

function mainFor(day: StrengthDay) {
  // The quick path passes the resolved main movement directly; the slug only
  // needs to be present in movementBySlug for warm-up / back-off resolution.
  const slug = day.candidateSlugs[0] ?? `${day.role}-main`;
  return { id: `main-${day.role}`, slug, displayName: `${day.role} main` };
}

describe("expand-prescription-sets — all archetypes", () => {
  const ids = Object.keys(ARCHETYPES) as Array<keyof typeof ARCHETYPES>;
  let rawMultiSetSeenAnywhere = false;

  for (const id of ids) {
    const archetype = ARCHETYPES[id];
    const days = strengthDays(archetype);

    it(`${id}: has at least one strength day to assemble`, () => {
      expect(days.length).toBeGreaterThan(0);
    });

    for (const day of days) {
      for (const length of ["normal", "short"] as const) {
        it(`${id} · ${day.role} · ${length}: every stored item is single-set`, () => {
          const main = mainFor(day);
          const raw = assembleQuickStrengthItems({
            archetype,
            day,
            movement: main,
            movementBySlug: new Map([
              [main.slug, { id: main.id, slug: main.slug, display_name: main.displayName }],
            ]),
            catalog: CATALOG,
            omitMainStrength: false,
            experience: null,
            freshnessByGroup: new Map(),
            length,
          });

          if (raw.some((it) => (it.sets ?? 1) > 1)) rawMultiSetSeenAnywhere = true;

          const expanded = expandPrescriptionSetItems(raw);

          // INVARIANT: no persisted item carries more than one set.
          for (const it of expanded) {
            expect(it.sets ?? 1).toBeLessThanOrEqual(1);
          }

          // Expansion conserves total prescribed sets…
          const rawTotal = raw.reduce((n, it) => n + (it.sets ?? 1), 0);
          expect(expanded.length).toBe(rawTotal);

          // …and the duration estimate (which sums per-item sets) is unchanged.
          expect(estimateSessionMinutes(expanded)).toBe(estimateSessionMinutes(raw));
        });
      }
    }
  }

  it("the raw assembler genuinely emits multi-set items (fix is non-vacuous)", () => {
    expect(rawMultiSetSeenAnywhere).toBe(true);
  });
});
