"use client";

/**
 * TopNav — desktop top navigation bar.
 *
 * Layout (left → centre → right):
 *   1. Brand wordmark (S×C, green ×) → /app
 *   2. Primary tabs: Today / Plan / Stats / Settings with pill-style active
 *      highlight via usePathname().
 *   3. Status cluster (TopBarRight): Search / sync / avatar.
 *
 * Mobile (≤768 px): primary tabs, brand wordmark, and the right cluster
 * are all hidden via CSS so the BottomTabBar + Today-page header take
 * over. The header itself stays sticky for the safe-area inset and
 * the brand link remains in the DOM for screen-readers.
 *
 * Inline styles only — the global `a { color: var(--cp-text-muted) }` rule
 * would otherwise repaint these links and we don't want that here.
 */

import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { usePathname } from "next/navigation";
import { TopBarRight } from "@/components/shell/TopBarRight";

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
}: {
  signOutAction: () => Promise<void>;
  displayName: string | null;
  email: string | null;
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
}) {
  const pathname = usePathname() ?? "/app";

  return (
    <header
      data-testid="app-topbar"
      aria-label="Primary navigation"
      className="cp-topbar"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        height: 56,
        background: "var(--cp-bg-elevated)",
        borderBottom: "1px solid var(--cp-border)",
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "max(14px, env(safe-area-inset-left))",
        paddingRight: "max(14px, env(safe-area-inset-right))",
      }}
    >
      <div
        className="cp-topbar-inner"
        style={{
          // Constrain nav contents to the same max-width as the page
          // content (1120px on .cp-main) so the brand on the left and
          // the right cluster visually align with the column edges
          // instead of sticking to the screen edges.
          maxWidth: 1120,
          margin: "0 auto",
          height: "100%",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href="/app"
          data-testid="topnav-brand"
          aria-label="SxC — home"
          className="cp-topnav-brand"
          style={{
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
          }}
        >
          <BrandMark size={30} />
        </Link>

      <nav
        aria-label="Primary"
        className="cp-topnav-tabs"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          height: "100%",
        }}
      >
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link
              key={t.href}
              href={t.href}
              data-testid={t.testid}
              data-active={active ? "true" : "false"}
              aria-current={active ? "page" : undefined}
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 14px",
                borderRadius: 999,
                fontFamily: "var(--cp-font-mono)",
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
                background: active ? "var(--cp-accent-soft)" : "transparent",
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.color =
                    "var(--cp-text)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.color =
                    "var(--cp-text-muted)";
                }
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

        <div
          data-testid="topbar-right-wrap"
          className="cp-topbar-right-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            justifySelf: "end",
          }}
        >
          <TopBarRight
            signOutAction={signOutAction}
            displayName={displayName}
            email={email}
            hasStravaConnection={hasStravaConnection}
            lastSyncedAt={lastSyncedAt}
          />
        </div>
      </div>
    </header>
  );
}
