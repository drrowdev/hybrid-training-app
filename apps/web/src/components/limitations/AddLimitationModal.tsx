"use client";
/**
 * AddLimitationModal — self-serve form for creating a new limitation
 * or editing an existing one. Lives at the top of
 * /app/recovery/injuries.
 *
 * v2 (PR `feat/limitations-v2-lifecycle`):
 *   - Removed the "Expected duration (days)" field. User feedback was
 *     unambiguous: duration estimates were noise, not signal.
 *   - Added a "Affects: Left / Right / Both" toggle. Per-limitation,
 *     not per-muscle (model-simplification noted in the PR body).
 *   - Added an interactive "Engine will block" preview between the
 *     muscle picker and the movement picker. The user sees the
 *     concrete movements that will be filtered and can toggle each
 *     row to add it to the allow-list ("I can still do this one
 *     without pain"). On save, the allow-list is persisted on the
 *     row's `allowed_movement_ids` array.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
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
import { AFFECTED_SIDES, type AffectedSide } from "@/lib/limitations/schema";
import { MusclePicker } from "@/components/muscle-grid/MusclePicker";
import { MovementPicker } from "./MovementPicker";
import type { LimitationRow, MovementRef } from "./types";

const MUSCLE_SET = new Set<string>(ALL_MUSCLE_GROUPS);

type AffectedMovementPreview = {
  id: string;
  slug: string;
  displayName: string;
  affectedAs: "primary" | "secondary";
};

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
  const [affectedSide, setAffectedSide] = useState<AffectedSide | null>(
    initial?.affectedSide ?? "bilateral",
  );
  const [allowedIds, setAllowedIds] = useState<Set<string>>(
    new Set(initial?.allowedMovementIds ?? []),
  );

  const [preview, setPreview] = useState<AffectedMovementPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    if (muscles.length === 0) {
      setPreview([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch("/api/limitations/affected-movements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            affectedMuscles: muscles,
            affectedRegion: initial?.region ?? null,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setPreview([]);
          return;
        }
        const json = (await res.json()) as {
          movements?: AffectedMovementPreview[];
        };
        setPreview(json.movements ?? []);
      } catch {
        // swallow — abort or transient network
      } finally {
        setPreviewLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [muscles, open, initial?.region]);

  if (!open) return null;

  const toggleAllowed = (id: string) => {
    setAllowedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      allowedMovementIds: Array.from(allowedIds),
      affectedSide,
      notes: notes.trim() ? notes.trim() : null,
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

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={labelStyle}>Affects</legend>
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 11,
                color: "var(--cp-text-muted)",
              }}
            >
              Pick one side for the whole limitation. To capture &ldquo;left
              adductor&rdquo; + &ldquo;right quad&rdquo; as one issue, create
              two limitations.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AFFECTED_SIDES.map((s) => (
                <label
                  key={s}
                  data-testid={`limitation-side-${s}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    border: "1px solid var(--cp-border)",
                    borderRadius: 999,
                    cursor: "pointer",
                    background:
                      affectedSide === s
                        ? "var(--cp-accent-soft, rgba(0,0,0,0.06))"
                        : "transparent",
                    color:
                      affectedSide === s
                        ? "var(--cp-accent, var(--cp-text))"
                        : "var(--cp-text-muted)",
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  <input
                    type="radio"
                    name="affected-side"
                    value={s}
                    checked={affectedSide === s}
                    onChange={() => setAffectedSide(s)}
                    style={{ accentColor: "var(--cp-accent)" }}
                  />
                  {s === "bilateral"
                    ? "Both"
                    : s.charAt(0).toUpperCase() + s.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>

          <AffectedPreviewSection
            preview={preview}
            loading={previewLoading}
            allowedIds={allowedIds}
            onToggleAllowed={toggleAllowed}
            hasMuscles={muscles.length > 0}
          />

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

function AffectedPreviewSection({
  preview,
  loading,
  allowedIds,
  onToggleAllowed,
  hasMuscles,
}: {
  preview: AffectedMovementPreview[];
  loading: boolean;
  allowedIds: Set<string>;
  onToggleAllowed: (id: string) => void;
  hasMuscles: boolean;
}): ReactElement {
  const visible = useMemo(() => preview.slice(0, 50), [preview]);
  return (
    <section
      data-testid="affected-movements-preview"
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--cp-surface-soft, transparent)",
        display: "grid",
        gap: 8,
      }}
    >
      <header style={{ display: "grid", gap: 2 }}>
        <strong style={{ fontSize: 13 }}>
          These movements will be filtered from your prescriptions:
        </strong>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          Toggle a row if you can still do that movement without pain.
        </span>
      </header>
      {!hasMuscles && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            fontStyle: "italic",
          }}
        >
          Select muscles above to see which movements will be affected.
        </p>
      )}
      {hasMuscles && loading && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--cp-text-muted)",
          }}
        >
          Computing…
        </p>
      )}
      {hasMuscles && !loading && visible.length === 0 && (
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            fontStyle: "italic",
          }}
        >
          No movements in your catalog match this muscle selection.
        </p>
      )}
      {hasMuscles && !loading && visible.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 4,
          }}
        >
          {visible.map((m) => {
            const allowed = allowedIds.has(m.id);
            return (
              <li
                key={m.id}
                data-testid={`affected-movement-${m.slug}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: allowed
                    ? "color-mix(in srgb, var(--cp-ok, #22c55e) 8%, transparent)"
                    : "transparent",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                  }}
                >
                  <span>{m.displayName}</span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: "1px 6px",
                      borderRadius: 999,
                      border: "1px solid var(--cp-border)",
                      color: "var(--cp-text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {m.affectedAs}
                  </span>
                </span>
                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "var(--cp-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid={`affected-movement-allow-${m.slug}`}
                    checked={allowed}
                    onChange={() => onToggleAllowed(m.id)}
                    style={{ accentColor: "var(--cp-ok, #22c55e)" }}
                  />
                  I can still do this
                </label>
              </li>
            );
          })}
          {preview.length > visible.length && (
            <li
              style={{
                fontSize: 11,
                color: "var(--cp-text-muted)",
                paddingTop: 4,
              }}
            >
              + {preview.length - visible.length} more not shown
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
