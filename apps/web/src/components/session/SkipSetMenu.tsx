"use client";

/**
 * Inline "skip this set" menu — a small popover-style expansion below
 * the focus card, NOT a modal. The caller renders it conditionally
 * (toggle on the "Skip set" secondary button below the log button).
 *
 * The five reasons here mirror the SQL CHECK constraint on
 * `set_logs.skip_reason` (migration 0037). Adding a new chip requires
 * an ALTER on the constraint — keep the two lists in lockstep.
 */

import { useState } from "react";
import {
  SKIP_REASONS,
  skipReasonLabel,
  type SkipReason,
} from "@/lib/sessions/skip-reasons";

export type SkipSetMenuProps = {
  onConfirm: (reason: SkipReason, note: string | null) => Promise<void> | void;
  onCancel: () => void;
  pending?: boolean;
  error?: string | null;
  /** Heading above the reason chips. Defaults to the single-set prompt. */
  prompt?: string;
};

export function SkipSetMenu({ onConfirm, onCancel, pending, error, prompt }: SkipSetMenuProps) {
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState("");

  const handleConfirm = async () => {
    if (!reason) return;
    await onConfirm(reason, reason === "other" && note.trim() ? note.trim() : null);
  };

  return (
    <div
      data-testid="skip-set-menu"
      style={{
        marginTop: 4,
        padding: 12,
        borderRadius: 12,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface-soft)",
        display: "grid",
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--cp-text)",
        }}
      >
        {prompt ?? "Why skip this set?"}
      </div>
      <div
        role="radiogroup"
        aria-label="Skip reason"
        style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
      >
        {SKIP_REASONS.map((r) => {
          const selected = reason === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setReason(r)}
              disabled={pending}
              data-testid={`skip-reason-${r}`}
              data-selected={selected ? "true" : "false"}
              style={{
                all: "unset",
                cursor: pending ? "default" : "pointer",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                border: `1px solid ${selected ? "var(--cp-warning)" : "var(--cp-border)"}`,
                background: selected
                  ? "color-mix(in oklab, var(--cp-warning) 14%, transparent)"
                  : "var(--cp-surface)",
                color: selected ? "var(--cp-warning)" : "var(--cp-text)",
                opacity: pending ? 0.6 : 1,
              }}
            >
              {skipReasonLabel(r)}
            </button>
          );
        })}
      </div>

      {reason === "other" && (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={120}
          placeholder="One-line note (optional)"
          data-testid="skip-note-input"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            fontSize: 13,
            outline: "none",
          }}
        />
      )}

      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="cp-btn"
          style={{ padding: "6px 12px", fontSize: 12 }}
          data-testid="skip-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!reason || pending}
          className="cp-btn primary"
          style={{ padding: "6px 12px", fontSize: 12 }}
          data-testid="skip-confirm"
        >
          {pending ? "Skipping…" : "Confirm skip"}
        </button>
      </div>
    </div>
  );
}
