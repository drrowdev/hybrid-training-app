"use client";

/**
 * Client wrapper around the `deleteBlock` server action.
 *
 * Rendered as a small kebab menu on each block card on /app/plan/history.
 * Kebab → opens a one-item menu with "Delete this block". Single click
 * soft-deletes and pops the undo banner — no confirmation modal (the
 * banner is the safety net, AGENTS.md DC-K4).
 *
 * The label fed to the banner is the human archetype name (resolved
 * server-side in queries.ts).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteBlock } from "@/lib/planner/actions";
import { dispatchUndoBanner } from "@/components/trash/UndoBanner";

export function DeleteBlockMenu({
  blockId,
  archetypeName,
}: {
  blockId: string;
  archetypeName: string;
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const onDelete = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.append("id", blockId);
    startTransition(async () => {
      const result = await deleteBlock(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      dispatchUndoBanner({
        kind: "block",
        id: result.blockId,
        label: `${archetypeName} program`,
      });
      router.refresh();
    });
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Program actions"
        data-testid="block-actions-trigger"
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
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
          cursor: "pointer",
          fontSize: 18,
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          data-testid="block-actions-menu"
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            zIndex: 20,
            minWidth: 200,
            background: "var(--cp-surface, #fff)",
            border: "1px solid var(--cp-border, #e5e5e5)",
            borderRadius: 8,
            boxShadow: "var(--cp-shadow, 0 4px 12px rgba(0,0,0,0.1))",
            overflow: "hidden",
          }}
        >
          <form onSubmit={onDelete}>
            <button
              type="submit"
              role="menuitem"
              disabled={pending}
              data-testid="delete-block-menu-item"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "12px 14px",
                background: "transparent",
                border: "none",
                textAlign: "left",
                color: "var(--cp-danger, #d33)",
                cursor: pending ? "progress" : "pointer",
                fontSize: 13,
                minHeight: 44,
              }}
            >
              <span aria-hidden>🗑️</span>
              <span>{pending ? "Deleting…" : "Delete this program"}</span>
            </button>
          </form>
          {error && (
            <p style={{ color: "var(--cp-danger, #d33)", fontSize: 12, padding: "4px 14px 8px" }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
