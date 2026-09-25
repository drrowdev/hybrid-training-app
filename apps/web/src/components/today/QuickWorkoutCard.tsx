"use client";

import { useState } from "react";
import {
  QuickWorkoutSheet,
  type StartStrengthFn,
  type RepeatFn,
  type GenerateStrengthFn,
  type GenerateHyroxFn,
  type HyroxStation,
} from "./QuickWorkoutSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

export type QuickWorkoutVariant = "planned" | "rest";

export function QuickWorkoutCard({
  variant,
  recent,
  startStrength,
  repeatRecent,
  generateStrength,
  generateHyrox,
  hyroxStationDefaults,
}: {
  variant: QuickWorkoutVariant;
  recent: QuickRepeatCandidate[];
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
  generateStrength: GenerateStrengthFn;
  generateHyrox: GenerateHyroxFn;
  hyroxStationDefaults: HyroxStation[];
}) {
  const [open, setOpen] = useState(false);

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
          padding: 16,
          minHeight: 76,
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
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
            Start something off-plan
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
        generateStrength={generateStrength}
        generateHyrox={generateHyrox}
        hyroxStationDefaults={hyroxStationDefaults}
      />
    </>
  );
}
