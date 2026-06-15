"use client";

/**
 * Rest-timer bar (Phase 1 B4 auto rest-timer).
 *
 * Renders a slim FULL-WIDTH bar pinned just above the bottom nav while a rest
 * countdown is active — it shows the remaining mm:ss, a progress bar, the
 * "next <movement>" context and ±30s controls. Unlike the old floating pill it
 * never overlaps the weight/reps steppers. It is present ONLY while a rest is in
 * progress (the parent passes `seconds=0` → renders nothing) plus a brief
 * "Ready ✓" completion state the lifter taps to dismiss.
 *
 * Optional Web Vibration buzz + ~200ms 600Hz Web Audio chirp when the timer
 * hits zero — gracefully no-op where the APIs are unavailable (or disabled in
 * Settings).
 *
 * Owns no domain state — the parent passes a `key` so each new set remounts the
 * component and resets the countdown.
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

// Full-width slim bar pinned above the bottom nav (respecting the safe-area
// inset). Shared by the active + done states so the timer never shifts.
const BAR_WRAP_STYLE: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: "calc(var(--cp-bottomnav-h, 0px) + env(safe-area-inset-bottom))",
  zIndex: 39,
  padding: "8px 12px",
  background: "var(--cp-bg-elevated)",
  borderTop: "1px solid var(--cp-border-strong)",
  boxShadow: "0 -6px 18px rgba(0,0,0,0.18)",
};

const ADJ_BTN_STYLE: React.CSSProperties = {
  minWidth: 44,
  minHeight: 36,
  padding: "6px 10px",
  borderRadius: 9,
  border: "1px solid var(--cp-border-strong)",
  background: "transparent",
  color: "var(--cp-text)",
  fontFamily: "var(--cp-font-mono)",
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

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
      <div data-testid="rest-timer-shell" style={BAR_WRAP_STYLE}>
        <button
          type="button"
          data-testid="rest-timer-done"
          onClick={dismiss}
          aria-label="Rest complete — tap to dismiss"
          style={{
            width: "100%",
            minHeight: 40,
            padding: "8px 14px",
            borderRadius: 10,
            border: "1px solid var(--cp-success)",
            background: "var(--cp-success)",
            color: "var(--cp-accent-fg)",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "0.04em",
            cursor: "pointer",
          }}
        >
          Ready ✓ — tap to dismiss
        </button>
      </div>
    );
  }

  const pct =
    effectiveSeconds > 0
      ? Math.max(0, Math.min(100, (remaining / effectiveSeconds) * 100))
      : 0;

  return (
    <div
      data-testid="rest-timer-shell"
      style={{ ...BAR_WRAP_STYLE, display: "flex", alignItems: "center", gap: 10 }}
    >
      <button
        type="button"
        data-testid="rest-timer-minus-30"
        onClick={(e) => {
          e.stopPropagation();
          setAdjustSec((v) => v - 30);
        }}
        aria-label="Subtract 30 seconds from rest timer"
        style={ADJ_BTN_STYLE}
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
          flex: 1,
          minHeight: 40,
          padding: "4px 10px",
          borderRadius: 10,
          border: "1px solid var(--cp-border)",
          background: "transparent",
          color: "var(--cp-text)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 4,
          textAlign: "left",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--cp-font-mono)",
              fontWeight: 800,
              fontSize: 18,
              color: "var(--cp-success)",
            }}
          >
            <span aria-hidden style={{ fontSize: 13, marginRight: 5 }}>⏱</span>
            {fmt(remaining)}
          </span>
          {movementName && (
            <span
              data-testid="rest-timer-context"
              style={{
                fontWeight: 500,
                fontSize: 11,
                color: "var(--cp-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              next {movementName}
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{
            height: 5,
            borderRadius: 999,
            background: "var(--cp-border-strong)",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              display: "block",
              height: "100%",
              width: `${pct}%`,
              background: "var(--cp-success)",
              transition: "width 0.25s linear",
            }}
          />
        </span>
      </button>

      <button
        type="button"
        data-testid="rest-timer-plus-30"
        onClick={(e) => {
          e.stopPropagation();
          setAdjustSec((v) => v + 30);
        }}
        aria-label="Add 30 seconds to rest timer"
        style={ADJ_BTN_STYLE}
      >
        +30s
      </button>
    </div>
  );
}
