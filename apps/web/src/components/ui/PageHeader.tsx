/**
 * PageHeader — the canonical page title block.
 *
 * Standardises the heading treatment that had drifted across routes
 * (Today used an eyebrow + bold H1, Stats a light H1 + subtitle, Settings
 * subpages a bold centered H1, etc.). One shape everywhere:
 *
 *   [← Back]                     (optional, quiet)
 *   EYEBROW                      (optional, uppercase muted)
 *   Title                        (H1, 28/700)
 *   Subtitle copy                (optional, muted)   [actions →]
 *
 * Server-safe — inline `--cp-*` styles, no client hooks.
 */
import type { ReactElement, ReactNode } from "react";
import { BackLink } from "./BackLink";

export type PageHeaderProps = {
  title: ReactNode;
  /** Small uppercase context line above the title. */
  eyebrow?: ReactNode;
  /** Muted description below the title. */
  subtitle?: ReactNode;
  /** Right-aligned controls (range toggles, primary buttons). */
  actions?: ReactNode;
  /** Quiet back-link rendered above the eyebrow. */
  back?: { href: string; label: string };
  /** Optional data-testid applied to the <h1> (preserve a page's old heading testid). */
  titleTestId?: string;
};

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  back,
  titleTestId,
}: PageHeaderProps): ReactElement {
  return (
    <header style={{ marginBottom: 24 }} data-testid="page-header">
      {back != null && <BackLink href={back.href} label={back.label} />}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          {eyebrow != null && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--cp-text-muted)",
              }}
            >
              {eyebrow}
            </div>
          )}
          <h1
            data-testid={titleTestId}
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              color: "var(--cp-text)",
            }}
          >
            {title}
          </h1>
          {subtitle != null && (
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 14,
                lineHeight: 1.5,
                color: "var(--cp-text-muted)",
                maxWidth: 640,
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions != null && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
