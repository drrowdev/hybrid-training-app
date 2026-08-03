"use client";

/**
 * Top-level container for the session log: one collapsible
 * `<MovementCard>` per prescribed movement, plus a freestyle "Add
 * movement" path for sets logged off-plan, plus the compact
 * "All logged sets" table at the bottom.
 *
 * Replaces the older `<PrescriptionItemsList>` + `<SessionLogClient>`
 * pair when there is a linked prescription. Freestyle sessions
 * (no prescription) still flow through the freestyle add-movement
 * path here, so the user always sees the same card-shaped UI.
 */

import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { Prescription } from "@hta/db";
import {
  groupPrescriptionByMovement,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { bucketForGroup } from "@/lib/sessions/movement-summary";
import { MetricHelp } from "@/components/ui/MetricHelp";
import {
  segmentAccessoryGroups,
  type SupersetCardInfo,
} from "@/lib/sessions/superset-cards";
import { MovementCard } from "./MovementCard";
import { FreestyleMovementCard } from "./FreestyleMovementCard";
import type { PlateInventoryItem } from "./plate-math";
import type { LoggedSet, LastSetHint } from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
} from "@/lib/sessions/actions";
import { removeSessionMovementAction } from "@/lib/sessions/session-movement-actions";
import { reorderSessionAccessories } from "@/lib/sessions/reorder-actions";
import { hapticTick } from "@/lib/feedback";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";
import {
  applyCustomOrder,
  smartAccessoryOrder,
  type AccessoryMeta,
} from "@/lib/sessions/accessory-order";

const EMPTY_SUPERSET_MAP: ReadonlyMap<string, SupersetCardInfo> = new Map();

export type MovementCardListProps = {
  sessionId: string;
  isComplete: boolean;
  prescription: Prescription | null;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  loggedItemIndices: ReadonlySet<number>;
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  /**
   * Prior-session "last time: X kg × Y (date)" top set per movementId,
   * computed server-side. Surfaced on accessory cards only — mains have
   * a TM-derived prescribed weight, so the hint would be redundant noise
   * there. Optional (defaults to `{}`) so existing callers/tests are
   * unaffected.
   */
  lastSetHints?: Record<string, LastSetHint>;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /** User equipment props forwarded to each prescribed card. */
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
  /**
   * Phase 4 BW gate state, keyed by movement family. Forwarded verbatim
   * to each prescribed `<MovementCard>` so the focus view can render the
   * "Next:" chip + popover.
   */
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
  /**
   * Server-resolved freestyle movement list (persisted +
   * set_logs-derived union). When supplied, replaces the legacy
   * "movements derived from set_logs only" computation that used to
   * live in this component.
   */
  resolvedFreestyle?: ReadonlyArray<ResolvedFreestyleMovement>;
  /**
   * ADR 0026 P5b — accessory movementId -> antagonist-superset membership, built
   * server-side from the (unpaired) prescription so paired accessory CARDS can be
   * bracketed and pulled adjacent WITHOUT reordering the index-bearing items.
   * Empty / omitted = no supersets (every card renders solo, as before).
   */
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
  /**
   * Movement ids whose movement is bodyweight-capable (`body_weight_loaded` in
   * the catalog): pull-ups, dips, inverted rows, push-ups, etc. Forwarded to
   * each card so the focus view can log them at 0 kg added load. Omitted ⇒ none.
   */
  bodyweightMovementIds?: ReadonlyArray<string>;
  /**
   * Equipment + region per movementId, used to cluster accessory cards by
   * "station" (smart ordering). Omitted ⇒ keep the engine's pass order.
   */
  accessoryMetaById?: Readonly<Record<string, AccessoryMeta>>;
  /**
   * User's saved per-session accessory order (movementIds). Applied OVER the
   * smart default, so the user's manual reorder wins. Omitted ⇒ smart default.
   */
  customAccessoryOrder?: ReadonlyArray<string> | null;
};

