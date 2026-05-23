"use client";

/**
 * TopBarRight — status cluster for the /app top bar.
 *
 * Renders, left → right:
 *   1. ⌘K / Ctrl K hint chip (clicking opens the palette).
 *   2. Strava sync indicator (dot + label). Hidden when the user has
 *      no `strava_connections` row.
 *   3. Notifications bell with unread badge + popover listing the most
 *      recent engine-override audit entries.
 *   4. Build SHA chip (first 7 chars). Hidden on small screens.
 *   5. User-initials avatar with a Profile / Sign out dropdown.
 *
 * All visuals lean on the existing `--cp-*` CSS variable tokens so the
 * cluster picks up theme changes for free. No new npm deps.
 */

import Link from "next/link";
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

export function TopBarRight({
  signOutAction,
  displayName,
  email,
  hasStravaConnection,
  lastSyncedAt,
  recentAudit,
  auditCount,
  buildSha,
}: {
  signOutAction: () => Promise<void>;
  displayName: string | null;
  email: string | null;
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
  recentAudit: TopBarAuditEntry[];
  auditCount: number;
  buildSha: string;
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

  // Local "mark all read" — optimistic only, persistence is a follow-up.
  const [unread, setUnread] = useState<number>(auditCount);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resync local optimistic count when the server prop changes (e.g. route revalidation)
    setUnread(auditCount);
  }, [auditCount]);

  const initials = initialsFrom(displayName, email);
  const shaShort =
    (buildSha || "dev").slice(0, 7) || "dev";

  return (
    <div className="cp-topbar-right">
      {/* 1. ⌘K hint chip */}
      <button
        type="button"
        data-testid="topbar-cmdk"
        className="cp-tbr-chip cp-tbr-cmdk"
        onClick={() => palette.open()}
        aria-label="Open quick-jump palette"
        title="Open quick-jump palette"
      >
        <kbd className="cp-tbr-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
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
        >
          <span
            aria-hidden
            className="cp-tbr-dot"
            style={{ background: syncDotColor }}
          />
          <span className="cp-tbr-sync-label">{syncLabel}</span>
        </div>
      )}

      {/* 3. Notifications bell */}
      <details className="cp-tbr-pop" data-testid="topbar-bell-wrap">
        <summary
          className="cp-tbr-bell"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          data-testid="topbar-bell"
        >
          <span aria-hidden>🔔</span>
          {unread > 0 && (
            <span className="cp-tbr-badge" data-testid="topbar-bell-badge">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </summary>
        <div
          className="cp-tbr-pop-panel"
          role="dialog"
          aria-label="Recent notifications"
          data-testid="topbar-bell-panel"
        >
          <div className="cp-tbr-pop-head">Recent activity</div>
          {recentAudit.length === 0 ? (
            <div className="cp-tbr-pop-empty">No notifications</div>
          ) : (
            <ul className="cp-tbr-pop-list">
              {recentAudit.map((entry) => {
                const label = eventLabel(entry.eventType);
                const when = formatRelative(entry.occurredAt);
                const body = entry.reason ? `${label} — ${entry.reason}` : label;
                if (entry.plannedSessionId) {
                  return (
                    <li key={entry.id}>
                      <Link
                        href={`/app/sessions/start/${entry.plannedSessionId}`}
                        className="cp-tbr-pop-item"
                      >
                        <span className="cp-tbr-pop-item-title">{body}</span>
                        <span className="cp-tbr-pop-item-when">{when}</span>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={entry.id}>
                    <div className="cp-tbr-pop-item">
                      <span className="cp-tbr-pop-item-title">{body}</span>
                      <span className="cp-tbr-pop-item-when">{when}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="cp-tbr-pop-mark"
            data-testid="topbar-bell-mark-read"
            onClick={() => setUnread(0)}
          >
            Mark all read
          </button>
        </div>
      </details>

      {/* 4. Build SHA */}
      <span
        className="cp-tbr-build mono"
        data-testid="topbar-build"
        title={`Build ${shaShort}`}
      >
        {shaShort}
      </span>

      {/* 5. User-initials avatar + dropdown */}
      <details className="cp-tbr-pop cp-tbr-user" data-testid="topbar-user-wrap">
        <summary
          className="cp-tbr-avatar"
          aria-label="Account menu"
          data-testid="topbar-avatar"
        >
          {initials}
        </summary>
        <div
          className="cp-tbr-pop-panel cp-tbr-pop-panel--user"
          role="menu"
          data-testid="topbar-user-menu"
        >
          {(displayName || email) && (
            <div className="cp-tbr-user-head">
              {displayName && <div className="cp-tbr-user-name">{displayName}</div>}
              {email && <div className="cp-tbr-user-mail mono">{email}</div>}
            </div>
          )}
          <Link
            href="/app/profile"
            className="cp-tbr-pop-item"
            role="menuitem"
            data-testid="topbar-user-profile"
          >
            Profile
          </Link>
          <Link
            href="/app/races"
            className="cp-tbr-pop-item"
            role="menuitem"
            data-testid="topbar-user-events"
          >
            Events
          </Link>
          <Link
            href="/app/settings"
            className="cp-tbr-pop-item"
            role="menuitem"
            data-testid="topbar-user-settings"
          >
            Settings
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              data-testid="topbar-sign-out-button"
              role="menuitem"
              className="cp-tbr-pop-item cp-tbr-pop-item--btn"
            >
              Sign out
            </button>
          </form>
        </div>
      </details>

      <style jsx>{`
        .cp-topbar-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .cp-tbr-chip,
        .cp-tbr-sync,
        .cp-tbr-build {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid var(--cp-border);
          background: var(--cp-surface-soft);
          color: var(--cp-text-muted);
          font-size: 12px;
          line-height: 1;
        }
        .cp-tbr-chip {
          cursor: pointer;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
        }
        .cp-tbr-chip:hover {
          color: var(--cp-text);
          border-color: var(--cp-text-muted);
        }
        .cp-tbr-kbd {
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .cp-tbr-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        .cp-tbr-sync-label {
          font-weight: 500;
        }
        .cp-tbr-build {
          font-size: 11px;
          letter-spacing: 0.02em;
        }

        /* Bell + avatar share the <details>/<summary> popover pattern. */
        .cp-tbr-pop {
          position: relative;
        }
        .cp-tbr-pop > summary {
          list-style: none;
          cursor: pointer;
        }
        .cp-tbr-pop > summary::-webkit-details-marker {
          display: none;
        }
        .cp-tbr-bell {
          position: relative;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          color: var(--cp-text);
          background: transparent;
          border: 1px solid transparent;
          transition: background 0.12s, border-color 0.12s;
        }
        .cp-tbr-bell:hover {
          background: var(--cp-surface-soft);
          border-color: var(--cp-border);
        }
        .cp-tbr-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 999px;
          background: #d33;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          line-height: 16px;
          text-align: center;
          box-shadow: 0 0 0 2px var(--cp-bg-elevated);
        }
        .cp-tbr-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--cp-accent-soft);
          color: var(--cp-accent);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--cp-border);
        }
        .cp-tbr-avatar:hover {
          filter: brightness(1.05);
        }

        .cp-tbr-pop-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 260px;
          max-width: 320px;
          background: var(--cp-bg-elevated);
          border: 1px solid var(--cp-border);
          border-radius: 12px;
          box-shadow: var(--cp-shadow);
          padding: 8px;
          z-index: 50;
        }
        .cp-tbr-pop-panel--user {
          min-width: 220px;
        }
        .cp-tbr-pop-head {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--cp-text-muted);
          padding: 6px 8px;
        }
        .cp-tbr-pop-empty {
          padding: 14px 8px;
          font-size: 13px;
          color: var(--cp-text-muted);
          text-align: center;
        }
        .cp-tbr-pop-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .cp-tbr-pop-item {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--cp-text);
          text-decoration: none;
          border-radius: 8px;
          background: transparent;
          border: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .cp-tbr-pop-item:hover {
          background: var(--cp-surface-soft);
        }
        .cp-tbr-pop-item--btn {
          color: var(--cp-text);
        }
        .cp-tbr-pop-item-title {
          font-size: 13px;
        }
        .cp-tbr-pop-item-when {
          font-size: 11px;
          color: var(--cp-text-muted);
        }
        .cp-tbr-pop-mark {
          margin-top: 4px;
          width: 100%;
          background: transparent;
          border: none;
          padding: 8px;
          font-size: 12px;
          color: var(--cp-accent);
          cursor: pointer;
          border-top: 1px solid var(--cp-border);
          border-radius: 0 0 12px 12px;
        }
        .cp-tbr-pop-mark:hover {
          background: var(--cp-surface-soft);
        }
        .cp-tbr-user-head {
          padding: 6px 8px 8px;
          border-bottom: 1px solid var(--cp-border);
          margin-bottom: 4px;
        }
        .cp-tbr-user-name {
          font-size: 13px;
          font-weight: 600;
        }
        .cp-tbr-user-mail {
          font-size: 10px;
          color: var(--cp-text-muted);
          margin-top: 2px;
          word-break: break-all;
        }

        /* Responsive: hide ⌘K hint < 640px and build SHA < 768px. */
        @media (max-width: 639px) {
          .cp-tbr-cmdk {
            display: none;
          }
        }
        @media (max-width: 767px) {
          .cp-tbr-build {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
