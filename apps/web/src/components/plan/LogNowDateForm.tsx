"use client";

/**
 * Inline date-picker for the overdue "Log now" CTA.
 *
 * When the user taps "Log now" on an overdue session the catch-up
 * intent is ambiguous: did the workout actually happen on the planned
 * day (and they're just back-filling the log now), or are they doing
 * it now? The picker lets them attribute the work to the right day,
 * defaulting to the planned date so the common "Monday's workout
 * logged Tuesday" path is one tap + confirm.
 *
 * For today/future sessions the parent renders a plain `<Link>` — no
 * picker, identical one-tap behaviour to PR #173.
 *
 * Styling mirrors `SkipSessionForm` so the two overdue CTAs feel
 * visually consistent.
 */
import { useState, useTransition } from "react";

type Action = (formData: FormData) => Promise<void> | void;

export function LogNowDateForm({
  plannedId,
  title,
  defaultDateYmd,
  maxDateYmd,
  action,
  onOpenChange,
}: {
  plannedId: string;
  title: string;
  /** Pre-filled date — usually the planned date, or today. */
  defaultDateYmd: string;
  /** Today in user tz — picker's max. */
  maxDateYmd: string;
  action: Action;
  /** Lets the parent disable other one-tap CTAs while the picker is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDateYmd);
  const [pending, startTransition] = useTransition();

  const setOpenAndNotify = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="cp-btn primary"
        data-testid={`overdue-log-${plannedId}`}
        title="Start logging this session now"
        onClick={() => setOpenAndNotify(true)}
      >
        Log now
      </button>
    );
  }

  return (
    <div
      data-testid={`log-now-form-${plannedId}`}
      role="dialog"
      aria-label={`Log ${title}`}
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
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        Log {title} — what day?
      </div>
      <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        Performed on
        <input
          type="date"
          value={date}
          max={maxDateYmd}
          onChange={(e) => setDate(e.target.value)}
          data-testid={`log-now-date-input-${plannedId}`}
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
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cp-btn ghost"
          onClick={() => setOpenAndNotify(false)}
          data-testid={`log-now-cancel-${plannedId}`}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="cp-btn primary"
          data-testid={`log-now-confirm-${plannedId}`}
          disabled={pending || date.length === 0}
          aria-busy={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set("id", plannedId);
            fd.set("performedAt", date);
            startTransition(async () => {
              // `startSessionFromPlan` redirects on success — control
              // never returns here on the happy path.
              await action(fd);
            });
          }}
        >
          Start logging
        </button>
      </div>
    </div>
  );
}
