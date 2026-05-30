"use client";

/**
 * Race Check-In Card — shown the day after a priority event when the
 * user has not yet recorded a result. Three buttons resolve to
 * priority_events.result.status ∈ {raced, partial, skipped}.
 *
 * DNF / partial triggers the same recovery flow as raced — the body
 * doesn't know the user DNF'd. Skipped suppresses the recovery banner.
 */

import { useTransition } from "react";
import { setEventResult } from "@/lib/planner/taper-recovery-actions";

type Props = {
  eventId: string;
  eventName: string;
};

export function RaceCheckInCard(props: Props) {
  const [isPending, start] = useTransition();
  const accent = "var(--cp-warning)";

  const submit = (status: "raced" | "partial" | "skipped") => {
    return (fd: FormData) => {
      fd.set("eventId", props.eventId);
      fd.set("status", status);
      start(() => setEventResult(fd).then(() => undefined));
    };
  };

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
          {props.eventName} · YESTERDAY
        </div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>How did it go?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <form action={submit("raced")}>
          <button type="submit" disabled={isPending} className="cp-btn cp-btn-primary">
            Raced it
          </button>
        </form>
        <form action={submit("partial")}>
          <button type="submit" disabled={isPending} className="cp-btn">
            DNF or partial
          </button>
        </form>
        <form action={submit("skipped")}>
          <button type="submit" disabled={isPending} className="cp-btn">
            Skipped / didn&rsquo;t race
          </button>
        </form>
      </div>
    </section>
  );
}
