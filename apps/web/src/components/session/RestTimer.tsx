"use client";

/**
 * Floating rest-timer button (Phase 1 B4 auto rest-timer).
 *
 * Renders a fixed bottom-right pill that counts down mm:ss. Tap to
 * dismiss. Optional Web Vibration buzz + ~200ms 600Hz Web Audio chirp
 * when the timer hits zero — gracefully no-op on browsers that don't
 * expose the APIs (or when the user has disabled either in Settings).
 *
 * Owns no domain state — the parent passes a `key` so each new set
 * remounts the component and resets the countdown.
 */

import { useEffect, useRef, useState } from "react";
import { hapticTick, timerBeep } from "@/lib/feedback";

export type RestTimerProps = {
  /** Total seconds to count down from. Set to 0 to render nothing. */
  seconds: number;
  /**
   * Optional kind-specific default — surfaced for the caller's bench-
   * mark / debugging. Not used by the countdown itself; the actual
   * countdown reads `seconds`. Kept on the type so callers can pass a
   * label without a TS lint.
   */
  defaultSeconds?: number;
  /** Called when the user dismisses or the timer hits zero. */
  onDone?: () => void;
  /** Phase 3 C1 — emit a short haptic buzz at zero. Defaults to true. */
  hapticsEnabled?: boolean;
  /** Phase 3 C2 — emit a short audio tone at zero. Defaults to true. */
  timerSoundEnabled?: boolean;
  /**
   * Optional active-movement name. When provided, the timer surfaces
   * "next <name>" so the lifter knows which lift they're resting before.
   */
  movementName?: string | null;
};

function fmt(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function RestTimer({
  seconds,
  onDone,
  hapticsEnabled = true,
  timerSoundEnabled = true,
  movementName = null,
}: RestTimerProps) {
  // The user can nudge ±30s mid-countdown. Adjustments are session-
  // scoped only — we never persist them. Resetting `seconds` (parent
  // remounts the component with a new key) clears the adjustment.
  const [adjustSec, setAdjustSec] = useState(0);
  const effectiveSeconds = Math.max(0, seconds + adjustSec);
  const [remaining, setRemaining] = useState(effectiveSeconds);
  const [done, setDone] = useState(false);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (effectiveSeconds <= 0) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      const start = startRef.current;
      if (start == null) return;
      const elapsed = (Date.now() - start) / 1000;
      const next = Math.max(0, effectiveSeconds - elapsed);
      setRemaining(next);
      if (next <= 0) {
        setDone(true);
        // Phase 3 C1/C2 — best-effort feedback at zero.
        hapticTick(hapticsEnabled, 120);
        timerBeep(timerSoundEnabled);
        clearInterval(id);
      }
    }, 250);
    return () => clearInterval(id);
  }, [effectiveSeconds, hapticsEnabled, timerSoundEnabled]);

  if (seconds <= 0) return null;

  const dismiss = () => {
    setDone(true);
    onDone?.();
  };

  if (done) {
    return (
      <button
        type="button"
        data-testid="rest-timer-done"
        onClick={dismiss}
        aria-label="Rest complete — tap to dismiss"
        style={{
          position: "fixed",
          right: 16,
          bottom:
            "calc(var(--cp-finishbar-clearance, calc(var(--cp-bottomnav-h, 0px) + env(safe-area-inset-bottom) + 96px)) + 12px)",
          zIndex: 39,
          minWidth: 96,
          minHeight: 56,
          padding: "12px 18px",
          borderRadius: 999,
          border: "1px solid var(--cp-success)",
          background: "var(--cp-success)",
          color: "var(--cp-accent-fg)",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.04em",
          cursor: "pointer",
          boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
        }}
      >
        Ready ✓
      </button>
    );
  }

  return (
    <div
      data-testid="rest-timer-shell"
      style={{
        position: "fixed",
        right: 16,
        bottom:
          "calc(var(--cp-finishbar-clearance, calc(var(--cp-bottomnav-h, 0px) + env(safe-area-inset-bottom) + 96px)) + 12px)",
        zIndex: 39,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <button
        type="button"
        data-testid="rest-timer-minus-30"
        onClick={(e) => {
          e.stopPropagation();
          setAdjustSec((v) => v - 30);
        }}
        aria-label="Subtract 30 seconds from rest timer"
        style={{
          minWidth: 40,
          minHeight: 40,
          padding: "6px 8px",
          borderRadius: 999,
          border: "1px solid var(--cp-border-strong)",
          background: "var(--cp-bg-elevated)",
          color: "var(--cp-text)",
          fontFamily: "var(--cp-font-mono)",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          boxShadow: "0 6px 14px rgba(0,0,0,0.12)",
        }}
      >
        −30s
      </button>
      <button
        type="button"
        data-testid="rest-timer"
        data-default-seconds={seconds}
        onClick={dismiss}
        aria-label={
          movementName
            ? `Rest timer ${fmt(remaining)} before next ${movementName} set — tap to dismiss`
            : `Rest timer ${fmt(remaining)} — tap to dismiss`
        }
        style={{
          minWidth: 96,
          minHeight: 56,
          padding: "10px 18px",
          borderRadius: 999,
          border: "1px solid var(--cp-border-strong)",
          background: "var(--cp-bg-elevated)",
          color: "var(--cp-text)",
          fontFamily: "var(--cp-font-mono)",
          fontWeight: 700,
          fontSize: 18,
          cursor: "pointer",
          boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          lineHeight: 1.1,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ fontSize: 14 }}>⏱</span>
          <span>{fmt(remaining)}</span>
        </span>
        {movementName && (
          <span
            data-testid="rest-timer-context"
            style={{
              fontFamily: "var(--cp-font)",
              fontWeight: 500,
              fontSize: 11,
              color: "var(--cp-text-muted)",
              letterSpacing: "0.02em",
            }}
          >
            next {movementName}
          </span>
        )}
      </button>
      <button
        type="button"
        data-testid="rest-timer-plus-30"
        onClick={(e) => {
          e.stopPropagation();
          setAdjustSec((v) => v + 30);
        }}
        aria-label="Add 30 seconds to rest timer"
        style={{
          minWidth: 40,
          minHeight: 40,
          padding: "6px 8px",
          borderRadius: 999,
          border: "1px solid var(--cp-border-strong)",
          background: "var(--cp-bg-elevated)",
          color: "var(--cp-text)",
          fontFamily: "var(--cp-font-mono)",
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
          boxShadow: "0 6px 14px rgba(0,0,0,0.12)",
        }}
      >
        +30s
      </button>
    </div>
  );
}
