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

type AddStrengthSetAction = typeof addStrengthSetAction;
type FillSessionFromPlanAction = typeof fillSessionFromPlanAction;
type SwapAction = typeof swapPrescriptionItemAction;

export function SessionWorkArea({
  sessionId,
  isComplete,
  performedAt,
  durationMin,
  sessionRpe,
  sets,
  tmBySlug,
  oneRmBySlug,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  // `lastSetHints` is still computed server-side for backward compat
  // (analytics consumers can read it), but the new card layout
  // surfaces "last set" inline via the priorBest/loggedSets pair.
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
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  durationMin: number | null;
  sessionRpe: number | string | null;
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
}) {
  // The card-list layout doesn't currently surface `lastSetHints`,
  // `plannedSessionId`, or the page-level swap server action — they're
  // accepted to preserve the existing prop contract from the server
  // page (and to keep tests that reach into the prop shape happy).
  void lastSetHints;
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
        durationMin={durationMin}
        sessionRpe={sessionRpe}
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
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillFromPlan}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        barbellKg={barbellKg}
        trapBarKg={trapBarKg}
        plateInventory={plateInventory}
        bwGateStateByFamily={bwGateStateByFamily}
        resolvedFreestyle={resolvedFreestyle}
      />
    </>
  );
}

/**
 * Sticky-ish "Session in progress" banner. Renders as a regular card
 * at the top of the workflow (no `position: sticky` because the page
 * already has a bottom CTA bar — pinning two CTAs is visually busy).
 *
 * Completed sessions get the post-mortem variant: "✓ Session complete
 * · 52 min · sRPE 7".
 */
function InProgressBanner({
  sessionId,
  isComplete,
  performedAt,
  durationMin,
  sessionRpe,
  loggedCount,
  prescriptionItemCount,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  durationMin: number | null;
  sessionRpe: number | string | null;
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
    return (
      <div
        data-testid="session-status-banner"
        data-state="complete"
        className="cp-card"
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "color-mix(in oklab, var(--cp-success) 8%, transparent)",
          borderColor: "color-mix(in oklab, var(--cp-success) 40%, var(--cp-border))",
        }}
      >
        <span aria-hidden="true" style={{ color: "var(--cp-success)", fontWeight: 700 }}>
          ✓
        </span>
        <span style={{ fontSize: 13, color: "var(--cp-text)", fontWeight: 600 }}>
          Session complete
        </span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {durationMin != null ? `· ${durationMin} min` : ""}
          {sessionRpe != null ? ` · sRPE ${sessionRpe}` : ""}
        </span>
      </div>
    );
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
