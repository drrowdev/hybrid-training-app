"use client";

/**
 * Inline-editable workout title. Renders the title as a heading with a
 * small "Rename" affordance; clicking swaps to a text input that saves
 * via the `updateSessionTitle` server action and calls
 * `router.refresh()` so the new name propagates through headers and lists.
 * Optimistic: the heading updates immediately on save.
 *
 * Titles are user-facing labels only — the DB/route key is the session
 * id — so renaming never affects anything but the displayed name.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSessionTitle } from "@/lib/sessions/actions";

const MAX_LEN = 120;

export function EditableSessionTitle({
  sessionId,
  initialTitle,
}: {
  sessionId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setDraft(title);
    setError(null);
    setEditing(true);
    // Focus + select after the input mounts.
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = () => {
    const next = draft.trim();
    if (next.length === 0) {
      setError("Name can't be empty.");
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      fd.set("title", next.slice(0, MAX_LEN));
      const res = await updateSessionTitle(fd);
      if (res.ok) {
        setTitle(next.slice(0, MAX_LEN));
        setEditing(false);
        router.refresh();
      } else {
        setError(res.error ?? "Couldn't rename — try again.");
      }
    });
  };

  if (!editing) {
    return (
      <h1
        data-testid="session-title"
        style={{
          fontSize: "clamp(17px, 4.6vw, 26px)",
          lineHeight: 1.2,
          margin: "4px 0 0",
          letterSpacing: "-0.01em",
          display: "inline-flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        {title}
        <button
          type="button"
          onClick={open}
          data-testid="session-title-edit"
          aria-label="Rename workout"
          title="Rename workout"
          style={{
            all: "unset",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--cp-text-muted)",
            padding: "2px 4px",
          }}
        >
          ✎
        </button>
      </h1>
    );
  }

  return (
    <div style={{ display: "grid", gap: 4, margin: "4px 0 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          maxLength={MAX_LEN}
          data-testid="session-title-input"
          aria-label="Workout name"
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            padding: "4px 8px",
            borderRadius: 8,
            border: "1px solid var(--cp-border)",
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            minWidth: 0,
            flex: "1 1 220px",
          }}
        />
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="cp-btn primary"
          data-testid="session-title-save"
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isPending}
          className="cp-btn ghost"
          style={{ padding: "6px 12px", fontSize: 13 }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
