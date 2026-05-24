"use client";

/**
 * Client wrapper that stitches `<PrescriptionItemsList>` to
 * `<SessionLogClient>` so a prescription row tap one-shot-prefills the
 * logger. Owning this state on the client means the server page can
 * stay a server component — we just hand both children the data they
 * need, plus an `onItemTap` callback for the prescription list and a
 * `prefillRequest` prop for the logger.
 *
 * Also owns the "Session in progress" sticky banner (sibling card at
 * the top of the page) so its "Finish session →" duplicate-CTA can
 * point at the same href as the bottom `<FinishSessionBar>` without
 * having to thread two refs across the server/client boundary.
 *
 * The banner re-derives "minutes in" client-side on a 60s tick so the
 * counter stays honest during a long session — server-rendered initial
 * value avoids hydration flicker.
 */

import { useEffect, useState } from "react";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  PrescriptionItemsList,
  type PrescriptionItemTapHandler,
} from "./PrescriptionItemsList";
import {
  SessionLogClient,
  type LoggedSet,
  type LastSetHint,
  type PriorBest,
  type PrescriptionPrefillRequest,
} from "./SessionLogClient";
import type {
  addStrengthSet as addStrengthSetAction,
  fillSessionFromPlan as fillSessionFromPlanAction,
  swapPrescriptionItem as swapPrescriptionItemAction,
} from "@/lib/sessions/actions";
import { FinishSessionBar } from "./FinishSessionBar";

type AddStrengthSetAction = typeof addStrengthSetAction;
type FillSessionFromPlanAction = typeof fillSessionFromPlanAction;
type SwapAction = typeof swapPrescriptionItemAction;

const STRENGTH_SETKINDS = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
]);

function setKindForPrescription(
  kind: PrescriptionItem["kind"],
): "warmup" | "main" | "back_off" | "accessory" | "tendon" {
  // power_potentiation maps onto "main" at the set-log level — the
  // setKind enum on set_logs intentionally stays narrower than the
  // prescription kind enum (DC-J7 keeps `power_potentiation` as a
  // planner-only label so historical analytics don't fragment).
  if (kind === "power_potentiation") return "main";
  if (STRENGTH_SETKINDS.has(kind)) {
    return kind as "warmup" | "main" | "back_off" | "accessory" | "tendon";
  }
  return "main";
}

export function SessionWorkArea({
  sessionId,
  isComplete,
  performedAt,
  durationMin,
  sessionRpe,
  sets,
  tmBySlug,
  addStrengthSet,
  fillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  lastSetHints,
  priorBests,
  // Prescription wiring (null when the session is freestyle / unlinked).
  plannedSessionId,
  prescription,
  swapAction,
  loggedItemIndices,
  loggedSetIdByItemIndex,
}: {
  sessionId: string;
  isComplete: boolean;
  performedAt: string;
  durationMin: number | null;
  sessionRpe: number | string | null;
  sets: LoggedSet[];
  tmBySlug: Record<string, number>;
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
  loggedSetIdByItemIndex: Record<number, string>;
}) {
  const [prefillRequest, setPrefillRequest] = useState<PrescriptionPrefillRequest | null>(null);
  const loggedSet = new Set<number>(loggedItemIndices);

  const handlePrescriptionTap: PrescriptionItemTapHandler = ({ index, item, loggedSetId }) => {
    if (loggedSetId) {
      // Already logged — scroll the user to the existing row in the
      // "This session" table instead of prefilling. The row carries a
      // `data-testid="logged-set-row-${id}"` already.
      if (typeof document === "undefined") return;
      const target = document.querySelector(`[data-testid="logged-set-row-${loggedSetId}"]`);
      if (target && "scrollIntoView" in target) {
        (target as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    const tm = item.movementSlug ? tmBySlug[item.movementSlug] : undefined;
    const weightKg =
      typeof item.percentTm === "number" && tm
        ? Math.round((tm * (item.percentTm / 100)) / 2.5) * 2.5
        : 0;
    setPrefillRequest({
      token: Date.now(),
      movement: {
        id: item.movementId,
        slug: item.movementSlug ?? "",
        display_name: item.movementName ?? item.movementSlug ?? "Movement",
        primary_region: "",
      },
      weightKg,
      reps: item.reps ?? 5,
      setKind: setKindForPrescription(item.kind),
      prescriptionItemIndex: index,
    });
  };

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

      {!isComplete && plannedSessionId && prescription && prescription.items.length > 0 && (
        <PrescriptionItemsList
          plannedSessionId={plannedSessionId}
          initialPrescription={prescription}
          swapAction={swapAction}
          loggedItemIndices={loggedSet}
          loggedSetIdByItemIndex={loggedSetIdByItemIndex}
          onItemTap={handlePrescriptionTap}
        />
      )}

      <SessionLogClient
        sessionId={sessionId}
        isComplete={isComplete}
        sets={sets}
        tmBySlug={tmBySlug}
        addStrengthSet={addStrengthSet}
        fillFromPlan={fillFromPlan}
        hasPlan={Boolean(prescription && prescription.items.length > 0)}
        lastSetHints={lastSetHints}
        priorBests={priorBests}
        hapticsEnabled={hapticsEnabled}
        timerSoundEnabled={timerSoundEnabled}
        prefillRequest={prefillRequest}
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
