"use client";

/**
 * DisplayNameEditor — click-to-edit on the identity header name.
 *
 * Keyboard:
 *   - Enter           → save
 *   - Esc             → cancel
 *   - Tab / blur      → save
 *
 * The display value is the rendered `<h1>` until the user clicks; we
 * swap to an `<input>` then. Submission goes through the server action
 * passed in via prop so callers can wire revalidation as they see fit.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/profile/actions";

export type DisplayNameEditorProps = {
  initialName: string;
  email: string | null;
  action: (formData: FormData) => Promise<ActionResult>;
};

export function DisplayNameEditor({
  initialName,
  email,
  action,
}: DisplayNameEditorProps) {
  const [value, setValue] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const draftRef = useRef(initialName);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = useCallback(() => {
    const next = draftRef.current.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("displayName", next);
    startTransition(async () => {
      const result = await action(fd);
      if (result.ok) {
        setValue(next);
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }, [value, action]);

  const cancel = useCallback(() => {
    draftRef.current = value;
    setError(null);
    setEditing(false);
  }, [value]);

  const displayed = value.trim() || "Athlete";

  return (
    <div
      data-testid="display-name-editor"
      style={{ display: "grid", gap: 4 }}
    >
      {editing ? (
        <input
          ref={inputRef}
          data-testid="display-name-input"
          defaultValue={value}
          onChange={(e) => (draftRef.current = e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={pending}
          aria-label="Display name"
          maxLength={60}
          style={{
            fontSize: 22,
            fontWeight: 700,
            padding: "2px 6px",
            border: "1px solid var(--cp-border)",
            borderRadius: 6,
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            width: "min(100%, 340px)",
          }}
        />
      ) : (
        <button
          type="button"
          data-testid="display-name-trigger"
          onClick={() => {
            draftRef.current = value;
            setEditing(true);
          }}
          aria-label={`Edit display name (currently ${displayed})`}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 8,
            background: "transparent",
            border: "none",
            color: "var(--cp-text)",
            cursor: "text",
            padding: 0,
            fontSize: 22,
            fontWeight: 700,
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <span data-testid="display-name-value">{displayed}</span>
          <span
            aria-hidden
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--cp-text-muted)",
            }}
          >
            edit
          </span>
        </button>
      )}
      {email && (
        <div
          className="mono"
          data-testid="display-name-email"
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          {email}
        </div>
      )}
      {error && (
        <div
          role="alert"
          data-testid="display-name-error"
          style={{ fontSize: 11, color: "var(--cp-danger, #d33)" }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
