/**
 * ADR 0006 — demote bench + OHP from anchor in STRENGTH_ANCHOR and
 * HYPERTROPHY_ANCHOR so dual-main-lift folding (ADR 0005) actually
 * triggers at low frequency. Closes the audit gap recorded in ADR 0005
 * open follow-ups.
 *
 * Behavioural contracts:
 *   (a) STRENGTH_ANCHOR + HYPERTROPHY_ANCHOR at every supported freq ≥ 2
 *       cover all four canonical patterns (squat, deadlift,
 *       horizontal_press, vertical_press) after fold.
 *   (b) High-frequency regression guard: at the archetype's max freq, all
 *       four strength days return and fold is a no-op (no day carries a
 *       runtime `secondaryRole`).
 *   (c) Priority exact-match: bench + OHP are `optional`, squat + deadlift
 *       remain `anchor`, in both `days` and `twoADayDays`.
 *   (d) Cross-archetype invariant: every non-`disableFolding` archetype
 *       ships balanced (4-pattern coverage) at every freq in [2..6].
 */
import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  HYPERTROPHY_ANCHOR,
  STRENGTH_ANCHOR,
  daysForFrequency,
  maxDaysForArchetype,
  minDaysForArchetype,
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

const findStrengthByRole = (
  archetype: Archetype,
  role: StrengthRole,
): StrengthDay | undefined =>
  archetype.days.find(
    (d): d is StrengthDay => d.kind === "strength" && d.role === role,
  );

const findTwoADayAmByRole = (
  archetype: Archetype,
  role: StrengthRole,
): StrengthDay | undefined =>
  archetype.twoADayDays?.find(
    (d): d is StrengthDay =>
      d.kind === "strength" && d.role === role && d.slot === "am",
  );

