/**
 * Read-time recovery for warm-ups materialised under the old broad
 * `body_weight_loaded` rule.
 *
 * Those plans treated every bodyweight-CAPABLE movement (forward lunge,
 * step-up, ...) as if its max were a bodyweight-inclusive system max. The
 * engine resolved the ramp to a concrete kg, took bodyweight off it, and stored
 * the remainder as an absolute with a `systemLoad` marker and NO `percentTm`.
 *
 * For a lunge that number is meaningless on its own: with a 110 kg top set and
 * an 80 kg lifter a 50/75/100 ramp was written as `0 / 2.5 / 30`. Now that the
 * catalog says the lunge is an ordinary lift those absolutes read as literal
 * kilos, so the ramp shows 2.5 kg and 30 kg and the clamped rung resolves to
 * nothing at all.
 *
 * Two different problems live in that row of numbers:
 *
 *  - A rung the writer did NOT clamp is its total minus the bodyweight of the
 *    day it was written. Adding bodyweight back inverts it — but only if the
 *    bodyweight on file is still that one, which the item cannot say.
 *  - A rung that landed at or under bodyweight was clamped to `0`
 *    (`addedLoadFromSystemLoad`), which erases it. `0` could have been any total
 *    up to the lifter's weight, so the number cannot be un-clamped from the item
 *    itself.
 *
 * One gate answers both: a block is recovered only when REPLAYING the writer
 * against the ladder, top set and bodyweight the app can see today reproduces
 * this block exactly, slot for slot. A match proves all three at once — a
 * lifter whose bodyweight has moved since the plan was written no longer
 * reproduces it — and tells us which ladder rung each surviving slot holds,
 * which a slot count cannot: the writer collapses repeated loads and keeps the
 * FIRST. The block is then restated off the ladder. No match, no change: the
 * numbers are left as they are rather than replanned behind the lifter's back,
 * and a rung nothing can place stays unprescribed rather than being invented.
 *
 * The ladder read is the lifter's configured one, as the task specifies. A
 * clamped rung holds no information at all, so the configured ladder is the
 * only thing that can speak for it — and it is the same ladder every other
 * surface uses for this lift today. The top set follows the movement's own
 * main percentage and current training max, which is how every main set in the
 * session already renders, so the ramp cannot disagree with the set it leads to.
 *
 * Everything here is in memory. Nothing is written back, no marker is erased on
 * disk, and only load fields are touched — sets, reps, notes and metadata are
 * the lifter's record of what they were asked to do.
 */

/** The fields recovery reads. Structural so callers can pass their own item type. */
export type LegacyWarmupItem = {
  movementId?: string | null;
  kind?: string | null;
  percentTm?: number | null;
  targetWeightKg?: number | null;
  systemLoad?: boolean;
  /**
   * The writer's cue. Engine items call it `note`; the persisted item the
   * adapter writes calls it `notes`. Both are read so a stale "bodyweight" cue
   * is cleared wherever it actually landed.
   */
  note?: string | null;
  notes?: string | null;
};

export type LegacyWarmupRepairContext = {
  /**
   * The catalog's verdict for a movement: does its max count bodyweight?
   *
   * Tri-state on purpose. `undefined` means the catalog could not answer (an
   * unknown, custom or deleted movement) and recovery does nothing — a marker
   * that disagrees with a verdict we don't have is not evidence of anything.
   */
  isSystemLoadMovement: (movementId: string) => boolean | undefined;
  /** The lifter's bodyweight. Without it nothing is recoverable. */
  bodyweightKg?: number | null;
  /** The movement's working max in kg, already rounded as the logger rounds it. */
  trainingMaxKg: (movementId: string) => number | null | undefined;
  /**
   * Ascending ramp fractions the writer would have used (`0.5` = 50% of the top
   * set), i.e. the lifter's configured ladder, else the shared one. Used only to
   * rebuild a clamped rung, and only after it reproduces the surviving rungs.
   */
  rampFractions?: readonly number[] | null;
  /** Plate step the ramp was floored to when it was written. */
  roundingKg?: number;
};

type Block = {
  /** Indices into the source array, in order. */
  indices: number[];
  movementId: string;
};

