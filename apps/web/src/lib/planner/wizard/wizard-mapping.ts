/**
 * Wizard → Archetype mapping (single canonical home, per AGENTS.md
 * "single home for derived state").
 *
 * Mirrors the mockup's `resolveArchetype()` reduction:
 *
 *   { goal, secondary, days, twoADay } → { archetypeId, daysPerWeek, sessions }
 *
 * Pure. Vitest-tested in `__tests__/wizard-mapping.test.ts`.
 *
 * The wizard's "secondary" channel carries an extra value `"maintenance"`
 * synthesized by the step-1 "See lighter options" link — it overrides goal
 * and resolves to a 2-week light block.
 */
import type { ArchetypeId } from "../archetypes";

export type Goal = "strength" | "muscle" | "cardio" | "resilience";

/**
 * Secondary focus. `"skip"` = single-focus block. `"maintenance"` = the
 * synthetic maintenance shortcut.
 */
export type Secondary = Goal | "skip" | "maintenance";

/** Session breakdown that matches the mockup's shape. */
export type SessionBreakdown = {
  strength: number;
  hypertrophy: number;
  cardio: number;
  tendon: number;
};

export type ResolvedArchetype = {
  /** Mockup id — also matches `ArchetypeId` from the existing archetypes registry. */
  id: Extract<
    ArchetypeId,
    | "strength_anchor"
    | "endurance_anchor"
    | "concurrent_hybrid"
    | "hypertrophy_anchor"
    | "maintenance"
    | "rebuild"
  >;
  name: string;
  weeks: number;
  powerEligible: boolean;
  sessions: SessionBreakdown;
  /**
   * When the secondary focus is expressed as an accessory volume tilt ON the
   * primary's own days (ADR 0020) rather than as standalone sessions, this
   * names the tilt so the preview annotates those days instead of inventing a
   * phantom standalone day the engine never builds. v1: "hypertrophy" for a
   * muscle secondary on strength_anchor. `null`/absent everywhere else.
   */
  accessoryEmphasis?: "hypertrophy" | null;
};

/** Strength-led distribution (primary lift + cardio filler). */
export function distributeStrengthLed(s: number): { strength: number; cardio: number } {
  return { strength: Math.min(4, s), cardio: Math.min(2, Math.max(0, s - 4)) };
}

/** Primary lift + non-cardio secondary (lift + lift). Both modalities present from 2+. */
export function distributeLiftLed(s: number): { primary: number; secondary: number } {
  if (s <= 1) return { primary: 1, secondary: 0 };
  if (s === 2) return { primary: 1, secondary: 1 };
  if (s === 3) return { primary: 2, secondary: 1 };
  if (s === 4) return { primary: 3, secondary: 1 };
  return { primary: 4, secondary: s - 4 };
}

/** Hybrid — strength + cardio. Cap strength at 4 (recovery limit) at higher doses. */
export function distributeHybrid(s: number): { strength: number; cardio: number } {
  if (s <= 1) return { strength: 1, cardio: 0 };
  if (s === 2) return { strength: 1, cardio: 1 };
  if (s === 3) return { strength: 2, cardio: 1 };
  if (s === 4) return { strength: 2, cardio: 2 };
  if (s === 5) return { strength: 3, cardio: 2 };
  if (s === 6) return { strength: 4, cardio: 2 };
  if (s === 7) return { strength: 4, cardio: 3 };
  return { strength: 4, cardio: s - 4 };
}

/** Endurance-led: cardio dominates, strength preservation dose. */
export function distributeEnduranceLed(s: number): { strength: number; cardio: number } {
  if (s === 1) return { strength: 0, cardio: 1 };
  if (s === 2) return { strength: 1, cardio: 1 };
  if (s === 3) return { strength: 1, cardio: 2 };
  if (s === 4) return { strength: 2, cardio: 2 };
  if (s === 5) return { strength: 2, cardio: 3 };
  if (s === 6) return { strength: 2, cardio: 4 };
  if (s === 7) return { strength: 2, cardio: 5 };
  return { strength: 2, cardio: s - 2 };
}

const empty: SessionBreakdown = { strength: 0, hypertrophy: 0, cardio: 0, tendon: 0 };

/**
 * Canonical reduction. Returns null when neither a goal nor the maintenance
 * shortcut has been picked — i.e. the wizard is below step 4.
 */
