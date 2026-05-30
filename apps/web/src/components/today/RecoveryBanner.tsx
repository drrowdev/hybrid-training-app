"use client";

/**
 * Post-race recovery banner. A/B/C state machine matches TaperBanner.
 * Recommendation (days + load scales) is computed server-side before
 * render and serialised in.
 */

import { useTransition } from "react";
import {
  applyRecoveryPlan,
  declineRecoveryPlan,
  undoRecoveryPlan,
} from "@/lib/planner/taper-recovery-actions";

export type RecoveryBannerState =
  | { kind: "pending" }
  | { kind: "applied" }
  | { kind: "declined" };

type Props = {
  eventId: string;
  eventName: string;
  days: number;
  strengthLoadScale: number;
  cardioLoadScale: number;
  rampDays: number;
  confidence?: "LOW";
  state: RecoveryBannerState;
};

function describeRecoveryCuts(p: Props): string {
  const strength = p.strengthLoadScale === 0 ? "skip strength" : `cap strength at ${Math.round(p.strengthLoadScale * 100)}%`;
  const cardio = `cap cardio at ${Math.round(p.cardioLoadScale * 100)}% of duration`;
  return `${strength}, ${cardio}, ramp back over ${p.rampDays}d`;
}

export function RecoveryBanner(props: Props) {
  const [isPending, start] = useTransition();
  const accent = "var(--cp-warning)";

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
          Recovery · {props.eventName}
          {props.confidence === "LOW" ? " · LOW CONFIDENCE" : ""}
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {props.days}d
        </span>
      </div>

      {props.state.kind === "pending" ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Post-race recovery — {props.days}d window
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
            Engine will: {describeRecoveryCuts(props)}.
            {props.confidence === "LOW" ? " Ultras are under-studied — adjust by feel." : ""}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={(fd) => start(() => applyRecoveryPlan(fd).then(() => undefined))}>
              <input type="hidden" name="eventId" value={props.eventId} />
              <button type="submit" disabled={isPending} className="cp-btn cp-btn-primary">
                Apply recovery plan
              </button>
            </form>
            <form action={(fd) => start(() => declineRecoveryPlan(fd).then(() => undefined))}>
              <input type="hidden" name="eventId" value={props.eventId} />
              <button type="submit" disabled={isPending} className="cp-btn">
                Decline
              </button>
            </form>
          </div>
        </>
      ) : props.state.kind === "applied" ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            APPLIED · {props.days}d recovery
          </div>
          <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
            Engine is: {describeRecoveryCuts(props)}.
          </div>
          <div>
            <form action={(fd) => start(() => undoRecoveryPlan(fd).then(() => undefined))}>
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
            <form action={(fd) => start(() => applyRecoveryPlan(fd).then(() => undefined))}>
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
