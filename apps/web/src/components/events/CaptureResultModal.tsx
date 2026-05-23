"use client";

/**
 * CaptureResultModal — record the actual outcome of a past event.
 *
 * Uses the same modality-specific field layout as EventFormModal but
 * binds to `result` instead of `target_performance`. Also flips the
 * `completed` flag (default true on save).
 */
import { useState, useTransition } from "react";
import type { FormEvent, ReactElement } from "react";
import { captureResult } from "@/lib/events/actions";
import type { EventModality, EventPerformance } from "@/lib/events/schema";
import type { EventRowView } from "./types";

export function CaptureResultModal({
  open,
  onClose,
  event,
}: {
  open: boolean;
  onClose: () => void;
  event: EventRowView;
}): ReactElement | null {
  const modality = (event.modality as EventModality) ?? "other";
  const [time, setTime] = useState<string>(
    (event.result?.targetTime as string | undefined) ?? "",
  );
  const [distance, setDistance] = useState<string>(
    event.result?.targetDistanceKm != null ? String(event.result.targetDistanceKm) : "",
  );
  const [pace, setPace] = useState<string>("");
  const [total, setTotal] = useState<string>(
    event.result?.targetTotal != null ? String(event.result.targetTotal) : "",
  );
  const [description, setDescription] = useState<string>(
    (event.result?.description as string | undefined) ?? "",
  );
  const [completed, setCompleted] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const result: EventPerformance = {};
    if (["run", "bike", "swim", "row", "ski"].includes(modality)) {
      if (time.trim()) result.targetTime = time.trim();
      if (distance.trim()) {
        const n = Number.parseFloat(distance);
        if (Number.isFinite(n)) result.targetDistanceKm = n;
      }
      if (pace.trim()) {
        const m = pace.match(/^(\d+)[:.](\d{1,2})$/);
        if (m) result.paceSecPerKm = Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
        else if (/^\d+$/.test(pace.trim())) result.paceSecPerKm = Number.parseInt(pace, 10);
      }
    } else if (modality === "strength") {
      if (total.trim()) {
        const n = Number.parseFloat(total);
        if (Number.isFinite(n)) result.targetTotal = n;
      }
    } else {
      if (description.trim()) result.description = description.trim();
    }

    startTransition(async () => {
      const res = await captureResult(event.id, {
        result: Object.keys(result).length > 0 ? result : null,
        completed,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--cp-border)",
    background: "var(--cp-surface-soft, transparent)",
    color: "var(--cp-text)",
    fontSize: 13,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cp-text-muted)",
    display: "block",
    marginBottom: 4,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-result-title"
      data-testid="capture-result-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(440px, 100%)",
          background: "var(--cp-panel-strong, var(--cp-surface))",
          border: "1px solid var(--cp-border)",
          borderRadius: 14,
          padding: 20,
          color: "var(--cp-text)",
          display: "grid",
          gap: 14,
        }}
      >
        <header>
          <h2 id="capture-result-title" style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            Capture result · {event.name}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Record what you actually did. All fields optional.
          </p>
        </header>

        {["run", "bike", "swim", "row", "ski"].includes(modality) && (
          <>
            <div>
              <label style={labelStyle}>Distance (km)</label>
              <input data-testid="result-distance" type="number" step="0.001" min={0} value={distance} onChange={(e) => setDistance(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Finish time</label>
              <input data-testid="result-time" type="text" placeholder="1:36:42" value={time} onChange={(e) => setTime(e.target.value)} style={fieldStyle} />
            </div>
            <div>
              <label style={labelStyle}>Avg pace (min:sec/km)</label>
              <input data-testid="result-pace" type="text" placeholder="4:34" value={pace} onChange={(e) => setPace(e.target.value)} style={fieldStyle} />
            </div>
          </>
        )}

        {modality === "strength" && (
          <div>
            <label style={labelStyle}>Total (kg)</label>
            <input data-testid="result-total" type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} style={fieldStyle} />
          </div>
        )}

        {!["run", "bike", "swim", "row", "ski", "strength"].includes(modality) && (
          <div>
            <label style={labelStyle}>Notes</label>
            <input data-testid="result-description" type="text" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} style={fieldStyle} />
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: "var(--cp-text)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            data-testid="result-completed"
            checked={completed}
            onChange={(e) => setCompleted(e.target.checked)}
          />
          Mark event as completed
        </label>

        {error && (
          <div
            role="alert"
            data-testid="result-error"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "var(--cp-danger-soft, rgba(239,68,68,0.12))",
              color: "var(--cp-danger, #ef4444)",
              fontSize: 12,
              border: "1px solid var(--cp-danger, #ef4444)",
            }}
          >
            {error}
          </div>
        )}

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="result-cancel"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              background: "transparent",
              color: "var(--cp-text-muted)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="result-save"
            disabled={pending}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--cp-accent, var(--cp-text))",
              background: "var(--cp-accent, var(--cp-text))",
              color: "var(--cp-accent-fg, var(--cp-bg))",
              fontSize: 13,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Saving…" : "Save result"}
          </button>
        </footer>
      </form>
    </div>
  );
}
