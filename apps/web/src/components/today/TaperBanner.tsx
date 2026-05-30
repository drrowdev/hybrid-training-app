"use client";

/**
 * Pre-race taper banner — three states (pending / applied / declined).
 *
 * Pending: shows what the engine *will* do and asks for explicit
 * opt-in. Applied: shows current cuts + Undo. Declined: states the
 * user is on the original plan + Reapply.
 *
 * Re-renders on every page load — when the user crosses a window
 * threshold (14d → 7d → 3d), `current.daysOut` differs from
 * `appliedTriggeredAtDaysOut` (snapshotted on Apply), and the pending
 * variant is shown again so the user can accept the deeper cut.
 */

import { useTransition } from "react";
import {
  applyTaperPlan,
  declineTaperPlan,
  undoTaperPlan,
} from "@/lib/planner/taper-recovery-actions";

type Phase = "approach" | "deep" | "polish" | "event_day";

export type TaperBannerState =
  | { kind: "pending" }
  | { kind: "applied"; appliedDaysOut: number; appliedPhase: Phase }
  | { kind: "declined" };

type Props = {
  eventId: string;
  eventName: string;
  daysOut: number;
  phase: Phase;
  volumeScale: number;
  intensityAction: "hold" | "hold_then_taper" | "minimal";
  state: TaperBannerState;
};

function describeCuts(volumeScale: number, intensityAction: Props["intensityAction"]): string {
  const cutPct = Math.round((1 - volumeScale) * 100);
  const intensity =
    intensityAction === "minimal"
      ? "drop max-effort work"
      : intensityAction === "hold"
        ? "hold intensity"
        : "hold intensity, taper top-end";
  return `cut volume by ${cutPct}%, ${intensity}, drop optional work`;
}

export function TaperBanner(props: Props) {
  const [isPending, start] = useTransition();
  const accent = "var(--cp-warning)";
  const cuts = describeCuts(props.volumeScale, props.intensityAction);

  // Re-prompt: applied for an earlier window but daysOut now hits a
  // deeper threshold? show pending UI with "Update to deeper unload".
  const reprompt =
    props.state.kind === "applied" &&
    props.state.appliedPhase !== props.phase &&
    props.daysOut < props.state.appliedDaysOut;

  const isPendingState = props.state.kind === "pending" || reprompt;

  return (
    <section
      className="cp-card"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 10,
        borderColor: accent,
        background: `color-mix(in oklab, ${accent} 6%, transparent)`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, color: accent, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
          Taper · {props.eventName}
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {props.daysOut === 0 ? "today" : `${props.daysOut}d`}
        </span>
      </div>

      {isPendingState ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {props.daysOut === 0
              ? "Race today — rest, save it for the event."
              : reprompt
                ? `${props.daysOut}d out — update to deeper unload?`
                : `${props.daysOut}d out — ${props.phase === "deep" ? "deeper unload" : props.phase === "polish" ? "polish only" : "start tapering"}`}
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
            Engine will: {cuts}.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={(fd) => start(() => applyTaperPlan(fd).then(() => undefined))}>
              <input type="hidden" name="eventId" value={props.eventId} />
              <button type="submit" disabled={isPending} className="cp-btn cp-btn-primary">
                {reprompt ? "Update taper plan" : "Apply taper plan"}
              </button>
            </form>
            {!reprompt && (
              <form action={(fd) => start(() => declineTaperPlan(fd).then(() => undefined))}>
                <input type="hidden" name="eventId" value={props.eventId} />
                <button type="submit" disabled={isPending} className="cp-btn">
                  Decline
                </button>
              </form>
            )}
          </div>
        </>
      ) : props.state.kind === "applied" ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            APPLIED · {Math.round((1 - props.volumeScale) * 100)}% volume cut
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
            Engine is: {cuts}.
          </div>
          <div>
            <form action={(fd) => start(() => undoTaperPlan(fd).then(() => undefined))}>
              <input type="hidden" name="eventId" value={props.eventId} />
              <button type="submit" disabled={isPending} className="cp-btn">
                Undo
              </button>
            </form>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            DECLINED — You&rsquo;re following the original plan.
          </div>
          <div>
            <form action={(fd) => start(() => applyTaperPlan(fd).then(() => undefined))}>
              <input type="hidden" name="eventId" value={props.eventId} />
              <button type="submit" disabled={isPending} className="cp-btn">
                Reapply
              </button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
