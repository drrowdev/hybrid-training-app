"use client";

/**
 * Season discovery nudge (ADR 0051 — closes the discoverability gap from the UX
 * audit). A one-time, dismissible card on the Plan page that is the ONLY
 * in-product entry point to Season planning besides the Settings toggle.
 *
 * The server renders this only when Season planning is OFF (so it never shows to
 * users already using the feature). Dismissal is stored in localStorage — this
 * is a low-stakes advanced-feature nudge, so a client-only, zero-migration
 * dismissal is enough. "Plan a season" flips the opt-in on and deep-links the
 * Season tab in one tap.
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSeasonPlanningEnabled } from "@/lib/seasons/actions";

const DISMISS_KEY = "sxc.seasonNudgeDismissed";

export function SeasonDiscoveryNudge() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Render nothing until mounted + confirmed not-dismissed, to avoid an SSR flash.
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage mount read (runs once, [] deps); avoids an SSR flash.
    setShow(!dismissed);
  }, []);

  if (!show) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  const onPlan = () => {
    startTransition(async () => {
      await setSeasonPlanningEnabled({ enabled: true });
      router.push("/app/plan?view=season");
    });
  };

  return (
    <section
      className="cp-card"
      data-testid="season-discovery-nudge"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        borderStyle: "dashed",
        borderColor: "color-mix(in oklab, var(--cp-accent) 38%, var(--cp-border))",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 36,
          height: 36,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: "var(--cp-accent-soft, transparent)",
          color: "var(--cp-accent)",
          fontSize: 18,
        }}
      >
        ✦
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Thinking longer-term?</div>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 2 }}>
          Map a training season — base → focus blocks → peak for a goal. You stay
          in control; only your current block is ever scheduled.
        </div>
      </div>
      <button
        type="button"
        className="cp-btn primary"
        onClick={onPlan}
        disabled={pending}
        data-testid="season-discovery-plan"
      >
        {pending ? "Opening…" : "Plan a season →"}
      </button>
      <button
        type="button"
        className="cp-btn ghost"
        onClick={onDismiss}
        disabled={pending}
        data-testid="season-discovery-dismiss"
      >
        Dismiss
      </button>
    </section>
  );
}
