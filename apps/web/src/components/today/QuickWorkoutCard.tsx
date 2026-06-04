"use client";

/**
 * Quick-workout entry point — Mockup variant C (inline dashed-border
 * card). Sits at the bottom of the Today page on both planned days
 * (below "Recent activity") and rest days (below the rest banner).
 *
 * Tap the whole card to open `<QuickWorkoutSheet>`. The card itself is
 * purely presentational; the sheet owns the picker + action wiring.
 *
 * The subtitle copy adapts to `variant`:
 *   - "planned":  "Start something off-plan"
 *   - "rest":     "Got energy? Start something light"
 *
 * On rest days the planned hero is a one-row "Rest day" banner, so the
 * card sits below it without competing visually — the user is still
 * gently steered toward rest-first, but the option is one tap away.
 */

import { useState } from "react";
import {
  QuickWorkoutSheet,
  type StartStrengthFn,
  type RepeatFn,
} from "./QuickWorkoutSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

export type QuickWorkoutVariant = "planned" | "rest";

export function QuickWorkoutCard({
  variant,
  recent,
  startStrength,
  repeatRecent,
}: {
  variant: QuickWorkoutVariant;
  recent: QuickRepeatCandidate[];
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
}) {
  const [open, setOpen] = useState(false);
  const subtitle =
    variant === "rest"
      ? "Got energy? Start something light"
      : "Start something off-plan";

  return (
    <>
      <button
        type="button"
        data-testid="quick-workout-card"
        data-variant={variant}
        onClick={() => setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          width: "100%",
          padding: 12,
          background: "transparent",
          border: "1px dashed var(--cp-border-strong)",
          borderRadius: 14,
          cursor: "pointer",
          color: "var(--cp-text)",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "var(--cp-accent-soft)",
            color: "var(--cp-accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            flex: "0 0 auto",
          }}
        >
          +
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Quick workout</span>
          <span
            data-testid="quick-workout-subtitle"
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            {subtitle}
          </span>
        </span>
        <span
          aria-hidden
          style={{ color: "var(--cp-text-muted)", fontSize: 18 }}
        >
          ›
        </span>
      </button>

      <QuickWorkoutSheet
        open={open}
        onClose={() => setOpen(false)}
        recent={recent}
        startStrength={startStrength}
        repeatRecent={repeatRecent}
      />
    </>
  );
}
