"use client";

/**
 * Client wrapper around the `deleteSession` server action.
 *
 * Renders the trash icon button (≥44px tap target on mobile, hover
 * tooltip "Delete" on desktop). Single click triggers the soft-delete
 * with no confirmation modal — the UndoBanner is the safety net
 * (AGENTS.md DC-K4: reversible destructive actions).
 *
 * On success, dispatches the global `hta-undo-banner` event so the
 * banner mounted in the app shell pops up with the Undo affordance.
 * On failure, surfaces the error via a small inline message — server
 * action failure here is rare (RLS or network) and not worth a modal.
 *
 * The `label` prop becomes the banner copy ("{label} deleted ·
 * Undo"). The `redirectTo` prop is optional; when provided, the page
 * navigates there after a successful delete (used from the session
 * detail page to return the user to the list).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSession } from "@/lib/sessions/actions";
import { dispatchUndoBanner } from "@/components/trash/UndoBanner";

export function DeleteSessionButton({
  sessionId,
  label = "Session",
  redirectTo,
  variant = "icon",
}: {
  sessionId: string;
  label?: string;
  redirectTo?: string;
  variant?: "icon" | "menu";
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append("id", sessionId);
    startTransition(async () => {
      const result = await deleteSession(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      dispatchUndoBanner({ kind: "session", id: result.sessionId, label });
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  };

  if (variant === "menu") {
    return (
      <form onSubmit={onSubmit}>
        <button
          type="submit"
          disabled={pending}
          data-testid="delete-session-menu-item"
          className="cp-menu-item-destructive"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            background: "transparent",
            border: "none",
            color: "var(--cp-danger, #d33)",
            cursor: pending ? "progress" : "pointer",
            fontSize: 13,
            width: "100%",
            textAlign: "left",
            minHeight: 44,
          }}
        >
          <TrashIcon />
          <span>{pending ? "Deleting…" : `Delete ${label.toLowerCase()}`}</span>
        </button>
        {error && <p style={{ color: "var(--cp-danger, #d33)", fontSize: 12, padding: "4px 14px" }}>{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
      <button
        type="submit"
        disabled={pending}
        title="Delete"
        aria-label={`Delete ${label.toLowerCase()}`}
        data-testid="delete-session-button"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          borderRadius: 8,
          border: "none",
          background: "transparent",
          color: "var(--cp-text-muted, #666)",
          cursor: pending ? "progress" : "pointer",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--cp-danger, #d33)";
          (e.currentTarget as HTMLButtonElement).style.background = "var(--cp-surface-soft, rgba(0,0,0,0.04))";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "var(--cp-text-muted, #666)";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        <TrashIcon />
      </button>
      {error && <span style={{ color: "var(--cp-danger, #d33)", fontSize: 11 }}>{error}</span>}
    </form>
  );
}

function TrashIcon(): React.ReactElement {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
