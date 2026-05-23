"use client";
/**
 * AddLimitationModal — self-serve form for creating a new limitation
 * or editing an existing one. Lives at the top of
 * /app/recovery/injuries; opens from the "Add a limitation" button
 * on the page and the per-card "Edit" affordance.
 *
 * The modal is a thin wrapper around the typed `createLimitation` /
 * `updateLimitation` server actions in @/lib/limitations/actions —
 * we don't roll our own fetch. Validation is mirrored client-side so
 * the user sees an inline error before the server round-trip, but
 * the server is still the source of truth via the same Zod schema.
 */
import { useState, useTransition } from "react";
import type { FormEvent, ReactElement } from "react";
import {
  ALL_MUSCLE_GROUPS,
  type MuscleGroup,
} from "@/lib/muscle/muscle-groups";
import {
  createLimitation,
  updateLimitation,
} from "@/lib/limitations/actions";
import type { LimitationFormInput } from "@/lib/limitations/schema";
import { MusclePicker } from "@/components/muscle-grid/MusclePicker";
import { MovementPicker } from "./MovementPicker";
import type { LimitationRow, MovementRef } from "./types";

const MUSCLE_SET = new Set<string>(ALL_MUSCLE_GROUPS);

export type AddLimitationModalProps = {
  open: boolean;
  onClose: () => void;
  /** Optional existing row — present in edit mode. */
  initial?: LimitationRow | null;
  /** Resolved movement refs for `initial.affectedMovementIds`. */
  initialMovements?: MovementRef[];
};

export function AddLimitationModal({
  open,
  onClose,
  initial = null,
  initialMovements = [],
}: AddLimitationModalProps): ReactElement | null {
  const [kind, setKind] = useState(initial?.kind ?? "");
  const [severity, setSeverity] = useState<"mild" | "moderate" | "severe">(
    initial?.severity ?? "mild",
  );
  const [muscles, setMuscles] = useState<MuscleGroup[]>(
    (initial?.affectedMuscles ?? []).filter((m): m is MuscleGroup =>
      MUSCLE_SET.has(m),
    ),
  );
  const [movements, setMovements] = useState<MovementRef[]>(initialMovements);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [durationDays, setDurationDays] = useState<string>(
    initial?.expectedDurationDays != null
      ? String(initial.expectedDurationDays)
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmedKind = kind.trim();
    if (!trimmedKind) {
      setError("Kind is required");
      return;
    }
    if (muscles.length === 0 && movements.length === 0) {
      setError("Pick at least one muscle or one movement");
      return;
    }

    const payload: LimitationFormInput = {
      kind: trimmedKind,
      severity,
      affectedMuscles: muscles,
      affectedMovementIds: movements.map((m) => m.id),
      notes: notes.trim() ? notes.trim() : null,
      expectedDurationDays:
        durationDays.trim() === "" ? null : Number(durationDays),
    };

    startTransition(async () => {
      const result = initial
        ? await updateLimitation(initial.id, payload)
        : await createLimitation(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onClose();
    });
  };

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.55)",
    display: "grid",
    placeItems: "center",
    zIndex: 100,
    padding: 16,
  };
  const cardStyle: React.CSSProperties = {
    width: "min(640px, 100%)",
    maxHeight: "calc(100dvh - 48px)",
    overflowY: "auto",
    background: "var(--cp-panel-strong, var(--cp-surface))",
    border: "1px solid var(--cp-border)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "var(--cp-shadow, 0 16px 48px rgba(0,0,0,0.4))",
    color: "var(--cp-text)",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cp-text-muted)",
    display: "block",
    marginBottom: 4,
  };
  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--cp-border)",
    background: "var(--cp-surface-soft, transparent)",
    color: "var(--cp-text)",
    fontSize: 13,
    fontFamily: "inherit",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="limitation-modal-title"
      data-testid="add-limitation-modal"
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form onSubmit={onSubmit} style={cardStyle}>
        <header style={{ marginBottom: 16 }}>
          <h2
            id="limitation-modal-title"
            style={{ margin: 0, fontSize: 18, fontWeight: 700 }}
          >
            {initial ? "Edit limitation" : "Add a limitation"}
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--cp-text-muted)",
            }}
          >
            The engine will cap or rotate around the affected muscles and
            movements you select.
          </p>
        </header>

        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="lim-kind" style={labelStyle}>
              Kind
            </label>
            <input
              id="lim-kind"
              data-testid="lim-kind"
              type="text"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="e.g. left knee, lower back, shoulder"
              maxLength={80}
              style={fieldStyle}
              required
            />
          </div>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={labelStyle}>Severity</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["mild", "moderate", "severe"] as const).map((s) => (
                <label
                  key={s}
                  data-testid={`lim-severity-${s}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    border: "1px solid var(--cp-border)",
                    borderRadius: 999,
                    cursor: "pointer",
                    background:
                      severity === s
                        ? "var(--cp-accent-soft, rgba(0,0,0,0.06))"
                        : "transparent",
                    color:
                      severity === s
                        ? "var(--cp-accent, var(--cp-text))"
                        : "var(--cp-text-muted)",
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  <input
                    type="radio"
                    name="severity"
                    value={s}
                    checked={severity === s}
                    onChange={() => setSeverity(s)}
                    style={{ accentColor: "var(--cp-accent)" }}
                  />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label style={labelStyle}>Affected muscles</label>
            <MusclePicker selected={muscles} onChange={setMuscles} />
          </div>

          <div>
            <label style={labelStyle}>Affected movements</label>
            <MovementPicker selected={movements} onChange={setMovements} />
          </div>

          <div>
            <label htmlFor="lim-notes" style={labelStyle}>
              Notes
            </label>
            <textarea
              id="lim-notes"
              data-testid="lim-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What's happening? When does it hurt? What helps?"
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </div>

          <div>
            <label htmlFor="lim-duration" style={labelStyle}>
              Expected duration (days, optional)
            </label>
            <input
              id="lim-duration"
              data-testid="lim-duration"
              type="number"
              inputMode="numeric"
              min={0}
              max={3650}
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
              placeholder="e.g. 14"
              style={fieldStyle}
            />
          </div>

          {error && (
            <div
              role="alert"
              data-testid="lim-error"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--cp-danger-soft, rgba(239, 68, 68, 0.12))",
                color: "var(--cp-danger, #ef4444)",
                fontSize: 12,
                border: "1px solid var(--cp-danger, #ef4444)",
              }}
            >
              {error}
            </div>
          )}

          <footer
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              onClick={onClose}
              data-testid="lim-cancel"
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
              data-testid="lim-save"
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
              {pending ? "Saving…" : "Save"}
            </button>
          </footer>
        </div>
      </form>
    </div>
  );
}