describe("ADR 0006 — balance STRENGTH_ANCHOR + HYPERTROPHY_ANCHOR at low frequency", () => {
  describe("Priority demotion — STRENGTH_ANCHOR `days`", () => {
    it("squat and deadlift remain anchor priority", () => {
      expect(findStrengthByRole(STRENGTH_ANCHOR, "squat")!.priority).toBe(
        "anchor",
      );
      expect(findStrengthByRole(STRENGTH_ANCHOR, "deadlift")!.priority).toBe(
        "anchor",
      );
    });

    it("bench and OHP are demoted to optional with ranks 7 / 8", () => {
      const bench = findStrengthByRole(STRENGTH_ANCHOR, "horizontal_press")!;
      const ohp = findStrengthByRole(STRENGTH_ANCHOR, "vertical_press")!;
      expect(bench.priority).toBe("optional");
      expect(bench.rank).toBe(7);
      expect(ohp.priority).toBe("optional");
      expect(ohp.rank).toBe(8);
    });
  });

  describe("Priority demotion — STRENGTH_ANCHOR `twoADayDays`", () => {
    it("squat AM and deadlift AM remain anchor priority", () => {
      expect(findTwoADayAmByRole(STRENGTH_ANCHOR, "squat")!.priority).toBe(
        "anchor",
      );
      expect(findTwoADayAmByRole(STRENGTH_ANCHOR, "deadlift")!.priority).toBe(
        "anchor",
      );
    });

    it("bench AM and OHP AM are demoted to optional with ranks 7 / 8", () => {
      const bench = findTwoADayAmByRole(STRENGTH_ANCHOR, "horizontal_press")!;
      const ohp = findTwoADayAmByRole(STRENGTH_ANCHOR, "vertical_press")!;
      expect(bench.priority).toBe("optional");
      expect(bench.rank).toBe(7);
      expect(ohp.priority).toBe("optional");
      expect(ohp.rank).toBe(8);
    });
  });

  describe("Priority demotion — HYPERTROPHY_ANCHOR `days`", () => {
    it("squat and deadlift remain anchor priority", () => {
      expect(findStrengthByRole(HYPERTROPHY_ANCHOR, "squat")!.priority).toBe(
        "anchor",
      );
      expect(findStrengthByRole(HYPERTROPHY_ANCHOR, "deadlift")!.priority).toBe(
        "anchor",
      );
    });

    it("bench and OHP are demoted to optional with ranks 7 / 8", () => {
      const bench = findStrengthByRole(
        HYPERTROPHY_ANCHOR,
        "horizontal_press",
      )!;
      const ohp = findStrengthByRole(HYPERTROPHY_ANCHOR, "vertical_press")!;
      expect(bench.priority).toBe("optional");
      expect(bench.rank).toBe(7);
      expect(ohp.priority).toBe("optional");
      expect(ohp.rank).toBe(8);
    });
  });

  describe("Priority demotion — HYPERTROPHY_ANCHOR `twoADayDays`", () => {
    it("squat AM and deadlift AM remain anchor priority", () => {
      expect(findTwoADayAmByRole(HYPERTROPHY_ANCHOR, "squat")!.priority).toBe(
        "anchor",
      );
      expect(
        findTwoADayAmByRole(HYPERTROPHY_ANCHOR, "deadlift")!.priority,
      ).toBe("anchor");
    });

    it("bench AM and OHP AM are demoted to optional with ranks 7 / 8", () => {
      const bench = findTwoADayAmByRole(
        HYPERTROPHY_ANCHOR,
        "horizontal_press",
      )!;
      const ohp = findTwoADayAmByRole(HYPERTROPHY_ANCHOR, "vertical_press")!;
      expect(bench.priority).toBe("optional");
      expect(bench.rank).toBe(7);
      expect(ohp.priority).toBe("optional");
      expect(ohp.rank).toBe(8);
    });
  });

  describe("STRENGTH_ANCHOR — fold triggers at low frequency", () => {
    it("freq=2: trim is squat + deadlift; fold attaches OHP + bench (cap=5); all four patterns covered", () => {
      const trimmed = daysForFrequency(STRENGTH_ANCHOR, 2, false);
      const trimS = strengthOnly(trimmed);
      expect(trimS.length).toBe(2);
      expect(trimS.map((d) => d.role).sort()).toEqual(["deadlift", "squat"]);

      const folded = foldDualMainLifts(STRENGTH_ANCHOR, trimmed);
      const sDays = strengthOnly(folded);
      expect(sDays.length).toBe(2);

      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);

      const squatDay = sDays.find((d) => d.role === "squat")!;
      const deadDay = sDays.find((d) => d.role === "deadlift")!;
      expect(squatDay.secondaryRole).toBe("vertical_press");
      expect(deadDay.secondaryRole).toBe("horizontal_press");
      expect(squatDay.secondaryMaxSets).toBe(5);
      expect(deadDay.secondaryMaxSets).toBe(5);
      expect(STRENGTH_ANCHOR.foldedSecondaryMaxSets).toBe(5);
    });

    it("freq=3: trim is squat + deadlift + Z2 cardio; fold still covers both upper patterns", () => {
      const trimmed = daysForFrequency(STRENGTH_ANCHOR, 3, false);
      const trimS = strengthOnly(trimmed);
      expect(trimS.length).toBe(2);
      const folded = foldDualMainLifts(STRENGTH_ANCHOR, trimmed);
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
    });
  });

  describe("STRENGTH_ANCHOR — high-frequency regression guard", () => {
    it("freq=6 (max): all four strength days return, fold is a no-op", () => {
      const max = maxDaysForArchetype(STRENGTH_ANCHOR, false);
      expect(max).toBe(6);
      const trimmed = daysForFrequency(STRENGTH_ANCHOR, max, false);
      const trimS = strengthOnly(trimmed);
      expect(trimS.length).toBe(4);
      const rolesPresent = new Set(trimS.map((d) => d.role));
      for (const p of ALL_FOUR) expect(rolesPresent.has(p)).toBe(true);

      const folded = foldDualMainLifts(STRENGTH_ANCHOR, trimmed);
      for (const d of strengthOnly(folded)) {
        expect(d.secondaryRole).toBeUndefined();
      }
    });
  });

  describe("HYPERTROPHY_ANCHOR — fold triggers at low frequency", () => {
    it("freq=2: trim is squat + deadlift; fold attaches OHP + bench (cap=4); all four patterns covered", () => {
      const trimmed = daysForFrequency(HYPERTROPHY_ANCHOR, 2, false);
      const trimS = strengthOnly(trimmed);
      expect(trimS.length).toBe(2);
      expect(trimS.map((d) => d.role).sort()).toEqual(["deadlift", "squat"]);

      const folded = foldDualMainLifts(HYPERTROPHY_ANCHOR, trimmed);
      const sDays = strengthOnly(folded);
      expect(sDays.length).toBe(2);

      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);

      for (const d of sDays) {
        expect(d.secondaryMaxSets).toBe(4);
      }
      expect(HYPERTROPHY_ANCHOR.foldedSecondaryMaxSets).toBe(4);
    });

    it("freq=3: trim is squat + deadlift + Z2; fold still covers both upper patterns", () => {
      const trimmed = daysForFrequency(HYPERTROPHY_ANCHOR, 3, false);
      const folded = foldDualMainLifts(HYPERTROPHY_ANCHOR, trimmed);
      const roles = rolesCovered(folded);
      for (const p of ALL_FOUR) expect(roles.has(p)).toBe(true);
    });
  });

  describe("HYPERTROPHY_ANCHOR — high-frequency regression guard", () => {
    it("freq=5 (max): all four strength days return, fold is a no-op", () => {
      const max = maxDaysForArchetype(HYPERTROPHY_ANCHOR, false);
      expect(max).toBe(5);
      const trimmed = daysForFrequency(HYPERTROPHY_ANCHOR, max, false);
      const trimS = strengthOnly(trimmed);
      expect(trimS.length).toBe(4);
      const rolesPresent = new Set(trimS.map((d) => d.role));
      for (const p of ALL_FOUR) expect(rolesPresent.has(p)).toBe(true);

      const folded = foldDualMainLifts(HYPERTROPHY_ANCHOR, trimmed);
      for (const d of strengthOnly(folded)) {
        expect(d.secondaryRole).toBeUndefined();
      }
    });
  });

  describe("minDaysForArchetype reflects the demotion", () => {
    it("STRENGTH_ANCHOR min drops from 4 → 2 (squat + deadlift anchors only)", () => {
      expect(minDaysForArchetype(STRENGTH_ANCHOR, false)).toBe(2);
    });

    it("STRENGTH_ANCHOR two-a-day min drops from 4 → 2", () => {
      expect(minDaysForArchetype(STRENGTH_ANCHOR, true)).toBe(2);
    });

    it("HYPERTROPHY_ANCHOR min drops from 4 → 2", () => {
      expect(minDaysForArchetype(HYPERTROPHY_ANCHOR, false)).toBe(2);
    });

    it("HYPERTROPHY_ANCHOR two-a-day min drops from 4 → 2", () => {
      expect(minDaysForArchetype(HYPERTROPHY_ANCHOR, true)).toBe(2);
    });
  });

  describe("All-archetypes-balanced invariant (user intent: no lower-only weeks)", () => {
    // For every archetype where folding is enabled (i.e. not REBUILD /
    // MAINTENANCE), at every supported frequency from the archetype's
    // min..max, the post-fold day list MUST cover all four canonical
    // patterns. This is the durable guarantee against re-introducing a
    // lower-only configuration in any future archetype edit.
    it.each(Object.entries(ARCHETYPES))(
      "%s — every supported frequency covers all four patterns after fold",
      (_id, archetype) => {
        if (archetype.disableFolding === true) return;
        const min = minDaysForArchetype(archetype, false);
        const max = maxDaysForArchetype(archetype, false);
        for (let freq = min; freq <= max; freq++) {
          const trimmed = daysForFrequency(archetype, freq, false);
          const folded = foldDualMainLifts(archetype, trimmed);
          const roles = rolesCovered(folded);
          for (const p of ALL_FOUR) {
            expect(
              roles.has(p),
              `${archetype.id} @ freq=${freq}: missing canonical pattern '${p}' after fold`,
            ).toBe(true);
          }
        }
      },
    );

    it.each(Object.entries(ARCHETYPES))(
      "%s — two-a-day variant: every supported frequency covers all four patterns after fold",
      (_id, archetype) => {
        if (archetype.disableFolding === true) return;
        if (!archetype.twoADayDays || archetype.twoADayDays.length === 0)
          return;
        const min = minDaysForArchetype(archetype, true);
        const max = maxDaysForArchetype(archetype, true);
        for (let freq = min; freq <= max; freq++) {
          const trimmed = daysForFrequency(archetype, freq, true);
          const folded = foldDualMainLifts(archetype, trimmed);
          const roles = rolesCovered(folded);
          for (const p of ALL_FOUR) {
            expect(
              roles.has(p),
              `${archetype.id} (2-a-day) @ freq=${freq}: missing canonical pattern '${p}' after fold`,
            ).toBe(true);
          }
        }
      },
    );
  });
});