export function resolveArchetype(input: {
  days: number | null;
  goal: Goal | null;
  secondary: Secondary | null;
  twoADay: boolean;
}): ResolvedArchetype | null {
  const { goal, secondary, twoADay } = input;
  const d = input.days ?? 4;
  const effective = twoADay ? d * 2 : d;

  // ── Maintenance shortcut wins over resilience (matches mockup). ──
  if (secondary === "maintenance") {
    const cap = Math.min(d, 4);
    const strength = Math.max(1, Math.min(2, Math.floor(cap / 2) + (cap % 2)));
    const cardio = Math.max(0, cap - strength);
    return {
      id: "maintenance",
      name: "Maintenance",
      weeks: 2,
      powerEligible: false,
      sessions: { ...empty, strength, cardio },
    };
  }

  if (goal === "resilience") {
    const strength = effective <= 1 ? 0 : Math.floor(effective / 2);
    const tendon = effective <= 1 ? effective : Math.ceil(effective / 2);
    return {
      id: "rebuild",
      name: "Rebuild",
      weeks: 4,
      powerEligible: false,
      sessions: { ...empty, strength, tendon },
    };
  }

  if (goal === "cardio") {
    const dist = distributeEnduranceLed(effective);
    // Secondary not yet picked (null) is treated like an explicit "skip"
    // so the live preview reflects what the user has actually chosen.
    // The sidebar will rebalance once the user picks a secondary on the
    // next step.
    const sessions: SessionBreakdown =
      secondary === "skip" || secondary == null
        ? { ...empty, cardio: effective }
        : { ...empty, strength: dist.strength, cardio: dist.cardio };
    return {
      id: "endurance_anchor",
      name: "Endurance Focus",
      weeks: 4,
      powerEligible: false,
      sessions,
    };
  }

  if (goal === "muscle" && secondary === "cardio") {
    const dist = distributeHybrid(effective);
    return {
      id: "concurrent_hybrid",
      name: "Hybrid Focus",
      weeks: 4,
      powerEligible: true,
      sessions: { ...empty, hypertrophy: dist.strength, cardio: dist.cardio },
    };
  }

  if (goal === "muscle") {
    const dist = distributeLiftLed(effective);
    // Secondary not yet picked (null) is treated like an explicit "skip"
    // so the live preview reflects what the user has actually chosen.
    const sessions: SessionBreakdown =
      secondary === "strength"
        ? { ...empty, hypertrophy: dist.primary, strength: dist.secondary }
        : secondary === "skip" || secondary == null
          ? { ...empty, hypertrophy: effective }
          : { ...empty, hypertrophy: dist.primary, cardio: dist.secondary };
    return {
      id: "hypertrophy_anchor",
      name: "Hypertrophy Focus",
      weeks: 4,
      powerEligible: false,
      sessions,
    };
  }

  if (goal === "strength" && secondary === "cardio") {
    const dist = distributeHybrid(effective);
    return {
      id: "concurrent_hybrid",
      name: "Hybrid Focus",
      weeks: 4,
      powerEligible: true,
      sessions: { ...empty, strength: dist.strength, cardio: dist.cardio },
    };
  }

  if (goal === "strength") {
    const dist = distributeLiftLed(effective);
    // A muscle secondary is delivered as an accessory volume tilt ON the
    // strength days (ADR 0020) — NOT as a standalone hypertrophy day. So the
    // preview keeps every day a strength day (identical to "skip") and flags
    // the emphasis; it must never invent a phantom hypertrophy day the engine
    // doesn't build. Secondary not yet picked (null) is treated like "skip".
    const sessions: SessionBreakdown =
      secondary === "muscle" || secondary === "skip" || secondary == null
        ? { ...empty, strength: effective }
        : { ...empty, strength: dist.primary, cardio: dist.secondary };
    return {
      id: "strength_anchor",
      name: "Strength Focus",
      weeks: 4,
      powerEligible: true,
      sessions,
      accessoryEmphasis: secondary === "muscle" ? "hypertrophy" : null,
    };
  }

  return null;
}

/**
 * The piece the server action ultimately needs: archetype id + days/week.
 * Pulled out so the React component never reads `resolveArchetype()` for
 * submission — keeps server/client wire format narrow.
 */
export function wizardOutput(input: {
  days: number | null;
  goal: Goal | null;
  secondary: Secondary | null;
  twoADay: boolean;
}): { archetypeId: ResolvedArchetype["id"]; daysPerWeek: number } | null {
  const a = resolveArchetype(input);
  if (!a) return null;
  return {
    archetypeId: a.id,
    daysPerWeek: input.days ?? 4,
  };
}
