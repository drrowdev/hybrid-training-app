"use client";

/**
 * VolumeAutoregCard — ADR 0013 within-block volume-autoregulation offer.
 *
 * Surfaces when this week's LOGGED strength volume is over the archetype's
 * budget and there are un-started sessions with discretionary accessory
 * volume to ease. Clicking the CTA opens a confirmation modal that shows
 * EXACTLY which accessory sets would be trimmed (per remaining session,
 * before → after) before the user accepts. Main lifts are never touched and
 * the trim is reversible.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VolumeAutoregOffer } from "@/lib/planner/autoreg-offer";
import type { AcceptAutoregResult } from "@/lib/planner/autoreg-actions";

export function VolumeAutoregCard({
  offer,
  applyAction,
}: {
  offer: VolumeAutoregOffer;
  applyAction: () => Promise<AcceptAutoregResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pct = Math.round(offer.pct * 100);
  const hasDrops = offer.preview.some((p) => p.drops.length > 0);

  const apply = () => {
    setError(null);
    startTransition(async () => {
      const res = await applyAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.sessions);
      router.refresh();
    });
  };

  return (
    <section
      className="cp-card"
      role="alert"
      data-testid="volume-autoreg-card"
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
        Volume over budget
      </div>

      {done != null ? (
        <div style={{ fontSize: 13, color: "var(--cp-text)" }} data-testid="volume-autoreg-done">
          ✓ Eased accessory volume on {done} session{done === 1 ? "" : "s"} to{" "}
          {offer.keepPct}% of plan. Main lifts are untouched — clear it from any
          session to undo.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            You&apos;ve logged <strong>{offer.actual}</strong> strength sets in the
            last 7 days — <strong>{pct}%</strong> of this week&apos;s ~
            {offer.prescribed}-set budget. To keep quality high and fatigue in
            check, the engine can ease accessory volume on your{" "}
            {offer.sessionCount} remaining session
            {offer.sessionCount === 1 ? "" : "s"} to about {offer.keepPct}% of
            plan. Main lifts stay untouched, and it&apos;s reversible.
          </div>
          <button
            type="button"
            className="cp-btn"
            data-testid="volume-autoreg-review"
            onClick={() => setOpen(true)}
            style={{ fontSize: 13, padding: "7px 14px", justifySelf: "start" }}
          >
            Review &amp; ease volume…
          </button>
        </>
      )}

      {open && done == null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm accessory volume trim"
          data-testid="volume-autoreg-modal"
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
            style={{
              maxWidth: 460,
              width: "100%",
              padding: 20,
              display: "grid",
              gap: 14,
              maxHeight: "85vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>
                Ease this week&apos;s accessory volume?
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                Trims accessory sets on your remaining un-started session
                {offer.sessionCount === 1 ? "" : "s"} to ~{offer.keepPct}% of plan.
                Main lifts, back-off and warm-ups are untouched. Reversible — clear
                the trim from a session to restore the full plan.
              </p>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {offer.preview.map((s) => (
                <div
                  key={s.sessionId}
                  data-testid="volume-autoreg-session"
                  style={{
                    border: "1px solid var(--cp-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
                    {s.title}
                  </div>
                  {s.drops.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                      No accessory sets to trim — already at budget.
                    </div>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                      {s.drops.map((d) => (
                        <li
                          key={d.name}
                          style={{
                            fontSize: 12.5,
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            color: "var(--cp-text)",
                          }}
                        >
                          <span>{d.name}</span>
                          <span className="mono" style={{ color: "var(--cp-text-muted)" }}>
                            {d.before} →{" "}
                            <strong style={{ color: "var(--cp-text)" }}>{d.after}</strong>{" "}
                            sets
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {!hasDrops && (
                <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                  Nothing to trim at this scale — your remaining sessions are
                  already lean on accessory volume.
                </div>
              )}
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
                data-testid="volume-autoreg-cancel"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                data-testid="volume-autoreg-apply"
                onClick={apply}
                disabled={pending || !hasDrops}
              >
                {pending ? "Easing…" : "Apply trim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
