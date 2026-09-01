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
 *  - Any rung the writer did NOT clamp is recoverable EXACTLY: it is the total
 *    minus bodyweight, so adding bodyweight back returns the total. No ramp, no
 *    training max, no guessing.
 *  - A rung that landed at or under bodyweight was clamped to `0`
 *    (`addedLoadFromSystemLoad`), which erases it. `0` could have been any total
 *    up to the lifter's weight, so the number cannot be un-clamped from the item
 *    itself.
 *
 * A clamped rung is therefore rebuilt from the ramp — but only when the ramp is
 * CORROBORATED by the rungs that survived. If the ladder the app can see today
 * reproduces every recoverable rung, it is the ladder that wrote them and the
 * missing rung follows from it. If it does not, the block is left alone rather
 * than replanned behind the lifter's back.
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

  // Exact half: a rung the writer did not clamp is its total minus bodyweight.
  const clamped: number[] = [];
  for (const index of block.indices) {
    const stored = finite(items[index]!.targetWeightKg)!;
    if (stored > 0) recovered.set(index, stored + bodyweightKg);
    else clamped.push(index);
  }
  if (clamped.length === 0) return recovered;

  // Lossy half: a clamped rung only comes back if the ladder can be shown to be
  // the one that wrote this block.
  const ramp = ctx.rampFractions;
  if (!ramp || ramp.length < block.indices.length) return recovered;
  const topWorkingKg = topWorkingKgFor(
    items,
    block,
    finite(ctx.trainingMaxKg(block.movementId)),
  );
  if (topWorkingKg == null || topWorkingKg <= 0) return recovered;

  // Consecutive rungs that resolved to the same added load collapsed into one
  // when they were written, and an ascending ramp only ever collapses its
  // sub-bodyweight START. So the surviving slots are the ladder's TAIL.
  const offset = ramp.length - block.indices.length;
  const tolerance = ctx.roundingKg ?? 2.5;
  let corroborated = 0;
  for (let slot = 0; slot < block.indices.length; slot++) {
    const index = block.indices[slot]!;
    const exact = recovered.get(index);
    if (exact == null) continue;
    const fraction = ramp[offset + slot]!;
    if (Math.abs(topWorkingKg * fraction - exact) > tolerance) return recovered;
    corroborated += 1;
  }
  // Nothing survived to check the ladder against, so there is no evidence it is
  // the right one. Better an unprescribed rung than an invented load.
  if (corroborated === 0) return recovered;

  for (const index of clamped) {
    const slot = block.indices.indexOf(index);
    recovered.set(index, topWorkingKg * ramp[offset + slot]!);
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
    return next;
  });
}
