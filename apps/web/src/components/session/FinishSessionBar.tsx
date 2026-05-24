"use client";

/**
 * Finish-session CTA, rendered in two places:
 *
 *   - `variant="bottom"` — full-width sticky bar at the bottom of the
 *     session detail page (the original `cp-stickybar`).
 *   - `variant="banner"` — compact pill embedded in the
 *     "Session in progress" status banner.
 *
 * Both render a single `<Link href="/app/sessions/:id/complete">` so
 * there's exactly one canonical destination — only the chrome differs.
 *
 * `disabled` is enforced both visually and via aria-disabled. Next's
 * `<Link>` doesn't accept a `disabled` attribute, so when the gate is
 * dimmed we swap to a plain button-styled `<span>` to keep keyboard
 * users from being navigated.
 */

import Link from "next/link";

export function FinishSessionBar({
  sessionId,
  variant,
  disabled,
  subtitle,
  testId = "finish-stickybar",
}: {
  sessionId: string;
  variant: "bottom" | "banner";
  disabled: boolean;
  /** Optional small text rendered under the bottom-variant button. */
  subtitle?: string | null;
  testId?: string;
}) {
  const href = `/app/sessions/${sessionId}/complete`;
  const label = disabled ? "Log at least 1 set to finish" : "Finish session →";

  if (variant === "banner") {
    if (disabled) {
      return (
        <span
          data-testid={testId}
          data-armed="false"
          aria-disabled="true"
          className="cp-btn"
          style={{
            padding: "8px 14px",
            fontSize: 12,
            opacity: 0.55,
            cursor: "not-allowed",
          }}
        >
          Finish session →
        </span>
      );
    }
    return (
      <Link
        href={href}
        data-testid={testId}
        data-armed="true"
        className="cp-btn primary"
        style={{ padding: "8px 14px", fontSize: 12 }}
      >
        Finish session →
      </Link>
    );
  }

  // Bottom sticky variant.
  return (
    <div
      data-testid={testId}
      data-armed={disabled ? "false" : "true"}
      className={`cp-stickybar${disabled ? " cp-stickybar--dim" : ""}`}
      style={{ marginInline: -16, flexDirection: "column", gap: 4 }}
    >
      {disabled ? (
        <span
          aria-disabled="true"
          className="cp-btn primary big"
          style={{
            flex: 1,
            opacity: 0.55,
            cursor: "not-allowed",
            textAlign: "center",
          }}
        >
          {label}
        </span>
      ) : (
        <Link
          href={href}
          className="cp-btn primary big"
          style={{ flex: 1, textAlign: "center" }}
        >
          Finish session →
        </Link>
      )}
      {subtitle && (
        <div
          data-testid="finish-subtitle"
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textAlign: "center",
            paddingTop: 2,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
