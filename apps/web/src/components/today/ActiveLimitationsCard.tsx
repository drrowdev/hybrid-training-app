/**
 * ActiveLimitationsCard — persistent reminder banner at the top of
 * Today when the user has ≥1 active limitation.
 *
 * Returns null on zero active rows. On one or more, renders a small
 * warning-bordered card listing up to 3 entries with a "Manage →"
 * link to /app/recovery/injuries. The visual treatment intentionally
 * echoes OverdueNotice (warning border, --cp-warning) but is a
 * persistent card rather than a single inline link — limitations
 * stick around longer than overdue sessions.
 */
import Link from "next/link";

export type ActiveLimitationSummary = {
  id: string;
  kind: string | null;
  severity: "mild" | "moderate" | "severe";
  startedAt: string;
};

export type ActiveLimitationsCardProps = {
  limitations: ReadonlyArray<ActiveLimitationSummary>;
};

const MAX_VISIBLE = 3;

function shortDateLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return new Date(iso).toISOString().slice(0, 10);
}

export function ActiveLimitationsCard({
  limitations,
}: ActiveLimitationsCardProps) {
  if (limitations.length === 0) return null;
  const visible = limitations.slice(0, MAX_VISIBLE);
  const more = limitations.length - visible.length;

  return (
    <section
      data-testid="active-limitations-card"
      style={{
        display: "grid",
        gap: 6,
        padding: "10px 14px",
        border: "1px solid var(--cp-warning)",
        background: "color-mix(in srgb, var(--cp-warning) 8%, transparent)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <strong
          style={{ fontSize: 13, color: "var(--cp-text)" }}
        >
          Active limitation{limitations.length === 1 ? "" : "s"}:
        </strong>
        <Link
          href="/app/recovery/injuries"
          data-testid="active-limitations-manage"
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            textDecoration: "none",
          }}
        >
          Manage →
        </Link>
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gap: 2,
        }}
      >
        {visible.map((l) => (
          <li
            key={l.id}
            data-testid="active-limitations-row"
            style={{
              fontSize: 12,
              color: "var(--cp-text)",
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span style={{ textTransform: "capitalize", fontWeight: 600 }}>
              {l.kind ?? "Limitation"}
            </span>
            <span style={{ color: "var(--cp-text-muted)" }}>
              — {l.severity}, since {shortDateLabel(l.startedAt)}
            </span>
          </li>
        ))}
        {more > 0 && (
          <li
            style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
            data-testid="active-limitations-more"
          >
            + {more} more
          </li>
        )}
      </ul>
    </section>
  );
}
