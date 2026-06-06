"use client";

/**
 * TopBarRight — status cluster for the /app top bar.
 *
 * Renders, left → right:
 *   1. Search button (magnifier + label + ⌘K/Ctrl K kbd chip). Clicking
 *      opens the quick-jump palette.
 *   2. Strava sync indicator (dot + label). Hidden when the user has
 *      no `strava_connections` row.
 *   3. Notifications bell with unread badge + popover listing the most
 *      recent engine-override audit entries.
 *   4. User-initials avatar with a Settings / Account & data / Sign out
 *      dropdown. (Profile / Limitations / Events live under the
 *      settings hub now — one click from Settings.)
 *
 * Styling: inline `style={{}}` objects + `var(--cp-*)` tokens, matching
 * the project convention (see PlanRedesign / SettingsHubCard). A handful
 * of rules that can't be inlined — the native `<details>` marker hide,
 * the < 640px responsive collapse of the search label, and an override
 * for the global `a { color: var(--cp-text-muted) }` rule — live in
 * `globals.css` under the `.cp-tbr-*` namespace.
 */

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useCommandPalette } from "@/components/cmd-k/CommandPaletteProvider";

export type TopBarAuditEntry = {
  id: string;
  eventType: string;
  occurredAt: string;
  plannedSessionId: string | null;
  reason: string | null;
};

type SyncState = "fresh" | "stale";

function computeSyncState(lastSyncedAt: string | null): SyncState {
  if (!lastSyncedAt) return "stale";
  const ts = Date.parse(lastSyncedAt);
  if (!Number.isFinite(ts)) return "stale";
  const ageMs = Date.now() - ts;
  // Spec: < 24h → "Up to date", otherwise "Stale".
  return ageMs <= 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

function initialsFrom(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  if (source.includes("@")) {
    // Email — use the first two alphanumerics of the local-part.
    const local = source.split("@")[0] ?? "";
    const letters = local.replace(/[^a-z0-9]/gi, "");
    return (letters.slice(0, 2) || local.slice(0, 2) || "?").toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

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

// Shared shapes — pulled out so the avatar / bell / search buttons share
// the same baseline geometry and the popover items match across the
// notifications panel and the user menu.
const styles = {
  root: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  searchBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 30,
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid var(--cp-border)",
    background: "transparent",
    color: "var(--cp-text-muted)",
    fontSize: 13,
    lineHeight: 1,
    cursor: "pointer",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
    font: "inherit",
  },
  sync: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 30,
    padding: "0 10px",
    borderRadius: 8,
    border: "1px solid var(--cp-border)",
    background: "transparent",
    color: "var(--cp-text-muted)",
    fontSize: 13,
    lineHeight: 1,
  },
  kbd: {
    fontFamily: "var(--font-mono, Consolas, monospace)",
    fontSize: 10,
    padding: "2px 5px",
    background: "var(--cp-surface-soft)",
    borderRadius: 4,
    border: "1px solid var(--cp-border)",
    color: "var(--cp-text-muted)",
    letterSpacing: "0.02em",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  syncLabel: { fontWeight: 500 },
  popWrap: { position: "relative" },
  summary: { listStyle: "none", cursor: "pointer" },
  bell: {
    position: "relative",
    width: 32,
    height: 32,
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    color: "var(--cp-text)",
    background: "transparent",
    border: "1px solid transparent",
    transition: "background 0.12s, border-color 0.12s",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    padding: "0 4px",
    borderRadius: 999,
    background: "#d33",
    color: "#fff",
    fontSize: 10,
    fontWeight: 700,
    lineHeight: "16px",
    textAlign: "center",
    boxShadow: "0 0 0 2px var(--cp-bg-elevated)",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "var(--cp-accent-soft)",
    color: "var(--cp-accent)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.02em",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--cp-border)",
    listStyle: "none",
    cursor: "pointer",
  },
  popPanel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: 260,
    maxWidth: 320,
    background: "var(--cp-bg-elevated)",
    border: "1px solid var(--cp-border)",
    borderRadius: 12,
    boxShadow: "var(--cp-shadow)",
    padding: 8,
    zIndex: 50,
  },
  popPanelUser: {
    minWidth: 220,
    maxWidth: 320,
  },
  popHead: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--cp-text-muted)",
    padding: "6px 8px",
  },
  popEmpty: {
    padding: "14px 8px",
    fontSize: 13,
    color: "var(--cp-text-muted)",
    textAlign: "center",
  },
  popList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
  },
  popItem: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "8px 10px",
    fontSize: 13,
    color: "var(--cp-text)",
    textDecoration: "none",
    borderRadius: 8,
    background: "transparent",
    border: "none",
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
  },
  popItemTitle: { fontSize: 13 },
  popItemWhen: { fontSize: 11, color: "var(--cp-text-muted)" },
  popMark: {
    marginTop: 4,
    width: "100%",
    background: "transparent",
    border: "none",
    padding: 8,
    fontSize: 12,
    color: "var(--cp-accent)",
    cursor: "pointer",
    borderTop: "1px solid var(--cp-border)",
    borderRadius: "0 0 12px 12px",
  },
  userHead: {
    padding: "6px 8px 8px",
    borderBottom: "1px solid var(--cp-border)",
    marginBottom: 4,
  },
  userName: { fontSize: 13, fontWeight: 600 },
  userMail: {
    fontSize: 10,
    color: "var(--cp-text-muted)",
    marginTop: 2,
    wordBreak: "break-all",
  },
} satisfies Record<string, CSSProperties>;

