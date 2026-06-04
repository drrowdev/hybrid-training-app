"use client";

/**
 * Quick-workout bottom sheet — fired from `<QuickWorkoutCard>` on the
 * Today page. Quick workouts are STRENGTH-ONLY: the sheet offers a
 * single "Strength" start plus, when available, a "Recent" list of
 * completed strength workouts the user can clone with one tap.
 *
 * Cardio is intentionally NOT a quick-workout option. In-app cardio
 * capture (GPS live tracking) was removed — cardio is logged in Strava
 * and flows in via the Strava integration, or is entered manually on a
 * planned cardio session. Steering ad-hoc cardio out of the quick-workout
 * picker keeps that mental model clean.
 *
 * Both the Strength start and every Recent row call a server action
 * exposed via props rather than imported directly — keeps the component
 * pure for tests and lets the page wire the actions once.
 *
 * Wraps the shared `<BottomSheet>` for the backdrop + swipe-down UX.
 */

import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

export type StartStrengthFn = () => void | Promise<void>;
export type RepeatFn = (input: { sessionId: string }) => void | Promise<void>;

export function QuickWorkoutSheet({
  open,
  onClose,
  recent,
  startStrength,
  repeatRecent,
}: {
  open: boolean;
  onClose: () => void;
  recent: QuickRepeatCandidate[];
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
}) {
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fire = (id: string, fn: () => void | Promise<void>) => {
    if (pending) return;
    setPendingId(id);
    startTransition(() => {
      Promise.resolve(fn()).catch((err) => {
        // Server actions that redirect throw `NEXT_REDIRECT`; that's
        // expected and not an error path the user needs to see.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/NEXT_REDIRECT/i.test(msg)) {
          console.error("[quick-workout] action failed", err);
        }
      });
    });
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="quick-workout-sheet"
      ariaLabelledById="quick-workout-sheet-title"
      title={
        <div>
          <h2
            id="quick-workout-sheet-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700 }}
          >
            Quick workout
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--cp-text-muted)",
              lineHeight: 1.4,
            }}
          >
            Start a strength session now. It won&apos;t replace your planned
            workout — it&apos;s logged on top.
          </p>
        </div>
      }
    >
      <div data-testid="quick-workout-tiles" style={{ display: "grid", gap: 10 }}>
        <StrengthTile
          disabled={pending}
          loading={pendingId === "strength"}
          onClick={() => fire("strength", () => startStrength())}
        />
      </div>

      {recent.length > 0 && (
        <div
          data-testid="quick-workout-recent"
          style={{ marginTop: 20, display: "grid", gap: 8 }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Recent
          </div>
          {recent.map((s) => (
            <RecentRow
              key={s.id}
              candidate={s}
              disabled={pending}
              loading={pendingId === `repeat:${s.id}`}
              onRepeat={() =>
                fire(`repeat:${s.id}`, () => repeatRecent({ sessionId: s.id }))
              }
            />
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

function StrengthTile({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="quick-tile-strength"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 16,
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
        width: "100%",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--cp-accent-soft)",
          color: "var(--cp-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          flex: "0 0 auto",
        }}
      >
        🏋️
      </span>
      <span style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Strength</span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {loading ? "Starting…" : "build your own"}
        </span>
      </span>
    </button>
  );
}

function RecentRow({
  candidate,
  onRepeat,
  disabled,
  loading,
}: {
  candidate: QuickRepeatCandidate;
  onRepeat: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const dow = dayOfWeekShort(candidate.performedAt);
  return (
    <div
      data-testid={`quick-recent-${candidate.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {candidate.title ?? "Untitled"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            marginTop: 2,
          }}
        >
          {candidate.summary} · {dow}
        </div>
      </div>
      <button
        type="button"
        className="cp-btn"
        data-testid={`quick-recent-repeat-${candidate.id}`}
        onClick={onRepeat}
        disabled={disabled}
        style={{ fontSize: 13, padding: "6px 12px" }}
      >
        {loading ? "Starting…" : "Repeat"}
      </button>
    </div>
  );
}

function dayOfWeekShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
