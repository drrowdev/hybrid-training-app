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

import { useEffect, useState } from "react";
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
import { FinishSessionBar } from "./FinishSessionBar";
import { MovementCardList } from "./MovementCardList";
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
}) {
  // `plannedSessionId` and the page-level swap server action aren't
  // surfaced by the card-list layout — they're accepted to preserve the
  // existing prop contract from the server page (and to keep tests that
  // reach into the prop shape happy).
  void plannedSessionId;
  void swapAction;
  const loggedSet = new Set<number>(loggedItemIndices);
  const skippedSet = new Set<number>(skippedItemIndices ?? []);
  const priorBestsForCards: Record<
    string,
    { heaviestWeight: number | null; bestE1rm: number | null }
  > = priorBests;

  return (
    <>
      <InProgressBanner
        sessionId={sessionId}
        isComplete={isComplete}
        performedAt={performedAt}
        loggedCount={sets.length}
        prescriptionItemCount={prescription?.items?.length ?? 0}
      />

      <MovementCardList
        sessionId={sessionId}
        isComplete={isComplete}
        prescription={prescription}
        sets={sets}
        tmBySlug={tmBySlug}
        oneRmBySlug={oneRmBySlug}
        loggedItemIndices={loggedSet}
        skippedItemIndices={skippedSet}
        loggedSetIdByItemIndex={loggedSetIdByItemIndex}
        priorBests={priorBestsForCards}
        lastSetHints={lastSetHints}
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillFromPlan}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
        bwGateStateByFamily={bwGateStateByFamily}
        resolvedFreestyle={resolvedFreestyle}
        supersetByMovementId={supersetByMovementId}
      />
    </>
  );
}

/**
 * Sticky-ish "Session in progress" banner. Renders as a regular card
 * at the top of the workflow (no `position: sticky` because the page
 * already has a bottom CTA bar — pinning two CTAs is visually busy).
 *
 * On a completed session this renders nothing — the PostSessionSummary
 * card above already owns the "Session complete" recap (incl. effort).
 */
function InProgressBanner({
  sessionId,
  isComplete,
  performedAt,
  loggedCount,
  prescriptionItemCount,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  loggedCount: number;
  prescriptionItemCount: number;
}) {
  const [minutesIn, setMinutesIn] = useState(() => computeMinutesIn(performedAt));

  useEffect(() => {
    if (isComplete) return;
    const id = window.setInterval(() => {
      setMinutesIn(computeMinutesIn(performedAt));
    }, 60_000);
    return () => window.clearInterval(id);
  }, [isComplete, performedAt]);

  if (isComplete) {
    // The completed-state line used to render here ("✓ Session complete ·
    // 52 min · sRPE 7"), but it duplicated the PostSessionSummary card
    // that already sits directly above on a completed session — including
    // the effort rating, now surfaced there as a friendly "Effort" stat.
    // Render nothing so the post-mortem owns the summary.
    return null;
  }

  if (loggedCount === 0) return null;

  const totalSets = prescriptionItemCount > 0 ? prescriptionItemCount : loggedCount;

  return (
    <div
      data-testid="session-status-banner"
      data-state="in-progress"
      data-logged={loggedCount}
      data-planned={prescriptionItemCount}
      className="cp-card"
      style={{
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
        borderColor: "color-mix(in oklab, var(--cp-accent) 40%, var(--cp-border))",
      }}
    >
      <span aria-hidden="true" style={{ color: "var(--cp-accent)" }}>
        ⚡
      </span>
      <span style={{ fontSize: 13, color: "var(--cp-text)", fontWeight: 600 }}>
        Session in progress
      </span>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        ·{" "}
        <span className="mono" style={{ color: "var(--cp-text)" }}>
          {loggedCount} of {totalSets}
        </span>{" "}
        sets logged
        {minutesIn > 0 ? (
          <>
            {" "}
            ·{" "}
            <span className="mono" style={{ color: "var(--cp-text)" }}>
              {minutesIn} min
            </span>{" "}
            in
          </>
        ) : null}
      </span>
      <span style={{ flex: "1 0 0" }} />
      <FinishSessionBar
        sessionId={sessionId}
        variant="banner"
        disabled={false}
        testId="finish-banner"
      />
    </div>
  );
}

function computeMinutesIn(performedAt: string): number {
  const t = new Date(performedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const delta = Date.now() - t;
  if (delta < 0) return 0;
  return Math.round(delta / 60_000);
}
