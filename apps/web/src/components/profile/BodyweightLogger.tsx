"use client";

/**
 * BodyweightLogger — inline "Log bodyweight" affordance.
 *
 * Hides behind a button. Clicking opens a small input row; Enter or
 * Save persists via the existing `logBodyweight` server action so the
 * write path stays single-sourced. Esc closes without saving.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { logBodyweight } from "@/lib/settings/actions";

export type BodyweightLoggerProps = {
  /** YYYY-MM-DD in the user's tz. Required so the upsert lands on the right day. */
  todayYmd: string;
  /** Optional placeholder pulled from the user's last entry. */
  placeholderKg?: number | null;
};

export function BodyweightLogger({
  todayYmd,
  placeholderKg,
}: BodyweightLoggerProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const reset = () => {
    setOpen(false);
    setValue("");
    setError(null);
  };

  const save = () => {
    const kg = Number(value);
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      setError("Enter a bodyweight in kg (20 – 400).");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("date", todayYmd);
    fd.set("bodyweightKg", String(kg));
    startTransition(async () => {
      try {
        await logBodyweight(fd);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="bodyweight-log-trigger"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: "start",
          padding: "6px 10px",
          fontSize: 12,
          border: "1px solid var(--cp-border)",
          borderRadius: 999,
          background: "var(--cp-surface-soft)",
          color: "var(--cp-text)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Log bodyweight
      </button>
    );
  }

  return (
    <div
      data-testid="bodyweight-logger"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      <input
        ref={inputRef}
        data-testid="bodyweight-input"
        inputMode="decimal"
        type="number"
        step="0.1"
        min={20}
        max={400}
        value={value}
        placeholder={
          placeholderKg != null && Number.isFinite(placeholderKg)
            ? String(placeholderKg)
            : "kg"
        }
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            reset();
          }
        }}
        disabled={pending}
        aria-label="Bodyweight in kilograms"
        style={{
          width: 96,
          padding: "6px 8px",
          fontSize: 13,
          border: "1px solid var(--cp-border)",
          borderRadius: 6,
          background: "var(--cp-surface)",
          color: "var(--cp-text)",
          fontVariantNumeric: "tabular-nums",
        }}
      />
      <button
        type="button"
        data-testid="bodyweight-save"
        onClick={save}
        disabled={pending}
        style={{
          padding: "6px 10px",
          fontSize: 12,
          fontWeight: 600,
          border: "1px solid var(--cp-accent, var(--cp-border))",
          borderRadius: 6,
          background: "var(--cp-accent-soft, var(--cp-surface-soft))",
          color: "var(--cp-accent, var(--cp-text))",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Save
      </button>
      <button
        type="button"
        data-testid="bodyweight-cancel"
        onClick={reset}
        disabled={pending}
        style={{
          padding: "6px 10px",
          fontSize: 12,
          border: "1px solid var(--cp-border)",
          borderRadius: 6,
          background: "transparent",
          color: "var(--cp-text-muted)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Cancel
      </button>
      {error && (
        <span
          role="alert"
          data-testid="bodyweight-error"
          style={{ fontSize: 11, color: "var(--cp-danger, #d33)" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
