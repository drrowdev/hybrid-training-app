/**
 * ADR 0027 Lever B — synergist credit for compound main lifts.
 *
 * The accessory picker's weekly muscle ledger (`muscleProgress` in
 * `accessory-picker.ts`) is seeded ONLY from prior *accessory* history — the
 * main compound lifts (squat / bench / deadlift / overhead press) never enter
 * it. So muscles those lifts already train as synergists read as completely
 * empty and keep attracting redundant aesthetic gap-fill, while genuinely
 * under-trained muscles (rear delts, biceps, calves) compete on equal footing.
 *
 * This module credits each main lift's synergist coverage into the ledger as
 * FRACTIONAL effective sets, so the aesthetic gap order prioritises the muscles
 * the program actually under-trains.
 *
 * Safety: credit is keyed by strength ROLE and only ever lands on muscles a
 * main lift genuinely trains. Those are exactly the muscles that do NOT need
 * isolation work — so over-crediting (e.g. at a trimmed low frequency, where
 * this computes from the full archetype template) only de-prioritises an
 * already-covered muscle and can never STARVE a truly-missed one. Muscles no
 * main lift trains (biceps, rear_delts, calves) receive 0 from every role and
 * are fully protected.
 */
import type { Archetype, StrengthRole } from "./archetypes";

/**
 * Fixed STRUCTURAL working-set count credited per main-lift exposure. Not
 * deload-scaled — the credit represents stable structural coverage, mirroring
 * how `perMuscleTargets` are structural weekly targets rather than per-week
 * deloaded volume. heuristic CP-1.
 */
export const MAIN_LIFT_NOMINAL_SETS = 3;

/**
 * Fractional effective-set credit a strength role delivers to each AESTHETIC
 * target muscle it trains as a synergist (the picker only gap-fills the 11
 * `AESTHETIC_TARGET_MUSCLES`, so only those muscles are listed; prime-mover
 * muscles like quads / chest / glutes are never gap-filled and need no entry).
 *
 * Magnitudes follow the fractional/indirect set-counting model of Pelland et
 * al. 2026 (PMID 41343037): ~0.5 effective sets per direct set for a strongly
 * involved synergist, scaled down for partial / isometric involvement. Each
 * entry carries a confidence note (CP-3 derived, CP-5 honest-uncertainty).
 *
 * Muscles deliberately absent from EVERY role (biceps, rear_delts, calves) get
 * zero credit and stay first in line for aesthetic work — no main lift trains
 * them.
 */
export const SYNERGIST_CREDIT: Record<StrengthRole, Record<string, number>> = {
  // Bench press. Triceps are a major pressing synergist (long/lateral head
  // heavily active → meaningful growth from heavy pressing). Upper chest gets
  // partial flat-press stimulus.
  horizontal_press: {
    triceps: 0.5, // CP-3 strong synergist (Pelland 2026 default) — MODERATE
    upper_chest: 0.33, // CP-5 partial flat-press stimulus — LOW
  },
  // Overhead press. Anterior-delt-led; lateral delt and upper chest contribute
  // moderately, triceps lock out, trunk braces isometrically overhead.
  vertical_press: {
    triceps: 0.5, // CP-3 strong lockout synergist — MODERATE
    side_delts: 0.33, // CP-5 moderate lateral-delt contribution — LOW
    upper_chest: 0.33, // CP-5 partial clavicular stimulus — LOW
    abs: 0.2, // CP-5 overhead anti-extension isometric ≠ dynamic hypertrophy — LOW
  },
  // Squat. Mostly knee-extension + hip drive; trunk braces hard, hamstrings
  // co-contract minimally (short ROM, near-isometric).
  squat: {
    abs: 0.33, // CP-5 heavy bracing isometric — LOW
    hamstrings: 0.1, // CP-5 minimal co-contraction — LOW
  },
  // Deadlift. Hip-hinge: hamstrings as hip extensors, grip taxes forearms hard,
  // lats + mid-back hold the bar path isometrically.
  deadlift: {
    hamstrings: 0.4, // CP-5 hip-extension role, but limited knee-flexion ROM — LOW
    forearms: 0.5, // CP-3 grip strongly loaded — MODERATE
    mid_back: 0.33, // CP-5 isometric upper-back tension — LOW
    lats: 0.25, // CP-5 isometric bar-path tension — LOW
  },
};

/**
 * Weekly compound-coverage credit, as a muscle → effective-set map, computed
 * from the archetype's strength days. Sums each strength day's `role` (and
 * `secondaryRole`, when a dual-main-lift day declares one) against
 * `SYNERGIST_CREDIT`, multiplied by `MAIN_LIFT_NOMINAL_SETS`.
 *
 * Computed from the full `archetype.days` template (the assembler does not see
 * the frequency-trimmed week). This is a deliberate, safe over-estimate — see
 * the module header: credit only ever lands on already-covered muscles.
 */
export function computeWeeklyCompoundCredit(
  archetype: Archetype,
): Map<string, number> {
  const credit = new Map<string, number>();
  const addRole = (role: StrengthRole) => {
    const table = SYNERGIST_CREDIT[role];
    for (const [muscle, frac] of Object.entries(table)) {
      credit.set(muscle, (credit.get(muscle) ?? 0) + frac * MAIN_LIFT_NOMINAL_SETS);
    }
  };
  for (const day of archetype.days) {
    if (day.kind !== "strength") continue;
    addRole(day.role);
    if (day.secondaryRole) addRole(day.secondaryRole);
  }
  return credit;
}
