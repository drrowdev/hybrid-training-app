/**
 * SettingCard — the always-open card used by the training-profile page.
 *
 * Replaces the collapsible `SettingsGroup` on that page. The accordions hid
 * three of four settings behind a click and rendered the current value as the
 * smallest, dimmest text on the screen; this inverts that — the value is the
 * loudest element and nothing needs opening.
 *
 * Shape:
 *
 *   EYEBROW              (what this affects, mono uppercase)
 *   Title            [?] (muted, display font)
 *   Current value        (large, display font)
 *   <control>
 *
 * Server-safe: inline `--cp-*` styles, no client hooks. The optional `info`
 * slot takes the client-side `SettingInfo` disclosure.
 */
import type { CSSProperties, ReactNode } from "react";

export type SettingCardProps = {
  /** Small uppercase kicker naming what the setting affects. */
  eyebrow: string;
  title: string;
  /** The current value, rendered as the card's headline. */
  value: string;
  /** Optional "?" disclosure rendered beside the title. */
  info?: ReactNode;
  testId?: string;
  /** Anchor id so `/app/settings/profile#experience` still deep-links. */
  id?: string;
  children: ReactNode;
};

const CARD: CSSProperties = {
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  background: "var(--cp-surface)",
  padding: 18,
  display: "grid",
  gap: 14,
  alignContent: "start",
  minWidth: 0,
};

export function SettingCard({
  eyebrow,
  title,
  value,
  info,
  testId,
  id,
  children,
}: SettingCardProps) {
  return (
    <section id={id} data-testid={testId} style={CARD}>
      <header style={{ display: "grid", gap: 6 }}>
        <div
          style={{
            fontFamily: "var(--cp-font-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--cp-text-muted)",
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--cp-font-display)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--cp-text-muted)",
            }}
          >
            {title}
          </h2>
          {info}
        </div>
        <div
          data-testid={testId ? `${testId}-value` : undefined}
          style={{
            fontFamily: "var(--cp-font-display)",
            fontSize: 26,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "0.01em",
            color: "var(--cp-text)",
          }}
        >
          {value}
        </div>
      </header>
      {children}
    </section>
  );
}

/** Muted caption for a soft warning (e.g. an undeclared value). */
export function SettingNote({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 11.5,
        lineHeight: 1.5,
        color: "var(--cp-warning)",
      }}
    >
      {children}
    </p>
  );
}
