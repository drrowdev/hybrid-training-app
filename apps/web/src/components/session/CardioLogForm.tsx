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
import type {
  logCardioSession as logCardioSessionAction,
  finishStravaAppliedSession as finishStravaAppliedAction,
} from "@/lib/sessions/actions";
import { RpeInput } from "@/components/forms/RpeInput";

type LogAction = typeof logCardioSessionAction;
type StravaFinishAction = typeof finishStravaAppliedAction;

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
  /**
   * When true, the cardio row has already been filled from a matched
   * Strava activity (PR #208's autofill flow). In that mode the form
   * collapses to RPE + Notes + Finish — Duration / HR / Distance are
   * hidden because we don't want to ask the user to retype data that's
   * already authoritative. Submission goes through
   * `finishStravaAppliedAction` instead of `logCardioSession`.
   */
  stravaApplied?: boolean;
  /** Required when `stravaApplied` is true. */
  stravaFinishAction?: StravaFinishAction;
  /**
   * When the form is opened as the "finish" step of a live tracking
   * session, the measured duration (minutes) pre-fills the Duration field,
   * overriding the prescribed default.
   */
  initialDurationMin?: number | null;
  /**
   * GPS-measured distance in kilometres from a live tracking session.
   * Pre-fills the distance field (converted to the display unit) and opens
   * the "More details" disclosure so the captured value is visible.
   */
  initialDistanceKm?: number | null;
};

const MI_TO_KM = 1.609344;

export function CardioLogForm({
  sessionId,
  prescribedDurationMin,
  movementId,
  modality,
  units,
  action,
  stravaApplied,
  stravaFinishAction,
  initialDurationMin,
  initialDistanceKm,
}: CardioLogFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const durationDefault =
    initialDurationMin != null
      ? initialDurationMin
      : prescribedDurationMin;

  const initialDistanceDisplay =
    initialDistanceKm != null && initialDistanceKm > 0
      ? String(
          Math.round(
            (units === "imperial"
              ? initialDistanceKm / MI_TO_KM
              : initialDistanceKm) * 100,
          ) / 100,
        )
      : "";

  const [completed, setCompleted] = useState<boolean>(true);
  const [duration, setDuration] = useState<string>(
    durationDefault != null ? String(durationDefault) : "",
  );
  const [rpe, setRpe] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showMore, setShowMore] = useState(initialDistanceDisplay !== "");
  const [avgHr, setAvgHr] = useState<string>("");
  const [distance, setDistance] = useState<string>(initialDistanceDisplay);

  const distanceUnit = units === "imperial" ? "mi" : "km";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (stravaApplied) {
      if (!stravaFinishAction) {
        setError("Missing finish handler for Strava-applied session.");
        return;
      }
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      if (rpe.trim()) fd.set("avgRpe", rpe.trim());
      if (notes.trim()) fd.set("notes", notes.trim());
      startTransition(async () => {
        const res = await stravaFinishAction(fd);
        if (res?.error) {
          setError(res.error);
          return;
        }
        router.refresh();
      });
      return;
    }

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
        padding: 14,
        display: "grid",
        gap: 12,
        marginInline: -16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          Log your cardio
        </h3>
        {/* Fix 5 — completion defaults to "yes". The skip path is the
            edge case (most cardio gets done), so the big yes/no radio
            block becomes a tiny inline link. */}
        <button
          type="button"
          onClick={() => setCompleted((c) => !c)}
          data-testid="cardio-log-toggle-skip"
          data-skipped={!completed ? "true" : "false"}
          aria-pressed={!completed}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            fontSize: 12,
            color: completed ? "var(--cp-text-muted)" : "var(--cp-danger)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {completed ? "Skip instead" : "Undo skip"}
        </button>
        {/* Keep the radio inputs for form-state introspection and
            existing data-testids. They're visually hidden but still
            in the DOM so tests + accessibility tools can read state. */}
        <fieldset
          data-testid="cardio-log-completed-fieldset"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            border: 0,
            padding: 0,
            margin: 0,
          }}
        >
          <legend>Did you complete it?</legend>
          {(["yes", "no"] as const).map((choice) => {
            const isOn =
              (choice === "yes" && completed) ||
              (choice === "no" && !completed);
            return (
              <label
                key={choice}
                data-testid={`cardio-log-completed-${choice}`}
                data-on={isOn ? "true" : "false"}
              >
                <input
                  type="radio"
                  name="cardio-completed"
                  value={choice}
                  checked={isOn}
                  onChange={() => setCompleted(choice === "yes")}
                />
                {choice === "yes" ? "Yes, completed" : "No, skipped"}
              </label>
            );
          })}
        </fieldset>
      </div>

      {/* Fix 5 — Duration + RPE on one row at desktop width, stacked
          below 480px. Uses an inline media query via a tiny <style>
          block so we don't need a new CSS module just for this form. */}
      <style>{`
        .cardio-log-duration-rpe-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 479px) {
          .cardio-log-duration-rpe-row { grid-template-columns: 1fr; }
        }
      `}</style>
      {!stravaApplied && (
        <div
          className="cardio-log-duration-rpe-row"
          data-testid="cardio-log-duration-rpe-row"
        >
          <label style={fieldStackStyle}>
            <span style={labelStyle}>Duration (min)</span>
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

          <div style={fieldStackStyle}>
            <RpeInput
              name="cardio-log-rpe-input"
              context="cardio"
              value={rpe === "" ? null : Number(rpe)}
              onChange={(v) => setRpe(v == null ? "" : String(v))}
            />
            {/* Hidden mirror so tests querying `cardio-log-rpe` still work. */}
            <input
              type="hidden"
              data-testid="cardio-log-rpe"
              value={rpe}
              readOnly
            />
          </div>
        </div>
      )}

      {stravaApplied && (
        <div
          data-testid="cardio-log-strava-applied-banner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--cp-border)",
            background:
              "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
            fontSize: 13,
            color: "var(--cp-text-muted)",
          }}
        >
          <span
            aria-hidden
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--cp-accent)",
            }}
          />
          <span>
            Duration, HR and distance are filled from Strava — just add RPE
            and notes to finish.
          </span>
        </div>
      )}

      {stravaApplied && (
        <div style={fieldStackStyle}>
          <RpeInput
            name="cardio-log-rpe-input"
            context="cardio"
            value={rpe === "" ? null : Number(rpe)}
            onChange={(v) => setRpe(v == null ? "" : String(v))}
          />
          <input
            type="hidden"
            data-testid="cardio-log-rpe"
            value={rpe}
            readOnly
          />
        </div>
      )}

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Notes (optional)</span>
        <textarea
          rows={3}
          maxLength={400}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          data-testid="cardio-log-notes"
          style={{ ...inputStyle, resize: "vertical", minHeight: 64, padding: "8px 12px" }}
        />
      </label>

      {!stravaApplied && (
        <details
          data-testid="cardio-log-more-details"
          open={showMore}
          onToggle={(e) =>
            setShowMore((e.target as HTMLDetailsElement).open)
          }
          style={{ display: "grid", gap: 10 }}
        >
        <summary
          style={{
            cursor: "pointer",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            userSelect: "none",
            padding: "4px 0",
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
      )}

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
          minHeight: 52,
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
