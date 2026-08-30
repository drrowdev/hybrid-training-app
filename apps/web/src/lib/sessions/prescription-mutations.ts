/**
 * Pure prescription mutators (Phase 2 A2).
 *
 * Kept out of ``actions.ts`` so the JSONB-mutation invariants can be
 * unit-tested without standing up a Supabase double. The server action
 * orchestrates auth + DB I/O; this helper owns the in-memory shape.
 */
import type { Prescription, PrescriptionItem } from "@hta/db";
import { countDistinctRehabMovements, isRehabItem } from "@hta/domain";
import {
  generateWarmupItems,
  resolveWarmupScheme,
  type WarmupScheme,
} from "@/lib/planner/warmups";

export type SwappedFromMeta = {
  movementId: string;
  movementName: string;
};

export type ApplySwapInput = {
  itemIndex: number;
  newMovement: {
    id: string;
    slug: string;
    displayName: string;
  };
  /** ISO timestamp to stamp into ``meta.swappedAt``. Defaults to now. */
  swappedAt?: string;
};

/**
 * Append-only swap lineage: every movement this slot has previously been,
 * oldest first.
 *
 * `meta.swappedFrom` records only the ORIGINAL-original, so a chained
 * A → B → C swap forgets B and any set logged against B during its window
 * becomes unattributable (`movement-attribution.ts`). `meta.swapLineage`
 * records the full chain so the read side can accept all of them.
 *
 * Back-compat: an item swapped under the old code has `swappedFrom` but no
 * `swapLineage`. Its first entry here is the movement being left now, and
 * `movementIdsForItem` unions BOTH keys, so no lineage is lost.
 */
function nextSwapLineage(
  prevMeta: Record<string, unknown>,
  leaving: SwappedFromMeta,
): SwappedFromMeta[] {
  const prev = Array.isArray(prevMeta.swapLineage)
    ? (prevMeta.swapLineage as unknown[]).filter(
        (entry): entry is SwappedFromMeta =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as SwappedFromMeta).movementId === "string" &&
          typeof (entry as SwappedFromMeta).movementName === "string",
      )
    : [];
  if (prev.some((entry) => entry.movementId === leaving.movementId)) return prev;
  return [...prev, leaving];
}

function applySwapToItem(
  orig: PrescriptionItem,
  input: ApplySwapInput,
): PrescriptionItem {
  const prevMeta = (orig.meta ?? {}) as Record<string, unknown>;
  const prevSwappedFrom = prevMeta.swappedFrom as SwappedFromMeta | undefined;
  const leaving: SwappedFromMeta = {
    movementId: orig.movementId,
    movementName: orig.movementName ?? orig.movementSlug ?? "previous",
  };
  // If we've already swapped this item, keep the original-original
  // recorded — chaining swaps shouldn't lose that lineage.
  const swappedFrom: SwappedFromMeta = prevSwappedFrom ?? leaving;
  const next: PrescriptionItem = {
    ...orig,
    movementId: input.newMovement.id,
    movementSlug: input.newMovement.slug,
    movementName: input.newMovement.displayName,
    meta: {
      ...prevMeta,
      swappedFrom,
      swapLineage: nextSwapLineage(prevMeta, leaving),
      swappedAt: input.swappedAt ?? new Date().toISOString(),
    },
  };
  // "This percentage counts bodyweight" describes the movement that just left.
  // Kept across the swap it would take bodyweight off a barbell row; the
  // replacement's own status is read from the catalog.
  delete next.systemLoad;
  return next;
}

export type MovementMutationScope = {
  rehab?: boolean;
};

/**
 * Options for rebuilding a swapped movement's load-bearing prescription.
 *
 * The legacy mutator remains usable without these options for callers that
 * only need to retarget an item. Server swap actions pass the user's resolved
 * warmup scheme and the replacement movement's TM availability so this path
 * can remove stale absolute loads and rebuild the warmup ladder.
 */
