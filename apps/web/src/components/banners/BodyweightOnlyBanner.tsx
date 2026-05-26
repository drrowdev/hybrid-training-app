"use client";

/**
 * Soft "early support" notice for users on the bodyweight-only
 * equipment preset who have no training maxes set.
 *
 * Surfaced on /app (Today) and /app/plan above the hero / block summary
 * so the user understands why they're seeing accessory-only sessions
 * with no %TM main lift.
 *
 * Cross-device sync (PR Z1): the dismiss timestamp lives on
 * `profiles.bw_banner_dismissed_at` (migration 0055). The server
 * passes `dismissedAt` as a prop; the client also mirrors to
 * localStorage as a fast-paint fallback to keep the existing
 * one-frame-after-hydrate dismissed behaviour.
 *
 * Brand purity: no external programme names, no methodology hooks —
 * the copy describes the gap in our own engine and what's on the
 * roadmap.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const DISMISS_KEY = "cp-bw-banner-dismissed-v1";

export type DismissBwBannerAction = () => Promise<
  { ok: true } | { ok: false; error: string }
>;

export function BodyweightOnlyBanner({
  dismissedAt = null,
  dismissBwBannerAction,
}: {
  /** ISO timestamp from `profiles.bw_banner_dismissed_at`. Non-null = hide. */
  dismissedAt?: string | null;
  /** Server action that persists the dismissal across devices. */
  dismissBwBannerAction?: DismissBwBannerAction;
} = {}) {
  const [dismissed, setDismissed] = useState<boolean | null>(
    dismissedAt != null ? true : null,
  );

  useEffect(() => {
    if (dismissedAt != null) {
      // Server already says dismissed — skip the localStorage probe.
      return;
    }
    // Defer the read+setState into a microtask so we don't trigger a
    // cascading synchronous render from inside the effect body
    // (react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
      } catch {
        setDismissed(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dismissedAt]);

  if (dismissed !== false) return null;

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage unavailable (private mode, quota) — keep showing
      // the banner; better than crashing the page.
    }
    setDismissed(true);
    if (dismissBwBannerAction) {
      // Fire-and-forget: the banner is already hidden, and the
      // localStorage write covers the current device. Cross-device
      // propagation is a soft guarantee.
      void dismissBwBannerAction();
    }
  };

  return (
    <section
      data-testid="bodyweight-only-banner"
      role="note"
      style={{
        display: "grid",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface-soft, var(--cp-surface))",
        color: "var(--cp-text)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-text-muted)",
          fontWeight: 700,
        }}
      >
        Bodyweight programming is in early support
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        You&apos;ll get a starter block focused on accessories with RPE-based
        progression. Proper push-up / pull-up / squat progression ladders are next
        on our roadmap.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        <Link
          href="/app/settings/equipment"
          className="cp-btn ghost"
          style={{ fontSize: 12 }}
        >
          Settings →
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="cp-btn ghost"
          style={{ fontSize: 12 }}
          data-testid="bodyweight-only-banner-dismiss"
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