function finite(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * True for an item that could only have been written by the old rule: a warm-up
 * carrying the "bodyweight is already off this number" marker and a concrete
 * load, with no percentage to fall back on.
 */
function isLegacyMarkedWarmup(item: LegacyWarmupItem): boolean {
  if (item.kind !== "warmup") return false;
  if (item.systemLoad !== true) return false;
  if (finite(item.percentTm) != null) return false;
  const absolute = finite(item.targetWeightKg);
  return absolute != null && absolute >= 0;
}

/**
 * Contiguous runs of legacy-marked warm-ups for one movement.
 *
 * Contiguous, not grouped by movement: a movement can own two independent
 * blocks in one session, and merging them would rebuild both off whichever
 * anchor happened to be larger.
 */
function findBlocks(items: readonly LegacyWarmupItem[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const movementId = item.movementId;
    if (!isLegacyMarkedWarmup(item) || !movementId) {
      current = null;
      continue;
    }
    if (current && current.movementId === movementId) {
      current.indices.push(i);
      continue;
    }
    current = { indices: [i], movementId };
    blocks.push(current);
  }
  return blocks;
}

/**
 * The top working load the block ramps towards: the FIRST main set for the same
 * movement after the block. Warm-ups precede the work they prepare, so the next
 * main is the one they belong to.
 */
function topWorkingKgFor(
  items: readonly LegacyWarmupItem[],
  block: Block,
  trainingMaxKg: number | undefined,
): number | undefined {
  if (trainingMaxKg == null || trainingMaxKg <= 0) return undefined;
  const start = block.indices[block.indices.length - 1]! + 1;
  for (let i = start; i < items.length; i++) {
    const item = items[i]!;
    if (item.movementId !== block.movementId) continue;
    if (item.kind !== "main") continue;
    const percent = finite(item.percentTm);
    if (percent == null || percent <= 0) return undefined;
    return (trainingMaxKg * percent) / 100;
  }
  return undefined;
}

/**
 * Replay `buildSystemLoadWarmupItems` (program-core) for one block: the added
 * load it would have stored for each ladder rung, dropping a rung whose load
 * repeats the one before it — exactly as the writer does. Returns the surviving
 * rungs in order, each tagged with the ladder index it came from.
 *
 * Reproducing the collapse is the only way to know which rung a surviving slot
 * holds. The writer keeps the FIRST of a repeated run, so a slot count alone
 * cannot be aligned to the ladder from either end.
 */
function replayWriter(
  topWorkingKg: number,
  bodyweightKg: number,
  ramp: readonly number[],
  roundingKg: number,
): Array<{ rungIndex: number; addedKg: number }> {
  const out: Array<{ rungIndex: number; addedKg: number }> = [];
  let previousAddedKg: number | null = null;
  for (let i = 0; i < ramp.length; i++) {
    const added = topWorkingKg * ramp[i]! - bodyweightKg;
    const addedKg =
      added <= 0
        ? 0
        : Math.max(0, roundingKg > 0 ? Math.floor(added / roundingKg) * roundingKg : added);
    if (previousAddedKg != null && addedKg === previousAddedKg) continue;
    previousAddedKg = addedKg;
    out.push({ rungIndex: i, addedKg });
  }
  return out;
}

/**
 * Recovered totals for one block, by index, or an empty map when nothing can be
 * recovered safely.
 */
function recoverBlock(
  items: readonly LegacyWarmupItem[],
  block: Block,
  ctx: LegacyWarmupRepairContext,
): Map<number, number> {
  const recovered = new Map<number, number>();
  if (ctx.isSystemLoadMovement(block.movementId) !== false) return recovered;

  const bodyweightKg = finite(ctx.bodyweightKg);
  if (bodyweightKg == null || bodyweightKg <= 0) return recovered;

  // A block only comes back if the writer can be REPLAYED to produce exactly
  // it. Nothing here is recoverable without that: a stored rung is its total
  // minus the bodyweight of the day it was WRITTEN, and only a matching replay
  // shows the bodyweight on file is still that one. Replaying also proves the
  // ladder and the top set, and tells us which rung each surviving slot came
  // from — which a slot count cannot, because the writer collapses rungs.
  const ramp = ctx.rampFractions;
  if (!ramp || ramp.length < block.indices.length) return recovered;
  const topWorkingKg = topWorkingKgFor(
    items,
    block,
    finite(ctx.trainingMaxKg(block.movementId)),
  );
  if (topWorkingKg == null || topWorkingKg <= 0) return recovered;

  const replay = replayWriter(topWorkingKg, bodyweightKg, ramp, ctx.roundingKg ?? 2.5);
  if (replay.length !== block.indices.length) return recovered;
  for (let slot = 0; slot < block.indices.length; slot++) {
    const stored = finite(items[block.indices[slot]!]!.targetWeightKg)!;
    if (replay[slot]!.addedKg !== stored) return recovered;
  }

  // The replay matched, so the ladder, the top set and the bodyweight are all
  // confirmed and every slot's rung is known. Restate the block off the ladder:
  // the stored figure was floored only because bodyweight had to come out of
  // it, and an ordinary lift's ramp is rounded at the surface against the
  // lifter's own plates. This is the ramp the same plan would build today.
  for (let slot = 0; slot < block.indices.length; slot++) {
    recovered.set(block.indices[slot]!, topWorkingKg * ramp[replay[slot]!.rungIndex]!);
  }
  return recovered;
}

/**
 * Return `items` with legacy system-load warm-ups restated as the totals they
 * always meant. Items that are not provably legacy come back untouched, and the
 * array is returned as-is when there is nothing to recover.
 *
 * Only `targetWeightKg` and the stale `systemLoad` marker change. Reps, sets,
 * notes, ordering and metadata are preserved exactly, so a `set_logs` row still
 * addresses the slot it was written for.
 */
export function repairLegacySystemLoadWarmups<T extends LegacyWarmupItem>(
  items: readonly T[],
  ctx: LegacyWarmupRepairContext,
): T[] {
  const blocks = findBlocks(items);
  if (blocks.length === 0) return items as T[];

  const recovered = new Map<number, number>();
  for (const block of blocks) {
    for (const [index, kg] of recoverBlock(items, block, ctx)) {
      recovered.set(index, kg);
    }
  }
  if (recovered.size === 0) return items as T[];

  return items.map((item, index) => {
    const kg = recovered.get(index);
    if (kg == null) return item;
    const next: T = { ...item, targetWeightKg: kg };
    delete (next as LegacyWarmupItem).systemLoad;
    // The writer stamped "bodyweight" on a rung it had clamped to zero. It now
    // carries a load, so the cue would contradict the number next to it.
    if (kg > 0) {
      if (item.note === "bodyweight") delete (next as LegacyWarmupItem).note;
      if (item.notes === "bodyweight") delete (next as LegacyWarmupItem).notes;
    }
    return next;
  });
}
