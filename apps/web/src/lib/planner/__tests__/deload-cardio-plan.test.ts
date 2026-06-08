/**
 * ADR 0037 — coherent multi-modal deload.
 *
 * `deloadCardioPlan` is the pure decision the materialization loops consult to
 * downgrade a maximal VO2 day to a sub-maximal touch and drop the alactic
 * finisher on the deload week (5/3/1 7th-Week Protocol / Tactical Barbell
 * deload: reduce INTENSITY, not just volume). These tests pin the matrix +
 * confirm the substitute slugs are preloaded into the catalog and that the
 * resulting effective day renders as a real reduced-intensity session.
 */
import { describe, it, expect } from "vitest";
import {
  ENDURANCE_ANCHOR,
  buildPrescription,
  deloadCardioPlan,
  requiredCardioSlugs,
  DELOAD_VO2_TO_Z2_SLUG,
  DELOAD_VO2_TO_THRESHOLD_SLUG,
  type CardioDay,
  type DayTemplate,
  type WeekProfile,
} from "../archetypes";

const FAKE_PRIMARY = { id: "p-id", slug: "p-slug", displayName: "Primary Cardio" };

const VO2_DAY = ENDURANCE_ANCHOR.days.find(
  (d): d is CardioDay => d.kind === "cardio" && d.cardioKind === "cardio_vo2",
)!;
const Z2_ALACTIC_DAY = ENDURANCE_ANCHOR.days.find(
  (d): d is CardioDay => d.kind === "cardio" && d.finisher != null,
)!;
const DELOAD_PROFILE = ENDURANCE_ANCHOR.weekProfiles.find(
  (w) => w.intensityLabel === "Deload",
)!;
const LOADING_PROFILE = ENDURANCE_ANCHOR.weekProfiles.find(
  (w) => w.intensityLabel !== "Deload",
)!;

describe("ADR 0037 — deloadCardioPlan", () => {
  it("returns null on a loading week (loading weeks stay byte-identical)", () => {
    expect(deloadCardioPlan(VO2_DAY, LOADING_PROFILE, 4, 3)).toBeNull();
    expect(deloadCardioPlan(Z2_ALACTIC_DAY, LOADING_PROFILE, 6, 3)).toBeNull();
  });

  it("downgrades a deload VO2 day to easy Z2 at normal frequency", () => {
    const plan = deloadCardioPlan(VO2_DAY, DELOAD_PROFILE, 4, 3);
    expect(plan).not.toBeNull();
    expect(plan!.slugOverride).toBe(DELOAD_VO2_TO_Z2_SLUG);
    expect(plan!.cardioKindOverride).toBe("cardio_z2");
  });

  it("keeps ONE threshold touch on a deload VO2 day at frequency >= 5 for a VO2-earning tier", () => {
    const plan = deloadCardioPlan(VO2_DAY, DELOAD_PROFILE, 5, 2);
    expect(plan!.slugOverride).toBe(DELOAD_VO2_TO_THRESHOLD_SLUG);
    expect(plan!.cardioKindOverride).toBe("cardio_threshold");
  });

  it("never makes the deload HARDER than a loading week for a lower tier (always easy Z2)", () => {
    // Tier 1 resolves the loading-week VO2 day down to a tempo run already, so
    // the deload must not jump them up to a threshold session.
    const plan = deloadCardioPlan(VO2_DAY, DELOAD_PROFILE, 6, 1);
    expect(plan!.cardioKindOverride).toBe("cardio_z2");
    expect(plan!.slugOverride).toBe(DELOAD_VO2_TO_Z2_SLUG);
  });

  it("drops the alactic finisher on a deload Z2+alactic day", () => {
    const plan = deloadCardioPlan(Z2_ALACTIC_DAY, DELOAD_PROFILE, 4, 3);
    expect(plan).not.toBeNull();
    expect(plan!.dropFinisher).toBe(true);
    // A plain Z2 day is not movement-swapped — only the finisher is dropped.
    expect(plan!.slugOverride).toBeUndefined();
    expect(plan!.cardioKindOverride).toBeUndefined();
  });

  it("is a no-op for a deload plain-Z2 day with no finisher", () => {
    const plainZ2 = ENDURANCE_ANCHOR.days.find(
      (d): d is CardioDay =>
        d.kind === "cardio" && d.cardioKind === "cardio_z2" && d.finisher == null,
    );
    if (plainZ2) {
      expect(deloadCardioPlan(plainZ2, DELOAD_PROFILE, 4, 3)).toBeNull();
    }
  });
});

describe("ADR 0037 — requiredCardioSlugs preloads the deload substitutes", () => {
  it("includes both VO2 deload substitutes for an archetype with a VO2 day + deload", () => {
    const slugs = requiredCardioSlugs(ENDURANCE_ANCHOR);
    expect(slugs).toContain(DELOAD_VO2_TO_Z2_SLUG);
    expect(slugs).toContain(DELOAD_VO2_TO_THRESHOLD_SLUG);
  });
});

describe("ADR 0037 — the effective deload day renders a reduced-intensity session", () => {
  it("VO2→Z2 conversion renders one easy-Z2 item, no alactic, at the trimmed duration", () => {
    // Mirrors the actions.ts effective-day construction.
    const effectiveDay = {
      ...VO2_DAY,
      cardioKind: "cardio_z2",
      finisher: undefined,
      hrCap: undefined,
      protocolNote: undefined,
    } as CardioDay;
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      DELOAD_PROFILE.weekIndex,
      effectiveDay as DayTemplate,
      FAKE_PRIMARY,
    );
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("cardio_z2");
    expect(items.some((i) => i.kind === "cardio_alactic")).toBe(false);
    const z2Override = (DELOAD_PROFILE as WeekProfile).z2DurationMinOverride;
    if (z2Override != null) {
      expect(items[0]!.durationMin).toBe(z2Override);
    }
  });

  it("finisher-drop renders the base Z2 only (no alactic) on the deload week", () => {
    const effectiveDay = { ...Z2_ALACTIC_DAY, finisher: undefined } as CardioDay;
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      DELOAD_PROFILE.weekIndex,
      effectiveDay as DayTemplate,
      FAKE_PRIMARY,
      // Even if a finisher movement is offered, the dropped finisher field means
      // no alactic item is emitted.
      { id: "f-id", slug: "f-slug", displayName: "Sprint Finisher" },
    );
    expect(items.some((i) => i.kind === "cardio_alactic")).toBe(false);
    expect(items[0]!.kind).toBe("cardio_z2");
  });
});
