/**
 * ProfileNotifications — top-of-page Notifications block on /app/profile.
 *
 * Mirrors the desktop TopBarRight bell popover (same audit entries,
 * same labels, same "Mark all read" affordance) so mobile users have
 * a parity surface. Hidden when there are no entries.
 */

import Link from "next/link";
import { MarkAllReadButton } from "./MarkAllReadButton";
import type { TopBarAuditEntry } from "@/components/shell/TopBarRight";

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function eventLabel(t: string): string {
  switch (t) {
    case "skip":
      return "Session skipped";
    case "swap":
      return "Movement swapped";
    case "manual_end":
      return "Block ended manually";
    case "custom":
      return "Custom override";
    default:
      return t;
  }
}

export function ProfileNotifications({
  recentAudit,
  unreadCount,
  markAuditReadAction,
}: {
  recentAudit: TopBarAuditEntry[];
  unreadCount: number;
  markAuditReadAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  return (
    <section
      data-testid="profile-notifications"
      className="cp-card"
      style={{ padding: 18, display: "grid", gap: 12 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            Notifications
          </h2>
          {unreadCount > 0 && (
            <span
              data-testid="profile-notifications-badge"
              style={{
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 999,
                background: "#d33",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "18px",
                textAlign: "center",
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && markAuditReadAction && (
          <MarkAllReadButton action={markAuditReadAction} />
        )}
      </div>
      {recentAudit.length === 0 ? (
        <div
          style={{
            padding: "12px 4px",
            fontSize: 13,
            color: "var(--cp-text-muted)",
          }}
        >
          No notifications
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {recentAudit.map((entry) => {
            const label = eventLabel(entry.eventType);
            const when = formatRelative(entry.occurredAt);
            const body = entry.reason ? `${label} — ${entry.reason}` : label;
            const inner = (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "var(--cp-surface-soft, var(--cp-surface))",
                  border: "1px solid var(--cp-border)",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--cp-text)" }}>{body}</span>
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>{when}</span>
              </div>
            );
            return (
              <li key={entry.id}>
                {entry.plannedSessionId ? (
                  <Link
                    href={`/app/sessions/start/${entry.plannedSessionId}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
