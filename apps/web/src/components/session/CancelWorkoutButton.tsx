"use client";

/**
 * Cancel-workout escape hatch for an in-progress session.
 *
 * Mirrors `DeleteSessionButton` in delegating to the `deleteSession`
 * server action (soft-delete via `deleted_at = now()`; trash cleanup
 * cron handles permanent removal). It exists as a separate component
 * because the user intent — "I tapped Start by mistake" — is distinct
 * from cleanup of an old completed session, and the copy needs to
 * reflect that.
 *
 * Rendered only when the session is truly empty (no set logs, no
 * cardio logs, not completed). The parent server component decides
 * which of `CancelWorkoutButton` / `DeleteSessionButton` to mount.
 *
 * Behaviour:
 *   - Click → inline confirmation modal ("Cancel this workout? …").
 *   - Confirm → call `deleteSession`, then redirect to `/app`.
 *   - The Undo banner is intentionally NOT dispatched here: cancel
 *     means "I never wanted this", whereas Delete on a completed
 *     session is a regret-prone destructive action. The session is
 *     still recoverable from Trash for the retention window.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSession } from "@/lib/sessions/actions";

export function CancelWorkoutButton({
  sessionId,
  redirectTo = "/app",
}: {
  sessionId: string;
  redirectTo?: string;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const onConfirm = () => {
    setError(null);
    const fd = new FormData();
    fd.append("id", sessionId);
    startTransition(async () => {
      const result = await deleteSession(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(redirectTo);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={pending}
        data-testid="cancel-workout-menu-item"
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
        <CancelIcon />
        <span>{pending ? "Cancelling…" : "Cancel workout"}</span>
      </button>
      {error && (
        <p
          role="alert"
          style={{ color: "var(--cp-danger, #d33)", fontSize: 12, padding: "4px 14px" }}
        >
          {error}
        </p>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-workout-title"
          data-testid="cancel-workout-confirm"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setConfirming(false);
          }}
        >
          <div
            style={{
              background: "var(--cp-surface)",
              border: "1px solid var(--cp-border)",
              borderRadius: 12,
              padding: 20,
              maxWidth: 360,
              width: "100%",
              boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
              display: "grid",
              gap: 12,
            }}
          >
            <h2
              id="cancel-workout-title"
              style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--cp-text)" }}
            >
              Cancel this workout?
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}>
              It won&apos;t be saved to your history.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                data-testid="cancel-workout-keep"
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  border: "1px solid var(--cp-border)",
                  borderRadius: 8,
                  color: "var(--cp-text)",
                  cursor: pending ? "progress" : "pointer",
                  fontSize: 13,
                  minHeight: 36,
                }}
              >
                Keep workout
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                data-testid="cancel-workout-confirm-yes"
                style={{
                  padding: "8px 14px",
                  background: "var(--cp-danger, #d33)",
                  border: "1px solid var(--cp-danger, #d33)",
                  borderRadius: 8,
                  color: "white",
                  cursor: pending ? "progress" : "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  minHeight: 36,
                }}
              >
                {pending ? "Cancelling…" : "Yes, cancel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CancelIcon(): React.ReactElement {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}
