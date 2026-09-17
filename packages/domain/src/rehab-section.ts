export type RehabAwareItem = {
  movementId: string;
  reps?: number;
  repRange?: { min: number; max: number };
  holdSec?: { min: number; max: number };
  meta?: Record<string, unknown>;
};

export type EmbeddedRehabSection = {
  protocolId: string | null;
  protocolName: string;
  sourceRef: string;
  placement: "during_warmup";
  itemCount: number;
  movementCount: number;
  migrationSource?: {
    migration: "0127_embed_same_day_rehab";
    plannedSessionId: string;
    originalStrengthPrescription: unknown;
    originalStrengthRow: Record<string, unknown>;
    originalRehabRow: Record<string, unknown>;
  };
};

export function isRehabItem(
  item: Pick<RehabAwareItem, "meta"> | null | undefined,
): boolean {
  return item?.meta?.rehab === true;
}

export function partitionRehabItems<T extends Pick<RehabAwareItem, "meta">>(
  items: readonly T[],
): { rehab: T[]; core: T[] } {
  const rehab: T[] = [];
  const core: T[] = [];
  for (const item of items) {
    (isRehabItem(item) ? rehab : core).push(item);
  }
  return { rehab, core };
}

export function prependRehabItems<T extends Pick<RehabAwareItem, "meta">>(
  coreItems: readonly T[],
  rehabItems: readonly T[],
): T[] {
  return [...rehabItems, ...partitionRehabItems(coreItems).core];
}

export function countDistinctRehabMovements<T extends RehabAwareItem>(
  items: readonly T[],
): number {
  return new Set(
    items.filter(isRehabItem).map((item) => {
      // A dynamic exercise and an isometric hold can share a catalog ID.
      // Set copies and left/right sides still belong to the same variant.
      const work = item.holdSec == null
        ? "reps"
        : item.reps != null || item.repRange != null
          ? "reps-and-hold"
          : "hold";
      return JSON.stringify([item.movementId, work]);
    }),
  ).size;
}

export function unresolvedRehabItemIndices<
  T extends Pick<RehabAwareItem, "meta">,
>(
  items: readonly T[],
  coveredIndices: ReadonlySet<number>,
): number[] {
  return items.flatMap((item, index) =>
    isRehabItem(item) && !coveredIndices.has(index) ? [index] : [],
  );
}