export type MovementSwapRebuildOptions = {
  warmupScheme?: WarmupScheme;
  /** True only when the replacement has a usable 1RM/TM anchor. */
  replacementHasTrainingMax?: boolean;
  /**
   * Hold `items.length` — and therefore every item's array position —
   * constant.
   *
   * `set_logs.prescription_item_index` is a live join key: it is written by
   * `fillSessionFromPlan` on every materialized row and feeds the deterministic
   * `client_log_id`, the logger's logged/skipped maps, movement recaps, and
   * platform progression. Once a workout has started, re-splicing the warm-up
   * block would shift every index at or after it and silently re-point those
   * rows at the wrong item. Callers that write to a session which may already
   * have `set_logs` (mid-workout swap, or a plan-drawer swap on a started
   * session) MUST pass `true`; the warm-up ladder is then rewritten inside the
   * slots that already exist instead of being re-spliced.
   */
  preserveItemIndices?: boolean;
};

/** User-facing DC-K4 warning for the no-load-anchor swap fallback. */
export const SWAP_NO_TRAINING_MAX_WARNING =
  "No training max or 1RM is recorded for the replacement movement. " +
  "Warm-up slots were retained with loads left blank and absolute loads cleared; " +
  "confirm the replacement load before lifting.";
export const SWAP_NO_WARMUP_ANCHOR_WARNING =
  "The replacement has no usable working-set %TM anchor. " +
  "Warm-up slots were retained with loads left blank; confirm the replacement load before lifting.";
/**
 * DC-K4 warning for a mid-workout swap into a movement that had no warm-up
 * slots to reuse. Adding slots would move every later prescription item, and
 * already-logged sets are addressed by item position, so the engine declines
 * the rebuild and says so instead of silently re-indexing the workout.
 */
export const SWAP_WARMUPS_NOT_REBUILT_WARNING =
  "Warm-up sets weren't added because this workout is already in progress and " +
  "your logged sets are tied to its set order. Warm up off the logged sets, or " +
  "swap this movement from the plan before starting.";
/**
 * DC-K4 warning for a rehab swap that carried a hand-entered load across.
 * Rehab items are not %TM-anchored, so the absolute load is the whole
 * prescription — clearing it would leave nothing behind.
 */
export const SWAP_REHAB_LOAD_CARRIED_WARNING =
  "The rehab load from the previous movement was carried over; " +
  "confirm it suits the replacement before lifting.";

function matchesMovement(
  item: PrescriptionItem,
  movementId: string,
  scope?: MovementMutationScope,
): boolean {
  return (
    item.movementId === movementId &&
    (scope?.rehab == null || isRehabItem(item) === scope.rehab)
  );
}

export type SwapWarmupAnchor = {
  hasMain: boolean;
  topWorkingPercent?: number;
  /**
   * How many `kind: "warmup"` items this movement already owns. The
   * mid-workout rebuild can only rewrite slots that exist, so callers use this
   * to decide whether a DC-K4 "warm-ups were not rebuilt" warning is due.
   */
  warmupSlotCount: number;
};

/**
 * Return the main-lift anchor used by warm-up derivation for one movement.
 * Bodyweight main items are valid mains but intentionally have no `%TM`, so
 * callers can retain blank warm-up slots and warn instead of dropping them.
 */
export function getSwapWarmupAnchor(
  prescription: Prescription,
  movementId: string,
  scope?: MovementMutationScope,
): SwapWarmupAnchor {
  let hasMain = false;
  let warmupSlotCount = 0;
  let topWorkingPercent: number | undefined;
  for (const item of prescription.items ?? []) {
    if (
      !matchesMovement(item, movementId, scope) ||
      isRehabItem(item) ||
      item.kind === "cardio_external"
    ) {
      continue;
    }
    if (item.kind === "warmup") {
      warmupSlotCount += 1;
      continue;
    }
    if (item.kind !== "main") continue;
    hasMain = true;
    if (
      typeof item.percentTm === "number" &&
      Number.isFinite(item.percentTm) &&
      item.percentTm > 0
    ) {
      topWorkingPercent =
        topWorkingPercent == null
          ? item.percentTm
          : Math.max(topWorkingPercent, item.percentTm);
    }
  }
  return { hasMain, topWorkingPercent, warmupSlotCount };
}

