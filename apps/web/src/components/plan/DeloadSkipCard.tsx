"use client";

/**
 * DeloadSkipCard — ADR 0031 (Phase 2) autoregulated deload-skip offer.
 *
 * Surfaces when the user is at / one week before the block's programmed deload
 * AND their recent loading weeks logged as recovered. Accepting converts the
 * deload week's un-started sessions into a normal loading week (the block's
 * wave opener). Default is to keep the deload — this only ever offers a choice.
 * Mirrors VolumeAutoregCard's confirm-modal pattern.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DeloadSkipOffer } from "@/lib/planner/deload-skip-offer";
import type { AcceptDeloadSkipResult } from "@/lib/planner/deload-skip-actions";

export function DeloadSkipCard({
  offer,
  applyAction,
}: {
  offer: DeloadSkipOffer;
  applyAction: () => Promise<AcceptDeloadSkipResult>;
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
      data-testid="deload-skip-card"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 8,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Deload — your call
      </div>

      {done != null ? (
        <div style={{ fontSize: 13, color: "var(--cp-text)" }} data-testid="deload-skip-done">
          ✓ Skipped the deload — {done} session{done === 1 ? "" : "s"} are now a
          loading week. Keep accumulating; take a deload when you actually feel
          you need it.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}>
            Your last <strong>{offer.recoveredWeeks}</strong> training weeks
            logged as <strong>recovered</strong> (no missed sessions, low fatigue
            and soreness). A deload is meant to dissipate accumulated fatigue —
            you don&apos;t look like you&apos;ve banked much. You can{" "}
            <strong>skip this deload</strong> and keep accumulating, or take it as
            planned. Recovered athletes can train through a deload; the safe
            default is to take it.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="cp-btn"
              data-testid="deload-skip-review"
              onClick={() => setOpen(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Skip the deload…
            </button>
            <button
              type="button"
              className="cp-btn ghost"
              data-testid="deload-skip-keep"
              onClick={() => setDismissed(true)}
              style={{ fontSize: 13, padding: "7px 14px" }}
            >
              Keep my deload
            </button>
          </div>
        </>
      )}

      {open && done == null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm skip deload"
          data-testid="deload-skip-modal"
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
                Skip this deload?
              </h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
                Converts your {offer.sessionCount} un-started deload session
                {offer.sessionCount === 1 ? "" : "s"} into a normal loading week —
                a fresh wave at full volume and intensity. Already-logged sessions
                are untouched. You can still take a deload later whenever fatigue
                catches up.
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
                data-testid="deload-skip-cancel"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cp-btn primary"
                data-testid="deload-skip-apply"
                onClick={apply}
                disabled={pending}
              >
                {pending ? "Skipping…" : "Skip deload, keep training"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
