"use client";

/**
 * Skip-session form with optional reason note (DC-K4 audit log).
 *
 * Two-stage flow:
 *   1) "Skip" button — collapsed state, identical click target to
 *      the old single-action button.
 *   2) After click → reveals an inline form with a 280-char textarea
 *      (mobile-first: full-width on phones, bottom-sheet feel via
 *      `position: sticky` is not needed at this card width) and two
 *      buttons: "Skip session" (primary) + "Cancel".
 *
 * Empty reason is fine — the audit log accepts NULL. The flow degrades
 * to a single click + confirm if the user doesn't want to type a note.
 */
import { useState, useTransition } from "react";
import type { skipPlannedSession } from "@/lib/planner/actions";

type Action = typeof skipPlannedSession;

export function SkipSessionForm({
  plannedId,
  title,
  action,
}: {
  plannedId: string;
  title: string;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        className="cp-btn ghost"
        data-testid={`skip-${plannedId}`}
        onClick={() => setOpen(true)}
      >
        Skip
      </button>
    );
  }

  return (
    <div
      data-testid={`skip-form-${plannedId}`}
      role="dialog"
      aria-label={`Skip ${title}`}
      style={{
        display: "grid",
        gap: 8,
        padding: 12,
        marginTop: 8,
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface-soft)",
        width: "100%",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>Skipping {title}?</div>
      <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        What happened? (optional)
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 280))}
          rows={2}
          maxLength={280}
          data-testid={`skip-reason-${plannedId}`}
          placeholder="Tired, travel, shoulder twinge…"
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "6px 8px",
            border: "1px solid var(--cp-border)",
            borderRadius: 6,
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            fontSize: 13,
            fontFamily: "inherit",
            resize: "vertical",
            minHeight: 36,
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cp-btn ghost"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          data-testid={`skip-cancel-${plannedId}`}
        >
          Cancel
        </button>
        <button
          type="button"
          className="cp-btn primary"
          data-testid={`skip-confirm-${plannedId}`}
          onClick={() => {
            const fd = new FormData();
            fd.set("id", plannedId);
            if (reason.trim().length > 0) fd.set("reason", reason.trim());
            startTransition(async () => {
              await action(fd);
              setOpen(false);
              setReason("");
            });
          }}
        >
          Skip session
        </button>
      </div>
    </div>
  );
}
