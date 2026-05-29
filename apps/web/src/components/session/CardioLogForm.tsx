"use client";

/**
 * Cardio session log form, rendered on the live session page when the
 * session has at least one cardio prescription item.
 *
 * Replaces the strength-only "Log at least 1 set to finish" CTA for
 * pure-cardio sessions and renders BELOW the strength logging area on
 * hybrid sessions (where the user does both).
 *
 * Minimal field set:
 *   - Completed: yes / no (skip path aligns with existing
 *     completed_at = null semantics, NOT a new status).
 *   - Actual duration: minutes (defaults to prescribed duration).
 *   - Average RPE: 0–10 scale, optional.
 *   - Notes: free text, optional.
 *
 * Stretch fields (HR / distance) live behind a "More details" toggle
 * so the default flow stays minimal.
 *
 * Strava pull-from-activity is intentionally deferred — see PR body.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { logCardioSession as logCardioSessionAction } from "@/lib/sessions/actions";

type LogAction = typeof logCardioSessionAction;

export type CardioLogFormProps = {
  sessionId: string;
  /** Prescribed duration in minutes — pre-fills the input. */
  prescribedDurationMin: number | null;
  /** Movement id from the (first) prescribed cardio item. */
  movementId: string | null;
  /** Cardio modality string for the cardio_logs row. */
  modality: string;
  /** "metric" | "imperial" — controls the distance unit label. */
  units: "metric" | "imperial";
  action: LogAction;
};

const MI_TO_KM = 1.609344;

export function CardioLogForm({
  sessionId,
  prescribedDurationMin,
  movementId,
  modality,
  units,
  action,
}: CardioLogFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [completed, setCompleted] = useState<boolean>(true);
  const [duration, setDuration] = useState<string>(
    prescribedDurationMin != null ? String(prescribedDurationMin) : "",
  );
  const [rpe, setRpe] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showMore, setShowMore] = useState(false);
  const [avgHr, setAvgHr] = useState<string>("");
  const [distance, setDistance] = useState<string>("");

  const distanceUnit = units === "imperial" ? "mi" : "km";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("completed", completed ? "true" : "false");
    fd.set("actualDurationMin", duration);
    fd.set("modality", modality);
    if (movementId) fd.set("movementId", movementId);
    if (rpe.trim()) fd.set("avgRpe", rpe.trim());
    if (notes.trim()) fd.set("notes", notes.trim());
    if (avgHr.trim()) fd.set("avgHrBpm", avgHr.trim());
    if (distance.trim()) {
      const n = Number(distance);
      if (Number.isFinite(n) && n > 0) {
        const km = units === "imperial" ? n * MI_TO_KM : n;
        fd.set("distanceKm", String(km));
      }
    }

    startTransition(async () => {
      const res = await action(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <form
      data-testid="cardio-log-form"
      onSubmit={onSubmit}
      className="cp-card"
      style={{
        padding: 18,
        display: "grid",
        gap: 16,
        marginInline: -16,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          Log your cardio
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
          }}
        >
          A few quick details and we&apos;ll wrap up the session.
        </p>
      </div>

      <fieldset
        data-testid="cardio-log-completed-fieldset"
        style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}
      >
        <legend
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
            padding: 0,
          }}
        >
          Did you complete it?
        </legend>
        <div style={{ display: "flex", gap: 8 }}>
          {(["yes", "no"] as const).map((choice) => {
            const isOn =
              (choice === "yes" && completed) ||
              (choice === "no" && !completed);
            return (
              <label
                key={choice}
                data-testid={`cardio-log-completed-${choice}`}
                data-on={isOn ? "true" : "false"}
                style={{
                  flex: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 44,
                  padding: "0 12px",
                  borderRadius: 10,
                  border: `1px solid ${
                    isOn ? "var(--cp-accent)" : "var(--cp-border)"
                  }`,
                  background: isOn
                    ? "color-mix(in oklab, var(--cp-accent) 10%, transparent)"
                    : "var(--cp-surface)",
                  color: isOn ? "var(--cp-text)" : "var(--cp-text-muted)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="radio"
                  name="cardio-completed"
                  value={choice}
                  checked={isOn}
                  onChange={() => setCompleted(choice === "yes")}
                  style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                />
                {choice === "yes" ? "Yes, completed" : "No, skipped"}
              </label>
            );
          })}
        </div>
      </fieldset>

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Actual duration (min)</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          required
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          data-testid="cardio-log-duration"
          style={inputStyle}
        />
      </label>

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Average RPE (0–10, optional)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={10}
          step={0.5}
          value={rpe}
          onChange={(e) => setRpe(e.target.value)}
          data-testid="cardio-log-rpe"
          style={inputStyle}
        />
      </label>

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Notes (optional)</span>
        <textarea
          rows={2}
          maxLength={400}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="cardio-log-notes"
          style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
        />
      </label>

      <details
        open={showMore}
        onToggle={(e) =>
          setShowMore((e.target as HTMLDetailsElement).open)
        }
        style={{ display: "grid", gap: 12 }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            userSelect: "none",
            padding: "6px 0",
          }}
        >
          {showMore ? "Hide details" : "+ More details (HR, distance)"}
        </summary>
        <label style={fieldStackStyle}>
          <span style={labelStyle}>Average HR (bpm, optional)</span>
          <input
            type="number"
            inputMode="numeric"
            min={30}
            max={240}
            value={avgHr}
            onChange={(e) => setAvgHr(e.target.value)}
            data-testid="cardio-log-avg-hr"
            style={inputStyle}
          />
        </label>
        <label style={fieldStackStyle}>
          <span style={labelStyle}>Distance ({distanceUnit}, optional)</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={units === "imperial" ? 620 : 1000}
            step={0.01}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            data-testid="cardio-log-distance"
            style={inputStyle}
          />
        </label>
      </details>

      {error && (
        <div
          role="alert"
          data-testid="cardio-log-error"
          style={{
            fontSize: 13,
            color: "var(--cp-danger)",
            padding: "8px 10px",
            borderRadius: 8,
            background:
              "color-mix(in oklab, var(--cp-danger) 10%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        data-testid="cardio-log-submit"
        className="cp-btn primary big"
        style={{
          minHeight: 56,
          textAlign: "center",
          justifyContent: "center",
          opacity: pending ? 0.7 : 1,
          cursor: pending ? "not-allowed" : "pointer",
        }}
      >
        {pending
          ? "Saving…"
          : completed
            ? "Finish workout →"
            : "Save skip →"}
      </button>
    </form>
  );
}

const fieldStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontSize: 16,
};
