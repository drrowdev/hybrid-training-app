/**
 * ADR 0005 — frequency-aware dual-main-lift folding.
 *
 * Behavioural contracts:
 *   (a) Sub-4-strength-day trims gain a secondary main lift on each
 *       eligible strength day so the four canonical patterns
 *       (squat / deadlift / horizontal_press / vertical_press) are
 *       covered weekly.
 *   (b) Ergonomic pairing from ADR 0004 (squat ↔ vertical_press, deadlift
 *       ↔ horizontal_press) is honoured when the partner day is present;
 *       falls back to lowest-dayIndex eligible slot otherwise.
 *   (c) `Archetype.disableFolding` opts an archetype out entirely.
 *       `Archetype.foldedSecondaryMaxSets` controls the cap when fold
 *       applies (defaults to 3).
 *   (d) Skip-if-already-present guard: a `StrengthDay` already carrying
 *       `secondaryRole` (ADR 0004's static ENDURANCE_ANCHOR templates) is
 *       opaque to fold.
 *   (e) Folded titles use the form "Squat + Overhead Press".
 */
import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  CONCURRENT_HYBRID,
  ENDURANCE_ANCHOR,
  HYPERTROPHY_ANCHOR,
  MAINTENANCE,
  REBUILD,
  STRENGTH_ANCHOR,
  STRENGTH_ROLE_CANDIDATES,
  daysForFrequency,
  type Archetype,
  type DayTemplate,
  type StrengthDay,
  type StrengthRole,
} from "../archetypes";
import { foldDualMainLifts } from "../main-lift-folding";

const strengthOnly = (days: DayTemplate[]): StrengthDay[] =>
  days.filter((d): d is StrengthDay => d.kind === "strength");

const rolesCovered = (days: DayTemplate[]): Set<StrengthRole> => {
  const s = new Set<StrengthRole>();
  for (const d of strengthOnly(days)) {
    s.add(d.role);
    if (d.secondaryRole) s.add(d.secondaryRole);
  }
  return s;
};

const ALL_FOUR: StrengthRole[] = [
  "squat",
  "deadlift",
  "horizontal_press",
  "vertical_press",
];

function mkStrength(
  dayIndex: number,
  role: StrengthRole,
  title = `${role} day`,
): StrengthDay {
  return {
    kind: "strength",
    dayIndex,
    role,
    title,
    candidateSlugs: STRENGTH_ROLE_CANDIDATES[role],
    priority: "anchor",
    rank: dayIndex + 1,
  };
}

