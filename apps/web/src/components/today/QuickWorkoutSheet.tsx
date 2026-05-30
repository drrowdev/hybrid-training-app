"use client";

/**
 * Quick-workout bottom sheet — fired from `<QuickWorkoutCard>` on the
 * Today page. Renders a 2×2 picker for the four common ad-hoc workout
 * shapes (Run / Ride / Strength / Other) plus, when available, a
 * "Recent" list of completed sessions the user can clone with one tap.
 *
 * All four picker tiles + every Recent row call a server action exposed
 * via props rather than imported directly — keeps the component pure
 * for tests and lets the page wire the actions once.
 *
 * The "Other" tile expands inline into a small modality dropdown
 * (swim / row / ski / walk / other) so we don't make the user dig
 * through a third-level picker for a rarely-used cardio kind.
 *
 * Wraps the shared `<BottomSheet>` for the backdrop + swipe-down UX.
 */

import { useState, useTransition } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

export type StartCardioFn = (input: {
  modality: string;
}) => void | Promise<void>;
export type StartStrengthFn = () => void | Promise<void>;
export type RepeatFn = (input: { sessionId: string }) => void | Promise<void>;

const OTHER_MODALITIES: Array<{ value: string; label: string }> = [
  { value: "swim", label: "Swim" },
  { value: "row", label: "Row" },
  { value: "ski", label: "Ski erg" },
  { value: "walk", label: "Walk / hike" },
  { value: "other", label: "Other cardio" },
];

export function QuickWorkoutSheet({
  open,
  onClose,
  recent,
  startCardio,
  startStrength,
  repeatRecent,
}: {
  open: boolean;
  onClose: () => void;
  recent: QuickRepeatCandidate[];
  startCardio: StartCardioFn;
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherModality, setOtherModality] = useState<string>("swim");
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
            Start something now. It won&apos;t replace your planned
            workout — it&apos;s logged on top.
          </p>
        </div>
      }
    >
      <div
        data-testid="quick-workout-tiles"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <Tile
          testId="quick-tile-run"
          icon="🏃"
          label="Run"
          sub="cardio"
          disabled={pending}
          loading={pendingId === "run"}
          onClick={() => fire("run", () => startCardio({ modality: "run" }))}
        />
        <Tile
          testId="quick-tile-ride"
          icon="🚴"
          label="Ride"
          sub="cardio"
          disabled={pending}
          loading={pendingId === "ride"}
          onClick={() => fire("ride", () => startCardio({ modality: "bike" }))}
        />
        <Tile
          testId="quick-tile-strength"
          icon="🏋️"
          label="Strength"
          sub="build your own"
          disabled={pending}
          loading={pendingId === "strength"}
          onClick={() => fire("strength", () => startStrength())}
        />
        <Tile
          testId="quick-tile-other"
          icon="+"
          label="Other"
          sub={otherOpen ? "pick a modality" : "swim · row · ski · …"}
          disabled={pending}
          loading={pendingId === "other"}
          onClick={() => setOtherOpen((v) => !v)}
          active={otherOpen}
        />
      </div>

      {otherOpen && (
        <div
          data-testid="quick-tile-other-panel"
          style={{
            marginTop: 10,
            padding: 12,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-bg)",
            borderRadius: 12,
            display: "grid",
            gap: 8,
          }}
        >
          <label
            htmlFor="quick-other-modality"
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            Modality
          </label>
          <select
            id="quick-other-modality"
            data-testid="quick-other-modality"
            value={otherModality}
            onChange={(e) => setOtherModality(e.target.value)}
            disabled={pending}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 14,
            }}
          >
            {OTHER_MODALITIES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cp-btn primary"
            data-testid="quick-other-start"
            disabled={pending}
            onClick={() =>
              fire("other", () => startCardio({ modality: otherModality }))
            }
          >
            Start {OTHER_MODALITIES.find((m) => m.value === otherModality)?.label ?? otherModality}
          </button>
        </div>
      )}

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

function Tile({
  icon,
  label,
  sub,
  onClick,
  testId,
  disabled,
  loading,
  active,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
  loading?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active ? true : undefined}
      style={{
        display: "grid",
        gap: 6,
        justifyItems: "start",
        padding: 16,
        background: "var(--cp-bg)",
        border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
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
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        {loading ? "Starting…" : sub}
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
