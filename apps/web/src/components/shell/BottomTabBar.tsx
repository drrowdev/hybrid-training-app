"use client";

/**
 * BottomTabBar — mobile-only fixed bottom navigation.
 *
 * Four equal-width tabs (Today / Plan / Stats / More). The "More" tab
 * points at /app/profile, which surfaces the same destinations that the
 * desktop avatar dropdown does.
 *
 * Hidden ≥ 769 px via CSS — the TopNav's centred tabs handle desktop.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Tab = {
  href: string;
  label: string;
  testid: string;
  match: (p: string) => boolean;
  icon: ReactNode;
};

const ICON_SIZE = 24;

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
    href: "/app/profile",
    label: "More",
    testid: "bottomtab-more",
    icon: <IconMore />,
    match: (p) =>
      p.startsWith("/app/profile") ||
      p.startsWith("/app/settings") ||
      p.startsWith("/app/recovery") ||
      p.startsWith("/app/races"),
  },
];

export function BottomTabBar() {
  const pathname = usePathname() ?? "/app";

  return (
    <nav
      className="cp-bottomtabs"
      aria-label="Primary navigation"
      data-testid="bottom-tabbar"
    >
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`cp-bottomtab${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            data-testid={t.testid}
            data-active={active ? "true" : "false"}
          >
            <span className="cp-bottomtab-icon">{t.icon}</span>
            <span className="cp-bottomtab-label">{t.label}</span>
          </Link>
        );
      })}

      <style jsx>{`
        .cp-bottomtabs {
          display: none;
        }

        @media (max-width: 768px) {
          .cp-bottomtabs {
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 40;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            background: var(--cp-bg-elevated);
            border-top: 1px solid var(--cp-border);
            padding-bottom: env(safe-area-inset-bottom);
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
            backdrop-filter: blur(12px);
          }
          .cp-bottomtab {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            height: 56px;
            color: var(--cp-text-muted);
            text-decoration: none;
            -webkit-tap-highlight-color: transparent;
          }
          .cp-bottomtab.is-active {
            color: var(--cp-accent);
          }
          .cp-bottomtab-icon {
            display: inline-flex;
            line-height: 0;
          }
          .cp-bottomtab-label {
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
        }

        @media (min-width: 769px) {
          .cp-bottomtabs {
            display: none;
          }
        }
      `}</style>
    </nav>
  );
}