export function MovementCardList({
  sessionId,
  isComplete,
  prescription,
  sets,
  tmBySlug,
  oneRmBySlug,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  priorBests,
  lastSetHints = {},
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg,
  trapBarKg,
  plateInventory,
  preferStandardLbPlates,
  bwGateStateByFamily,
  resolvedFreestyle,
  supersetByMovementId,
  bodyweightMovementIds,
  accessoryMetaById,
  customAccessoryOrder,
}: MovementCardListProps) {
  const bodyweightIdSet = useMemo(
    () => new Set(bodyweightMovementIds ?? []),
    [bodyweightMovementIds],
  );
  // Optimistic local accessory order (movementIds). Set the instant the user
  // taps move; the server write settles in the background. `null` = use the
  // server-saved `customAccessoryOrder` (or the smart default when that's null).
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const effectiveOrder = localOrder ?? customAccessoryOrder ?? null;
  const hasManualOrder = (effectiveOrder?.length ?? 0) > 0;
  const groups = useMemo(
    () => groupPrescriptionByMovement(prescription),
    [prescription],
  );

  // Map prescribed movementIds for the freestyle add to skip duplicates.
  const prescribedIds = useMemo(
    () => new Set(groups.map((g) => g.movementId)),
    [groups],
  );

  // Logged sets bucketed by movementId for both the prescribed cards
  // (prior-set summary) and the freestyle cards (their own dot strip).
  const setsByMovement = useMemo(() => {
    const m = new Map<string, LoggedSet[]>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      const arr = m.get(s.movement.id) ?? [];
      arr.push(s);
      m.set(s.movement.id, arr);
    }
    return m;
  }, [sets]);

  // Freestyle movement ids = logged movements that aren't in the prescription.
  // Used as the fallback when the server didn't supply a resolved list.
  const freestyleMovements = useMemo(() => {
    const seen = new Map<string, LoggedSet["movement"]>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      if (prescribedIds.has(s.movement.id)) continue;
      if (!seen.has(s.movement.id)) seen.set(s.movement.id, s.movement);
    }
    return Array.from(seen.values());
  }, [sets, prescribedIds]);

  // User-added (yet-unlogged) freestyle movements — stacked on top of
  // anything the server already knows about. Also acts as the
  // optimistic-remove ledger: we hide ids the user asked to remove
  // before the next server fetch lands.
  //
  // The actual "+ Add" entry point now lives in `<AddToWorkout>` at
  // the page level (issue #210 unification — the inline picker that
  // used to be rendered below this list was a duplicate surface).
  // `pendingFreestyle` is retained as a no-op slot so the optimistic
  // round-trip continues to work if a future caller wires it back up;
  // today, the only mutator left is `setRemovedIds` via `handleRemove`.
  const [pendingFreestyle] = useState<LoggedSet["movement"][]>([]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  // Final ordered list of (movement, loggedSetCount) tuples for the
  // freestyle render block. When the server supplied a resolved union
  // we honour it verbatim (modulo optimistic pending/removed). When it
  // didn't, we fall back to the legacy "derived from sets" shape so
  // older callers (and tests) keep working.
  const freestyleMerged = useMemo<
    Array<{ movement: LoggedSet["movement"]; loggedSetCount: number }>
  >(() => {
    const setsCount = new Map<string, number>();
    for (const s of sets) {
      if (!s.movement.id) continue;
      setsCount.set(s.movement.id, (setsCount.get(s.movement.id) ?? 0) + 1);
    }

    const seen = new Set<string>();
    const out: Array<{ movement: LoggedSet["movement"]; loggedSetCount: number }> = [];

    if (resolvedFreestyle && resolvedFreestyle.length > 0) {
      for (const r of resolvedFreestyle) {
        if (prescribedIds.has(r.movement.id)) continue;
        if (removedIds.has(r.movement.id)) continue;
        seen.add(r.movement.id);
        out.push({ movement: r.movement, loggedSetCount: r.loggedSetCount });
      }
    } else {
      for (const m of freestyleMovements) {
        if (removedIds.has(m.id)) continue;
        seen.add(m.id);
        out.push({ movement: m, loggedSetCount: setsCount.get(m.id) ?? 0 });
      }
    }

    for (const m of pendingFreestyle) {
      if (seen.has(m.id)) continue;
      if (prescribedIds.has(m.id)) continue;
      if (removedIds.has(m.id)) continue;
      out.push({ movement: m, loggedSetCount: setsCount.get(m.id) ?? 0 });
    }
    return out;
  }, [
    resolvedFreestyle,
    freestyleMovements,
    pendingFreestyle,
    prescribedIds,
    removedIds,
    sets,
  ]);

  const handleRemove = (movementId: string) => {
    // Drop into the tombstone set so the card disappears immediately;
    // the server action will revalidate on its own.
    setRemovedIds((prev) => {
      if (prev.has(movementId)) return prev;
      const next = new Set(prev);
      next.add(movementId);
      return next;
    });
  };

  // Partition prescribed groups into main vs accessory buckets for
  // the two sub-section headings. Order within each bucket is the
  // original first-appearance order from the prescription.
  const { mainGroups, accessoryGroups, otherGroups } = useMemo(() => {
    const main: MovementGroup[] = [];
    const accessory: MovementGroup[] = [];
    const other: MovementGroup[] = [];
    for (const g of groups) {
      const b = bucketForGroup(g);
      if (b === "main") main.push(g);
      else if (b === "accessory") accessory.push(g);
      else other.push(g);
    }
    // Smart ordering: cluster accessory cards by equipment "station" so they're
    // done back-to-back (and antagonist pairs land adjacent), instead of the
    // engine's priority-pass order. Then apply the user's manual reorder OVER
    // that default. Presentational only — item indices unchanged.
    const smart = accessoryMetaById
      ? smartAccessoryOrder(accessory, (g) => g.movementId, accessoryMetaById)
      : accessory;
    const orderedAccessory = applyCustomOrder(smart, (g) => g.movementId, effectiveOrder);
    return { mainGroups: main, accessoryGroups: orderedAccessory, otherGroups: other };
  }, [groups, accessoryMetaById, effectiveOrder]);

  // First prescribed card with no logged sets across the whole session
  // shows the session-level "Same as planned" button.
  const showFillOnFirst = !isComplete && sets.length === 0;

  // Build a single ordered render list so the "first card" check for
  // the session-level fill button stays correct across both sections.
  const orderedGroups: MovementGroup[] = useMemo(
    () => [...mainGroups, ...accessoryGroups, ...otherGroups],
    [mainGroups, accessoryGroups, otherGroups],
  );

  // ADR 0026 P5b — fold the accessory cards into solo cards + antagonist
  // superset clusters (A2 pulled adjacent to A1). Membership is derived
  // server-side from the unpaired prescription; the underlying items are NOT
  // reordered, so the index-based set matching is untouched. Empty map (pref
  // off / no pairs) => every entry is solo, original order preserved.
  //
  // Once the user MANUALLY reorders, we respect their literal order — the
  // auto-superset re-clustering is suppressed so it can't fight their choice.
  const accessorySegments = useMemo(
    () =>
      segmentAccessoryGroups(
        accessoryGroups,
        hasManualOrder ? EMPTY_SUPERSET_MAP : supersetByMovementId ?? EMPTY_SUPERSET_MAP,
      ),
    [accessoryGroups, supersetByMovementId, hasManualOrder],
  );

  // Move an accessory card up/down. Recomputes the full movementId order from
  // the current (possibly smart/custom) accessory order, swaps the neighbour,
  // applies it optimistically, and persists in the background. Display-only.
  const reorderEnabled = !isComplete && accessoryGroups.length > 1;
  const persistOrder = useCallback(
    (ids: string[]) => {
      setLocalOrder(ids);
      void reorderSessionAccessories({ sessionId, movementIds: ids }).catch(() => {
        // Best-effort persistence; the optimistic order still stands for the
        // session even if the write fails (a reload would revert it).
      });
    },
    [sessionId],
  );
  // Drag-to-reorder built on POINTER events (not HTML5 drag), so it works with
  // both touch and mouse — native HTML5 drag never fires from touch on iOS, and
  // this is a phone-first app, so pointer events are the only way to offer drag
  // as the sole reorder affordance (no arrows). Pointer capture on the grip routes
  // every move/up to the handle; we hit-test the live accessory rects by clientY
  // to find the card under the finger and insert the dragged item there.
  const wrapperRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerWrapper = useCallback((movementId: string, el: HTMLDivElement | null) => {
    if (el) wrapperRefs.current.set(movementId, el);
    else wrapperRefs.current.delete(movementId);
  }, []);
  const draggingRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const accessoryIdOrder = useMemo(
    () => accessoryGroups.map((g) => g.movementId),
    [accessoryGroups],
  );

  // The accessory whose row currently contains the pointer's Y (live rects).
  const hitTestAccessory = useCallback((clientY: number): string | null => {
    for (const id of wrapperRefs.current.keys()) {
      const el = wrapperRefs.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return id;
    }
    return null;
  }, []);

  const onGripPointerDown = useCallback(
    (movementId: string) => (e: React.PointerEvent<HTMLSpanElement>) => {
      // Left mouse button only; any touch / pen starts the drag.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = movementId;
      dragOverRef.current = movementId;
      setDraggingId(movementId);
      setDragOverId(movementId);
      hapticTick(hapticsEnabled);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture can throw if the pointer is already gone — ignore. */
      }
    },
    [hapticsEnabled],
  );

  const onGripPointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      const over = hitTestAccessory(e.clientY);
      if (over) {
        dragOverRef.current = over;
        setDragOverId(over);
      }
    },
    [hitTestAccessory],
  );

  const finishDrag = useCallback(() => {
    const fromId = draggingRef.current;
    const overId = dragOverRef.current;
    draggingRef.current = null;
    dragOverRef.current = null;
    setDraggingId(null);
    setDragOverId(null);
    if (!fromId || !overId || fromId === overId) return;
    const ids = [...accessoryIdOrder];
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    persistOrder(ids);
  }, [accessoryIdOrder, persistOrder]);

  const onGripPointerUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  // Accessory movementIds — the only bucket that surfaces the
  // prior-session "last time" hint (mains use a TM-derived target).
  const accessoryIds = useMemo(
    () => new Set(accessoryGroups.map((g) => g.movementId)),
    [accessoryGroups],
  );

  const renderCard = (group: MovementGroup, dragHandle?: React.ReactNode) => {
    const idx = orderedGroups.indexOf(group);
    return (
      <PrescribedCard
        key={group.movementId}
        sessionId={sessionId}
        group={group}
        readOnly={isComplete}
        tmBySlug={tmBySlug}
        oneRmBySlug={oneRmBySlug}
        loggedItemIndices={loggedItemIndices}
        skippedItemIndices={skippedItemIndices}
        loggedSetIdByItemIndex={loggedSetIdByItemIndex}
        loggedSets={setsByMovement.get(group.movementId) ?? []}
        priorBests={priorBests}
        lastSetHint={
          accessoryIds.has(group.movementId)
            ? lastSetHints[group.movementId]
            : undefined
        }
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillFromPlan}
        showFillFromPlan={idx === 0 && showFillOnFirst}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
        preferStandardLbPlates={preferStandardLbPlates}
        bwGateStateByFamily={bwGateStateByFamily}
        bodyweightCapable={bodyweightIdSet.has(group.movementId)}
        {...(dragHandle ? { dragHandle } : {})}
      />
    );
  };

  const renderAccessoryCard = (group: MovementGroup) => {
    if (!reorderEnabled) return renderCard(group);
    return (
      <ReorderableAccessory
        key={group.movementId}
        movementId={group.movementId}
        registerWrapper={registerWrapper}
        isDragging={draggingId === group.movementId}
        isDragOver={dragOverId === group.movementId && draggingId !== group.movementId}
      >
        {renderCard(
          group,
          <AccessoryDragGrip
            movementId={group.movementId}
            onPointerDown={onGripPointerDown(group.movementId)}
            onPointerMove={onGripPointerMove}
            onPointerUp={onGripPointerUp}
          />,
        )}
      </ReorderableAccessory>
    );
  };

  return (
    <div data-testid="movement-card-list" style={{ display: "grid", gap: 12 }}>
      {mainGroups.length > 0 && (
        <>
          <SectionDivider label="Main lifts" testId="movement-group-main" />
          {mainGroups.map(renderCard)}
        </>
      )}

      {accessoryGroups.length > 0 && (
        <>
          <SectionDivider
            label="Accessory work"
            testId="movement-group-accessory"
            helpTerm="accessory_work"
          />
          {accessorySegments.map((seg) =>
            seg.kind === "solo" ? (
              renderAccessoryCard(seg.group)
            ) : (
              <SupersetCardBracket key={seg.groupId} groupId={seg.groupId}>
                {seg.groups.map(renderCard)}
              </SupersetCardBracket>
            ),
          )}
        </>
      )}

      {(otherGroups.length > 0 || freestyleMerged.length > 0) && (
        <SectionDivider label="Other" testId="movement-group-other" />
      )}
      {otherGroups.map(renderCard)}

      {freestyleMerged.map(({ movement: m, loggedSetCount }) => (
        <FreestyleMovementCard
          key={m.id}
          sessionId={sessionId}
          movement={m}
          readOnly={isComplete}
          loggedSets={setsByMovement.get(m.id) ?? []}
          loggedSetCount={loggedSetCount}
          tmKg={tmBySlug[m.slug]}
          oneRmKg={oneRmBySlug[m.slug]}
          priorBest={priorBests[m.id]}
          addStrengthSet={addStrengthSet}
          removeSessionMovement={removeSessionMovementAction}
          onRemove={handleRemove}
          hapticsEnabled={hapticsEnabled}
          timerSoundEnabled={timerSoundEnabled}
        />
      ))}

    </div>
  );
}