/**
 * True when this movement owns an item whose absolute `targetWeightKg`
 * survives a swap (rehab / external cardio — see `swapMovementInPrescription`).
 * Those loads are hand-entered and have no %TM fallback, so the swap carries
 * them across; callers surface that carry-over per DC-K4.
 */
export function swapCarriesAbsoluteLoad(
  prescription: Prescription,
  movementId: string,
  scope?: MovementMutationScope,
): boolean {
  return (prescription.items ?? []).some(
    (item) =>
      matchesMovement(item, movementId, scope) &&
      keepsAbsoluteLoadAcrossSwap(item) &&
      typeof item.targetWeightKg === "number" &&
      Number.isFinite(item.targetWeightKg) &&
      item.targetWeightKg > 0,
  );
}

/**
 * Absolute loads on TM-anchored strength items belong to the OLD movement and
 * must go. Rehab (`kind: "tendon"` + `meta.rehab`) and external-cardio items
 * are never %TM-derived — their `targetWeightKg` is the user's own number, so
 * clearing it would delete the prescription rather than re-derive it.
 */
function keepsAbsoluteLoadAcrossSwap(item: PrescriptionItem): boolean {
  return isRehabItem(item) || item.kind === "cardio_external";
}

function syncEmbeddedRehabSections(
  prescription: Prescription,
  items: PrescriptionItem[],
): Prescription["meta"] {
  const sections = prescription.meta?.embeddedRehabSections;
  if (!sections) return prescription.meta;
  const nextSections = sections.flatMap((section) => {
    const sectionItems = items.filter(
      (item) =>
        isRehabItem(item) &&
        item.meta?.rehabSourceRef === section.sourceRef,
    );
    return sectionItems.length === 0
      ? []
      : [
          {
            ...section,
            itemCount: sectionItems.length,
            movementCount: countDistinctRehabMovements(sectionItems),
          },
        ];
  });
  const meta = { ...(prescription.meta ?? {}) };
  const removedSourceRefs = sections
    .filter(
      (section) =>
        !nextSections.some(
          (nextSection) => nextSection.sourceRef === section.sourceRef,
        ),
    )
    .map((section) => section.sourceRef);
  if (nextSections.length > 0) {
    meta.embeddedRehabSections = nextSections;
  } else {
    delete meta.embeddedRehabSections;
  }
  if (removedSourceRefs.length > 0) {
    meta.removedEmbeddedRehabSourceRefs = Array.from(
      new Set([
        ...(meta.removedEmbeddedRehabSourceRefs ?? []),
        ...removedSourceRefs,
      ]),
    );
  }
  return meta;
}

export function hasUserEditedPrescription(
  prescription: Prescription | null | undefined,
): boolean {
  if (!prescription) return false;
  if (prescription.userEdited === true) return true;
  return (prescription.items ?? []).some((item) => {
    const meta = (item.meta ?? {}) as Record<string, unknown>;
    return meta.userAdded === true || meta.swappedFrom != null;
  });
}

/** Mark a planned workout's calendar placement as a user choice. */
export function markPrescriptionRescheduled(
  prescription: Prescription,
): Prescription {
  if (prescription.meta?.userRescheduled === true) return prescription;
  return {
    ...prescription,
    meta: {
      ...prescription.meta,
      userRescheduled: true,
    },
  };
}

/**
 * Does this planned session carry state the user accepted, such that
 * regenerating the row from the program would throw that state away?
 *
 * Broader than `hasUserEditedPrescription`, which only covers movement edits.
 * A volume trim, a skipped deload, and an early deload are all offers the user
 * explicitly accepted; the prescription was rewritten in place and the marker
 * is the only record that it happened.
 *
 * Limitation-response swaps are NOT visible here — they rewrite items without
 * leaving a marker — so the rewrite path additionally preserves any row named
 * in `limitation_adjustments`.
 */
