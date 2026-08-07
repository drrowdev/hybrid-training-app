"use client";

/**
 * TrainingNotesEditor — inline textarea for the user's training notes.
 *
 * Save-on-blur and keyboard:
 *   - Cmd/Ctrl+Enter  → save
 *   - Esc             → cancel (revert to last persisted value)
 *
 * Empty submissions persist as NULL.
 */

import { useCallback, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/profile/actions";

export type TrainingNotesEditorProps = {
  initialValue: string;
  action: (formData: FormData) => Promise<ActionResult>;
  /** Optional "Updated 3d ago" hint rendered above the textarea. */
  lastUpdatedLabel?: string | null;
};

export function TrainingNotesEditor({
  initialValue,
  action,
  lastUpdatedLabel,
}: TrainingNotesEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [persisted, setPersisted] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const save = useCallback(() => {
    if (value === persisted) return;
    setError(null);
    const fd = new FormData();
    fd.set("trainingNotes", value);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) {
        setPersisted(value);
        setSavedAt(Date.now());
      } else {
        setError(result.error);
      }
    });
  }, [value, persisted, action]);

  const cancel = useCallback(() => {
    setValue(persisted);
    setError(null);
    taRef.current?.blur();
  }, [persisted]);

  const dirty = value !== persisted;

  return (
    <div
      data-testid="training-notes-editor"
      style={{ display: "grid", gap: 6 }}
    >
      {lastUpdatedLabel && (
        <div
          data-testid="training-notes-updated"
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          {lastUpdatedLabel}
        </div>
      )}
      <textarea
        ref={taRef}
        data-testid="training-notes-textarea"
        value={value}
        rows={5}
        maxLength={4000}
        placeholder="Write what works for you — e.g. 'Better on heavy days after a rest day.'"
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        disabled={pending}
        aria-label="Training notes"
        style={{
          width: "100%",
          padding: 10,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--cp-text)",
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
          borderRadius: 8,
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          fontSize: 11,
          color: "var(--cp-text-muted)",
          minHeight: 14,
        }}
      >
        {pending && <span data-testid="training-notes-status">Saving…</span>}
        {!pending && dirty && (
          <span data-testid="training-notes-status">Unsaved · blur to save</span>
        )}
        {!pending && !dirty && savedAt != null && (
          <span data-testid="training-notes-status">Saved</span>
        )}
        {error && (
          <span
            role="alert"
            data-testid="training-notes-error"
            style={{ color: "var(--cp-danger, #d33)" }}
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
