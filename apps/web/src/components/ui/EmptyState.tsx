/**
 * EmptyState — shared empty-card primitive.
 *
 * "Explain what unlocks this card": every empty surface
 * should tell the user the answer ("no data"), the action ("connect
 * Strava"), and the reason ("…with HR streams populate this card") in
 * one short block. This component is the canonical render for that
 * pattern across the app.
 *
 * Two variants:
 *   - card   → full-card replacement, padded, neutral border + tint,
 *              centered text, icon above title, CTA below body.
 *   - inline → compact, no border, sits inside an existing card body
 *              (e.g. the activity list when sessions.length === 0).
 *
 * Pure / server-safe — no client-only hooks, no external deps. Styled
 * with inline `style` + `--cp-*` CSS variables to mirror the rest of
 * the codebase.
 */
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";

export type EmptyStateProps = {
  title: string;
  body: string;
  action?: {
    label: string;
    href: string;
  };
  icon?: ReactNode;
  variant?: "card" | "inline";
};

export function EmptyState({
  title,
  body,
  action,
  icon,
  variant = "card",
}: EmptyStateProps): ReactElement {
  const isCard = variant === "card";

  const containerStyle: React.CSSProperties = isCard
    ? {
        padding: 24,
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        background: "var(--cp-surface-soft, var(--cp-surface))",
        display: "grid",
        gap: 10,
        justifyItems: "center",
        textAlign: "center",
      }
    : {
        padding: 0,
        display: "grid",
        gap: 6,
        justifyItems: "start",
        textAlign: "left",
      };

  return (
    <div
      data-testid="empty-state"
      data-variant={variant}
      style={containerStyle}
    >
      {icon != null && isCard && (
        <div
          data-testid="empty-state-icon"
          aria-hidden="true"
          style={{
            fontSize: 22,
            lineHeight: 1,
            color: "var(--cp-text-muted)",
            marginBottom: 2,
          }}
        >
          {icon}
        </div>
      )}
      <div
        data-testid="empty-state-title"
        style={{
          margin: 0,
          fontSize: isCard ? 15 : 13,
          fontWeight: 700,
          color: "var(--cp-text)",
        }}
      >
        {title}
      </div>
      <p
        data-testid="empty-state-body"
        style={{
          margin: 0,
          fontSize: isCard ? 13 : 12,
          lineHeight: 1.5,
          color: "var(--cp-text-muted)",
          maxWidth: 360,
        }}
      >
        {body}
      </p>
      {action != null && (
        <Link
          href={action.href}
          data-testid="empty-state-action"
          style={{
            marginTop: isCard ? 6 : 2,
            fontSize: isCard ? 13 : 12,
            color: "var(--cp-accent, var(--cp-link))",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
