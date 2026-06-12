import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  badge?: string | null;
  testId?: string;
};

export function SettingsHubCard({
  href,
  icon,
  title,
  description,
  badge,
  testId,
}: Props) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="settings-hub-card"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "14px 16px",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
        color: "var(--cp-text)",
        textDecoration: "none",
        transition:
          "background 150ms ease-out, border-color 150ms ease-out",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "var(--cp-accent-soft)",
          color: "var(--cp-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "0 0 auto",
        }}
      >
        {icon}
      </span>
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
        <span
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            lineHeight: 1.35,
          }}
        >
          {description}
        </span>
      </span>
      {badge ? (
        <span
          className="mono"
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--cp-text)",
            background: "var(--cp-highlight)",
            border: "1px solid var(--cp-border-strong)",
            borderRadius: 999,
            padding: "3px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
