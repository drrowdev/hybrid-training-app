import Link from "next/link";

/**
 * Secondary notice surfaced on the Today page when the user has past
 * planned sessions sitting in limbo (date < today, neither completed
 * nor skipped — see `lib/planner/overdue.ts`).
 *
 * Renders nothing when `count === 0`. When count > 0, renders a single
 * inline link pointing at /app/plan where the user can review the
 * overdue rows and use the one-tap "Mark skipped" / "Log now" CTAs.
 *
 * Intentionally a Link, not a button or primary CTA — the Today page's
 * primary action remains the day's actual session (or the rest-day
 * banner). The overdue notice is review-only.
 */
export function OverdueNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Link
      href="/app/plan"
      data-testid="today-overdue-notice"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        border: "1px solid var(--cp-warning)",
        background: "color-mix(in srgb, var(--cp-warning) 10%, transparent)",
        borderRadius: 10,
        fontSize: 13,
        color: "var(--cp-text)",
        textDecoration: "none",
      }}
    >
      <span aria-hidden style={{ fontSize: 14 }}>⚠️</span>
      <span>
        You have <strong>{count}</strong> overdue session
        {count === 1 ? "" : "s"} — review {count === 1 ? "it" : "them"} →
      </span>
    </Link>
  );
}
