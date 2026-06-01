/**
 * Wizard → Archetype mapping tests.
 *
 * Cites the mockup's `resolveArchetype()` logic — the contract is that
 * every combination of (primary, secondary, days, twoADay) lands on the
 * same archetype id and session breakdown the mockup ships.
 */
import { describe, it, expect } from "vitest";
import { resolveArchetype, wizardOutput } from "../wizard-mapping";

describe("resolveArchetype — primary × secondary mapping", () => {
  it("returns null when no primary chosen and no maintenance shortcut", () => {
    expect(resolveArchetype({ days: 4, goal: null, secondary: null, twoADay: false })).toBeNull();
  });

  it("strength + skip → strength_anchor, all sessions are strength", () => {
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: "skip", twoADay: false });
    expect(r?.id).toBe("strength_anchor");
    expect(r?.sessions).toEqual({ strength: 4, hypertrophy: 0, cardio: 0, tendon: 0 });
  });

  it("strength + muscle → strength_anchor, all strength days + hypertrophy accessory tilt (no phantom day)", () => {
    // ADR 0020: the muscle secondary is an accessory volume tilt ON the
    // strength days, not a standalone hypertrophy day. Preview must match the
    // block the engine builds: every day is a strength day, flagged with the
    // hypertrophy accessory emphasis.
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: "muscle", twoADay: false });
    expect(r?.id).toBe("strength_anchor");
    expect(r?.sessions).toEqual({ strength: 4, hypertrophy: 0, cardio: 0, tendon: 0 });
    expect(r?.accessoryEmphasis).toBe("hypertrophy");
  });

  it("strength + muscle has the SAME session breakdown as strength + skip (tilt is within-day)", () => {
    const muscle = resolveArchetype({ days: 4, goal: "strength", secondary: "muscle", twoADay: false });
    const skip = resolveArchetype({ days: 4, goal: "strength", secondary: "skip", twoADay: false });
    expect(muscle?.sessions).toEqual(skip?.sessions);
    // The only difference is the emphasis flag — skip has none.
    expect(skip?.accessoryEmphasis).toBe(null);
    expect(muscle?.accessoryEmphasis).toBe("hypertrophy");
  });

  it("strength + cardio → concurrent_hybrid (hybrid distribution)", () => {
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: "cardio", twoADay: false });
    expect(r?.id).toBe("concurrent_hybrid");
    expect(r?.powerEligible).toBe(true);
    expect(r?.sessions).toEqual({ strength: 2, hypertrophy: 0, cardio: 2, tendon: 0 });
  });

  it("muscle + skip → hypertrophy_anchor, single-focus", () => {
    const r = resolveArchetype({ days: 4, goal: "muscle", secondary: "skip", twoADay: false });
    expect(r?.id).toBe("hypertrophy_anchor");
    expect(r?.sessions).toEqual({ strength: 0, hypertrophy: 4, cardio: 0, tendon: 0 });
  });

  it("muscle + strength → hypertrophy_anchor with preservation strength dose", () => {
    const r = resolveArchetype({ days: 4, goal: "muscle", secondary: "strength", twoADay: false });
    expect(r?.id).toBe("hypertrophy_anchor");
    expect(r?.sessions).toEqual({ strength: 1, hypertrophy: 3, cardio: 0, tendon: 0 });
  });

  it("muscle + cardio → concurrent_hybrid (hypertrophy bias)", () => {
    const r = resolveArchetype({ days: 4, goal: "muscle", secondary: "cardio", twoADay: false });
    expect(r?.id).toBe("concurrent_hybrid");
    expect(r?.sessions).toEqual({ strength: 0, hypertrophy: 2, cardio: 2, tendon: 0 });
  });

  it("cardio + skip → endurance_anchor, pure cardio", () => {
    const r = resolveArchetype({ days: 5, goal: "cardio", secondary: "skip", twoADay: false });
    expect(r?.id).toBe("endurance_anchor");
    expect(r?.sessions).toEqual({ strength: 0, hypertrophy: 0, cardio: 5, tendon: 0 });
  });

  it("cardio + strength → endurance_anchor with heavy-maintenance lifts", () => {
    const r = resolveArchetype({ days: 5, goal: "cardio", secondary: "strength", twoADay: false });
    expect(r?.id).toBe("endurance_anchor");
    expect(r?.sessions).toEqual({ strength: 2, hypertrophy: 0, cardio: 3, tendon: 0 });
  });

  it("resilience always → rebuild regardless of secondary (mockup branch)", () => {
    // resilience skips the secondary step in the wizard — secondary is null.
    const r = resolveArchetype({ days: 4, goal: "resilience", secondary: null, twoADay: false });
    expect(r?.id).toBe("rebuild");
    expect(r?.sessions.tendon).toBeGreaterThan(0);
    expect(r?.powerEligible).toBe(false);
  });

  it("maintenance shortcut → 2-week maintenance block (caps at 4 sessions)", () => {
    const r = resolveArchetype({ days: 7, goal: null, secondary: "maintenance", twoADay: false });
    expect(r?.id).toBe("maintenance");
    expect(r?.weeks).toBe(2);
    const total = r!.sessions.strength + r!.sessions.cardio;
    expect(total).toBeLessThanOrEqual(4);
  });

  it("twoADay doubles effective sessions in the strength_anchor distribution", () => {
    const r = resolveArchetype({ days: 3, goal: "strength", secondary: "skip", twoADay: true });
    // 3 days × 2 = 6 effective sessions, all-strength when secondary=skip.
    expect(r?.sessions.strength).toBe(6);
  });

  // ── Step-2 live-preview contract ─────────────────────────────────────
  // When the user has picked a primary but not yet visited Step 3, the
  // sidebar must reflect what they actually chose — primary only, with
  // no phantom secondary sessions. Once Step 3 lands a value, the
  // distribution rebalances.

  it("cardio + null (primary picked, secondary pending) → pure cardio preview", () => {
    const r = resolveArchetype({ days: 6, goal: "cardio", secondary: null, twoADay: false });
    expect(r?.id).toBe("endurance_anchor");
    expect(r?.sessions).toEqual({ strength: 0, hypertrophy: 0, cardio: 6, tendon: 0 });
  });

  it("muscle + null (primary picked, secondary pending) → pure hypertrophy preview", () => {
    const r = resolveArchetype({ days: 4, goal: "muscle", secondary: null, twoADay: false });
    expect(r?.id).toBe("hypertrophy_anchor");
    expect(r?.sessions).toEqual({ strength: 0, hypertrophy: 4, cardio: 0, tendon: 0 });
  });

  it("strength + null (primary picked, secondary pending) → pure strength preview", () => {
    const r = resolveArchetype({ days: 4, goal: "strength", secondary: null, twoADay: false });
    expect(r?.id).toBe("strength_anchor");
    expect(r?.sessions).toEqual({ strength: 4, hypertrophy: 0, cardio: 0, tendon: 0 });
  });
});

describe("wizardOutput — narrow submit shape", () => {
  it("returns id + daysPerWeek", () => {
    const out = wizardOutput({ days: 4, goal: "strength", secondary: "muscle", twoADay: false });
    expect(out).toEqual({ archetypeId: "strength_anchor", daysPerWeek: 4 });
  });
  it("null when no resolution possible", () => {
    expect(wizardOutput({ days: 4, goal: null, secondary: null, twoADay: false })).toBeNull();
  });
});
