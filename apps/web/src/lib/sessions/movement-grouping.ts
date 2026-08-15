/**
 * Helpers for the movement-grouped logging view.
 *
 * Pure functions only — owns the grouping logic, the auto/manual
 * cursor model, the per-card completeness check, and the lookup of
 * the canonical logged set per prescription item index. The React
 * components in `components/session/Movement*.tsx` are thin wrappers
 * around these.
 */

import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  movementIdentityKey,
  movementIdsForItems,
  type AttributionGroupInput,
} from "./movement-attribution";
import { PRESCRIPTION_STRENGTH_KINDS } from "./prescription-progress";
import { SET_KIND_LABELS } from "./set-kind-labels";

export type MovementSlotBucket = "warmup" | "working" | "accessory";

export type MovementGroup = {
  /**
   * UI identity for this card. Rehab and core work can intentionally use the
   * same catalog movement, so movementId alone is not always unique — and a
   * swapped block carries its origin in the key (see `movementIdentityKey`) so
   * a swap into a movement the session already prescribes elsewhere does not
   * merge the two blocks into one card.
   */
  groupKey?: string;
  movementId: string;
  movementName: string;
  movementSlug: string | null;
  /**
   * Every movement id whose logged sets belong on this card: the current
   * movement plus the swap lineage of its items. Attribution MUST use this, not
   * `movementId` — a forward-only swap leaves `set_logs.movement_id` pointing at
   * the original movement.
   *
   * Optional so hand-built fixtures stay valid; `attributionInputForGroup`
   * re-derives it from `items` when absent. `groupPrescriptionByMovement`
   * always populates it.
   */
  acceptedMovementIds?: string[];
  /** Prescription item indices belonging to this movement, in display order. */
  itemIndices: number[];
  /** The raw prescription items, same order as `itemIndices`. */
  items: PrescriptionItem[];
  /**
   * Per-bucket grouping of positions WITHIN this movement group.
   * Each array contains positions into `items[]` / `itemIndices[]`
   * (0-indexed). Used to render warm-ups as a distinct section above
   * working sets, and to scope the "Set X of Y" caption to the bucket
   * the user is actually inside.
   *
   * - `warmup`     → kind === "warmup"
   * - `working`    → kind in { "main", "back_off", "power_potentiation" }
   * - `accessory`  → kind in { "accessory", "tendon" }
   *
   * Items with no matching bucket (defensive) fall into `working`.
   */
  slotBuckets: Record<MovementSlotBucket, number[]>;
};

