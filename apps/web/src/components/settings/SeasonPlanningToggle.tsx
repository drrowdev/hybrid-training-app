"use client";

/**
 * Season-planning opt-in toggle (ADR 0051 Phase 0). Off by default. Flipping it
 * on reveals the Season tab on /app/plan; off hides it (existing Season data is
 * kept, just not surfaced).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSeasonPlanningEnabled } from "@/lib/seasons/actions";

export function SeasonPlanningToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flip = () => {
    const next = !on;
    setOn(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setSeasonPlanningEnabled({ enabled: next });
      if (!res.ok) {
        setOn(!next); // revert
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div
      className="cp-card"
      data-testid="season-planning-toggle"
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            Season planning
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid var(--cp-border)",
                color: "var(--cp-text-muted)",
              }}
            >
              Advanced
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--cp-text-muted)", marginTop: 3 }}>
            Plan several blocks ahead toward a goal. Off by default — your normal one-block flow is
            unchanged until you turn this on.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Season planning"
          onClick={flip}
          disabled={pending}
          data-testid="season-planning-switch"
          style={{
            flex: "0 0 auto",
            width: 44,
            height: 26,
            borderRadius: 999,
            border: "none",
            cursor: pending ? "wait" : "pointer",
            background: on ? "var(--cp-accent)" : "var(--cp-border-strong)",
            position: "relative",
            transition: "background .15s",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: on ? 21 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: on ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
              transition: "left .15s",
            }}
          />
        </button>
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
