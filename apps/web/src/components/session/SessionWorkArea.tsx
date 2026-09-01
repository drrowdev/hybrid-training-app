"use client";

/**
 * Session work-area shell: the "Session in progress" banner up top
 * plus the movement-grouped logging surface below.
 *
 * Originally stitched `<PrescriptionItemsList>` to `<SessionLogClient>`
 * with a tap-to-prefill bridge. That two-component layout is replaced
 * here by `<MovementCardList>` — a single active Focus Strip for
 * prescribed work, plus the existing freestyle cards.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  updateStrengthSetInline as updateStrengthSetInlineAction,
  AddStrengthSetResult,
} from "@/lib/sessions/actions";
import { MovementCardList } from "./MovementCardList";
import {
  buildLoggedSetIdOverlay,
  dropConfirmed,
  hydrateQueuedSetLogs,
  mergeOptimisticSets,
  optimisticLogFromFormData,
  planLogSetOutcome,
  serverHasPendingLog,
  type OptimisticLog,
} from "@/lib/sessions/optimistic-log";
import {
  countForSession as outboxCountForSession,
  listDeadLetteredForSession as outboxListDeadLetteredForSession,
  listForSession as outboxListForSession,
} from "@/lib/offline/outbox";
import {
  createOutboxEntryId,
  formDataToPayload,
} from "@/lib/offline/outbox-core";
import { runDurableAction } from "@/lib/offline/durable-action";
import { startAutoFlush } from "@/lib/offline/flusher";
import { clearResume } from "@/lib/sessions/session-resume";
import { OfflineSyncBadge } from "./OfflineSyncBadge";
import { useSessionLoggingState } from "./SessionLoggingState";
import type { PlateInventoryItem } from "./plate-math";
import type { ResolvedFreestyleMovement } from "@/lib/sessions/freestyle-resolver";

type AddStrengthSetAction = typeof addStrengthSetAction;
type FillSessionFromPlanAction = typeof fillSessionFromPlanAction;
type SwapAction = typeof swapPrescriptionItemAction;
type UpdateStrengthSetAction = typeof updateStrengthSetInlineAction;

export function SessionWorkArea({
  sessionId,
  isComplete,
  performedAt,
  sets,
  tmBySlug,
  oneRmBySlug,
  addStrengthSet,
  updateStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  restTimerEnabled,
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
  safetyBarKg,
  plateInventory,
  preferStandardLbPlates,
  bwGateStateByFamily,
  resolvedFreestyle,
  bodyweightMovementIds,
  systemLoadMovementIds,
  bodyweightKg,
  accessoryMetaById,
  customAccessoryOrder,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
  oneRmBySlug: Record<string, number>;
  addStrengthSet: AddStrengthSetAction;
  updateStrengthSet: UpdateStrengthSetAction;
  fillFromPlan: FillSessionFromPlanAction;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  restTimerEnabled: boolean;
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
  safetyBarKg?: number;
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
  /**
   * Server-resolved freestyle list (union of session_movements ∪
   * distinct set_logs.movement_id). When omitted the card list falls
   * back to its legacy set_logs-only derivation, which is still
   * correct but loses anything the user added without logging a set.
   */
  resolvedFreestyle?: ReadonlyArray<ResolvedFreestyleMovement>;
  /**
   * Movement ids whose movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, etc. The focus view lets these log at 0 kg
   * added load (bodyweight) instead of demanding a weight. Omitted ⇒ none.
   */
  bodyweightMovementIds?: ReadonlyArray<string>;
  /**
   * Movement ids anchored on a SYSTEM load — a max that counts bodyweight plus
   * belt (weighted pull-ups / dips). A percentage of that max is a total, so
   * the load to put on the belt is that total minus the lifter's bodyweight.
   */
  systemLoadMovementIds?: ReadonlyArray<string>;
  /** The lifter's bodyweight (kg) — resolves the loads above. */
  bodyweightKg?: number | null;
  /** Equipment + region per movementId for smart accessory card ordering. */
  accessoryMetaById?: Readonly<Record<string, { equipment: string | null; region: string | null }>>;
  /** User's saved per-session accessory order (movementIds); overrides the smart default. */
  customAccessoryOrder?: ReadonlyArray<string> | null;
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
  // The set-log server action intentionally does NOT revalidate (a per-set
  // full-page rebuild re-ran ~15 queries just to record one row). We keep a
  // client overlay of pending logs so the UI advances the instant the user taps;
  // the real write settles in the background. A fresh server snapshot (finish,
  // edit, offline-flush, or a reload) reconciles confirmed entries away.
  const [pendingLogs, setPendingLogs] = useState<OptimisticLog[]>([]);
  // Phase 4 — per-family bodyweight TUT overrides. The BW "Next:" chip counter
  // ticks up as you log BW sets; with no per-set revalidation we refresh just
  // that number from the value the action returns, until the next server
  // snapshot makes the gate state authoritative again.
  const [bwTutOverrides, setBwTutOverrides] = useState<Record<string, number>>({});
  // Offline outbox status: count of unsynced ops for this device, surfaced in
  // the sync badge. `router.refresh()` after a successful drain pulls a fresh
  // server snapshot so the overlay reconciles the now-persisted rows away.
  const router = useRouter();
  const [outboxPending, setOutboxPending] = useState(0);
  // Queued ops whose last replay attempt errored. Distinguishing "in flight"
  // from "tried and failed" is the difference between "wait" and "something
  // is wrong" for the user.
  const [outboxFailed, setOutboxFailed] = useState(0);
  const [outboxDropped, setOutboxDropped] = useState(0);
  const loggingState = useSessionLoggingState();
  const registerStrengthLog = loggingState?.registerStrengthLog;
  const rollbackStrengthLog = loggingState?.rollbackStrengthLog;
  const registerCompletionQueued = loggingState?.registerCompletionQueued;

  // Reconcile: whenever a fresh server snapshot lands (any revalidating action —
  // finish / delete / edit / fill / swap — or a reload changes the `sets` prop),
  // drop every CONFIRMED overlay entry. That snapshot already reflects all
  // persisted writes, so the server becomes authoritative for them (and a set
  // deleted via the edit page is then correctly absent). In-flight entries (write
  // not yet resolved) are kept until their own write settles.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the optimistic overlay against a fresh server snapshot; functional updater no-ops when nothing changed
    setPendingLogs((prev) => {
      if (prev.length === 0) return prev;
      const next = dropConfirmed(
        prev.filter((log) => !serverHasPendingLog(sets, log)),
      );
      return next.length === prev.length ? prev : next;
    });
    setBwTutOverrides((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [sets]);

  const logSet = useCallback(
    async (fd: FormData): Promise<AddStrengthSetResult> => {
      // Stable idempotency key: doubles as the optimistic overlay key AND the
      // server-side client_log_id, so a retried offline flush can't double-insert.
      const clientLogId = createOutboxEntryId();
      fd.set("clientLogId", clientLogId);
      const clientKey = clientLogId;
      const sid = String(fd.get("sessionId") ?? sessionId);

      const movementId = fd.get("movementId");
      const freestyleMovement =
        typeof movementId === "string"
          ? resolvedFreestyle?.find(
              (movement) => movement.movement.id === movementId,
            )
          : undefined;
      const optimistic = optimisticLogFromFormData(fd, clientKey, freestyleMovement
        ? {
            movementSlug: freestyleMovement.movement.slug,
            movementDisplayName: freestyleMovement.movement.display_name,
            movementPrimaryRegion: freestyleMovement.movement.primary_region,
          }
        : undefined);
      const overlay = optimistic != null;
      if (overlay) {
        setPendingLogs((prev) => [...prev, optimistic]);
      }
      if (optimistic) {
        registerStrengthLog?.(
          clientKey,
          optimistic.prescriptionItemIndex,
        );
      }

      const durable = await runDurableAction<AddStrengthSetResult>(
        {
          id: clientLogId,
          op: "set",
          sessionId: sid,
          payload: formDataToPayload(fd),
          metadata: optimistic
            ? {
                movementSlug: optimistic.movementSlug,
                movementDisplayName: optimistic.movementDisplayName,
                movementPrimaryRegion: optimistic.movementPrimaryRegion,
              }
            : undefined,
        },
        () => addStrengthSet(fd),
      );

     if (durable.status === "queued") {
       const pending = await outboxCountForSession(sid).catch(() => 0);
       setOutboxPending(pending);
       return planLogSetOutcome({ kind: "network-error" }).result;
     }

     const result: AddStrengthSetResult = durable.result ?? {
       error:
         durable.error?.message ??
         "Couldn't save this set. Check your connection and retry.",
       errorCode: "transient",
     };
     const pending = await outboxCountForSession(sid).catch(() => 0);
     setOutboxPending(pending);

     // See `planLogSetOutcome` (defect #1): rollback is keyed on whether
     // optimistic state was registered at all, never on whether it had an
     // overlay row — a rejected freestyle log (optimistic, no overlay) must
     // roll back just as completely as a rejected prescribed one.
     const outcome = planLogSetOutcome({
       kind: "resolved",
       hadOptimistic: optimistic != null,
       hadOverlay: Boolean(overlay),
       result,
     });

      if (outcome.dropOverlay) {
        setPendingLogs((prev) => prev.filter((l) => l.clientKey !== clientKey));
      }
      if (outcome.rollbackProvider) {
        rollbackStrengthLog?.(clientKey);
      }
      if (outcome.confirmedServerId) {
        // Mark confirmed with the REAL id, so the edit link works mid-session
        // without a per-set page revalidation. The entry survives until the next
        // server snapshot reconciles it away.
        const realId = outcome.confirmedServerId;
        setPendingLogs((prev) =>
          prev.map((l) => (l.clientKey === clientKey ? { ...l, serverId: realId } : l)),
        );
      }
      if (outcome.bwTut) {
        const { family, tutAccumulated } = outcome.bwTut;
        setBwTutOverrides((prev) => ({ ...prev, [family]: tutAccumulated }));
      }
      return outcome.result;
    },
    [
      addStrengthSet,
      resolvedFreestyle,
      sessionId,
      registerStrengthLog,
      rollbackStrengthLog,
    ],
  );

  // Seed the overlay from a durable outbox (relaunch with unsynced sets) and
  // start the auto-flusher. On a successful drain we refresh so the server
  // snapshot includes the now-persisted rows (the merge dedupes by index).
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      outboxListForSession(sessionId),
      outboxListDeadLetteredForSession(sessionId),
    ]).then(([entries, deadLettered]) => {
      if (cancelled) return;
      setOutboxPending(entries.length);
      setOutboxFailed(entries.filter((e) => e.attempts > 0 && e.lastError).length);
      setOutboxDropped(deadLettered.length);
      registerCompletionQueued?.(entries.some((entry) => entry.op === "complete"));
      const seeded = hydrateQueuedSetLogs(entries);
      for (const log of seeded) {
        registerStrengthLog?.(log.clientKey, log.prescriptionItemIndex);
      }
      if (seeded.length === 0) return;
      setPendingLogs((prev) => {
        const seen = new Set(prev.map((l) => l.clientKey));
        const add = seeded.filter((l) => !seen.has(l.clientKey));
        return add.length === 0 ? prev : [...prev, ...add];
      });
    });
    const stop = startAutoFlush((r) => {
      if (cancelled) return;
      if (r.completedSessionIds.includes(sessionId)) clearResume(sessionId);
      // Re-read so a failed replay surfaces as "couldn't sync" rather than
      // sitting silently in the queue looking like it is still in flight.
      void Promise.all([
        outboxListForSession(sessionId),
        outboxListDeadLetteredForSession(sessionId),
      ])
        .then(([entries, deadLettered]) => {
          if (cancelled) return;
          setOutboxPending(entries.length);
          setOutboxFailed(
            entries.filter((e) => e.attempts > 0 && e.lastError).length,
          );
          setOutboxDropped(deadLettered.length);
          registerCompletionQueued?.(
            entries.some((entry) => entry.op === "complete"),
          );
        })
        .catch(() => {});
      if (r.flushed > 0) router.refresh();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [registerCompletionQueued, registerStrengthLog, router, sessionId]);

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

  // Overlay the real set id for confirmed pending entries so the "Edit set" link
  // works mid-session without a revalidation.
  const mergedLoggedSetIdByItemIndex = useMemo(
    () => buildLoggedSetIdOverlay(loggedSetIdByItemIndex, pendingLogs),
    [loggedSetIdByItemIndex, pendingLogs],
  );

  const priorBestsForCards: Record<
    string,
    { heaviestWeight: number | null; bestE1rm: number | null }
  > = priorBests;

  // Overlay the per-family TUT counter onto the gate state (Phase 4).
  const mergedBwGateStateByFamily = useMemo(() => {
    if (!bwGateStateByFamily || Object.keys(bwTutOverrides).length === 0) {
      return bwGateStateByFamily;
    }
    const out = { ...bwGateStateByFamily };
    for (const [family, tut] of Object.entries(bwTutOverrides)) {
      const cur = out[family];
      if (cur) out[family] = { ...cur, tutAccumulated: tut };
    }
    return out;
  }, [bwGateStateByFamily, bwTutOverrides]);

  return (
    <>
      <OfflineSyncBadge
        pendingCount={outboxPending}
        failedCount={outboxFailed}
        droppedCount={outboxDropped}
      />
      <MovementCardList
        sessionId={sessionId}
        isComplete={isComplete}
        prescription={prescription}
        sets={mergedSets}
        tmBySlug={tmBySlug}
        oneRmBySlug={oneRmBySlug}
        loggedItemIndices={loggedSet}
        skippedItemIndices={skippedSet}
        loggedSetIdByItemIndex={mergedLoggedSetIdByItemIndex}
        priorBests={priorBestsForCards}
        lastSetHints={lastSetHints}
        addStrengthSet={logSet}
        updateStrengthSet={updateStrengthSet}
        fillFromPlan={fillFromPlan}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        restTimerEnabled={restTimerEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        safetyBarKg={safetyBarKg}
        plateInventory={plateInventory}
        preferStandardLbPlates={preferStandardLbPlates}
        bwGateStateByFamily={mergedBwGateStateByFamily}
        resolvedFreestyle={resolvedFreestyle}
        bodyweightMovementIds={bodyweightMovementIds}
        systemLoadMovementIds={systemLoadMovementIds}
        bodyweightKg={bodyweightKg}
        accessoryMetaById={accessoryMetaById}
        customAccessoryOrder={customAccessoryOrder}
      />
    </>
  );
}
