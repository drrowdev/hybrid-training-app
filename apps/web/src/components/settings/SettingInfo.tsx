/**
 * SettingInfo — the "?" disclosure beside a setting card's title.
 *
 * Supplementary detail only. Anything a user needs in order to CHOOSE stays
 * on screen (e.g. the year ranges on the experience tiers); this is for the
 * "how does this actually work" copy that used to sit as an always-on
 * paragraph above every control and made each group twice as tall.
 *
 * Built on a native `<details>` so it needs no client JS and the page stays a
 * server component.
 */
import type { ReactNode } from "react";

export type SettingInfoProps = {
  /** Accessible label, e.g. "How training experience works". */
  label: string;
  testId?: string;
  children: ReactNode;
};

export function SettingInfo({ label, testId, children }: SettingInfoProps) {
  return (
    <details
      className="cp-setting-info"
      data-testid={testId}
      style={{ position: "relative" }}
    >
      <summary
        aria-label={label}
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 999,
          border: "1px solid var(--cp-border-strong)",
          color: "var(--cp-text-muted)",
          fontSize: 11,
          lineHeight: 1,
          cursor: "pointer",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        ?
      </summary>
      <p
        style={{
          margin: "10px 0 0",
          fontSize: 12,
          lineHeight: 1.6,
          color: "var(--cp-text-muted)",
        }}
      >
        {children}
      </p>
      {/* Cross-browser hide of the native disclosure marker. */}
      <style>{`
        details.cp-setting-info > summary::-webkit-details-marker { display: none; }
        details.cp-setting-info > summary::marker { content: ""; }
        details.cp-setting-info > summary:hover { color: var(--cp-text); border-color: var(--cp-accent); }
      `}</style>
    </details>
  );
}
