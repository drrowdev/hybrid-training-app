/**
 * Onboarding shell — minimal layout for /onboarding.
 *
 * Deliberately differs from /app/**: no AppShell, no main nav, no bottom
 * tab bar, no side rail. Just a centred container so the multi-step
 * wizard can own the full viewport. Theme bootstrap + fonts come from
 * the root layout one level up.
 */
import type { ReactNode } from "react";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        background: "var(--cp-bg)",
        color: "var(--cp-text)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "24px 16px 64px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 880 }}>{children}</div>
      </main>
    </div>
  );
}
