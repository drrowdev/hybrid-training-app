/**
 * Maintenance-floor advisory math (ADR 0051 Phase 2, Decision 7).
 *
 * When a Season block concentrates one quality (`strength_bias` /
 * `endurance_bias`), the OTHER quality must be held at a maintenance floor so it
 * doesn't detrain. This module is the PURE, client-safe half: the floor targets
 * (frequency + volume) and the plain-English advisory, computed from a
 * server-supplied `FloorContext` (the user's rolling baseline + the interference
 * scalar AT the floor). It imports nothing engine-side and never enters the
 * generator — this is a read-only check that SHOWS, never blocks (Decision 4).
 *
 * Science: maintenance via preserved FREQUENCY at ~⅓ accumulation volume —
 * principle per Bickel 2011 (Med Sci Sports Exerc 43(7), HIGH). The exact
 * magnitudes below are CP-1 heuristics (consistent-with, not equal-to, Bickel),
 * with the ADR 0051 A6 validation plan (measured retention of the held quality).
 */

/** Min sessions/week of the held quality. heuristic — Bickel 2011 frequency
 *  principle (HIGH); the count is a CP-1 heuristic, no calibration data. */
export const MAINTENANCE_FREQUENCY_FLOOR = 2;

/** Held quality keeps ≥ this fraction of its rolling baseline weekly volume.
 *  heuristic — "~⅓" maintenance region per Bickel 2011 (direction HIGH); the
 *  exact fraction is a CP-1 placeholder. Expressed as a rational, not a fake
 *  decimal, per CP-3. */
export const MAINTENANCE_VOLUME_FLOOR_FRAC = 1 / 3;

/** How far a `*_bias` block tilts the displayed balance from 50/50 (→ ~60/40).
 *  heuristic — Season bias shift (CP-1), practitioner-consensus, no RCT value.
 *  ADVISORY/display only in Option B — it does NOT change the generator. */
export const SEASON_BIAS_SHIFT = 0.1;

/** Rolling window (days) for the cardio/strength baseline. 4 weeks → a stable
 *  weekly average (steadier than the engine's 7/14-day interference windows). */
export const BASELINE_WINDOW_DAYS = 28;

/** Server-computed context for the advisory (plain data crossing to the client). */
export interface FloorContext {
  /** Rolling weekly cardio minutes (baseline). */
  cardioBaselineMinPerWk: number;
  /** Rolling weekly cardio sessions (frequency baseline). */
  cardioSessionsPerWk: number;
  /** Rolling weekly strength sessions (frequency baseline). */
  strengthSessionsPerWk: number;
  /** Interference scalar (1.0 = none) if cardio is held at the volume floor —
   *  computed server-side via the existing concurrent-scalar model. */
  cardioScalarAtFloor: number;
}

export type FloorSeverity = "ok" | "watch";

export interface FloorAdvisory {
  /** Which quality this block holds at the floor. */
  heldQuality: "cardio" | "strength";
  /** Frequency floor (sessions/week). */
  floorSessions: number;
  /** Volume floor (cardio minutes/week); null for the strength-held case. */
  floorMinPerWk: number | null;
  /** Interference scalar at the floor (cardio case only). */
  scalarAtFloor: number | null;
  severity: FloorSeverity;
}

/** Round to the nearest 5 for friendly minute targets. */
function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

/**
 * Build the floor advisory for a bias emphasis from the user's baseline context.
 * Returns null for non-bias emphases (no held quality) or when there's no
 * baseline data to ground the numbers.
 */
export function floorAdvisory(emphasis: string, ctx: FloorContext | null): FloorAdvisory | null {
  if (!ctx) return null;
  if (emphasis === "strength_bias") {
    // Held quality = cardio. Show frequency + volume floor + interference at floor.
    const floorMin = round5(ctx.cardioBaselineMinPerWk * MAINTENANCE_VOLUME_FLOOR_FRAC);
    // "watch" when holding cardio at the floor still imposes meaningful
    // interference on the concentrated strength work (scalar materially < 1).
    const severity: FloorSeverity = ctx.cardioScalarAtFloor < 0.9 ? "watch" : "ok";
    return {
      heldQuality: "cardio",
      floorSessions: MAINTENANCE_FREQUENCY_FLOOR,
      floorMinPerWk: floorMin,
      scalarAtFloor: ctx.cardioScalarAtFloor,
      severity,
    };
  }
  if (emphasis === "endurance_bias") {
    // Held quality = strength. Frequency is the dominant maintenance lever; no
    // interference scalar applies to the strength side.
    return {
      heldQuality: "strength",
      floorSessions: MAINTENANCE_FREQUENCY_FLOOR,
      floorMinPerWk: null,
      scalarAtFloor: null,
      severity: "ok",
    };
  }
  return null;
}

/** Plain-English advisory line for a bias block (honest, never a mandate). */
export function floorAdvisoryText(adv: FloorAdvisory): string {
  if (adv.heldQuality === "strength") {
    return `Keep ≥${adv.floorSessions} strength sessions/wk at maintenance so you don’t detrain it.`;
  }
  if (!adv.floorMinPerWk || adv.floorMinPerWk <= 0) {
    return `You log little cardio right now — keep ≥${adv.floorSessions} easy sessions/wk to hold your engine.`;
  }
  const pct = adv.scalarAtFloor != null ? Math.round(adv.scalarAtFloor * 100) : null;
  const interferes =
    adv.severity === "watch"
      ? ` — even there, concurrent interference is ~${pct}% of baseline, so consider trimming cardio further`
      : pct != null
        ? ` — at that floor interference is minimal (~${pct}%)`
        : "";
  return `Hold cardio ≥${adv.floorSessions}×/wk and ≥~${adv.floorMinPerWk} min/wk${interferes}.`;
}

/** Read-only balance split for a bias block (display only). Null for non-bias. */
export function balanceSplit(
  emphasis: string,
): { primaryLabel: string; primaryPct: number; secondaryLabel: string; secondaryPct: number } | null {
  const primaryPct = Math.round((0.5 + SEASON_BIAS_SHIFT) * 100);
  const secondaryPct = 100 - primaryPct;
  if (emphasis === "strength_bias") {
    return { primaryLabel: "Strength", primaryPct, secondaryLabel: "Endurance", secondaryPct };
  }
  if (emphasis === "endurance_bias") {
    return { primaryLabel: "Endurance", primaryPct, secondaryLabel: "Strength", secondaryPct };
  }
  return null;
}