export function prescriptionCarriesUserState(
  prescription: Prescription | null | undefined,
): boolean {
  if (!prescription) return false;
  if (hasUserEditedPrescription(prescription)) return true;
  return (
    prescription.meta?.userRescheduled === true ||
    prescription.autoregVolumeScale != null ||
    prescription.deloadSkipped === true ||
    prescription.earlyDeload === true
  );
}

/**
 * Returns a NEW prescription with item[itemIndex] swapped to the given
 * movement. Records ``meta.swappedFrom = { movementId, movementName }``
 * on the mutated item — preserving the very-first original through
 * subsequent re-swaps so the badge always shows the planner-prescribed
 * canonical lift, not whatever the last swap was.
 *
 * Throws on out-of-range index. Returns the original ``prescription``
 * reference unchanged when no items array exists (caller already
 * guarded against that — defensive).
 */
export function applyPrescriptionSwap(
  prescription: Prescription,
  input: ApplySwapInput,
): Prescription {
  const items = [...(prescription.items ?? [])];
  if (input.itemIndex < 0 || input.itemIndex >= items.length) {
    throw new RangeError(
      `applyPrescriptionSwap: itemIndex ${input.itemIndex} out of range (length ${items.length})`,
    );
  }
  const orig = items[input.itemIndex]!;
  items[input.itemIndex] = applySwapToItem(orig, input);
  return { ...prescription, items, userEdited: true };
}

/**
 * Returns the originally-prescribed movement display name for an item,
 * if a swap has been applied. ``null`` when the item is unmodified.
 */
export function originalMovementName(item: PrescriptionItem): string | null {
  const meta = (item.meta ?? {}) as Record<string, unknown>;
  const swappedFrom = meta.swappedFrom as SwappedFromMeta | undefined;
  return swappedFrom?.movementName ?? null;
}

/** True when this prescription item has been swapped from its original. */
export function isSwapped(item: PrescriptionItem): boolean {
  return originalMovementName(item) != null;
}

/**
 * Returns a NEW prescription with every item belonging to `movementId` removed.
 * Used by the plan drawer's movement-level edit ("Remove movement"). A no-op
 * (same-shape new object) when the movement isn't present.
 */
export function removeMovementFromPrescription(
  prescription: Prescription,
  movementId: string,
  scope?: MovementMutationScope,
): Prescription {
  const priorItems = prescription.items ?? [];
  const items = priorItems.filter(
    (item) => !matchesMovement(item, movementId, scope),
  );
  if (items.length === priorItems.length) return prescription;
  return {
    ...prescription,
    items,
    meta: syncEmbeddedRehabSections(prescription, items),
    userEdited: true,
  };
}

/**
 * `isWellFormedScheme`'s ceiling. A retained ladder longer than this is
 * generated in chunks so the percentage math stays in its single home
 * (`planner/warmups.ts`) instead of being re-implemented here.
 */
const WARMUP_SCHEME_MAX_SET_COUNT = 5;

/**
 * Sample `ladder` down/up to exactly `slots` entries, reusing only values the
 * user configured (nearest-neighbour, never interpolated). Identity when the
 * counts already match, and always ends on the user's top entry so a shortened
 * ramp still bridges to the working set.
 */
function resampleLadder<T>(ladder: readonly T[], slots: number): T[] {
  if (slots <= 0 || ladder.length === 0) return [];
  if (slots === ladder.length) return [...ladder];
  return Array.from({ length: slots }, (_, position) => {
    const source =
      slots === 1
        ? ladder.length - 1
        : Math.round((position * (ladder.length - 1)) / (slots - 1));
    return ladder[Math.min(source, ladder.length - 1)]!;
  });
}

