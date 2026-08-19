"use client";

/**
 * Inter-set rest-countdown toggle.
 *
 * Off suppresses the countdown, not the rest — the lifter still rests, the app
 * just stops timing it. Nothing downstream depends on the timer, so this is
 * purely a display choice.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRestTimerEnabled } from "@/lib/sessions/rest-timer-actions";

export function RestTimerToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const flip = () => {
    const next = !on;
    setOn(next); // optimistic
    setError(null);
    startTransition(async () => {
      const res = await setRestTimerEnabled({ enabled: next });
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
      data-testid="rest-timer-toggle"
      style={{ padding: 16, display: "grid", gap: 8 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Rest timer</div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--cp-text-muted)",
              marginTop: 3,
            }}
          >
            Counts down between sets and can buzz when it hits zero.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Rest timer"
          onClick={flip}
          disabled={pending}
          data-testid="rest-timer-switch"
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
