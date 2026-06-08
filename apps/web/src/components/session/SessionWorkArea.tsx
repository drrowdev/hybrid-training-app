"use client";

/**
 * Session work-area shell: the "Session in progress" banner up top
 * plus the movement-grouped logging surface below.
 *
 * Originally stitched `<PrescriptionItemsList>` to `<SessionLogClient>`
 * with a tap-to-prefill bridge. That two-component layout is replaced
 * here by `<MovementCardList>` — one collapsible card per movement
 * with an inline focus view, dot strip, and per-set save flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Prescription } from "@hta/db";
import type {
  LoggedSet,
  LastSetHint,
  PriorBest,
} from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
  swapPrescriptionItem as swapPrescriptionItemAction,
} from "@/lib/sessions/actions";
import { MovementCardList } from "./MovementCardList";
import {
  mergeOptimisticSets,
  optimisticLogFromFormData,
  serverHasPendingLog,
  type OptimisticLog,
} from "@/lib/sessions/optimistic-log";
import type { PlateInventoryItem } from "./plate-math";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";
import type { SupersetCardInfo } from "@/lib/sessions/superset-cards";

type AddStrengthSetAction = typeof addStrengthSetAction;
type FillSessionFromPlanAction = typeof fillSessionFromPlanAction;
type SwapAction = typeof swapPrescriptionItemAction;

export function SessionWorkArea({
  sessionId,
  isComplete,
  performedAt,
  sets,
  tmBySlug,
  oneRmBySlug,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  // `lastSetHints` (prior-session "last time: X kg × Y" for each
  // movement) is computed server-side and threaded to the card list,
  // which surfaces it on accessory cards — the only weight-selection
  // signal there, since accessories have no TM-derived target.
  lastSetHints,
  priorBests,
  // Prescription wiring (null when the session is freestyle / unlinked).
  plannedSessionId,
  prescription,
  swapAction,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  barbellKg,
  trapBarKg,
  plateInventory,
  bwGateStateByFamily,
  resolvedFreestyle,
  supersetByMovementId,
  bodyweightMovementIds,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  addStrengthSet: AddStrengthSetAction;
  fillFromPlan: FillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  lastSetHints: Record<string, LastSetHint>;
  priorBests: Record<string, PriorBest>;
  plannedSessionId: string | null;
  prescription: Prescription | null;
  swapAction: SwapAction;
  loggedItemIndices: number[];
  skippedItemIndices?: number[];
  loggedSetIdByItemIndex: Record<number, string>;
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
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
   * Server-resolved freestyle list (union of session_movements ∪
   * distinct set_logs.movement_id). When omitted the card list falls
   * back to its legacy set_logs-only derivation, which is still
   * correct but loses anything the user added without logging a set.
   */
  resolvedFreestyle?: ReadonlyArray<ResolvedFreestyleMovement>;
  /**
   * ADR 0026 P5b — antagonist-superset membership keyed by accessory
   * movementId, built server-side. Threaded straight through to
   * `MovementCardList`. Omitted / empty = no supersets (solo cards).
   */
  supersetByMovementId?: ReadonlyMap<string, SupersetCardInfo>;
  /**
   * Movement ids whose movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, etc. The focus view lets these log at 0 kg
   * added load (bodyweight) instead of demanding a weight. Omitted ⇒ none.
   */
  bodyweightMovementIds?: ReadonlyArray<string>;
}) {
  // `plannedSessionId` and the page-level swap server action aren't
  // surfaced by the card-list layout — they're accepted to preserve the
  // existing prop contract from the server page (and to keep tests that
  // reach into the prop shape happy). `performedAt` is no longer rendered
  // here (the in-progress banner that used it was removed as redundant).
  void plannedSessionId;
  void swapAction;
  void performedAt;

  // ── Optimistic logging overlay ────────────────────────────────────────────
  // The set-log server action revalidates (and thus re-renders) this whole
  // page before resolving. Awaiting that made every "Log set" tap stall for
  // seconds before the cursor advanced. We keep a client overlay of pending
  // logs so the UI advances the instant the user taps; the real write +
  // revalidation settle in the background, and each pending entry is reconciled
  // away once the refreshed server `sets` includes its row.
  const [pendingLogs, setPendingLogs] = useState<OptimisticLog[]>([]);

  // Reconcile: drop any pending entry the freshly-fetched server sets now
  // represent. Runs whenever the server `sets` prop changes (after a
  // revalidation lands).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the optimistic overlay against freshly-fetched server sets; functional updater no-ops when nothing changed
    setPendingLogs((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((log) => !serverHasPendingLog(sets, log));
      return next.length === prev.length ? prev : next;
    });
  }, [sets]);

  const logSet = useCallback(
    async (fd: FormData): Promise<{ error?: string; ok?: true }> => {
      const clientKey = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic = optimisticLogFromFormData(fd, clientKey);
      // Only overlay PRESCRIBED logs (those carry a prescriptionItemIndex we can
      // reconcile against the server row). Freestyle/off-plan logs have no index
      // — overlaying them would never reconcile and would double-show once the
      // server catches up — so they take the plain (awaited) path.
      const overlay = optimistic && optimistic.prescriptionItemIndex != null;
      if (overlay) {
        setPendingLogs((prev) => [...prev, optimistic]);
      }
      const result = await addStrengthSet(fd);
      if (result?.error && overlay) {
        // Roll the overlay back so the slot un-logs and the user can retry.
        setPendingLogs((prev) => prev.filter((l) => l.clientKey !== clientKey));
      }
      return result;
    },
    [addStrengthSet],
  );

  const mergedSets = useMemo(
    () => mergeOptimisticSets(sets, pendingLogs),
    [sets, pendingLogs],
  );

  const loggedSet = useMemo(() => {
    const s = new Set<number>(loggedItemIndices);
    for (const log of pendingLogs) {
      if (log.prescriptionItemIndex != null) s.add(log.prescriptionItemIndex);
    }
    return s;
  }, [loggedItemIndices, pendingLogs]);

  const skippedSet = useMemo(() => {
    const s = new Set<number>(skippedItemIndices ?? []);
    for (const log of pendingLogs) {
      if (log.skipped && log.prescriptionItemIndex != null) {
        s.add(log.prescriptionItemIndex);
      }
    }
    return s;
  }, [skippedItemIndices, pendingLogs]);

  const priorBestsForCards: Record<
    string,
    { heaviestWeight: number | null; bestE1rm: number | null }
  > = priorBests;

  return (
    <MovementCardList
      sessionId={sessionId}
      isComplete={isComplete}
      prescription={prescription}
      sets={mergedSets}
      tmBySlug={tmBySlug}
      oneRmBySlug={oneRmBySlug}
      loggedItemIndices={loggedSet}
      skippedItemIndices={skippedSet}
      loggedSetIdByItemIndex={loggedSetIdByItemIndex}
      priorBests={priorBestsForCards}
      lastSetHints={lastSetHints}
      addStrengthSet={logSet}
      fillFromPlan={fillFromPlan}
      hapticsEnabled={hapticsEnabled}
      timerSoundEnabled={timerSoundEnabled}
      barbellKg={barbellKg}
      trapBarKg={trapBarKg}
      plateInventory={plateInventory}
      bwGateStateByFamily={bwGateStateByFamily}
      resolvedFreestyle={resolvedFreestyle}
      supersetByMovementId={supersetByMovementId}
      bodyweightMovementIds={bodyweightMovementIds}
    />
  );
}

