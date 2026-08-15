/**
 * Canonical movement identity + logged-set attribution (plan §6.9 — one home
 * for derived state; every consumer imports, nobody re-derives).
 *
 * ## Why this module exists
 *
 * A mid-workout swap is deliberately FORWARD-ONLY: `swapMovementInPrescription`
 * retargets the prescription item's `movementId`, but `set_logs.movement_id`
 * keeps the ORIGINAL movement. That is correct — the lifter really did perform
 * deadlifts, and rewriting the log would falsify training history (and with it
 * every stat, PR and progression that reads it).
 *
 * The consequence is that after a swap the prescription and the logs disagree
 * about which movement a slot belongs to. Every attribution path used to be a
 * two-clause OR:
 *
 * ```ts
 * indexLinkedSetIds.has(set.id) || set.movementId === group.movementId
 * ```
 *
 * and the swap kills the second clause, so any logged row that the FIRST clause
 * cannot cover (a second set at the same `prescription_item_index`, or a row
 * with a NULL index) silently vanished from the card, the dot strip and the
 * "X of N" progress chip — the owner-reported "swapping a main lift lowers the
 * set # by 1".
 *
 * The fix is read-side and lineage-aware. The swap already records where an item
 * came from in `meta.swappedFrom` (`SwappedFromMeta` in `prescription-mutations`),
 * so a prescription item legitimately owns logged sets for its CURRENT movement
 * *and* for every movement in its swap lineage. That rule — plus the index-link
 * rule — lives here, once.
 *
 * ## Lineage depth
 *
 * `applySwapToItem` keeps the ORIGINAL-original in `meta.swappedFrom`, and
 * additionally appends every movement the slot leaves to `meta.swapLineage`
 * (see `nextSwapLineage` in `prescription-mutations.ts`). So a chained
 * A → B → C swap accepts sets logged against A, B and C alike — including
 * against the INTERMEDIATE movement B, which `swappedFrom` alone forgets.
 * `movementIdsForItem` unions both keys and dedupes, so items swapped before
 * the chain existed (a `swappedFrom` with no `swapLineage`) keep working
 * unchanged. Index-linked rows are unaffected either way.
 */

import type { Prescription, PrescriptionItem } from "@hta/db";
import { isRehabItem } from "@hta/domain";

/** Shape of `meta.swappedFrom`, mirrored from `prescription-mutations`. */
type SwappedFromMeta = { movementId: string; movementName: string };

/**
 * Minimal item shape the attribution rules need. Accepting a structural type
 * (rather than the full `PrescriptionItem`) keeps this module importable from
 * both server components and pure tests without dragging the planner types in.
 */
export type AttributableItem = {
  movementId: string;
  kind?: PrescriptionItem["kind"] | string;
  meta?: Record<string, unknown> | null;
};

/** Minimal logged-set shape the attribution rules need. */
export type AttributableLoggedSet = {
  id: string;
  movementId?: string | null;
  setKind?: string | null;
  prescriptionItemIndex?: number | null;
};

/**
 * Prescription item kinds the lifter logs `set_logs` rows against. Cardio items
 * live in `cardio_logs` and are never matched here.
 *
 * Canonical home: re-exported by `prescription-progress` for back-compat.
 */
export const STRENGTH_ITEM_KINDS: ReadonlySet<string> = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
  "power_potentiation",
]);

