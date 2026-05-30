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
  durationMin?: number;
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

const DURATION_CHIPS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 30, label: "30 min" },
  { min: 45, label: "45 min" },
  { min: 60, label: "60 min" },
  { min: 90, label: "90 min" },
];

/** Allowed range, mirrors the server-side Zod schema. */
const MIN_DURATION = 5;
const MAX_DURATION = 300;

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
  // Which tile (if any) is in "waiting for the user to pick a
  // duration" mode. Tapping Run/Ride/Other expands the duration row
  // INLINE underneath the picker grid — no second sheet, no modal.
  const [durationFor, setDurationFor] = useState<
    | { modality: string; tileId: string }
    | null
  >(null);
  const [customMin, setCustomMin] = useState<string>("");
  const [customError, setCustomError] = useState<string | null>(null);
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

  const openDuration = (modality: string, tileId: string) => {
    // Tapping the same tile again collapses the duration row.
    if (durationFor?.tileId === tileId) {
      setDurationFor(null);
      return;
    }
    setDurationFor({ modality, tileId });
    setCustomMin("");
    setCustomError(null);
    setOtherOpen(false);
  };

  const pickDuration = (durationMin: number) => {
    if (!durationFor) return;
    fire(`${durationFor.tileId}:${durationMin}`, () =>
      startCardio({ modality: durationFor.modality, durationMin }),
    );
  };

  const submitCustom = () => {
    if (!durationFor) return;
    setCustomError(null);
    const n = Number(customMin);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < MIN_DURATION || n > MAX_DURATION) {
      setCustomError(`Enter a whole number ${MIN_DURATION}–${MAX_DURATION}`);
      return;
    }
    pickDuration(n);
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
          loading={pendingId?.startsWith("run") ?? false}
          active={durationFor?.tileId === "run"}
          onClick={() => openDuration("run", "run")}
        />
        <Tile
          testId="quick-tile-ride"
          icon="🚴"
          label="Ride"
          sub="cardio"
          disabled={pending}
          loading={pendingId?.startsWith("ride") ?? false}
          active={durationFor?.tileId === "ride"}
          onClick={() => openDuration("bike", "ride")}
        />
        <Tile
          testId="quick-tile-strength"
          icon="🏋️"
          label="Strength"
          sub="build your own"
          disabled={pending}
          loading={pendingId === "strength"}
          onClick={() => {
            setDurationFor(null);
            fire("strength", () => startStrength());
          }}
        />
        <Tile
          testId="quick-tile-other"
          icon="+"
          label="Other"
          sub={otherOpen ? "pick a modality" : "swim · row · ski · …"}
          disabled={pending}
          loading={pendingId?.startsWith("other") ?? false}
          onClick={() => {
            setDurationFor(null);
            setOtherOpen((v) => !v);
          }}
          active={otherOpen}
        />
      </div>

      {durationFor && (
        <DurationPickerRow
          testId="quick-duration-row"
          pending={pending}
          custom={customMin}
          customError={customError}
          onChip={pickDuration}
          onCustomChange={(v) => {
            setCustomError(null);
            setCustomMin(v);
          }}
          onCustomSubmit={submitCustom}
        />
      )}

      {otherOpen && !durationFor && (
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
            onClick={() => {
              // Hand off to the inline duration row instead of
              // submitting with the silent 30-min default.
              setOtherOpen(false);
              openDuration(otherModality, "other");
            }}
          >
            Next: pick duration
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

/**
 * Inline duration row that appears under the picker grid after the
 * user taps Run / Ride / Other. Keeps the sheet height tight (under
 * ~60px additional vertical space) and lives INSIDE the BottomSheet
 * so the swipe-to-dismiss handler on the sheet's drag handle still
 * works; chip taps are handled by their own button elements and
 * don't bubble into the swipe gesture.
 */
function DurationPickerRow({
  testId,
  pending,
  custom,
  customError,
  onChip,
  onCustomChange,
  onCustomSubmit,
}: {
  testId: string;
  pending: boolean;
  custom: string;
  customError: string | null;
  onChip: (min: number) => void;
  onCustomChange: (value: string) => void;
  onCustomSubmit: () => void;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 10,
        padding: 10,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-bg)",
        borderRadius: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-text-muted)",
          fontWeight: 600,
        }}
      >
        How long?
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {DURATION_CHIPS.map((c) => (
          <button
            key={c.min}
            type="button"
            data-testid={`quick-duration-${c.min}`}
            disabled={pending}
            onClick={() => onChip(c.min)}
            style={chipStyle(pending)}
          >
            {c.label}
          </button>
        ))}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: "auto",
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={MIN_DURATION}
            max={MAX_DURATION}
            placeholder="Custom"
            aria-label="Custom duration in minutes"
            data-testid="quick-duration-custom"
            value={custom}
            disabled={pending}
            onChange={(e) => onCustomChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCustomSubmit();
              }
            }}
            style={{
              width: 76,
              padding: "6px 8px",
              borderRadius: 999,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            data-testid="quick-duration-custom-go"
            onClick={onCustomSubmit}
            disabled={pending}
            style={chipStyle(pending)}
          >
            Go
          </button>
        </div>
      </div>
      {customError && (
        <div
          role="alert"
          data-testid="quick-duration-error"
          style={{ fontSize: 11, color: "var(--cp-danger)" }}
        >
          {customError}
        </div>
      )}
    </div>
  );
}

function chipStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid var(--cp-border)",
    background: "var(--cp-surface)",
    color: "var(--cp-text)",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    font: "inherit",
  };
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