// Hover affordances — inline styles can't express :hover, so we
// flip a tiny piece of local state on enter/leave and merge an
// override style. Mirrors how PlanRedesign / SettingsHubCard do it.
function useHover(): readonly [
  boolean,
  { onMouseEnter: () => void; onMouseLeave: () => void },
] {
  const [hover, setHover] = useState(false);
  return [
    hover,
    {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  ] as const;
}

function PopItemLink({
  href,
  testId,
  children,
}: {
  href: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const [hover, hoverProps] = useHover();
  return (
    <Link
      href={href}
      role="menuitem"
      data-testid={testId}
      className="cp-tbr-pop-item"
      style={{
        ...styles.popItem,
        background: hover ? "var(--cp-surface-soft)" : "transparent",
      }}
      {...hoverProps}
    >
      {children}
    </Link>
  );
}

function AuditItemLink({
  href,
  body,
  when,
}: {
  href: string;
  body: string;
  when: string;
}) {
  const [hover, hoverProps] = useHover();
  return (
    <Link
      href={href}
      className="cp-tbr-pop-item"
      style={{
        ...styles.popItem,
        background: hover ? "var(--cp-surface-soft)" : "transparent",
      }}
      {...hoverProps}
    >
      <span style={styles.popItemTitle}>{body}</span>
      <span style={styles.popItemWhen}>{when}</span>
    </Link>
  );
}

export function TopBarRight({
  signOutAction,
  displayName,
  email,
  hasStravaConnection,
  lastSyncedAt,
  recentAudit,
  auditCount,
  markAuditReadAction,
  // `buildSha` is still accepted for backwards-compat with AppShell and
  // the /app layout's env wiring, but the SHA chip itself is no longer
  // rendered. The prop is intentionally not destructured.
}: {
  signOutAction: () => Promise<void>;
  displayName: string | null;
  email: string | null;
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
  recentAudit: TopBarAuditEntry[];
  auditCount: number;
  /** PR Z1 — persists the "mark all read" gesture cross-device. */
  markAuditReadAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  buildSha?: string;
}) {
  const palette = useCommandPalette();

  // OS detection runs after mount so SSR + client output match — avoid
  // a hydration mismatch from `navigator.platform` reading on the
  // server. Default to the Mac glyph (matches the most common dev box).
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-shot platform detection after mount to avoid SSR/CSR hydration mismatch */
    try {
      const p =
        (typeof navigator !== "undefined" &&
          (navigator.platform || navigator.userAgent)) ||
        "";
      setIsMac(/Mac|iPhone|iPad|iPod/i.test(p));
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Fall back to the default.
    }
  }, []);

  const syncState = useMemo(
    () => computeSyncState(lastSyncedAt),
    [lastSyncedAt],
  );
  const syncLabel = syncState === "fresh" ? "Up to date" : "Stale";
  const syncDotColor =
    syncState === "fresh" ? "var(--cp-accent)" : "var(--cp-text-muted)";

  // PR Z1 — "mark all read" persists to `profiles.audit_last_read_at`
  // via `markAuditReadAction`. Local state is updated optimistically;
  // on server failure we restore the previous count so the badge
  // doesn't lie to the user.
  const [unread, setUnread] = useState<number>(auditCount);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync local optimistic count when the server prop changes (e.g. route revalidation)
    setUnread(auditCount);
  }, [auditCount]);

  const onMarkRead = () => {
    const prev = unread;
    setUnread(0);
    if (!markAuditReadAction) return;
    void markAuditReadAction().then((res) => {
      if (!res?.ok) setUnread(prev);
    });
  };

  const initials = initialsFrom(displayName, email);

  // Local hover state for the discrete top-bar controls.
  const [searchHover, searchHoverProps] = useHover();
  const [bellHover, bellHoverProps] = useHover();
  const [avatarHover, avatarHoverProps] = useHover();
  const [markHover, markHoverProps] = useHover();
  const [signOutHover, signOutHoverProps] = useHover();

  return (
    <div className="cp-topbar-right" style={styles.root}>
      {/* 1. Search button — magnifier + label + kbd chip */}
      <button
        type="button"
        data-testid="topbar-cmdk"
        className="cp-tbr-search cp-tbr-cmdk"
        onClick={() => palette.open()}
        aria-label="Open quick-jump palette"
        title="Open quick-jump palette"
        style={{
          ...styles.searchBtn,
          color: searchHover ? "var(--cp-text)" : "var(--cp-text-muted)",
          borderColor: searchHover
            ? "var(--cp-border-strong, var(--cp-text-muted))"
            : "var(--cp-border)",
        }}
        {...searchHoverProps}
      >
        <svg
          aria-hidden
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="cp-tbr-search-label" style={{ fontSize: 13 }}>
          Search
        </span>
        <kbd className="cp-tbr-kbd" style={styles.kbd}>
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {/* 2. Sync indicator */}
      {hasStravaConnection && (
        <div
          className="cp-tbr-sync"
          data-testid="topbar-sync"
          data-state={syncState}
          title={
            lastSyncedAt
              ? `Last sync ${formatRelative(lastSyncedAt)}`
              : "Never synced"
          }
          style={styles.sync}
        >
          <span
            aria-hidden
            style={{ ...styles.dot, background: syncDotColor }}
          />
          <span style={styles.syncLabel}>{syncLabel}</span>
        </div>
      )}

      {/* 3. Notifications bell */}
      <details
        className="cp-tbr-pop"
        data-testid="topbar-bell-wrap"
        style={styles.popWrap}
      >
        <summary
          className="cp-tbr-bell"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          data-testid="topbar-bell"
          style={{
            ...styles.summary,
            ...styles.bell,
            background: bellHover ? "var(--cp-surface-soft)" : "transparent",
            borderColor: bellHover ? "var(--cp-border)" : "transparent",
          }}
          {...bellHoverProps}
        >
          <span aria-hidden>🔔</span>
          {unread > 0 && (
            <span data-testid="topbar-bell-badge" style={styles.badge}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </summary>
        <div
          role="dialog"
          aria-label="Recent notifications"
          data-testid="topbar-bell-panel"
          style={styles.popPanel}
        >
          <div style={styles.popHead}>Recent activity</div>
          {recentAudit.length === 0 ? (
            <div style={styles.popEmpty}>No notifications</div>
          ) : (
            <ul style={styles.popList}>
              {recentAudit.map((entry) => {
                const label = eventLabel(entry.eventType);
                const when = formatRelative(entry.occurredAt);
                const body = entry.reason ? `${label} — ${entry.reason}` : label;
                if (entry.plannedSessionId) {
                  return (
                    <li key={entry.id}>
                      <AuditItemLink
                        href={`/app/sessions/start/${entry.plannedSessionId}`}
                        body={body}
                        when={when}
                      />
                    </li>
                  );
                }
                return (
                  <li key={entry.id}>
                    <div style={styles.popItem}>
                      <span style={styles.popItemTitle}>{body}</span>
                      <span style={styles.popItemWhen}>{when}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            data-testid="topbar-bell-mark-read"
            onClick={onMarkRead}
            style={{
              ...styles.popMark,
              background: markHover ? "var(--cp-surface-soft)" : "transparent",
            }}
            {...markHoverProps}
          >
            Mark all read
          </button>
        </div>
      </details>

      {/* 4. User-initials avatar + dropdown */}
      <details
        className="cp-tbr-pop cp-tbr-user"
        data-testid="topbar-user-wrap"
        style={styles.popWrap}
      >
        <summary
          className="cp-tbr-avatar"
          aria-label="Account menu"
          data-testid="topbar-avatar"
          style={{
            ...styles.summary,
            ...styles.avatar,
            filter: avatarHover ? "brightness(1.05)" : undefined,
          }}
          {...avatarHoverProps}
        >
          {initials}
        </summary>
        <div
          role="menu"
          data-testid="topbar-user-menu"
          style={{ ...styles.popPanel, ...styles.popPanelUser }}
        >
          {(displayName || email) && (
            <div style={styles.userHead}>
              {displayName && (
                <div style={styles.userName}>{displayName}</div>
              )}
              {email && (
                <div className="mono" style={styles.userMail}>
                  {email}
                </div>
              )}
            </div>
          )}
          <PopItemLink
            href="/app/settings"
            testId="topbar-user-settings"
          >
            Settings
          </PopItemLink>
          <PopItemLink
            href="/app/settings/account"
            testId="topbar-user-account"
          >
            Account &amp; data
          </PopItemLink>
          <form action={signOutAction}>
            <button
              type="submit"
              data-testid="topbar-sign-out-button"
              role="menuitem"
              className="cp-tbr-pop-item"
              style={{
                ...styles.popItem,
                color: "var(--cp-text)",
                background: signOutHover
                  ? "var(--cp-surface-soft)"
                  : "transparent",
              }}
              {...signOutHoverProps}
            >
              Sign out
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
