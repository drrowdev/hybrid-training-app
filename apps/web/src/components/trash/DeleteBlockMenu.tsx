"use client";

/**
 * Client wrapper around the `deleteBlock` server action.
 *
 * Rendered as a small kebab menu on each block card on /app/plan/history.
 * Kebab opens lifecycle actions. Single click
 * soft-deletes and pops the undo banner — no confirmation modal (the
 * banner is the safety net, AGENTS.md DC-K4).
 *
 * The label fed to the banner is the human archetype name (resolved
 * server-side in queries.ts).
 */
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteBlock, previewTrainingRestore, resumeBlock, type PlannedMovePreview } from "@/lib/planner/actions";
import { ProgramDialog } from "@/components/program/ProgramDialog";
import { dispatchUndoBanner } from "@/components/trash/UndoBanner";
import { useConfirmBlockDeletion } from "@/components/program/BlockHistoryList";

export function DeleteBlockMenu({
  blockId,
  archetypeName,
  canResume = false,
}: {
  blockId: string;
  archetypeName: string;
  canResume?: boolean;
}): React.ReactElement {
  const router = useRouter();
  const confirmDeletion = useConfirmBlockDeletion();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlannedMovePreview | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
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
      flushSync(() => {
        setOpen(false);
        confirmDeletion?.(result.blockId);
      });
      dispatchUndoBanner({
        kind: "block",
        id: result.blockId,
        label: `${archetypeName} program`,
      });
      router.refresh();
    });
  };

  const onResume = () => {
    setError(null);
    startTransition(async () => {
      const review = preview ?? await previewTrainingRestore({ kind: "resume", id: blockId });
      if (review.error !== undefined) { setError(review.error); return; }
      if (!preview && review.overlaps.length) {
        setPreview(review);
        setAcceptOverlap(false);
        setOpen(false);
        return;
      }
      const result = await resumeBlock(blockId, {
        revision: review.revision, requestId: review.requestId, acceptOverlap,
      });
      if (result.error !== undefined) { setError(result.error); return; }
      setPreview(null);
      setOpen(false);
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
        disabled={pending}
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
          {canResume && <button type="button" role="menuitem" disabled={pending}
            onClick={onResume} data-testid="resume-block-menu-item"
            style={{ display: "block", width: "100%", padding: "12px 14px", minHeight: 44,
              background: "transparent", border: "none", textAlign: "left", color: "var(--cp-text)",
              cursor: pending ? "progress" : "pointer", fontSize: 13 }}>
            Resume program
          </button>}
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
              <span>Delete this program</span>
            </button>
          </form>
          {error && (
            <p role="alert" style={{ color: "var(--cp-danger, #d33)", fontSize: 12, padding: "4px 14px 8px" }}>
              {error}
            </p>
          )}
          {preview && <ProgramDialog title="Resume program" busy={pending}
            onClose={() => { setPreview(null); setError(null); setAcceptOverlap(false); }}>
            <div style={{ display: "grid", gap: 16, padding: 20 }}>
              <ul style={{ margin: 0, paddingLeft: 20, overflowWrap: "anywhere" }}>
                {preview.overlaps.map((entry) => <li key={`${entry.source}:${entry.id}`}>{entry.date} · {entry.title}</li>)}
              </ul>
              <label style={{ display: "flex", gap: 8, alignItems: "start" }}>
                <input type="checkbox" checked={acceptOverlap} disabled={pending}
                  onChange={(event) => setAcceptOverlap(event.target.checked)} />
                Keep both workouts on these dates
              </label>
              {error && <p role="alert" style={{ margin: 0, color: "var(--cp-danger)" }}>{error}</p>}
              {error ? <button type="button" className="cp-btn ghost" disabled={pending}
                onClick={() => { setPreview(null); setAcceptOverlap(false); setError(null); setOpen(true); }}>Review again</button>
                : <button type="button" className="cp-btn primary" disabled={pending || !acceptOverlap}
                  onClick={onResume}>Resume program</button>}
            </div>
          </ProgramDialog>}
        </div>
      )}
    </div>
  );
}
