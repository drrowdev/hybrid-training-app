"use client";

/**
 * TrashItemRow — one row in the Trash page list, with Recover +
 * Permanently delete affordances.
 *
 * Permanently delete opens a confirmation modal with a type-to-confirm
 * input: the user must type the item's "confirm token" exactly to
 * enable the destructive Delete button. The token is the block's
 * archetype name for blocks, or the session's performed-on YYYY-MM-DD
 * for sessions — both human-readable enough to type but specific
 * enough that the user can't fat-finger their way through.
 *
 * Modal is inline (no portal) — keeps the component self-contained
 * and avoids a bespoke modal primitive. The dialog is `role="dialog"`
 * with `aria-modal` and traps initial focus on the input.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  permanentlyDeleteBlock,
  restoreBlock,
} from "@/lib/planner/actions";
import {
  permanentlyDeleteSession,
  restoreSession,
} from "@/lib/sessions/actions";

type Props = {
  kind: "block" | "session";
  id: string;
  /** Display label — "Strength Focus" for a block, "Tuesday session" / title for a session. */
  title: string;
  /** Secondary line — e.g. "Started 2026-05-01" or "Performed 2026-04-22". */
  subtitle: string;
  /** Token the user must type to confirm permanent deletion. */
  confirmToken: string;
  /** When this item was soft-deleted (ISO). Used to render "X days ago". */
  deletedAt: string;
};

export function TrashItemRow({ kind, id, title, subtitle, confirmToken, deletedAt }: Props): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRecover = () => {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "block" ? await restoreBlock(id) : await restoreSession(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const daysAgo = computeDaysAgo(deletedAt);

  return (
    <li
      data-testid="trash-item"
      data-kind={kind}
      data-id={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--cp-surface, transparent)",
        border: "1px solid var(--cp-border, #e5e5e5)",
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted, #777)" }}>
          {subtitle} · Deleted {daysAgo}
        </div>
        {error && (
          <div style={{ color: "var(--cp-danger, #d33)", fontSize: 12, marginTop: 4 }}>{error}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onRecover}
          disabled={pending}
          data-testid="recover-button"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--cp-border, #d4d4d4)",
            background: "transparent",
            color: "var(--cp-text, inherit)",
            cursor: pending ? "progress" : "pointer",
            fontSize: 13,
            minHeight: 36,
          }}
        >
          {pending ? "…" : "Recover"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          data-testid="permanent-delete-trigger"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--cp-danger, #d33)",
            background: "transparent",
            color: "var(--cp-danger, #d33)",
            cursor: "pointer",
            fontSize: 13,
            minHeight: 36,
          }}
        >
          Permanently delete
        </button>
      </div>

      {confirming && (
        <ConfirmDeleteModal
          kind={kind}
          id={id}
          title={title}
          confirmToken={confirmToken}
          onClose={() => setConfirming(false)}
          onConfirmed={() => {
            setConfirming(false);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

function ConfirmDeleteModal({
  kind,
  id,
  title,
  confirmToken,
  onClose,
  onConfirmed,
}: {
  kind: "block" | "session";
  id: string;
  title: string;
  confirmToken: string;
  onClose: () => void;
  onConfirmed: () => void;
}): React.ReactElement {
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = typed.trim() === confirmToken;
  const kindLabel = kind === "block" ? "block" : "session";

  const onDelete = () => {
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      const result =
        kind === "block"
          ? await permanentlyDeleteBlock(id)
          : await permanentlyDeleteSession(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onConfirmed();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      data-testid="confirm-delete-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--cp-surface, #fff)",
          color: "var(--cp-text, inherit)",
          maxWidth: 480,
          width: "100%",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
        }}
      >
        <h2 id="confirm-delete-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
          Permanently delete {kindLabel}?
        </h2>
        <p style={{ margin: "0 0 16px", color: "var(--cp-text-muted, #666)", fontSize: 14 }}>
          This will permanently delete this {kindLabel}. This cannot be undone.
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 13 }}>
          Type <code style={{ background: "var(--cp-surface-soft, rgba(0,0,0,0.05))", padding: "2px 6px", borderRadius: 4 }}>{confirmToken}</code> to confirm:
        </p>
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          data-testid="confirm-delete-input"
          aria-label={`Type ${confirmToken} to confirm permanent deletion of ${title}`}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--cp-border, #d4d4d4)",
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 16,
            fontFamily: "var(--cp-font-mono, ui-monospace, monospace)",
          }}
        />
        {error && (
          <p style={{ color: "var(--cp-danger, #d33)", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="confirm-delete-cancel"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--cp-border, #d4d4d4)",
              background: "transparent",
              color: "var(--cp-text, inherit)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={!matches || pending}
            data-testid="confirm-delete-confirm"
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid var(--cp-danger, #d33)",
              background: matches ? "var(--cp-danger, #d33)" : "transparent",
              color: matches ? "#fff" : "var(--cp-danger, #d33)",
              cursor: matches && !pending ? "pointer" : "not-allowed",
              fontSize: 14,
              opacity: matches ? 1 : 0.5,
              fontWeight: 600,
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function computeDaysAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const ms = Date.now() - then;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000);
    if (hours <= 0) return "just now";
    return `${hours}h ago`;
  }
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
