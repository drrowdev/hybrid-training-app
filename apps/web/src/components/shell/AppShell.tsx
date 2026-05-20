"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = {
  href: string;
  label: string;
  icon: string;
  match?: (p: string) => boolean;
};

const TABS: Tab[] = [
  { href: "/app", label: "Today", icon: "◉", match: (p) => p === "/app" },
  { href: "/app/log", label: "Log", icon: "▮", match: (p) => p.startsWith("/app/log") || p.startsWith("/app/sessions") },
  { href: "/app/plan", label: "Plan", icon: "▦", match: (p) => p.startsWith("/app/plan") },
  { href: "/app/stats", label: "Stats", icon: "▲", match: (p) => p.startsWith("/app/stats") || p.startsWith("/app/freshness") },
  { href: "/app/settings", label: "Settings", icon: "⚙", match: (p) => p.startsWith("/app/settings") },
];

export function AppShell({
  children,
  signOutAction,
  displayName,
  email,
}: {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
  displayName?: string | null;
  email?: string | null;
}) {
  const pathname = usePathname() ?? "/app";
  const isActive = (t: Tab) => (t.match ? t.match(pathname) : pathname.startsWith(t.href));

  return (
    <div className="cp-shell">
      <aside className="cp-sidebar" aria-label="Primary navigation">
        <div className="cp-brand">
          <span className="cp-brand-mark" aria-hidden>◐</span>
          <span className="cp-brand-name">Hybrid</span>
        </div>
        <nav className="cp-nav">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={`cp-nav-link ${isActive(t) ? "is-active" : ""}`}
              aria-current={isActive(t) ? "page" : undefined}
            >
              <span className="cp-nav-icon" aria-hidden>{t.icon}</span>
              <span>{t.label}</span>
            </Link>
          ))}
        </nav>
        <div className="cp-sidebar-foot">
          {displayName || email ? (
            <div className="cp-who">
              <div className="cp-who-name">{displayName ?? "Athlete"}</div>
              {email && <div className="cp-who-mail mono">{email}</div>}
            </div>
          ) : null}
          <ThemeToggle />
          <form action={signOutAction}>
            <button type="submit" className="cp-btn ghost" style={{ width: "100%" }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="cp-main">{children}</main>

      <nav className="cp-tabbar" aria-label="Primary navigation">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`cp-tab ${isActive(t) ? "is-active" : ""}`}
            aria-current={isActive(t) ? "page" : undefined}
          >
            <span className="cp-tab-icon" aria-hidden>{t.icon}</span>
            <span className="cp-tab-label">{t.label}</span>
          </Link>
        ))}
      </nav>

      <InjuryFab />

      <style jsx global>{`
        .cp-shell {
          min-height: 100dvh;
          display: grid;
          grid-template-columns: 240px 1fr;
        }
        .cp-sidebar {
          position: sticky; top: 0;
          height: 100dvh;
          display: flex; flex-direction: column;
          padding: 18px 14px;
          border-right: 1px solid var(--cp-border);
          background: var(--cp-bg-elevated);
          gap: 18px;
        }
        .cp-brand {
          display: flex; align-items: center; gap: 8px;
          padding: 4px 6px 0;
        }
        .cp-brand-mark { color: var(--cp-accent); font-size: 20px; }
        .cp-brand-name { font-weight: 700; letter-spacing: -0.01em; }

        .cp-nav { display: flex; flex-direction: column; gap: 2px; }
        .cp-nav-link {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px;
          border-radius: 10px;
          color: var(--cp-text-muted);
          text-decoration: none;
          font-size: 14px;
          transition: background .12s, color .12s;
        }
        .cp-nav-link:hover { background: var(--cp-surface-soft); color: var(--cp-text); }
        .cp-nav-link.is-active {
          background: var(--cp-accent-soft);
          color: var(--cp-accent);
          font-weight: 600;
        }
        .cp-nav-icon { width: 18px; text-align: center; font-size: 14px; }

        .cp-sidebar-foot { margin-top: auto; display: flex; flex-direction: column; gap: 10px; }
        .cp-who { padding: 8px 4px; border-top: 1px solid var(--cp-border); }
        .cp-who-name { font-size: 13px; font-weight: 600; }
        .cp-who-mail { font-size: 10px; color: var(--cp-text-muted); margin-top: 2px; word-break: break-all; }

        .cp-main {
          min-width: 0;
          padding: 24px 28px 80px;
          max-width: 1100px;
          width: 100%;
        }

        .cp-tabbar { display: none; }

        @media (max-width: 900px) {
          .cp-shell { grid-template-columns: 1fr; }
          .cp-sidebar { display: none; }
          .cp-main {
            padding: 16px 16px calc(72px + env(safe-area-inset-bottom));
          }
          .cp-tabbar {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            position: fixed; left: 0; right: 0; bottom: 0;
            z-index: 40;
            background: var(--cp-panel-strong);
            backdrop-filter: blur(12px);
            border-top: 1px solid var(--cp-border);
            padding-bottom: env(safe-area-inset-bottom);
          }
          .cp-tab {
            display: flex; flex-direction: column; align-items: center; gap: 2px;
            padding: 8px 4px 10px;
            color: var(--cp-text-muted);
            text-decoration: none;
            font-size: 10px;
          }
          .cp-tab.is-active { color: var(--cp-accent); }
          .cp-tab-icon { font-size: 18px; line-height: 1; }
          .cp-tab-label { letter-spacing: 0.02em; }
        }
      `}</style>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");
  }, []);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("cp-theme", next); } catch {}
    setTheme(next);
  };
  return (
    <button type="button" onClick={flip} className="cp-btn ghost" style={{ width: "100%" }}>
      {theme === "dark" ? "◑ Light" : "◐ Dark"}
    </button>
  );
}

function InjuryFab() {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Log an injury or limitation"
      title="Log an injury or limitation"
      onClick={() => router.push("/app/settings/limitations")}
      className="cp-fab"
    >
      <span aria-hidden>＋</span>
      <style jsx>{`
        .cp-fab {
          position: fixed;
          right: 18px;
          bottom: calc(86px + env(safe-area-inset-bottom));
          width: 52px; height: 52px;
          border-radius: 50%;
          background: var(--cp-accent);
          color: var(--cp-accent-fg);
          border: none;
          font-size: 24px; font-weight: 600;
          box-shadow: var(--cp-shadow);
          cursor: pointer;
          z-index: 30;
          transition: transform .12s, background .12s;
        }
        .cp-fab:hover { background: var(--cp-accent-hover); transform: scale(1.04); }
        @media (min-width: 901px) {
          .cp-fab { bottom: 24px; right: 24px; }
        }
      `}</style>
    </button>
  );
}
