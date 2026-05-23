/**
 * StatusBadge — shared pill for a training block's lifecycle state.
 *
 * Extracted from `/app/plan/history/page.tsx` (PR #21) so the new
 * `/app/stats/blocks` Phase 2 surface can reuse the exact same visual
 * shape and `data-testid` hooks. The history page now imports from
 * here so the badge stays in one place.
 *
 * `data-testid="block-status-badge"` and `data-status="<status>"`
 * remain stable for E2E.
 */
import type { ReactElement } from "react";

export type BlockStatus = "active" | "completed" | "archived";

export function StatusBadge({ status }: { status: BlockStatus }): ReactElement {
  if (status === "completed") {
    return (
      <span
        data-testid="block-status-badge"
        data-status="completed"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 999,
          background: "rgba(34, 197, 94, 0.12)",
          color: "rgb(22, 163, 74)",
          border: "1px solid rgba(34, 197, 94, 0.35)",
        }}
      >
        ✓ Completed
      </span>
    );
  }
  if (status === "archived") {
    return (
      <span
        data-testid="block-status-badge"
        data-status="archived"
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: 999,
          background: "var(--cp-surface-muted, rgba(0,0,0,0.04))",
          color: "var(--cp-text-muted)",
          border: "1px solid var(--cp-border)",
        }}
      >
        Ended
      </span>
    );
  }
  return (
    <span
      data-testid="block-status-badge"
      data-status="active"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 999,
        background: "var(--cp-accent-soft)",
        color: "var(--cp-accent)",
        border: "1px solid var(--cp-accent)",
      }}
    >
      Active
    </span>
  );
}
