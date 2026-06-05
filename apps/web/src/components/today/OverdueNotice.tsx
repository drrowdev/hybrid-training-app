import Link from "next/link";

/**
 * Secondary notice surfaced on the Today page when the user has past
 * planned sessions sitting in limbo (date < today, neither completed
 * nor skipped - see `lib/planner/overdue.ts`).
 *
 * Renders nothing when `count === 0`. When count > 0, renders a compact
 * amber "needs attention" card (distinct from the neutral hero / rest
 * banner) linking to /app/plan, where the user reviews the overdue rows
 * and uses the one-tap "Mark skipped" / "Log now" CTAs.
 *
 * Intentionally review-only - the Today page''s primary action remains
 * the day''s actual session (or the rest-day card). The warning treatment
 * signals "action needed" without being alarming.
 */
export function OverdueNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  const one = count === 1;
  return (
    <Link
      href="/app/plan"
      data-testid="today-overdue-notice"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        border:
          "1px solid color-mix(in srgb, var(--cp-warning) 38%, var(--cp-border))",
        background: "color-mix(in srgb, var(--cp-warning) 9%, transparent)",
        borderRadius: 12,
        textDecoration: "none",
        color: "var(--cp-text)",
      }}
    >
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          width: 30,
          height: 30,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: "color-mix(in srgb, var(--cp-warning) 20%, transparent)",
          color: "var(--cp-warning)",
          fontSize: 15,
        }}
      >
        &#9888;
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {count} overdue session{one ? "" : "s"}
        </span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          Slipped past {one ? "its" : "their"} planned day - log{" "}
          {one ? "it" : "them"} or skip.
        </span>
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--cp-warning)",
        }}
      >
        Review &#8594;
      </span>
    </Link>
  );
}