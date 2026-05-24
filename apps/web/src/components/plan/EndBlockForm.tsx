"use client";

/**
 * End-block form with confirmation + optional reason note (DC-K4).
 *
 * Ending a block is destructive (writes `archived_at`), so we always
 * show a confirmation modal-style inline form. Two-stage:
 *
 *   1) "End block" button — same affordance as before.
 *   2) After click → inline confirmation panel with optional reason
 *      textarea (280 chars), "End block" primary, "Cancel" secondary.
 *
 * Mobile-first: the panel fills the parent card width; on phones the
 * card is full-width so this becomes a bottom-of-screen sheet
 * naturally.
 */
import { useState, useTransition } from "react";
import type { endBlock } from "@/lib/planner/actions";

type Action = typeof endBlock;

export function EndBlockForm({
  blockId,
  action,
}: {
  blockId: string;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        className="cp-btn danger"
        data-testid="end-block-button"
        onClick={() => setOpen(true)}
      >
        End block
      </button>
    );
  }

  return (
    <div
      data-testid="end-block-form"
      role="dialog"
      aria-label="End block"
      style={{
        display: "grid",
        gap: 10,
        padding: 14,
        marginTop: 12,
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface-soft)",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>End this block?</div>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 4 }}>
          Archives the schedule. You keep all logged sessions and can
          start a new block immediately.
        </div>
      </div>
      <label style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        What happened? (optional)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 280))}
          rows={2}
          maxLength={280}
          data-testid="end-block-reason"
          placeholder="Switching focus, travel, injury…"
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
            resize: "vertical",
            minHeight: 36,
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="cp-btn ghost"
          data-testid="end-block-cancel"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="cp-btn danger"
          data-testid="end-block-confirm"
          onClick={() => {
            const fd = new FormData();
            fd.set("id", blockId);
            if (reason.trim().length > 0) fd.set("reason", reason.trim());
            startTransition(async () => {
              await action(fd);
              setOpen(false);
              setReason("");
            });
          }}
        >
          End block
        </button>
      </div>
    </div>
  );
}
