"use client";

import { UndoBanner } from "@/components/trash/UndoBanner";
import type { TopBarAuditEntry } from "@/components/shell/TopBarRight";
import { TopNav } from "@/components/shell/TopNav";
import { BottomTabBar } from "@/components/shell/BottomTabBar";

// Re-export so `/app/layout.tsx` keeps its existing import shape.
export type { TopBarAuditEntry } from "@/components/shell/TopBarRight";

export function AppShell({
  children,
  signOutAction,
  displayName,
  email,
  hasStravaConnection = false,
  lastSyncedAt = null,
  recentAudit = [],
  auditCount = 0,
  markAuditReadAction,
  // `buildSha` is still accepted for backwards-compat with the layout
  // wiring but is no longer rendered (the SHA chip was retired earlier).
}: {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
  displayName?: string | null;
  email?: string | null;
  hasStravaConnection?: boolean;
  lastSyncedAt?: string | null;
  recentAudit?: TopBarAuditEntry[];
  auditCount?: number;
  /** PR Z1 — server action that persists the "mark all read" gesture. */
  markAuditReadAction?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  buildSha?: string;
}) {
  return (
    <div className="cp-shell">
      <TopNav
        signOutAction={signOutAction}
        displayName={displayName ?? null}
        email={email ?? null}
        hasStravaConnection={hasStravaConnection}
        lastSyncedAt={lastSyncedAt}
        recentAudit={recentAudit}
        auditCount={auditCount}
        markAuditReadAction={markAuditReadAction}
      />

      <main className="cp-main">{children}</main>

      <BottomTabBar auditCount={auditCount} />

      <UndoBanner />

      <style jsx global>{`
        .cp-shell {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
        }
        .cp-main {
          flex: 1;
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
          padding: 32px 28px 64px;
          padding-left: max(28px, env(safe-area-inset-left));
          padding-right: max(28px, env(safe-area-inset-right));
          min-width: 0;
        }

        @media (max-width: 768px) {
          .cp-main {
            padding: 20px 16px calc(96px + env(safe-area-inset-bottom));
            padding-left: max(16px, env(safe-area-inset-left));
            padding-right: max(16px, env(safe-area-inset-right));
          }
        }
      `}</style>
    </div>
  );
}
