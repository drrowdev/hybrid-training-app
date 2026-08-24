/**
 * System-load movements — weighted pull-ups, weighted dips — are anchored on a
 * 1RM that counts BODYWEIGHT PLUS whatever hangs off the belt. That convention
 * is what makes the number comparable between lifters and across a bodyweight
 * change, and it is what Tactical Barbell (and weighted calisthenics generally)
 * prescribes percentages against.
 *
 * The consequence is the thing every implementation gets wrong: a percentage of
 * that 1RM is a TOTAL, not a belt load. 70% of a 110 kg system max is 77 kg of
 * total system load; for an 85 kg lifter that is a plain bodyweight pull-up,
 * not 77 kg hanging from a belt.
 *
 * Single home for the conversion (plan §6.9). The engines prescribe through it
 * and the app resolves stored percentages through it, so a plan preview, a
 * materialised set and the live logger cannot disagree.
 */

/**
 * The load to actually add for a system-load movement.
 *
 * Never negative: a percentage that lands at or below the lifter's own
 * bodyweight is a bodyweight set. That is a normal outcome on lighter weeks for
 * anyone whose max is under roughly 1.4× bodyweight, not an error.
 *
 * `roundToIncrement` rounds the ADDED portion, which is the only part that has
 * to land on real plates — rounding the total first would leave an unloadable
 * remainder once bodyweight comes off.
 */
export function addedLoadFromSystemLoad(
  systemLoadKg: number,
  bodyweightKg: number,
  roundToIncrement: (kg: number) => number = (kg) => kg,
): number {
  if (!Number.isFinite(systemLoadKg) || !Number.isFinite(bodyweightKg)) return 0;
  const added = systemLoadKg - bodyweightKg;
  if (added <= 0) return 0;
  return Math.max(0, roundToIncrement(added));
}
