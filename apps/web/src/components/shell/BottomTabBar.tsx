"use client";

/**
 * BottomTabBar — mobile-only fixed bottom navigation.
 *
 * Four equal-width tabs (Today / Plan / Stats / More). The "More" tab
 * points at /app/settings, the card-grid hub that mirrors the desktop
 * avatar dropdown.
 *
 * Hidden ≥ 769 px via a CSS media query — the TopNav's centred tabs
 * handle desktop. Rendering always happens (SSR-friendly) so the MORE
 * notification dot is testable via renderToStaticMarkup.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

type Tab = {
  href: string;
  label: string;
  testid: string;
  match: (p: string) => boolean;
  icon: ReactNode;
};

const ICON_SIZE = 22;

function IconToday() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  );
}

function IconPlan() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconStats() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 21V10M9 21V4M15 21v-9M21 21V7" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

const TABS: Tab[] = [
  {
    href: "/app",
    label: "Today",
    testid: "bottomtab-today",
    icon: <IconToday />,
    match: (p) => p === "/app" || p.startsWith("/app/sessions"),
  },
  {
    href: "/app/plan",
    label: "Plan",
    testid: "bottomtab-plan",
    icon: <IconPlan />,
    match: (p) =>
      p.startsWith("/app/plan") ||
      p.startsWith("/app/sessions/start") ||
      p.startsWith("/app/log"),
  },
  {
    href: "/app/stats",
    label: "Stats",
    testid: "bottomtab-stats",
    icon: <IconStats />,
    match: (p) => p.startsWith("/app/stats") || p.startsWith("/app/freshness"),
  },
  {
    href: "/app/settings",
    label: "More",
    testid: "bottomtab-more",
    icon: <IconMore />,
    match: (p) =>
      p.startsWith("/app/settings") ||
      p.startsWith("/app/profile") ||
      p.startsWith("/app/recovery") ||
      p.startsWith("/app/races"),
  },
];

export function BottomTabBar({ auditCount = 0 }: { auditCount?: number } = {}) {
  const pathname = usePathname() ?? "/app";

  return (
    <nav
      aria-label="Primary navigation"
      data-testid="bottom-tabbar"
      className="cp-bottom-tabbar"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        background: "var(--cp-bg-elevated)",
        borderTop: "1px solid var(--cp-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Overscroll filler: on iOS rubber-band scroll the fixed nav lifts a
          few px, revealing the page background below it as a dark gap above
          the home indicator. This off-screen elevated strip (top:100%) rides
          up with the nav during the bounce and keeps the bottom edge seamless.
          No layout impact — it overflows the nav and the viewport at rest. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "100%",
          height: 200,
          background: "var(--cp-bg-elevated)",
          pointerEvents: "none",
        }}
      />
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
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              height: 56,
              color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
              textDecoration: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ display: "inline-flex", lineHeight: 0, position: "relative" }}>
              {t.icon}
              {t.testid === "bottomtab-more" && auditCount > 0 && (
                <span
                  data-testid="bottomtab-more-dot"
                  aria-label={`${auditCount} unread notifications`}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -4,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#d33",
                    boxShadow: "0 0 0 2px var(--cp-bg-elevated)",
                  }}
                />
              )}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
