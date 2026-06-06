"use client";

/**
 * EarlyDeloadCard — ADR 0032 (Phase 3) early-deload recommendation.
 *
 * Surfaces when the combined-load fatigue proxy is high with loading still left
 * before the scheduled deload. Accepting converts the current week into a
 * deload. Advisory — the scheduled deload always remains. Mirrors the
 * VolumeAutoregCard / DeloadSkipCard confirm pattern.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EarlyDeloadRecommendation } from "@/lib/planner/early-deload-offer";
import type { AcceptEarlyDeloadResult } from "@/lib/planner/early-deload-actions";

function dominantDriver(terms: { load: number; cardio: number; subjective: number }): string {
  const entries: Array<[string, number]> = [
    ["training volume ramping up", terms.load],
    ["a lot of concurrent cardio", terms.cardio],
    ["elevated fatigue / soreness", terms.subjective],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0]![0];
}

export function EarlyDeloadCard({
  reco,
  applyAction,
}: {
  reco: EarlyDeloadRecommendation;
  applyAction: () => Promise<AcceptEarlyDeloadResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const res = await applyAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.sessions);
      setOpen(false);
      router.refresh();
    });
  };

  if (dismissed) return null;

  return (
    <section
      className="cp-card"
      role="status"
      data-testid="early-deload-card"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 8,
        borderColor: "var(--cp-warning)",
        background: "color-mix(in oklab, var(--cp-warning) 6%, transparent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-warning)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Combined load running high
      </div>

      {done != null ? (
        <div style={{ fontSize: 13, color: "var(--cp-text)" }} data-testid="early-deload-done">
          ✓ Deloaded this week — {done} session{done === 1 ? "" : "s"} eased to
          deload volume. Your scheduled deload still stands; you can skip it later
          if you bounce back.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            Your accumulated training load is running high — mostly{" "}
            <strong>{dominantDriver(reco.terms)}</strong>. The strength
            auto-deload only watches your lifts; this also accounts for cardio
            load. You can <strong>bring your deload forward to this week</strong>{" "}
            and resume loading after, or push on. Your scheduled deload stays
            either way.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="cp-btn"
              data-testid="early-deload-review"
              onClick={() => setOpen(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Deload this week…
            </button>
            <button
              type="button"
              className="cp-btn ghost"
              data-testid="early-deload-dismiss"
              onClick={() => setDismissed(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Push on
            </button>
          </div>
        </>
      )}

      {open && done == null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm early deload"
          data-testid="early-deload-modal"
          onClick={() => !pending && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cp-card"
            style={{ maxWidth: 460, width: "100%", padding: 20, display: "grid", gap: 14 }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>
                Deload this week?
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                Converts your {reco.sessionCount} un-started session
                {reco.sessionCount === 1 ? "" : "s"} this week to deload volume
                (reduced load + sets). Already-logged sessions are untouched. Your
                scheduled deload remains — if you recover, you&apos;ll be offered
                the option to skip it.
              </p>
            </div>

            {error && (
              <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="cp-btn ghost"
                data-testid="early-deload-cancel"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                data-testid="early-deload-apply"
                onClick={apply}
                disabled={pending}
              >
                {pending ? "Deloading…" : "Deload this week"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
