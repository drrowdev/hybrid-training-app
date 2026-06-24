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

// Floating, rounded "sheet" pinned above the bottom nav (respecting the safe-area
// inset) — a more native presentation than the old edge-to-edge slim bar. Shared
// by the active + done states so the timer never shifts.
const SHEET_WRAP_STYLE: React.CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: "calc(var(--cp-bottomnav-h, 0px) + env(safe-area-inset-bottom) + 10px)",
  zIndex: 39,
  padding: 14,
  borderRadius: 18,
  background: "var(--cp-bg-elevated)",
  border: "1px solid var(--cp-border-strong)",
  boxShadow: "0 14px 40px rgba(0,0,0,0.40)",
};

const ADJ_BTN_STYLE: React.CSSProperties = {
  minWidth: 46,
  minHeight: 44,
  padding: "6px 10px",
  borderRadius: 12,
  border: "1px solid var(--cp-border-strong)",
  background: "transparent",
  color: "var(--cp-text)",
  fontWeight: 700,
  fontSize: 13,
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
      <div data-testid="rest-timer-shell" className="cp-sheet-up" style={SHEET_WRAP_STYLE}>
        <button
          type="button"
          data-testid="rest-timer-done"
          onClick={dismiss}
          aria-label="Rest complete — tap to dismiss"
          style={{
            width: "100%",
            minHeight: 48,
            padding: "10px 14px",
            borderRadius: 14,
            border: "1px solid var(--cp-success)",
            background: "var(--cp-success)",
            color: "var(--cp-accent-fg)",
            fontWeight: 700,
            fontSize: 15,
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
  const sweepDeg = (pct / 100) * 360;

  return (
    <div
      data-testid="rest-timer-shell"
      className="cp-sheet-up"
      style={{ ...SHEET_WRAP_STYLE, display: "flex", alignItems: "center", gap: 12 }}
    >
      {/* Circular countdown — tapping it dismisses the rest, like the old bar. */}
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
          flex: "0 0 auto",
          width: 64,
          height: 64,
          borderRadius: "50%",
          border: 0,
          padding: 0,
          cursor: "pointer",
          background: `conic-gradient(var(--cp-success) ${sweepDeg}deg, var(--cp-border-strong) 0)`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "var(--cp-bg-elevated)",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: "-0.02em",
            color: "var(--cp-success)",
          }}
        >
          {fmt(remaining)}
        </span>
      </button>

      {/* Context — "Rest" + the next movement. */}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Rest</div>
        {movementName && (
          <div
            data-testid="rest-timer-context"
            style={{
              fontSize: 13,
              color: "var(--cp-text-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            next {movementName}
          </div>
        )}
      </div>

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
