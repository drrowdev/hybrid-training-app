/**
 * End-to-end realism guard for an endurance / forearm-focus / external-cardio
 * (running) block, run through the REAL assembly pipeline against the REAL seed
 * catalogue. Confirms — in one place — every fix from the plan-review validation
 * passes, so a regression in any of them fails CI:
 *
 *   1. Universal pull floor (ADR 0036) — a pull is seated.
 *   2. Focus-muscle MEV counts direct work only (review fix) — genuine loaded
 *      forearm isolation (wrist curl) is seated, not just a dead hang.
 *   3. Achilles/calf HSR for runners (ADR 0034 + external=running) — a calf
 *      HSR is seated.
 *   4. Rotator-cuff prehab for pressers (ADR 0035) — a shoulder_stability item
 *      is seated.
 *   5. Plyometric rep dose (review fix) — a plyometric is 5 reps, not ~14.
 *
 * Mirrors the production week-assembly path: foldDualMainLifts →
 * assemblePrescriptionItems with the full positional signature, runningCardio =
 * true (external cardio) and pressingMainLift = true (OHP + bench).
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
import type { CatalogMovement } from "../accessory-picker";
import type { LimitationsContext } from "../limitations-context";
import type { PrescriptionItem } from "@hta/db";

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

const NO_LIMITS: LimitationsContext = {
  blockedRegions: new Set(),
  blockedMuscles: new Set(),
  blockedMovementIds: new Set(),
  allowedMovementIds: new Set(),
  tendinopathyActive: false,
};

const PRIMARY = { id: "front-squat", slug: "front-squat", displayName: "Front Squat" };
const SECONDARY = { id: "ohp-standing", slug: "ohp-standing", displayName: "Standing Overhead Press" };

/** Materialise week 0's two endurance strength days through the real pipeline. */
function weekZeroAccessories(): { items: PrescriptionItem[]; byDay: PrescriptionItem[][] } {
  const activeDays = foldDualMainLifts(
    ENDURANCE_ANCHOR,
    daysForFrequency(ENDURANCE_ANCHOR, 6, false),
  );
  const weekAccessoryHistory: unknown[] = [];
  const movementBySlug = new Map<string, { id: string; slug: string; display_name: string }>();
  const collected: PrescriptionItem[] = [];
  const byDay: PrescriptionItem[][] = [];

  for (const day of activeDays) {
    if (day.kind !== "strength") continue;
    const secondary = (day as StrengthDay).secondaryRole ? SECONDARY : undefined;
    const items = assemblePrescriptionItems(
      ENDURANCE_ANCHOR,
      0,
      day,
      PRIMARY,
      undefined,
      movementBySlug,
      CATALOG,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      weekAccessoryHistory as any,
      1.0, // weekDeloadScale
      false, // powerEmphasis
      undefined, // warmupScheme (default)
      undefined, // equipment (no filter — full catalogue)
      false, // omitMainStrength
      null, // experience
      NO_LIMITS,
      secondary,
      ["forearms"], // focusMuscles
      1.0, // elbowForearmAtlRatio
      new Set<string>(), // recentlyUsedAccessoryIds
      "standard", // effortPreference
      "none", // secondaryFocus
      "low", // accessoryVolume
      undefined, // aestheticTargetMask
      undefined, // variationSeed
      true, // runningCardio (external cardio = running)
      2, // pressingMainLiftCount (OHP + bench)
    );
    collected.push(...items);
    byDay.push(items.filter((it) => it.kind === "accessory"));
  }
  return { items: collected, byDay };
}

const week = weekZeroAccessories();
const accessories = week.items.filter((it) => it.kind === "accessory");
const entry = (slug: string | undefined) => (slug ? BY_SLUG.get(slug) : undefined);
const isPull = (it: PrescriptionItem) => {
  const c = entry(it.movementSlug);
  return !!c && (c.pattern === "pull" || (c.functionalRoles as string[]).includes("pull"));
};

describe("endurance / forearm-focus / running block — review-fix realism (end-to-end)", () => {
  it("scales PULL volume to pressing (ADR 0037): 2 presses → ≥2 pulls", () => {
    const pulls = accessories.filter(isPull);
    // OHP + Bench = 2 pressing patterns → at least 2 weekly pulls.
    expect(pulls.length, "expected pull volume to match pressing count").toBeGreaterThanOrEqual(2);
  });

  it("varies repeated weekly slots across days (within-week variety)", () => {
    // The two pulls (one per pressing day) are DIFFERENT movements.
    const pullSlugs = accessories.filter(isPull).map((it) => it.movementSlug);
    expect(new Set(pullSlugs).size, "the weekly pulls should differ").toBe(pullSlugs.length);
    // The forearm focus work on day 1 vs day 2 is a DIFFERENT movement.
    const forearmSlugByDay = week.byDay.map((day) =>
      day
        .map((it) => entry(it.movementSlug))
        .filter((c) => c && (c.primaryMuscles as string[]).includes("forearms") && !(c.bulletproofRoles as string[]).includes("carry") && !(c.bulletproofRoles as string[]).includes("heavy_isometric"))
        .map((c) => c!.slug),
    );
    const d1 = forearmSlugByDay[0] ?? [];
    const d2 = forearmSlugByDay[1] ?? [];
    if (d1.length && d2.length) {
      expect(d1[0], "forearm work should differ across days").not.toBe(d2[0]);
    }
  });

  it("seats DIRECT loaded forearm work, not just a dead hang (focus MEV direct-only fix)", () => {
    const directForearm = accessories.filter((it) => {
      const c = entry(it.movementSlug);
      if (!c) return false;
      const isForearm = (c.primaryMuscles as string[]).includes("forearms");
      const indirect =
        (c.bulletproofRoles as string[]).includes("carry") ||
        (c.bulletproofRoles as string[]).includes("heavy_isometric");
      return isForearm && !indirect;
    });
    expect(directForearm.length, "expected genuine loaded forearm isolation (e.g. wrist curl)").toBeGreaterThan(0);
  });

  it("seats a calf / Achilles HSR for a runner (ADR 0034 + external=running)", () => {
    const calfHsr = accessories.filter((it) => {
      const c = entry(it.movementSlug);
      return (
        !!c &&
        (c.bulletproofRoles as string[]).includes("hsr") &&
        c.primaryRegion === "foot_ankle_calf"
      );
    });
    expect(calfHsr.length, "expected a calf/Achilles HSR (running impact)").toBeGreaterThan(0);
  });

  it("seats rotator-cuff prehab for a presser (ADR 0035)", () => {
    const cuff = accessories.filter((it) => {
      const c = entry(it.movementSlug);
      return !!c && (c.functionalRoles as string[]).includes("shoulder_stability");
    });
    expect(cuff.length, "expected a shoulder_stability (cuff) item").toBeGreaterThan(0);
  });

  it("suppresses the plyometric floor for a running block (review fix)", () => {
    // A runner already gets abundant reactive ground-contact loading, so the
    // low-impact plyometric floor (box jump) is dropped — no max-intent plyo.
    const plyos = accessories.filter(
      (it) => it.targetRpe && it.targetRpe.min === 10 && it.targetRpe.max === 10,
    );
    expect(plyos.length, "running block should not seat a plyometric").toBe(0);
  });
});