/** `meta.swappedFrom.movementId` when this item was swapped, else null. */
export function swappedFromMovementId(
  item: AttributableItem | null | undefined,
): string | null {
  const meta = item?.meta;
  if (!meta || typeof meta !== "object") return null;
  const swappedFrom = (meta as Record<string, unknown>).swappedFrom as
    | Partial<SwappedFromMeta>
    | undefined;
  const id = swappedFrom?.movementId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Movement ids from `meta.swapLineage` — the append-only chain of every
 * movement this slot has previously been, oldest first. Absent on items
 * swapped before the chain existed, which is why callers union this with
 * `swappedFromMovementId`.
 */
export function swapLineageMovementIds(
  item: AttributableItem | null | undefined,
): string[] {
  const meta = item?.meta;
  if (!meta || typeof meta !== "object") return [];
  const lineage = (meta as Record<string, unknown>).swapLineage;
  if (!Array.isArray(lineage)) return [];
  const out: string[] = [];
  for (const entry of lineage) {
    if (typeof entry !== "object" || entry === null) continue;
    const id = (entry as Partial<SwappedFromMeta>).movementId;
    if (typeof id === "string" && id.length > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Every movement id this item may legitimately own logged sets for, current
 * movement first, then its swap lineage. Deduped, order-stable.
 */
export function movementIdsForItem(item: AttributableItem): string[] {
  const out: string[] = [];
  const push = (id: string | null | undefined) => {
    if (typeof id === "string" && id.length > 0 && !out.includes(id)) out.push(id);
  };
  push(item.movementId);
  push(swappedFromMovementId(item));
  for (const id of swapLineageMovementIds(item)) push(id);
  return out;
}

/** Union of `movementIdsForItem` across a group of items, order-stable. */
export function movementIdsForItems(
  items: ReadonlyArray<AttributableItem>,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    for (const id of movementIdsForItem(item)) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * THE canonical movement-keyed predicate: does this prescription item accept a
 * logged set recorded against `movementId`? True for its current movement and
 * for anything in its swap lineage.
 */
export function itemAcceptsMovementId(
  item: AttributableItem,
  movementId: string | null | undefined,
): boolean {
  if (!movementId) return false;
  return movementIdsForItem(item).includes(movementId);
}

/**
 * Stable UI identity for the card an item belongs to.
 *
 * Un-swapped items key on their movement id, exactly as before. A SWAPPED item
 * keys on `swap:<original>><current>` so that swapping into a movement the
 * session already prescribes elsewhere does NOT merge the two blocks into one
 * card — the bug where a deadlift block swapped to barbell hip thrust silently
 * absorbed a pre-existing hip-thrust accessory and the card count dropped from
 * 3 to 2. Carrying the ORIGINAL id in the key also keeps a later, unrelated
 * re-add of the original movement in its own card instead of folding it into
 * the swapped block.
 *
 * Swapping BACK (A → B → A) collapses to key A again, which is right: the block
 * really is movement A once more, and it re-merges with any other A block
 * exactly as it would have before the swap.
 *
 * Rehab keeps its own namespace — rehab and strength work intentionally share
 * catalog movements, so movement id alone is not unique.
 */
export function movementIdentityKey(item: AttributableItem): string {
  const original = swappedFromMovementId(item);
  const identity =
    original == null || original === item.movementId
      ? item.movementId
      : `swap:${original}>${item.movementId}`;
  return isRehabItem({ meta: item.meta ?? undefined }) ? `rehab:${identity}` : identity;
}

function hasValidIndexLink(
  set: AttributableLoggedSet,
  itemCount: number,
): set is AttributableLoggedSet & { prescriptionItemIndex: number } {
  const index = set.prescriptionItemIndex;
  return index != null && index >= 0 && index < itemCount;
}

/**
 * Every logged `set_logs.id` per prescription item index.
 *
 * Two passes, matching `matchPrescriptionItemsDetailed`:
 *   1. explicit `prescription_item_index` links (survive a swap by construction);
 *   2. lineage-aware movement fallback for rows with no usable link — each such
 *      row claims the first strength item that accepts its movement and has not
 *      been claimed yet.
 *
 * Returns ALL ids per index, not just the first. The old first-only map lost
 * every extra row at an index; those rows then existed only via the movement
 * fallback and disappeared the moment a swap retargeted the item.
 */
export function buildLoggedSetIdsByItemIndex(
  prescription: Prescription | null,
  loggedSets: ReadonlyArray<AttributableLoggedSet>,
): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const items = prescription?.items ?? [];
  if (items.length === 0) return out;

  const add = (index: number, id: string) => {
    (out[index] ??= []).push(id);
  };

  const claimed = new Set<number>();
  for (const set of loggedSets) {
    if (!hasValidIndexLink(set, items.length)) continue;
    add(set.prescriptionItemIndex, set.id);
    claimed.add(set.prescriptionItemIndex);
  }

  for (const set of loggedSets) {
    if (hasValidIndexLink(set, items.length)) continue;
    if (set.setKind === "warmup") continue;
    for (let i = 0; i < items.length; i++) {
      if (claimed.has(i)) continue;
      const item = items[i]!;
      if (!STRENGTH_ITEM_KINDS.has(item.kind)) continue;
      if (!itemAcceptsMovementId(item, set.movementId)) continue;
      claimed.add(i);
      add(i, set.id);
      break;
    }
  }

  return out;
}

/**
 * Collapse the full map to the FIRST logged set per index — the canonical row
 * the prescription line scrolls to / the "Edit set" link targets. Attribution
 * must never use this: it is lossy by design.
 */
export function firstLoggedSetIdByItemIndex(
  byIndex: Readonly<Record<number, ReadonlyArray<string>>>,
): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [index, ids] of Object.entries(byIndex)) {
    const first = ids[0];
    if (first != null) out[Number(index)] = first;
  }
  return out;
}

/** A movement card / group, reduced to what attribution needs. */
export type AttributionGroupInput = {
  /** Stable UI identity (see `movementIdentityKey`). */
  key: string;
  /** Prescription item indices this group owns. */
  itemIndices: ReadonlyArray<number>;
  /** Current + lineage movement ids this group's items accept. */
  acceptedMovementIds: ReadonlyArray<string>;
};

export type LoggedSetAttribution = {
  /** Index-linked set ids per group key. */
  setIdsByGroupKey: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Movement ids exactly one group accepts. Only these are safe for the
   * movement-keyed fallback — when two cards could claim the same movement
   * (a duplicate movement, or a swap into a movement already in the session)
   * an unlinked row is ambiguous and is left to the index link alone.
   */
  exclusiveMovementIds: ReadonlySet<string>;
};

/**
 * Precompute the attribution context for a set of movement groups. Call once
 * per render (it is O(groups × items)) and reuse it for every group.
 */
export function buildLoggedSetAttribution(
  groups: ReadonlyArray<AttributionGroupInput>,
  loggedSetIdsByItemIndex: Readonly<Record<number, ReadonlyArray<string>>>,
): LoggedSetAttribution {
  const setIdsByGroupKey = new Map<string, ReadonlySet<string>>();
  const movementIdCounts = new Map<string, number>();
  for (const group of groups) {
    const ids = new Set<string>();
    for (const index of group.itemIndices) {
      for (const id of loggedSetIdsByItemIndex[index] ?? []) ids.add(id);
    }
    setIdsByGroupKey.set(group.key, ids);
    for (const movementId of new Set(group.acceptedMovementIds)) {
      movementIdCounts.set(movementId, (movementIdCounts.get(movementId) ?? 0) + 1);
    }
  }
  const exclusiveMovementIds = new Set<string>();
  for (const [movementId, count] of movementIdCounts) {
    if (count === 1) exclusiveMovementIds.add(movementId);
  }
  return { setIdsByGroupKey, exclusiveMovementIds };
}

/**
 * THE canonical group-level predicate: does this logged set belong on this
 * movement card?
 *
 * 1. index-linked — the set points at one of the group's prescription items;
 * 2. lineage-aware movement fallback — the group accepts the set's movement AND
 *    no other group could also claim it.
 */
export function groupOwnsLoggedSet(
  attribution: LoggedSetAttribution,
  group: AttributionGroupInput,
  set: { id: string; movementId?: string | null },
): boolean {
  if (attribution.setIdsByGroupKey.get(group.key)?.has(set.id)) return true;
  if (set.movementId == null) return false;
  if (!attribution.exclusiveMovementIds.has(set.movementId)) return false;
  return group.acceptedMovementIds.includes(set.movementId);
}