/** Humanise an underscored slug ("hip_hinge" → "Hip hinge") when no display name is available. */
function humanizeSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const cleaned = slug.replaceAll("_", " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Bucket assignment for a single prescription item kind. */
export function bucketForKind(kind: PrescriptionItem["kind"]): MovementSlotBucket {
  if (kind === "warmup") return "warmup";
  if (kind === "accessory" || kind === "tendon") return "accessory";
  return "working";
}

/**
 * Group strength prescription items by movement identity, preserving the
 * order in which each identity first appears. Cardio items are
 * skipped — they're rendered elsewhere on the session page.
 *
 * Identity is `movementIdentityKey`, NOT the raw movementId: a swapped block
 * carries its origin in the key, so swapping into a movement the session
 * already prescribes elsewhere no longer silently merges two blocks into a
 * single card (deadlift → barbell hip thrust absorbing a pre-existing
 * hip-thrust accessory: 3 cards became 2).
 */
export function groupPrescriptionByMovement(
  prescription: Prescription | null,
): MovementGroup[] {
  if (!prescription?.items?.length) return [];
  const byKey = new Map<string, MovementGroup>();
  prescription.items.forEach((item, idx) => {
    if (!PRESCRIPTION_STRENGTH_KINDS.has(item.kind)) return;
    if (!item.movementId) return;
    const groupKey = movementIdentityKey(item);
    const existing = byKey.get(groupKey);
    if (existing) {
      const slot = existing.itemIndices.length;
      existing.itemIndices.push(idx);
      existing.items.push(item);
      existing.slotBuckets[bucketForKind(item.kind)].push(slot);
      existing.acceptedMovementIds = movementIdsForItems(existing.items);
      return;
    }
    const name =
      item.movementName ?? humanizeSlug(item.movementSlug) ?? "Movement";
    byKey.set(groupKey, {
      groupKey,
      movementId: item.movementId,
      movementName: name,
      movementSlug: item.movementSlug ?? null,
      acceptedMovementIds: movementIdsForItems([item]),
      itemIndices: [idx],
      items: [item],
      slotBuckets: {
        warmup: bucketForKind(item.kind) === "warmup" ? [0] : [],
        working: bucketForKind(item.kind) === "working" ? [0] : [],
        accessory: bucketForKind(item.kind) === "accessory" ? [0] : [],
      },
    });
  });
  return Array.from(byKey.values());
}

export function movementGroupKey(
  group: Pick<MovementGroup, "groupKey" | "movementId">,
): string {
  return group.groupKey ?? group.movementId;
}

/**
 * Adapter to the canonical attribution context (`movement-attribution`). Every
 * surface that decides "does this logged set belong on this card?" builds its
 * context from here so the rule has exactly one implementation.
 */
export function attributionInputForGroup(
  group: MovementGroup,
): AttributionGroupInput {
  return {
    key: movementGroupKey(group),
    itemIndices: group.itemIndices,
    acceptedMovementIds:
      group.acceptedMovementIds ?? movementIdsForItems(group.items ?? []),
  };
}

export function attributionInputsForGroups(
  groups: ReadonlyArray<MovementGroup>,
): AttributionGroupInput[] {
  return groups.map(attributionInputForGroup);
}

/**
 * Position of a slot within its own bucket. e.g. a warm-up that is
 * slot 1 globally but the 2nd warm-up returns
 * { bucket: "warmup", position: 1, total: 2 }. Used by the focus view
 * caption so "Set X of Y" only counts the bucket the user is in.
 */
export function bucketPositionForSlot(
  group: MovementGroup,
  slot: number,
): { bucket: MovementSlotBucket; position: number; total: number } {
  const kind = group.items[slot]?.kind ?? "main";
  const bucket = bucketForKind(kind);
  const positions = group.slotBuckets[bucket];
  const position = positions.indexOf(slot);
  return {
    bucket,
    position: position < 0 ? 0 : position,
    total: positions.length,
  };
}

/**
 * Movement card state used to colour the header chip and decide
 * collapsed-by-default behaviour.
 */
export type MovementCardState = "not_started" | "in_progress" | "completed";

export function deriveCardState(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): MovementCardState {
  const required = group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
  const total = required.length;
  if (total === 0) return "not_started";
  let done = 0;
  for (const idx of required) if (loggedItemIndices.has(idx)) done++;
  if (done === 0) return "not_started";
  if (done >= total) return "completed";
  return "in_progress";
}

/**
 * Movement is "complete" when every prescribed item has ≥1 matching
 * logged-or-skipped row. Skipped sets count as "covered" because they
 * explicitly close out the slot (the user made a conscious decision
 * about it) even though they contribute zero work to tonnage / PRs.
 *
 * Pass the set of indices that have any logged row as `loggedItemIndices`
 * — the caller computes it the same way for both logged and skipped
 * rows, so this helper does NOT need a separate skipped argument.
 */
export function isMovementComplete(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): boolean {
  const required = group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
  if (required.length === 0) return false;
  return required.every((idx) => loggedItemIndices.has(idx));
}

/**
 * Auto cursor — first un-logged item in display order. Returns the
 * LAST item index when every set is already logged (so the recap and
 * focus-view fall back to the last set rather than going out of
 * bounds).
 */
export function autoCursorForGroup(
  group: MovementGroup,
  loggedItemIndices: ReadonlySet<number>,
): number {
  for (let i = 0; i < group.itemIndices.length; i++) {
    const idx = group.itemIndices[i]!;
    if (!loggedItemIndices.has(idx)) return i;
  }
  return Math.max(0, group.itemIndices.length - 1);
}

/**
 * Effective cursor — manual override wins until the user logs again.
 * `cursorSlot` is the position within the group (0-indexed), NOT the
 * raw prescription item index.
 */
export function effectiveCursor(
  autoCursor: number,
  manualCursor: number | null,
): number {
  return manualCursor ?? autoCursor;
}

/**
 * The last main-kind slot in a movement group. Used to flag the
 * top set as AMRAP for e1RM display and "× 5+" reps formatting.
 */
export function lastMainSlot(group: MovementGroup): number | null {
  let last: number | null = null;
  for (let i = 0; i < group.items.length; i++) {
    if (group.items[i]!.kind === "main") last = i;
  }
  return last;
}

export function bucketLabelForKind(
  kind: PrescriptionItem["kind"],
  position: number,
  total: number,
  optional = false,
  rehab = false,
): string {
  if (optional) return `Optional set · ${position + 1} of ${total}`;
  const tag =
    kind === "warmup"
      ? "Warm-up"
      : kind === "main" || kind === "power_potentiation"
        ? "Working set"
        : kind === "back_off"
          ? SET_KIND_LABELS.back_off.label
          : kind === "accessory"
            ? "Accessory"
            : kind === "tendon"
              ? rehab
                ? "Rehab"
                : "Tendon"
              : "Set";
  if (total <= 0) return tag;
  return `${tag} · ${position + 1} of ${total}`;
}

/** Round to nearest 2.5 kg plate (pure copy of the canonical helper). */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}