/**
 * Build exactly `slots` warm-up items for the replacement movement. Returns an
 * empty array when the user's scheme has no ladder at all — callers treat that
 * as "leave the existing slots alone".
 *
 * Slot count is decided by the caller (it is invariant for a started session),
 * so a longer/shorter ladder is resampled to fit. The scheme's ANCHOR is
 * carried onto every chunk: a TM-anchored ladder must stay TM-anchored after a
 * swap, or the rebuild would silently re-anchor a program's fixed ramp to the
 * day's top set.
 */
function buildWarmupSlots(
  newMovement: { id: string; slug: string; displayName: string },
  scheme: WarmupScheme,
  slots: number,
  topWorkingPercent: number | undefined,
  meta: Record<string, unknown>,
): PrescriptionItem[] {
  if (slots <= 0 || scheme.setCount <= 0) return [];
  const percentLadder = resampleLadder(scheme.percentLadder, slots);
  const repLadder = resampleLadder(scheme.repLadder, slots);
  const generated: PrescriptionItem[] = [];
  for (let start = 0; start < slots; start += WARMUP_SCHEME_MAX_SET_COUNT) {
    const end = Math.min(start + WARMUP_SCHEME_MAX_SET_COUNT, slots);
    generated.push(
      ...generateWarmupItems(
        newMovement.id,
        topWorkingPercent ?? 100,
        {
          setCount: end - start,
          percentLadder: percentLadder.slice(start, end),
          repLadder: repLadder.slice(start, end),
          ...(scheme.anchor != null ? { anchor: scheme.anchor } : {}),
        },
        {
          movementSlug: newMovement.slug,
          movementName: newMovement.displayName,
        },
      ),
    );
  }
  // BW prescriptions (and replacements with no TM) intentionally have no %TM
  // anchor. Keep the configured slots and reps, but never invent a percentage
  // or load; the caller's DC-K4 warning makes the blank load explicit.
  return generated.map((item) => {
    if (topWorkingPercent != null) return { ...item, meta: { ...meta } };
    const slot = { ...item };
    delete slot.percentTm;
    delete slot.intensityLabel;
    return { ...slot, meta: { ...meta } };
  });
}

/**
 * Rewrite one existing warm-up slot in place: the item keeps its array
 * position, `sets`, and any notes, and only the fields the rebuild owns
 * (movement identity, reps, %TM, intensity label, stale absolute load) change.
 */
function rewriteWarmupSlot(
  slot: PrescriptionItem,
  generated: PrescriptionItem,
  meta: Record<string, unknown>,
): PrescriptionItem {
  const next: PrescriptionItem = {
    ...slot,
    movementId: generated.movementId,
    movementSlug: generated.movementSlug,
    movementName: generated.movementName,
    reps: generated.reps,
    meta: { ...((slot.meta ?? {}) as Record<string, unknown>), ...meta },
  };
  delete next.targetWeightKg;
  // "This percentage counts bodyweight" is a property of the old movement.
  delete next.systemLoad;
  if (generated.percentTm != null) {
    next.percentTm = generated.percentTm;
    next.intensityLabel = generated.intensityLabel;
  } else {
    delete next.percentTm;
    delete next.intensityLabel;
  }
  return next;
}

/**
 * Returns a NEW prescription with `fromMovementId`'s items all retargeted to the
 * given movement (whole-movement swap, vs the per-item `applyPrescriptionSwap`).
 * Preserves each item's set/rep shape and records the swap lineage in meta.
 *
 * The warm-up ladder is rebuilt off the replacement's anchor because the old
 * ladder's absolute loads belong to the old lift. Two shapes:
 *
 *  - `rebuild.preserveItemIndices` (a session that may already have
 *    `set_logs`): the item COUNT is invariant. Existing warm-up slots are
 *    rewritten where they sit; none are added or removed, so every
 *    `set_logs.prescription_item_index` still points at the item it was
 *    written for.
 *  - otherwise (a future planned session, no logs yet): the matched warm-up
 *    block is replaced with `scheme.setCount` fresh items at the same anchor
 *    position.
 *
 * Throws when `rebuild.warmupScheme` is missing — a swap that skipped the
 * rebuild would leave the previous lift's ladder in place.
 */
