/**
 * /app/plan summary affordance: "Focus: Biceps, Forearms [Edit]" or
 * "No focus muscles set [+ Add focus]" depending on the active block's
 * `focus_muscles` array.
 *
 * Tapping the button opens an inline modal with the same chip selector
 * used by the wizard. Save calls the `updateBlockFocus` server action.
 */
"use client";

import { useState, useTransition } from "react";
import { FocusMuscleChips } from "./FocusMuscleChips";
import {
  FOCUS_MUSCLE_MAX,
  formatFocusMuscles,
} from "@/lib/planner/focus-muscles";

export type UpdateBlockFocusResult =
  | { ok: true; focusMuscles: string[] }
  | { ok: false; error: string };

export function PlanBlockFocusCard({
  blockId,
  initialFocusMuscles,
  updateAction,
}: {
  blockId: string;
  initialFocusMuscles: readonly string[];
  updateAction: (formData: FormData) => Promise<UpdateBlockFocusResult>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [focusMuscles, setFocusMuscles] = useState<string[]>(
    initialFocusMuscles.slice(),
  );
  const [draft, setDraft] = useState<string[]>(initialFocusMuscles.slice());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = focusMuscles.length === 0
    ? "No focus muscles set"
    : `Focus: ${formatFocusMuscles(focusMuscles)}`;
  const ctaLabel = focusMuscles.length === 0 ? "+ Add focus" : "Edit";

  const openModal = (): void => {
    setError(null);
    setDraft(focusMuscles.slice());
    setOpen(true);
  };

  const closeModal = (): void => {
    setOpen(false);
  };

  const toggleDraft = (muscle: string): void => {
    setDraft((prev) => {
      const idx = prev.indexOf(muscle);
      if (idx >= 0) {
        const next = prev.slice();
        next.splice(idx, 1);
        return next;
      }
      if (prev.length >= FOCUS_MUSCLE_MAX) {
        // Drop oldest entry so the newest tap always lands. Mirrors the
        // wizard reducer policy.
        return [prev[1]!, muscle];
      }
      return [...prev, muscle];
    });
  };

  const save = (): void => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", blockId);
      for (const m of draft) fd.append("focusMuscles", m);
      const result = await updateAction(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFocusMuscles(result.focusMuscles);
      setOpen(false);
    });
  };

  return (
    <section
      data-testid="plan-block-focus-card"
      className="cp-card"
      style={cardStyle}
    >
      <div style={rowStyle}>
        <span style={labelStyle} data-testid="plan-focus-label">
          {label}
        </span>
        <button
          type="button"
          onClick={openModal}
          className="cp-btn ghost"
          style={ctaStyle}
          data-testid="plan-focus-edit"
        >
          {ctaLabel}
        </button>
      </div>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit focus muscle groups"
          data-testid="plan-focus-modal"
          style={modalShellStyle}
          onClick={closeModal}
        >
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <header style={modalHeaderStyle}>
              <h2 style={{ margin: 0, fontSize: 16 }}>Focus muscle groups</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                style={modalCloseStyle}
              >
                ×
              </button>
            </header>
            <p style={modalDescStyle}>
              Pick up to {FOCUS_MUSCLE_MAX}. The engine biases your accessory
              work toward these groups while keeping total session volume the
              same. Changes apply to FUTURE sessions in this block; already-
              generated sessions keep their existing prescription.
            </p>
            <FocusMuscleChips selected={draft} onToggle={toggleDraft} />
            {error && (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            )}
            <div style={modalFooterStyle}>
              <button
                type="button"
                onClick={closeModal}
                disabled={pending}
                className="cp-btn ghost"
                style={ghostBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="cp-btn primary"
                style={primaryBtnStyle}
                data-testid="plan-focus-save"
              >
                {pending ? "Saving…" : "Save focus"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "12px 16px",
  display: "grid",
  gap: 4,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text)",
};

const ctaStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 8,
  background: "transparent",
  color: "var(--cp-accent)",
  border: "1px solid var(--cp-border)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const modalShellStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: React.CSSProperties = {
  background: "var(--cp-bg)",
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: "18px 20px",
  maxWidth: 520,
  width: "100%",
  display: "grid",
  gap: 14,
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const modalDescStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12.5,
  color: "var(--cp-text-muted)",
  lineHeight: 1.5,
};

const modalCloseStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--cp-text-muted)",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

const modalFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const errorStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid var(--cp-warning, #d97706)",
  color: "var(--cp-text)",
  fontSize: 12.5,
};

const ghostBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 10,
  background: "transparent",
  color: "var(--cp-text-muted)",
  border: "1px solid var(--cp-border)",
  cursor: "pointer",
  fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "8px 14px",
  borderRadius: 10,
  background: "var(--cp-accent)",
  color: "var(--cp-accent-fg)",
  border: "1px solid var(--cp-accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 600,
};