/**
 * Reorder wrapper for an accessory card. Drag-only: a grip handle the user drags
 * (or swipes, on touch) to reorder. Built on POINTER events — not HTML5 drag —
 * so it works with finger and mouse alike (native drag never fires from touch on
 * iOS, and this is a phone-first app). The wrapper registers itself so the parent
 * can hit-test which card the pointer is over.
 */
function ReorderableAccessory({
  movementId,
  registerWrapper,
  isDragging,
  isDragOver,
  children,
}: {
  movementId: string;
  registerWrapper: (movementId: string, el: HTMLDivElement | null) => void;
  isDragging: boolean;
  isDragOver: boolean;
  children: React.ReactNode;
}) {
  // Full-width wrapper: the card keeps the same width as the non-reorderable
  // main-lift cards (the grip lives INSIDE the card header — see AccessoryDragGrip).
  // The wrapper only registers itself for drag hit-testing and draws the drag
  // state (dim while picked up, accent rule on the drop target).
  return (
    <div
      ref={(el) => registerWrapper(movementId, el)}
      data-testid={`accessory-reorder-${movementId}`}
      style={{
        opacity: isDragging ? 0.5 : 1,
        borderTop: isDragOver ? "2px solid var(--cp-accent)" : "2px solid transparent",
        borderRadius: 4,
        transition: "opacity 0.12s",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Subtle in-card reorder grip rendered in the accessory card header (after the
 * disclosure arrow). Pointer-driven so it works with finger and mouse alike, and
 * stops propagation so grabbing the handle never toggles the card open/closed.
 */
function AccessoryDragGrip({
  movementId,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  movementId: string;
  onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLSpanElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      data-testid={`accessory-drag-${movementId}`}
      role="button"
      tabIndex={0}
      aria-label="Drag to reorder"
      title="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 32,
        marginRight: -4,
        color: "var(--cp-text-soft, var(--cp-text-muted))",
        fontSize: 15,
        lineHeight: 1,
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
      }}
    >
      ⠿
    </span>
  );
}

type PrescribedCardProps = {
  sessionId: string;
  group: MovementGroup;
  readOnly?: boolean;
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  loggedItemIndices: ReadonlySet<number>;
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  loggedSets: LoggedSet[];
  priorBests: Record<string, { heaviestWeight: number | null; bestE1rm: number | null }>;
  lastSetHint?: LastSetHint;
  addStrengthSet: typeof addStrengthSetAction;
  fillFromPlan: typeof fillSessionFromPlanAction;
  showFillFromPlan: boolean;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
  bodyweightCapable?: boolean;
  dragHandle?: React.ReactNode;
};

const PrescribedCard = memo(function PrescribedCard(props: PrescribedCardProps) {
  const tmKg = props.group.movementSlug
    ? props.tmBySlug[props.group.movementSlug]
    : undefined;
  const oneRmKg = props.group.movementSlug
    ? props.oneRmBySlug[props.group.movementSlug]
    : undefined;
  const priorBest = props.priorBests[props.group.movementId];
  const focusLogged = props.loggedSets.map((s) => ({
    id: s.id,
    weightKg: s.weight_kg == null ? null : Number(s.weight_kg),
    reps: s.reps,
    distanceM: s.distance_m ?? null,
    durationSec: s.duration_sec ?? null,
    rpe: s.rpe == null ? null : Number(s.rpe),
    skipped: s.skipped ?? false,
    skipReason: (s.skip_reason as
      | "pain"
      | "fatigue"
      | "time"
      | "equipment"
      | "other"
      | null
      | undefined) ?? null,
  }));
  return (
    <MovementCard
      sessionId={props.sessionId}
      group={props.group}
      readOnly={props.readOnly}
      tmKg={tmKg}
      oneRmKg={oneRmKg}
      loggedItemIndices={props.loggedItemIndices}
      skippedItemIndices={props.skippedItemIndices}
      loggedSetIdByItemIndex={props.loggedSetIdByItemIndex}
      loggedSets={focusLogged}
      priorBest={priorBest}
      lastSetHint={props.lastSetHint}
      addStrengthSet={props.addStrengthSet}
      fillFromPlan={props.fillFromPlan}
      showFillFromPlan={props.showFillFromPlan}
      hapticsEnabled={props.hapticsEnabled}
      timerSoundEnabled={props.timerSoundEnabled}
      barbellKg={props.barbellKg}
      trapBarKg={props.trapBarKg}
      plateInventory={props.plateInventory}
      preferStandardLbPlates={props.preferStandardLbPlates}
      persistKeyPrefix={`mc:${props.sessionId}`}
      bwGateStateByFamily={props.bwGateStateByFamily}
      bodyweightCapable={props.bodyweightCapable}
      dragHandle={props.dragHandle}
    />
  );
}, samePrescribedCardProps);

function samePrescribedCardProps(
  previous: PrescribedCardProps,
  next: PrescribedCardProps,
): boolean {
  if (
    previous.sessionId !== next.sessionId ||
    previous.group !== next.group ||
    previous.readOnly !== next.readOnly ||
    previous.tmBySlug !== next.tmBySlug ||
    previous.oneRmBySlug !== next.oneRmBySlug ||
    previous.priorBests !== next.priorBests ||
    previous.lastSetHint !== next.lastSetHint ||
    previous.addStrengthSet !== next.addStrengthSet ||
    previous.fillFromPlan !== next.fillFromPlan ||
    previous.showFillFromPlan !== next.showFillFromPlan ||
    previous.hapticsEnabled !== next.hapticsEnabled ||
    previous.timerSoundEnabled !== next.timerSoundEnabled ||
    previous.barbellKg !== next.barbellKg ||
    previous.trapBarKg !== next.trapBarKg ||
    previous.plateInventory !== next.plateInventory ||
    previous.preferStandardLbPlates !== next.preferStandardLbPlates ||
    previous.bwGateStateByFamily !== next.bwGateStateByFamily ||
    previous.bodyweightCapable !== next.bodyweightCapable ||
    Boolean(previous.dragHandle) !== Boolean(next.dragHandle)
  ) {
    return false;
  }

  if (!sameLoggedSets(previous.loggedSets, next.loggedSets)) return false;
  for (const itemIndex of previous.group.itemIndices) {
    if (
      previous.loggedItemIndices.has(itemIndex) !==
        next.loggedItemIndices.has(itemIndex) ||
      (previous.skippedItemIndices?.has(itemIndex) ?? false) !==
        (next.skippedItemIndices?.has(itemIndex) ?? false) ||
      previous.loggedSetIdByItemIndex[itemIndex] !==
        next.loggedSetIdByItemIndex[itemIndex]
    ) {
      return false;
    }
  }
  return true;
}

function sameLoggedSets(previous: LoggedSet[], next: LoggedSet[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) {
    const a = previous[index]!;
    const b = next[index]!;
    if (
      a.id !== b.id ||
      a.weight_kg !== b.weight_kg ||
      a.reps !== b.reps ||
      a.distance_m !== b.distance_m ||
      a.duration_sec !== b.duration_sec ||
      a.rpe !== b.rpe ||
      a.skipped !== b.skipped ||
      a.skip_reason !== b.skip_reason
    ) {
      return false;
    }
  }
  return true;
}

/**
 * ADR 0026 P5b — bracket around an antagonist superset pair in the logger.
 * Wraps the two paired accessory cards with a left accent rule + a "Superset ·
 * alternate, rest once" caption so the lifter does them back-to-back and rests
 * a single time per round. Internal A1/A2 slot codes are NOT surfaced.
 */
function SupersetCardBracket({
  groupId,
  children,
}: {
  groupId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid="superset-card-bracket"
      data-superset-group={groupId}
      style={{
        display: "grid",
        gap: 12,
        borderLeft: "2px solid var(--cp-accent, var(--cp-text-muted))",
        paddingLeft: 10,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-accent, var(--cp-text-muted))",
          fontWeight: 600,
        }}
      >
        Superset · alternate, rest once
      </div>
      {children}
    </div>
  );
}

function SectionDivider({
  label,
  testId,
  helpTerm,
}: {
  label: string;
  testId: string;
  helpTerm?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 15,
        letterSpacing: "-0.01em",
        color: "var(--cp-text)",
        fontWeight: 700,
        padding: "16px 2px 8px",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {label}
        {helpTerm && <MetricHelp term={helpTerm} variant="why" placement="bottom" />}
      </span>
    </div>
  );
}
