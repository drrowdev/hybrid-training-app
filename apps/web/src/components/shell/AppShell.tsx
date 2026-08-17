"use client";

import { UndoBanner } from "@/components/trash/UndoBanner";
import { TopNav } from "@/components/shell/TopNav";
import { BottomTabBar } from "@/components/shell/BottomTabBar";

export function AppShell({
  children,
  signOutAction,
  displayName,
  email,
  hapticsEnabled = true,
  // `buildSha` is still accepted for backwards-compat with the layout
  // wiring but is no longer rendered (the SHA chip was retired earlier).
}: {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
  displayName?: string | null;
  email?: string | null;
  hapticsEnabled?: boolean;
  buildSha?: string;
}) {
  return (
    <div className="cp-shell">
      <TopNav
        signOutAction={signOutAction}
        displayName={displayName ?? null}
        email={email ?? null}
      />

      <main className="cp-main">{children}</main>

      <BottomTabBar hapticsEnabled={hapticsEnabled} />

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
