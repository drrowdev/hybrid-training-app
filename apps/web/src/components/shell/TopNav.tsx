"use client";

/**
 * TopNav — desktop top navigation bar.
 *
 * Layout (left → centre → right):
 *   1. Brand glyph + wordmark → /app
 *   2. Primary tabs: Today / Plan / Stats / Settings, with active-route
 *      highlighting via usePathname().
 *   3. Status cluster (TopBarRight): Search / sync / bell / avatar.
 *
 * Mobile (≤768 px): primary tabs are hidden (the BottomTabBar takes over);
 * the brand and right cluster remain.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TopBarRight,
  type TopBarAuditEntry,
} from "@/components/shell/TopBarRight";

type Tab = {
  href: string;
  label: string;
  match: (p: string) => boolean;
  testid: string;
};

const TABS: Tab[] = [
  {
    href: "/app",
    label: "Today",
    testid: "topnav-tab-today",
    match: (p) => p === "/app" || p.startsWith("/app/sessions"),
  },
  {
    href: "/app/plan",
    label: "Plan",
    testid: "topnav-tab-plan",
    match: (p) =>
      p.startsWith("/app/plan") ||
      p.startsWith("/app/sessions/start") ||
      p.startsWith("/app/log"),
  },
  {
    href: "/app/stats",
    label: "Stats",
    testid: "topnav-tab-stats",
    match: (p) => p.startsWith("/app/stats") || p.startsWith("/app/freshness"),
  },
  {
    href: "/app/settings",
    label: "Settings",
    testid: "topnav-tab-settings",
    match: (p) => p.startsWith("/app/settings"),
  },
];

export function TopNav({
  signOutAction,
  displayName,
  email,
  hasStravaConnection,
  lastSyncedAt,
  recentAudit,
  auditCount,
}: {
  signOutAction: () => Promise<void>;
  displayName: string | null;
  email: string | null;
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
  recentAudit: TopBarAuditEntry[];
  auditCount: number;
}) {
  const pathname = usePathname() ?? "/app";
  const isActive = (t: Tab) => t.match(pathname);

  return (
    <header
      className="cp-topnav"
      data-testid="app-topbar"
      aria-label="Primary navigation"
    >
      <Link href="/app" className="cp-topnav-brand" data-testid="topnav-brand">
        <span className="cp-topnav-brand-mark" aria-hidden>
          ●
        </span>
        <span className="cp-topnav-brand-name">Hybrid</span>
      </Link>

      <nav className="cp-topnav-tabs" aria-label="Primary">
        {TABS.map((t) => {
          const active = isActive(t);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`cp-topnav-tab${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              data-testid={t.testid}
              data-active={active ? "true" : "false"}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="cp-topnav-right">
        <TopBarRight
          signOutAction={signOutAction}
          displayName={displayName}
          email={email}
          hasStravaConnection={hasStravaConnection}
          lastSyncedAt={lastSyncedAt}
          recentAudit={recentAudit}
          auditCount={auditCount}
        />
      </div>

      <style jsx>{`
        .cp-topnav {
          position: sticky;
          top: 0;
          z-index: 30;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 24px;
          height: 56px;
          padding: 0 24px;
          padding-left: max(24px, env(safe-area-inset-left));
          padding-right: max(24px, env(safe-area-inset-right));
          background: var(--cp-bg-elevated);
          border-bottom: 1px solid var(--cp-border);
        }

        .cp-topnav-brand {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          color: var(--cp-text);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .cp-topnav-brand-mark {
          color: var(--cp-accent);
          font-size: 14px;
          line-height: 1;
        }
        .cp-topnav-brand-name {
          font-size: 15px;
        }

        .cp-topnav-tabs {
          display: flex;
          align-items: stretch;
          justify-content: center;
          gap: 4px;
          height: 100%;
        }
        .cp-topnav-tab {
          position: relative;
          display: inline-flex;
          align-items: center;
          padding: 0 14px;
          height: 100%;
          color: var(--cp-text-muted);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: color 0.12s;
        }
        .cp-topnav-tab:hover {
          color: var(--cp-text);
        }
        .cp-topnav-tab.is-active {
          color: var(--cp-accent);
          font-weight: 600;
        }
        .cp-topnav-tab.is-active::after {
          content: "";
          position: absolute;
          left: 8px;
          right: 8px;
          bottom: -1px;
          height: 2px;
          background: var(--cp-accent);
          border-radius: 2px 2px 0 0;
        }

        .cp-topnav-right {
          display: flex;
          align-items: center;
          justify-self: end;
        }

        /* Hide the centre tabs on mobile — BottomTabBar takes over. */
        @media (max-width: 768px) {
          .cp-topnav {
            grid-template-columns: auto 1fr auto;
            gap: 12px;
            padding: 0 14px;
            padding-top: env(safe-area-inset-top);
            padding-left: max(14px, env(safe-area-inset-left));
            padding-right: max(14px, env(safe-area-inset-right));
          }
          .cp-topnav-tabs {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
