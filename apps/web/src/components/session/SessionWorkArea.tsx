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
  AddStrengthSetResult,
} from "@/lib/sessions/actions";
import { MovementCardList } from "./MovementCardList";
import {
  buildLoggedSetIdOverlay,
  dropConfirmed,
  mergeOptimisticSets,
  optimisticLogFromFormData,
  type OptimisticLog,
} from "@/lib/sessions/optimistic-log";
import {
  enqueue as outboxEnqueue,
  remove as outboxRemove,
  listForSession as outboxListForSession,
} from "@/lib/offline/outbox";
import { formDataToPayload, payloadToFormData } from "@/lib/offline/outbox-core";
import { startAutoFlush } from "@/lib/offline/flusher";
import { OfflineSyncBadge } from "./OfflineSyncBadge";
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
  // The set-log server action revalidates (and thus re-renders) this whole
  // page before resolving. Awaiting that made every "Log set" tap stall for
  // seconds before the cursor advanced. We keep a client overlay of pending
  // logs so the UI advances the instant the user taps; the real write +
  // revalidation settle in the background, and each pending entry is reconciled
  // away once the refreshed server `sets` includes its row.
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
      const next = dropConfirmed(prev);
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fresh server bwGateStateByFamily supersedes our TUT overrides
    setBwTutOverrides((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, [sets]);

  const logSet = useCallback(
    async (fd: FormData): Promise<AddStrengthSetResult> => {
      // Stable idempotency key: doubles as the optimistic overlay key AND the
      // server-side client_log_id, so a retried offline flush can't double-insert.
      const clientLogId =
        globalThis.crypto?.randomUUID?.() ??
        `cl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      fd.set("clientLogId", clientLogId);
      const clientKey = clientLogId;
      const sid = String(fd.get("sessionId") ?? sessionId);

      const optimistic = optimisticLogFromFormData(fd, clientKey);
      // Only overlay PRESCRIBED logs (those carry a prescriptionItemIndex we can
      // reconcile against the server row). Freestyle/off-plan logs have no index
      // — overlaying them would never reconcile and would double-show once the
      // server catches up — so they take the plain (awaited) path.
      const overlay = optimistic && optimistic.prescriptionItemIndex != null;
      if (overlay) {
        setPendingLogs((prev) => [...prev, optimistic]);
      }

      // Durably enqueue BEFORE the network call so a signal drop or app kill
      // can't lose the set — it replays from the outbox on reconnect/relaunch.
      await outboxEnqueue({
        id: clientLogId,
        op: "set",
        sessionId: sid,
        payload: formDataToPayload(fd),
      }).catch(() => null);

      let result: AddStrengthSetResult | undefined;
      let threw = false;
      try {
        result = await addStrengthSet(fd);
      } catch {
        threw = true;
      }

      if (threw) {
        // Offline / network error. Keep the overlay AND the outbox entry; the
        // flusher replays it when connectivity returns. Report optimistic
        // success so the logger advances to the next set.
        const queued = await outboxListForSession(sid).catch(() => []);
        setOutboxPending(queued.length);
        return { ok: true };
      }

      // Online resolved — the row is persisted, so drop the durable entry.
      await outboxRemove(clientLogId).catch(() => {});
      const queued = await outboxListForSession(sid).catch(() => []);
      setOutboxPending(queued.length);

      if (!overlay) return result ?? { ok: true };
      if (result?.error) {
        // Validation rejection — roll the overlay back so the slot un-logs.
        setPendingLogs((prev) => prev.filter((l) => l.clientKey !== clientKey));
      } else if (result?.set?.id) {
        // Mark confirmed with the REAL id, so the edit link works mid-session
        // without a per-set page revalidation. The entry survives until the next
        // server snapshot reconciles it away.
        const realId = result.set.id;
        setPendingLogs((prev) =>
          prev.map((l) => (l.clientKey === clientKey ? { ...l, serverId: realId } : l)),
        );
        if (result.bwTut) {
          const { family, tutAccumulated } = result.bwTut;
          setBwTutOverrides((prev) => ({ ...prev, [family]: tutAccumulated }));
        }
      }
      return result ?? { ok: true };
    },
    [addStrengthSet, sessionId],
  );

  // Seed the overlay from a durable outbox (relaunch with unsynced sets) and
  // start the auto-flusher. On a successful drain we refresh so the server
  // snapshot includes the now-persisted rows (the merge dedupes by index).
  useEffect(() => {
    let cancelled = false;
    void outboxListForSession(sessionId).then((entries) => {
      if (cancelled) return;
      setOutboxPending(entries.length);
      const seeded = entries
        .filter((e) => e.op === "set")
        .map((e) => optimisticLogFromFormData(payloadToFormData(e.payload), e.id))
        .filter(
          (l): l is OptimisticLog => l != null && l.prescriptionItemIndex != null,
        );
      if (seeded.length === 0) return;
      setPendingLogs((prev) => {
        const seen = new Set(prev.map((l) => l.clientKey));
        const add = seeded.filter((l) => !seen.has(l.clientKey));
        return add.length === 0 ? prev : [...prev, ...add];
      });
    });
    const stop = startAutoFlush((r) => {
      if (cancelled) return;
      setOutboxPending(r.remaining);
      if (r.flushed > 0) router.refresh();
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId, router]);

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
      <OfflineSyncBadge pendingCount={outboxPending} />
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
        fillFromPlan={fillFromPlan}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
        bwGateStateByFamily={mergedBwGateStateByFamily}
        resolvedFreestyle={resolvedFreestyle}
        supersetByMovementId={supersetByMovementId}
        bodyweightMovementIds={bodyweightMovementIds}
        accessoryMetaById={accessoryMetaById}
        customAccessoryOrder={customAccessoryOrder}
      />
    </>
  );
}

