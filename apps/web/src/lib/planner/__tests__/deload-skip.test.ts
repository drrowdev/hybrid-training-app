/**
 * ADR 0031 (Phase 2) — pure deload-skip eligibility + deload-week resolution.
 */
import { describe, it, expect } from "vitest";
import {
  deloadWeekIndexFor,
  deloadWeekIndexFromRoles,
  resolveDeloadWeekIndex,
  isDeloadSkipEligible,
  DELOAD_SKIP_RECOVERED_WEEKS,
} from "../deload-skip";

describe("deloadWeekIndexFor", () => {
  it("returns the last week for the standard 7-week archetypes", () => {
    // strength_anchor etc. now run 6 build weeks + 1 deload (ADR 0030).
    expect(deloadWeekIndexFor("strength_anchor", 7)).toBe(6);
    expect(deloadWeekIndexFor("concurrent_hybrid", 7)).toBe(6);
    expect(deloadWeekIndexFor("hypertrophy_anchor", 7)).toBe(6);
  });

  it("returns null for maintenance (no deload week)", () => {
    expect(deloadWeekIndexFor("maintenance", 2)).toBeNull();
  });

  it("uses the last week for custom blocks", () => {
    expect(deloadWeekIndexFor("custom", 5)).toBe(4);
    expect(deloadWeekIndexFor("custom", 1)).toBe(0);
  });

  it("returns null for an unknown non-custom archetype", () => {
    expect(deloadWeekIndexFor("nonsense", 7)).toBeNull();
  });
});

describe("deloadWeekIndexFromRoles (ADR 0046 Phase 3)", () => {
  it("returns the earliest week with a deload-role session", () => {
    expect(
      deloadWeekIndexFromRoles([
        { weekIndex: 0, role: "primary" },
        { weekIndex: 6, role: "deload" },
        { weekIndex: 6, role: "deload" },
      ]),
    ).toBe(6);
  });

  it("returns the MIN deload week when several exist (e.g. 5/3/1 7th weeks)", () => {
    expect(
      deloadWeekIndexFromRoles([
        { weekIndex: 3, role: "deload" },
        { weekIndex: 7, role: "deload" },
      ]),
    ).toBe(3);
  });

  it("returns null when no session is a deload", () => {
    expect(deloadWeekIndexFromRoles([{ weekIndex: 0, role: "primary" }, { weekIndex: 1, role: null }])).toBeNull();
    expect(deloadWeekIndexFromRoles([])).toBeNull();
  });
});

describe("resolveDeloadWeekIndex (role-derived with archetype fallback)", () => {
  it("prefers the materialised plan's deload week (foreign programs, archetype NULL)", () => {
    expect(
      resolveDeloadWeekIndex({
        archetype: null,
        weeks: 8,
        sessions: [{ weekIndex: 3, role: "deload" }],
      }),
    ).toBe(3);
  });

  it("matches the archetype config for a Hybrid block (role-derived == config)", () => {
    // strength_anchor's deload is week 6; a Hybrid block tags week 6 role=deload.
    expect(
      resolveDeloadWeekIndex({
        archetype: "strength_anchor",
        weeks: 7,
        sessions: [{ weekIndex: 6, role: "deload" }],
      }),
    ).toBe(6);
  });

  it("falls back to the archetype config when no session carries a deload role (legacy)", () => {
    expect(
      resolveDeloadWeekIndex({
        archetype: "strength_anchor",
        weeks: 7,
        sessions: [{ weekIndex: 0, role: "primary" }],
      }),
    ).toBe(6);
    // custom fallback → last week
    expect(resolveDeloadWeekIndex({ archetype: "custom", weeks: 5, sessions: [] })).toBe(4);
    // foreign with no deload session and no archetype → null
    expect(resolveDeloadWeekIndex({ archetype: null, weeks: 6, sessions: [] })).toBeNull();
  });
});

describe("isDeloadSkipEligible", () => {
  const base = {
    deloadWeekIndex: 6,
    currentWeekIndex: 6,
    skippableSessionCount: 3,
    reactiveDeloadCount: 0,
    recentLoggedRecovered: [true, true] as boolean[],
  };

  it("is eligible in the deload week with recovered recent weeks", () => {
    expect(isDeloadSkipEligible(base)).toBe(true);
  });

  it("is eligible the week BEFORE the deload", () => {
    expect(isDeloadSkipEligible({ ...base, currentWeekIndex: 5 })).toBe(true);
  });

  it("is NOT eligible two weeks before the deload", () => {
    expect(isDeloadSkipEligible({ ...base, currentWeekIndex: 4 })).toBe(false);
  });

  it("is NOT eligible without a deload week (maintenance)", () => {
    expect(isDeloadSkipEligible({ ...base, deloadWeekIndex: null })).toBe(false);
  });

  it("is NOT eligible when the deload week has no un-started sessions", () => {
    expect(isDeloadSkipEligible({ ...base, skippableSessionCount: 0 })).toBe(false);
  });

  it("is NOT eligible when a reactive deload already fired this block", () => {
    expect(isDeloadSkipEligible({ ...base, reactiveDeloadCount: 1 })).toBe(false);
  });

  it("is NOT eligible with too few logged weeks of evidence", () => {
    expect(
      isDeloadSkipEligible({ ...base, recentLoggedRecovered: [true] }),
    ).toBe(false);
  });

  it("is NOT eligible when a recent week was NOT recovered", () => {
    expect(
      isDeloadSkipEligible({ ...base, recentLoggedRecovered: [true, false] }),
    ).toBe(false);
    expect(
      isDeloadSkipEligible({ ...base, recentLoggedRecovered: [false, true] }),
    ).toBe(false);
  });

  it("only inspects the most-recent DELOAD_SKIP_RECOVERED_WEEKS weeks", () => {
    // An older non-recovered week beyond the window does not block eligibility.
    const flags = [true, true, false, false];
    expect(flags.length).toBeGreaterThan(DELOAD_SKIP_RECOVERED_WEEKS);
    expect(
      isDeloadSkipEligible({ ...base, recentLoggedRecovered: flags }),
    ).toBe(true);
  });
});
