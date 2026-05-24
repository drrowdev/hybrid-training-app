/**
 * Pure helper that distributes a target barbell load across the user's
 * plate inventory, returning a per-side stack ordered heaviest →
 * lightest plus any remainder that couldn't be matched exactly.
 *
 * Algorithm (greedy, no backtracking):
 *
 *   1. Subtract bar weight from target. If the difference is ≤ 0, the
 *      bar is already heavy enough — return `{ perSide: [], remainder
 *      = bar - target }`.
 *   2. Working with per-side load (`(target - bar) / 2`), walk the
 *      sorted-desc inventory and for each plate weight take as many
 *      pairs as both `pair_count` and the remaining load allow.
 *   3. Whatever load remains after the lightest plate is reported as
 *      the `remainderKg` (× 2 — the caller cares about total miss,
 *      not per-side miss).
 *
 * The greedy strategy can be suboptimal in pathological inventories
 * (e.g. 20 + 5 stack on a 21.25 target with no 1.25 pair available)
 * but the reference doc explicitly opts for greedy + report-the-miss
 * over backtracking.
 */
export type PlateInventoryItem = { weightKg: number; pairCount: number };

export type PlateBreakdown = {
  /** Plates on one side of the bar, ordered heaviest → lightest. */
  perSide: number[];
  /** Total weight (kg) the breakdown undershoots by. 0 = exact match. */
  remainderKg: number;
};

export function computePlateBreakdown(
  targetWeightKg: number,
  barWeightKg: number,
  inventory: PlateInventoryItem[],
): PlateBreakdown {
  if (!(targetWeightKg > 0)) {
    return { perSide: [], remainderKg: 0 };
  }
  const delta = targetWeightKg - barWeightKg;
  if (delta <= 0) {
    return { perSide: [], remainderKg: Math.max(0, barWeightKg - targetWeightKg) };
  }
  let perSideRemaining = delta / 2;
  const perSide: number[] = [];
  const sorted = [...inventory]
    .filter((p) => p.weightKg > 0 && p.pairCount > 0)
    .sort((a, b) => b.weightKg - a.weightKg);
  // Floating-point tolerance — Olympic micro plates introduce 0.005 kg
  // round-trip noise. 0.001 kg per side is well below any plate step.
  const EPS = 0.001;
  for (const plate of sorted) {
    let pairsLeft = plate.pairCount;
    while (pairsLeft > 0 && perSideRemaining >= plate.weightKg - EPS) {
      perSide.push(plate.weightKg);
      perSideRemaining -= plate.weightKg;
      pairsLeft--;
    }
  }
  return {
    perSide,
    // × 2 because the remainder is reported as total load missed, not
    // per-side.
    remainderKg: Math.max(0, Math.round(perSideRemaining * 2 * 100) / 100),
  };
}