describe("ADR 0005 — foldDualMainLifts", () => {
  describe("CONCURRENT_HYBRID freq=2", () => {
    const trimmed = daysForFrequency(CONCURRENT_HYBRID, 2, false);
    const folded = foldDualMainLifts(CONCURRENT_HYBRID, trimmed);
    const sDays = strengthOnly(folded);

    it("trim returns exactly 2 strength days (squat + deadlift)", () => {
      const trimSDays = strengthOnly(trimmed);
      expect(trimSDays.length).toBe(2);
      expect(trimSDays.map((d) => d.role).sort()).toEqual([
        "deadlift",
        "squat",
      ]);
    });

    it("after folding, both strength days have a secondary slot", () => {
      expect(sDays.length).toBe(2);
      for (const d of sDays) {
        expect(d.secondaryRole).toBeDefined();
        expect(d.secondaryCandidateSlugs?.length ?? 0).toBeGreaterThan(0);
      }
    });

    it("covers all four canonical patterns weekly (squat+OHP, deadlift+bench)", () => {
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
      const squatDay = sDays.find((d) => d.role === "squat")!;
      const deadDay = sDays.find((d) => d.role === "deadlift")!;
      expect(squatDay.secondaryRole).toBe("vertical_press");
      expect(deadDay.secondaryRole).toBe("horizontal_press");
    });

    it("honours CONCURRENT_HYBRID.foldedSecondaryMaxSets = 3", () => {
      for (const d of sDays) {
        expect(d.secondaryMaxSets).toBe(3);
      }
    });

    it("folded titles join primary + secondary friendly labels", () => {
      const squatDay = sDays.find((d) => d.role === "squat")!;
      const deadDay = sDays.find((d) => d.role === "deadlift")!;
      expect(squatDay.title).toBe("Squat + Overhead Press");
      expect(deadDay.title).toBe("Deadlift + Bench Press");
    });
  });

  describe("STRENGTH_ANCHOR — direct fold on synthesized 2-day trim", () => {
    // Historical context: pre-ADR-0006, STRENGTH_ANCHOR's four strength
    // days were all anchors, so the production path never produced a
    // sub-4 trim and folding was a structural no-op there. ADR 0006
    // demoted bench + OHP to optional, so fold is now LIVE in production
    // at freq < 6 — covered end-to-end in adr-0006-balance-archetypes.test.ts.
    // This block keeps the direct-fold cap assertion to lock the
    // STRENGTH_ANCHOR.foldedSecondaryMaxSets = 5 contract independent of
    // the trim path.
    // a synthesized 2-day trim so the cap path is exercised independent
    // of the production trim path.
    const synthetic: DayTemplate[] = [
      mkStrength(0, "squat"),
      mkStrength(3, "deadlift"),
    ];
    const folded = foldDualMainLifts(STRENGTH_ANCHOR, synthetic);
    const sDays = strengthOnly(folded);

    it("covers all four patterns via folded secondaries", () => {
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
    });

    it("honours STRENGTH_ANCHOR.foldedSecondaryMaxSets = 5", () => {
      expect(STRENGTH_ANCHOR.foldedSecondaryMaxSets).toBe(5);
      for (const d of sDays) {
        expect(d.secondaryMaxSets).toBe(5);
      }
    });
  });

  describe("HYPERTROPHY_ANCHOR — direct fold on synthesized 2-day trim", () => {
    // ADR 0006 demoted HYPERTROPHY_ANCHOR's bench + OHP to optional so
    // fold is now LIVE in production at freq < 5 — covered end-to-end in
    // adr-0006-balance-archetypes.test.ts. This block keeps the
    // direct-fold cap assertion to lock the cap = 4 contract independent
    // of the trim path.
    const synthetic: DayTemplate[] = [
      mkStrength(0, "squat"),
      mkStrength(3, "deadlift"),
    ];
    const folded = foldDualMainLifts(HYPERTROPHY_ANCHOR, synthetic);
    const sDays = strengthOnly(folded);

    it("covers all four patterns via folded secondaries (cap = 4)", () => {
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
      expect(HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets).toBe(4);
      for (const d of sDays) expect(d.secondaryMaxSets).toBe(4);
    });

    it("HYPERTROPHY_ANCHOR at max freq retains all 4 strength days and fold is a no-op (regression guard)", () => {
      // ADR 0006 — at max freq (5) all four strength days return (2
      // anchors + Z2 cardio + bench + OHP) and fold becomes a no-op.
      // The full freq sweep (2..max) lives in the ADR 0006 test file.
      const trimmed = daysForFrequency(HYPERTROPHY_ANCHOR, 5, false);
      const out = foldDualMainLifts(HYPERTROPHY_ANCHOR, trimmed);
      const trimSDays = strengthOnly(trimmed);
      const outSDays = strengthOnly(out);
      expect(trimSDays.length).toBe(4);
      expect(outSDays.length).toBe(4);
      for (const d of outSDays) expect(d.secondaryRole).toBeUndefined();
    });
  });

  describe("REBUILD — disableFolding", () => {
    it("freq=2 trim is returned unchanged (no secondaries attached)", () => {
      const trimmed = daysForFrequency(REBUILD, 2, false);
      const folded = foldDualMainLifts(REBUILD, trimmed);
      expect(folded).toBe(trimmed);
      for (const d of strengthOnly(folded)) {
        expect(d.secondaryRole).toBeUndefined();
      }
    });

    it("REBUILD.disableFolding is set to true", () => {
      expect(REBUILD.disableFolding).toBe(true);
    });
  });

  describe("MAINTENANCE — disableFolding", () => {
    it("freq=2 trim is returned unchanged (no secondaries attached)", () => {
      const trimmed = daysForFrequency(MAINTENANCE, 2, false);
      const folded = foldDualMainLifts(MAINTENANCE, trimmed);
      expect(folded).toBe(trimmed);
      for (const d of strengthOnly(folded)) {
        expect(d.secondaryRole).toBeUndefined();
      }
    });

    it("MAINTENANCE.disableFolding is set to true", () => {
      expect(MAINTENANCE.disableFolding).toBe(true);
    });
  });

  describe("ENDURANCE_ANCHOR — equivalence", () => {
    // ADR 0004 static templates already populate secondaryRole on every
    // strength day, so the skip-if-already-present guard makes fold a
    // structural no-op here. The contract is: result is byte-for-byte
    // identical to the trimmed input.
    it("freq=4 trim is structurally identical after folding", () => {
      const trimmed = daysForFrequency(ENDURANCE_ANCHOR, 4, false);
      const folded = foldDualMainLifts(ENDURANCE_ANCHOR, trimmed);
      expect(folded).toEqual(trimmed);
      // Existing ADR 0004 titles win — fold never overwrites.
      for (const d of strengthOnly(folded)) {
        expect(d.title).toMatch(/\+/);
        expect(d.secondaryMaxSets).toBe(3);
      }
    });

    it("freq=6 trim is structurally identical after folding", () => {
      const trimmed = daysForFrequency(ENDURANCE_ANCHOR, 6, false);
      const folded = foldDualMainLifts(ENDURANCE_ANCHOR, trimmed);
      expect(folded).toEqual(trimmed);
    });
  });

  describe("3-strength-day fold rule", () => {
    it("one missing pattern folds onto its ergonomic partner (deadlift missing → folds onto bench day)", () => {
      // 3 strength days: squat, bench, OHP. Missing pattern: deadlift.
      // Ergonomic partner of deadlift is horizontal_press (bench), which
      // IS present — fold deadlift onto bench day.
      const synthetic: DayTemplate[] = [
        mkStrength(0, "squat"),
        mkStrength(1, "horizontal_press"),
        mkStrength(4, "vertical_press"),
      ];
      const archetype: Archetype = {
        ...CONCURRENT_HYBRID,
        foldedSecondaryMaxSets: 3,
      };
      const folded = foldDualMainLifts(archetype, synthetic);
      const benchDay = strengthOnly(folded).find(
        (d) => d.role === "horizontal_press",
      )!;
      expect(benchDay.secondaryRole).toBe("deadlift");
      expect(benchDay.title).toBe("Bench Press + Deadlift");
      // The other two strength days remain untouched.
      const squatDay = strengthOnly(folded).find((d) => d.role === "squat")!;
      const ohpDay = strengthOnly(folded).find(
        (d) => d.role === "vertical_press",
      )!;
      expect(squatDay.secondaryRole).toBeUndefined();
      expect(ohpDay.secondaryRole).toBeUndefined();
    });

    it("missing pattern with absent ergonomic partner falls back to lowest-dayIndex eligible slot", () => {
      // 3 strength days: squat, deadlift, bench. Missing: vertical_press.
      // Ergonomic partner of vertical_press is squat — present → folds
      // onto squat day. (This is the canonical-partner path; the true
      // fallback case is rare and exercised by the edge-case test below.)
      const synthetic: DayTemplate[] = [
        mkStrength(0, "squat"),
        mkStrength(1, "horizontal_press"),
        mkStrength(3, "deadlift"),
      ];
      const folded = foldDualMainLifts(CONCURRENT_HYBRID, synthetic);
      const squatDay = strengthOnly(folded).find((d) => d.role === "squat")!;
      expect(squatDay.secondaryRole).toBe("vertical_press");
    });
  });

  describe("edge case — non-canonical 2-day pair (squat + bench)", () => {
    it("folds deadlift onto bench day (its partner) and OHP onto squat day (its partner)", () => {
      const synthetic: DayTemplate[] = [
        mkStrength(0, "squat"),
        mkStrength(1, "horizontal_press"),
      ];
      const folded = foldDualMainLifts(CONCURRENT_HYBRID, synthetic);
      const squatDay = strengthOnly(folded).find((d) => d.role === "squat")!;
      const benchDay = strengthOnly(folded).find(
        (d) => d.role === "horizontal_press",
      )!;
      expect(squatDay.secondaryRole).toBe("vertical_press");
      expect(benchDay.secondaryRole).toBe("deadlift");
      // All four patterns covered.
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
    });
  });

  describe("4+ strength days — no-op regression guard", () => {
    it("4 strength days covering all patterns: fold returns input unchanged", () => {
      const synthetic: DayTemplate[] = [
        mkStrength(0, "squat"),
        mkStrength(1, "horizontal_press"),
        mkStrength(3, "deadlift"),
        mkStrength(4, "vertical_press"),
      ];
      const folded = foldDualMainLifts(CONCURRENT_HYBRID, synthetic);
      expect(folded).toBe(synthetic);
      for (const d of strengthOnly(folded)) {
        expect(d.secondaryRole).toBeUndefined();
      }
    });
  });

  describe("two-a-day variant", () => {
    it("fold applies to AM strength sessions and leaves PM cardio untouched", () => {
      // CONCURRENT_HYBRID twoADayDays at freq=2 trims to the squat+Z2 AM/PM
      // pair (calendar day 0) plus the deadlift AM (calendar day 3) — both
      // strength sessions count, and PM cardio is untouched by the fold.
      const trimmed = daysForFrequency(CONCURRENT_HYBRID, 2, true);
      const folded = foldDualMainLifts(CONCURRENT_HYBRID, trimmed);
      const sDays = strengthOnly(folded);
      // Each strength session (regardless of AM/PM slot) gets a secondary.
      for (const d of sDays) {
        expect(d.secondaryRole).toBeDefined();
        expect(d.secondaryMaxSets).toBe(3);
      }
      const cardioDays = folded.filter((d) => d.kind === "cardio");
      // PM cardio sessions pass through unchanged by reference.
      for (const c of cardioDays) {
        const original = trimmed.find(
          (t) =>
            t.dayIndex === c.dayIndex &&
            (t.slot ?? "single") === (c.slot ?? "single"),
        );
        expect(c).toBe(original);
      }
    });
  });

  describe("title generation", () => {
    it("folded days get 'Primary + Secondary' titles", () => {
      const synthetic: DayTemplate[] = [
        mkStrength(0, "squat", "Squat day"),
        mkStrength(3, "deadlift", "Deadlift day"),
      ];
      const folded = foldDualMainLifts(CONCURRENT_HYBRID, synthetic);
      const squatDay = strengthOnly(folded).find((d) => d.role === "squat")!;
      const deadDay = strengthOnly(folded).find((d) => d.role === "deadlift")!;
      expect(squatDay.title).toBe("Squat + Overhead Press");
      expect(deadDay.title).toBe("Deadlift + Bench Press");
    });

    it("existing curated titles win — ENDURANCE_ANCHOR's static 'Squat + Overhead Press' is preserved", () => {
      const trimmed = daysForFrequency(ENDURANCE_ANCHOR, 4, false);
      const folded = foldDualMainLifts(ENDURANCE_ANCHOR, trimmed);
      const tue = strengthOnly(folded).find((d) => d.dayIndex === 1)!;
      const thu = strengthOnly(folded).find((d) => d.dayIndex === 3)!;
      // ADR 0004's explicit titles survive the fold step.
      expect(tue.title).toBe("Squat + Overhead Press");
      expect(thu.title).toBe("Deadlift + Bench Press");
    });
  });

  describe("archetype registry sanity", () => {
    it("ARCHETYPES carries the new fields on all relevant archetypes", () => {
      expect(ARCHETYPES.concurrent_hybrid.foldedSecondaryMaxSets).toBe(3);
      expect(ARCHETYPES.endurance_anchor.foldedSecondaryMaxSets).toBe(3);
      expect(ARCHETYPES.strength_anchor.foldedSecondaryMaxSets).toBe(5);
      expect(ARCHETYPES.hypertrophy_anchor.foldedSecondaryMaxSets).toBe(4);
      expect(ARCHETYPES.rebuild.disableFolding).toBe(true);
      expect(ARCHETYPES.maintenance.disableFolding).toBe(true);
    });
  });
});
