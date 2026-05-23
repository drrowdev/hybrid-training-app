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
  /** Called when the user dismisses or the timer hits zero. */
  onDone?: () => void;
  /** Phase 3 C1 — emit a short haptic buzz at zero. Defaults to true. */
  hapticsEnabled?: boolean;
  /** Phase 3 C2 — emit a short audio tone at zero. Defaults to true. */
  timerSoundEnabled?: boolean;
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
}: RestTimerProps) {
  const [remaining, setRemaining] = useState(seconds);
  const [done, setDone] = useState(false);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (seconds <= 0) {
      startRef.current = null;
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      const start = startRef.current;
      if (start == null) return;
      const elapsed = (Date.now() - start) / 1000;
      const next = Math.max(0, seconds - elapsed);
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
  }, [seconds, hapticsEnabled, timerSoundEnabled]);

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
          bottom: 88,
          zIndex: 40,
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
    <button
      type="button"
      data-testid="rest-timer"
      onClick={dismiss}
      aria-label={`Rest timer ${fmt(remaining)} — tap to dismiss`}
      style={{
        position: "fixed",
        right: 16,
        bottom: 88,
        zIndex: 40,
        minWidth: 96,
        minHeight: 56,
        padding: "12px 18px",
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
        alignItems: "center",
        gap: 8,
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>⏱</span>
      <span>{fmt(remaining)}</span>
    </button>
  );
}
