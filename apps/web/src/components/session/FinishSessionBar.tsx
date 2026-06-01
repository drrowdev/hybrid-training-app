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
import { useEffect, useRef } from "react";

export function FinishSessionBar({
  sessionId,
  variant,
  disabled,
  subtitle,
  hybrid,
  testId = "finish-stickybar",
}: {
  sessionId: string;
  variant: "bottom" | "banner";
  disabled: boolean;
  /** Optional small text rendered under the bottom-variant button. */
  subtitle?: string | null;
  /**
   * Hybrid sessions (cardio + strength prescribed) need the disabled
   * label to clarify which kind of work counts toward the gate —
   * strength sets, not cardio time. Pure-strength sessions keep the
   * generic copy (still accurate); pure-cardio sessions don't render
   * this bar at all (see SessionLogClient — CardioLogForm owns the
   * Finish button in that flow).
   */
  hybrid?: boolean;
  testId?: string;
}) {
  const href = `/app/sessions/${sessionId}/complete`;
  const disabledLabel = hybrid
    ? "Log at least 1 strength set to finish"
    : "Log at least 1 set to finish";
  const label = disabled ? disabledLabel : "Finish session →";

  // The armed bottom bar overlaps the floating rest-timer's corner. Publish
  // the bar's live top-clearance (viewport-bottom → bar-top) as a CSS var so
  // RestTimer can dock just above it — robust to subtitle wrap, safe-area, and
  // sticky scroll state. Only the armed bottom variant participates; the dim
  // (in-flow) bar and the banner variant remove the var so the timer falls
  // back to its bottom-nav offset.
  const barRef = useRef<HTMLDivElement>(null);
  const publishesClearance = variant === "bottom" && !disabled;
  useEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!publishesClearance || !el) {
      root.style.removeProperty("--cp-finishbar-clearance");
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const clearance = Math.max(0, Math.round(window.innerHeight - rect.top));
      root.style.setProperty("--cp-finishbar-clearance", `${clearance}px`);
    };
    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (raf) window.cancelAnimationFrame(raf);
      root.style.removeProperty("--cp-finishbar-clearance");
    };
  }, [publishesClearance]);

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
      ref={barRef}
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
