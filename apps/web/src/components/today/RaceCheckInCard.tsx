"use client";

/**
 * Race Check-In Card — shown the day after a priority event when the
 * user has not yet recorded a result. Three buttons resolve to
 * priority_events.result.status ∈ {raced, partial, skipped}.
 *
 * DNF / partial triggers the same recovery flow as raced — the body
 * doesn't know the user DNF'd. Skipped suppresses the recovery banner.
 *
 * After a successful answer we optimistically hide the card AND call
 * router.refresh(): the server action revalidates /app, but because the
 * action is invoked imperatively (inside a transition, not bound to a
 * <form action> / useActionState), Next does not auto-apply the
 * refreshed RSC payload. The explicit refresh re-renders Today so the
 * card drops out and the recovery banner (after raced/partial) appears.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEventResult } from "@/lib/planner/taper-recovery-actions";

type Props = {
  eventId: string;
  eventName: string;
};

export function RaceCheckInCard(props: Props) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [answered, setAnswered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accent = "var(--cp-warning)";

  const submit = (status: "raced" | "partial" | "skipped") => {
    return (fd: FormData) => {
      fd.set("eventId", props.eventId);
      fd.set("status", status);
      setError(null);
      start(async () => {
        const res = await setEventResult(fd);
        if (res.ok) {
          setAnswered(true);
          router.refresh();
        } else {
          setError(res.error);
        }
      });
    };
  };

  // Optimistically drop the card the moment the answer lands — the
  // server refresh that follows will agree (result.status is now set).
  if (answered) return null;

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
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          Couldn&rsquo;t save that — please try again.
        </div>
      )}
    </section>
  );
}
