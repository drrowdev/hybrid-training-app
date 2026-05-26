"use client";

/**
 * TopNav — desktop top navigation bar.
 *
 * Layout (left → centre → right):
 *   1. Brand glyph (big green H) → /app
 *   2. Primary tabs: Today / Plan / Stats / Settings with pill-style active
 *      highlight via usePathname().
 *   3. Status cluster (TopBarRight): Search / sync / bell / avatar.
 *
 * Mobile (≤768 px): primary tabs are hidden via inline display rule on the
 * <nav> wrapper, so the BottomTabBar takes over. Brand + right cluster stay.
 *
 * Inline styles only — global `a { color: var(--cp-link) }` would otherwise
 * paint every link blue and we don't want that here.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  markAuditReadAction,
}: {
  signOutAction: () => Promise<void>;
  displayName: string | null;
  email: string | null;
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
  recentAudit: TopBarAuditEntry[];
  auditCount: number;
  markAuditReadAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const pathname = usePathname() ?? "/app";
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <header
      data-testid="app-topbar"
      aria-label="Primary navigation"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        height: 56,
        background: "var(--cp-bg-elevated)",
        borderBottom: "1px solid var(--cp-border)",
        paddingTop: isMobile ? "env(safe-area-inset-top)" : 0,
        paddingLeft: `max(${isMobile ? 14 : 24}px, env(safe-area-inset-left))`,
        paddingRight: `max(${isMobile ? 14 : 24}px, env(safe-area-inset-right))`,
      }}
    >
      <div
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
          gap: isMobile ? 12 : 24,
        }}
      >
        <Link
          href="/app"
          data-testid="topnav-brand"
          aria-label="Hybrid — home"
          style={{
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--cp-accent)",
            fontWeight: 800,
            fontSize: 24,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            width: 32,
            height: 32,
          }}
        >
          H
        </Link>

      <nav
        aria-label="Primary"
        style={{
          display: isMobile ? "none" : "flex",
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
                fontSize: 14,
                fontWeight: active ? 600 : 500,
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
            recentAudit={recentAudit}
            auditCount={auditCount}
            markAuditReadAction={markAuditReadAction}
          />
        </div>
      </div>
    </header>
  );
}