export function swapMovementInPrescription(
  prescription: Prescription,
  fromMovementId: string,
  newMovement: { id: string; slug: string; displayName: string },
  swappedAt?: string,
  scope?: MovementMutationScope,
  rebuild?: MovementSwapRebuildOptions,
): Prescription {
  if (rebuild?.warmupScheme == null) {
    throw new TypeError(
      "swapMovementInPrescription: rebuild.warmupScheme is required — " +
        "pass resolveWarmupScheme(profile.warmup_scheme) so the ladder is " +
        "rebuilt for the replacement movement.",
    );
  }
  const warmupScheme = resolveWarmupScheme(rebuild.warmupScheme);
  const priorItems = prescription.items ?? [];
  const stamp = swappedAt ?? new Date().toISOString();
  const preserveItemIndices = rebuild.preserveItemIndices === true;

  const replacementHasTrainingMax = rebuild.replacementHasTrainingMax === true;
  const matched = priorItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matchesMovement(item, fromMovementId, scope));
  if (matched.length === 0) {
    return { ...prescription, items: [...priorItems] };
  }

  // Warm-ups are derived from the highest `main` %TM, exactly as in
  // assemble-prescription.ts. Never use a back-off/accessory percentage as the
  // anchor for a main-lift warmup ladder.
  const coreMatched = matched.filter(
    ({ item }) => !isRehabItem(item) && item.kind !== "cardio_external",
  );
  const warmupAnchor = getSwapWarmupAnchor(
    prescription,
    fromMovementId,
    scope,
  );
  const topWorkingPercent = warmupAnchor.topWorkingPercent;

  const originalName =
    matched.find(({ item }) => item.movementName || item.movementSlug)?.item
      .movementName ??
    matched.find(({ item }) => item.movementSlug)?.item.movementSlug ??
    "previous movement";
  const previousSwappedFrom = matched
    .map(({ item }) => (item.meta as Record<string, unknown> | undefined)?.swappedFrom)
    .find(
      (value): value is SwappedFromMeta =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as SwappedFromMeta).movementId === "string" &&
        typeof (value as SwappedFromMeta).movementName === "string",
    );
  const leavingMovement: SwappedFromMeta = {
    movementId: fromMovementId,
    movementName: originalName,
  };
  const lineage = {
    swappedFrom: previousSwappedFrom ?? leavingMovement,
    swappedAt: stamp,
  };

  // The absolute target belongs to the old movement. Clear it for every
  // rebuilt strength item so set-load resolution either uses the replacement
  // movement's %TM × TM or leaves the load empty when no anchor exists.
  // Rehab / external-cardio items are the exception: their load is the user's
  // own number with no %TM fallback, so clearing it would silently delete the
  // prescription rather than re-derive it (DC-K4).
  //
  // `systemLoad` belongs to the old movement too: it says "this percentage
  // counts bodyweight". Carried across a swap it would take bodyweight off a
  // barbell row. The replacement's own status is read from the catalog.
  const retarget = (item: PrescriptionItem): PrescriptionItem => {
    const prevMeta = (item.meta ?? {}) as Record<string, unknown>;
    const nextItem: PrescriptionItem = {
      ...item,
      movementId: newMovement.id,
      movementSlug: newMovement.slug,
      movementName: newMovement.displayName,
      meta: {
        ...prevMeta,
        ...lineage,
        swapLineage: nextSwapLineage(prevMeta, leavingMovement),
      },
    };
    delete nextItem.systemLoad;
    if (!keepsAbsoluteLoadAcrossSwap(item)) delete nextItem.targetWeightKg;
    return nextItem;
  };

  const oldWarmupSlots = coreMatched.filter(({ item }) => item.kind === "warmup");
  const oldWarmupIndices = new Set(oldWarmupSlots.map(({ index }) => index));

  // How many warm-up slots the movement ends up with.
  //  - live session: exactly what it already has (never re-index a workout
  //    whose set_logs address items by position);
  //  - future session with a main anchor: the user's configured count;
  //  - no main anchor (e.g. warm-ups in front of an accessory-only movement):
  //    retain the existing slots rather than deleting them silently.
  const warmupSlotCount = preserveItemIndices
    ? oldWarmupSlots.length
    : warmupAnchor.hasMain
      ? warmupScheme.setCount
      : oldWarmupSlots.length;
  // Blank slots unless the replacement has BOTH a TM and a working-set anchor.
  const warmupAnchorPercent =
    replacementHasTrainingMax && topWorkingPercent != null
      ? topWorkingPercent
      : undefined;
  const generatedWarmups = buildWarmupSlots(
    newMovement,
    warmupScheme,
    warmupSlotCount,
    warmupAnchorPercent,
    lineage,
  );

  if (preserveItemIndices) {
    // Rewrite in place. A user whose scheme has warm-ups disabled (setCount 0)
    // yields no generated slots — those items are then simply retargeted, so
    // the array length is invariant in every branch.
    const rewritable = generatedWarmups.length === oldWarmupSlots.length;
    const rewrittenByIndex = new Map<number, PrescriptionItem>();
    if (rewritable) {
      oldWarmupSlots.forEach(({ item, index }, position) => {
        rewrittenByIndex.set(
          index,
          rewriteWarmupSlot(item, generatedWarmups[position]!, lineage),
        );
      });
    }
    const items = priorItems.map((item, index) => {
      const rewritten = rewrittenByIndex.get(index);
      if (rewritten) return rewritten;
      if (!matchesMovement(item, fromMovementId, scope)) return item;
      return retarget(item);
    });
    return { ...prescription, items, userEdited: true };
  }

  // Replace only core warmups. Rehab items keep their own shape and remain
  // governed by the caller's rehab scope. The insertion point mirrors the
  // canonical assembly order: warmups immediately precede the first main set.
  const firstMainIndex = coreMatched.find(({ item }) => item.kind === "main")?.index;
  const insertionIndex =
    oldWarmupIndices.size > 0
      ? Math.min(...oldWarmupIndices)
      : firstMainIndex;
  if (generatedWarmups.length > 0 && insertionIndex == null) {
    // Unreachable: warm-ups are only generated when the movement has a main
    // item or warm-up slots of its own, and both give an insertion point.
    // Fail loudly rather than dumping the ladder at the top of the session,
    // ahead of unrelated movements.
    throw new Error(
      "swapMovementInPrescription: generated warm-ups with no anchor item " +
        `for movement ${fromMovementId}`,
    );
  }
  const output: PrescriptionItem[] = [];
  for (let index = 0; index < priorItems.length; index++) {
    if (insertionIndex === index && generatedWarmups.length > 0) {
      output.push(...generatedWarmups);
    }
    if (oldWarmupIndices.has(index)) continue;
    const item = priorItems[index]!;
    if (!matchesMovement(item, fromMovementId, scope)) {
      output.push(item);
      continue;
    }
    output.push(retarget(item));
  }

  return {
    ...prescription,
    items: output,
    userEdited: true,
  };
}

export type AddMovementInput = {
  id: string;
  slug: string;
  displayName: string;
  /** Defaults to a standard 3×10 accessory. */
  sets?: number;
  reps?: number;
};

/**
 * Returns a NEW prescription with a movement appended as an accessory. Defaults
 * to 3×10 — the app's standard accessory dose — so a user can add a movement in
 * the plan drawer without a per-set wizard. Tagged `meta.userAdded` so the
 * origin is auditable.
 */
export function addMovementToPrescription(
  prescription: Prescription,
  movement: AddMovementInput,
): Prescription {
  const item: PrescriptionItem = {
    movementId: movement.id,
    movementSlug: movement.slug,
    movementName: movement.displayName,
    kind: "accessory",
    sets: movement.sets ?? 3,
    reps: movement.reps ?? 10,
    meta: { userAdded: true, addedAt: new Date().toISOString() },
  };
  return {
    ...prescription,
    items: [...(prescription.items ?? []), item],
    userEdited: true,
  };
}
