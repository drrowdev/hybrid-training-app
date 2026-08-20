"use client";

/**
 * Finish-session CTA, rendered in two places:
 *
 *   - `variant="bottom"` — full-width sticky bar at the bottom of the
 *     session detail page (the original `cp-stickybar`).
 *   - `variant="banner"` — compact pill embedded in the
 *     "Session in progress" status banner.
 *
 * Both call the redirect-free completion action, show immediate pending
 * feedback, then perform a full navigation to the summary. The document
 * navigation deliberately resets scroll and layout-shift accounting instead
 * of replacing the long active-session tree in place.
 *
 * `disabled` is enforced both visually and via aria-disabled. When the
 * gate is dimmed we render a plain button-styled `<span>` so keyboard
 * users can't submit.
 */

import { useEffect, useRef, useState } from "react";
import { completeSessionResult } from "@/lib/sessions/actions";
import { enqueue as outboxEnqueue } from "@/lib/offline/outbox";
import { clearResume } from "@/lib/sessions/session-resume";
import { useSessionLoggingState } from "./SessionLoggingState";

/**
 * Where the Finish action belongs right now.
 *
 * While required work is outstanding the big button would sit directly above
 * the fixed dock's "Log set" — the control the user taps dozens of times a
 * session — so Finish moves into the ⋯ menu, which costs a deliberate extra
 * tap. Once nothing required is left, Finish is the obvious next action and
 * takes the primary slot back.
 */
export function finishPlacement(remainingRequiredSets: number): "bottom" | "menu" {
  return remainingRequiredSets > 0 ? "menu" : "bottom";
}

type FinishSlotProps = {
  sessionId: string;
  disabled: boolean;
  subtitle?: string | null;
  hybrid?: boolean;
  testId?: string;
};

/** Renders the Finish bar at the end of the content, or nothing when the
 *  action currently belongs in the ⋯ menu. */
export function FinishSessionBottomSlot(props: FinishSlotProps) {
  const loggingState = useSessionLoggingState();
  if (finishPlacement(loggingState?.remainingRequiredSets ?? 0) !== "bottom") {
    return null;
  }
  return <FinishSessionBar {...props} variant="bottom" />;
}

/** Renders the Finish row inside the ⋯ menu, or nothing when the action
 *  currently owns the primary slot at the end of the content. */
export function FinishSessionMenuSlot(props: FinishSlotProps) {
  const loggingState = useSessionLoggingState();
  if (finishPlacement(loggingState?.remainingRequiredSets ?? 0) !== "menu") {
    return null;
  }
  return <FinishSessionBar {...props} variant="menu" />;
}

export function FinishSessionBar({
  sessionId,
  variant,
  disabled,
  subtitle,
  hybrid,
  testId = "finish-stickybar",
}: {
  sessionId: string;
  /**
   * `bottom` — full-width button at the end of the session content.
   * `banner` — compact pill in the "Session in progress" banner.
   * `menu`   — row inside the header's ⋯ menu, used while required work is
   *            still outstanding so the primary Finish button isn't sitting a
   *            thumb-width from "Log set" in the fixed dock.
   */
  variant: "bottom" | "banner" | "menu";
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
  const loggingState = useSessionLoggingState();
  const remainingRehabSets = loggingState?.remainingRehabSets ?? 0;
  const rehabBlocked = remainingRehabSets > 0;
  const effectiveDisabled =
    rehabBlocked || (disabled && !loggingState?.hasStrengthSets);
  const disabledLabel = hybrid
    ? "Log at least 1 strength set to finish"
    : "Log at least 1 set to finish";
  const label = rehabBlocked
    ? "Log or skip rehab to finish"
    : effectiveDisabled
      ? disabledLabel
      : "Finish session →";
  const effectiveSubtitle =
    rehabBlocked
      ? `${remainingRehabSets} rehab set${
          remainingRehabSets === 1 ? "" : "s"
        } remain. Log or explicitly skip them before finishing.`
      : disabled && loggingState?.hasStrengthSets
      ? loggingState.remainingPlannedSets > 0
        ? `${loggingState.remainingPlannedSets} planned sets aren't logged. You can still finish; the session will be marked complete with what you logged. · Finish anyway`
        : null
      : subtitle;

  // Finish-while-offline: completeSession is heavy server work that redirects to
  // the summary, so it can't run offline. When the network is down we instead
  // enqueue a durable `complete` op (after the queued sets) and confirm in place;
  // the outbox flusher on the session page replays it on reconnect. The ONLINE
  // path is untouched — the native form action redirects as before.
  const [savedOffline, setSavedOffline] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (effectiveDisabled) return;
    // The session is over either way — drop the resume snapshot so reopening
    // a finished session never restores a stale cursor or rest countdown.
    clearResume(sessionId);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const id =
        globalThis.crypto?.randomUUID?.() ?? `complete-${Date.now()}`;
      void outboxEnqueue({
        id,
        op: "complete",
        sessionId,
        payload: { sessionId },
      }).catch(() => null);
      setSavedOffline(true);
      return;
    }
    if (finishing) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const result = await completeSessionResult(sessionId, null);
      if (result.error) {
        if (result.error === "not-signed-in") {
          window.location.assign("/login");
          return;
        }
        setFinishError(result.error);
        setFinishing(false);
        return;
      }
      window.location.assign(`/app/sessions/${sessionId}?completed=1`);
    } catch {
      setFinishError("Couldn't finish the session. Check your connection and retry.");
      setFinishing(false);
    }
  };

  // The armed bottom bar overlaps the floating rest-timer's corner. Publish
  // the bar's live top-clearance (viewport-bottom → bar-top) as a CSS var so
  // RestTimer can dock just above it — robust to subtitle wrap, safe-area, and
  // sticky scroll state. Only the armed bottom variant participates; the dim
  // (in-flow) bar and the banner variant remove the var so the timer falls
  // back to its bottom-nav offset.
  // The Finish bar used to float (sticky) above the rest-timer, so it published
  // its clearance for RestTimer to dock above it. Now it's in-flow at the bottom
  // of the content, so there's nothing to dock around — never publish the var
  // (RestTimer falls back to its bottom-nav offset).
  const barRef = useRef<HTMLDivElement>(null);
  const publishesClearance = false;
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

  if (variant === "menu") {
    if (effectiveDisabled) {
      return (
        <span
          data-testid={testId}
          data-armed="false"
          aria-disabled="true"
          style={{
            display: "block",
            padding: "8px 10px",
            fontSize: 13,
            color: "var(--cp-text-muted)",
            cursor: "not-allowed",
          }}
        >
          {label}
        </span>
      );
    }
    if (savedOffline) {
      return (
        <span
          data-testid="finish-saved-offline"
          style={{ display: "block", padding: "8px 10px", fontSize: 13 }}
        >
          Saved offline — finishes when you reconnect
        </span>
      );
    }
    return (
      <form onSubmit={handleSubmit} data-testid={testId} data-armed="true">
        <input type="hidden" name="sessionId" value={sessionId} />
        <button
          type="submit"
          role="menuitem"
          disabled={finishing}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "8px 10px",
            border: 0,
            borderRadius: 8,
            background: "transparent",
            color: "var(--cp-text)",
            font: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {finishing ? "Finishing…" : "Finish session"}
        </button>
        {finishError && (
          <div
            role="alert"
            style={{ color: "var(--cp-danger)", fontSize: 12, padding: "0 10px 6px" }}
          >
            {finishError}
          </div>
        )}
      </form>
    );
  }

  if (variant === "banner") {
    if (effectiveDisabled) {
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
    if (savedOffline) {
      return (
        <span
          data-testid="finish-saved-offline"
          className="cp-btn"
          style={{ padding: "8px 14px", fontSize: 12, opacity: 0.8 }}
        >
          Saved offline — finishes when you reconnect
        </span>
      );
    }
    return (
      <form
        onSubmit={handleSubmit}
        data-testid={testId}
        data-armed="true"
        style={{ display: "contents" }}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <button
          type="submit"
          disabled={finishing}
          className="cp-btn primary"
          style={{ padding: "8px 14px", fontSize: 12 }}
        >
          {finishing ? "Finishing…" : "Finish session →"}
        </button>
      </form>
    );
  }

  // Bottom in-flow variant. Previously a sticky bar pinned to the viewport
  // bottom; that permanently occupied screen estate on mobile. It now sits at
  // the END of the session content — the user scrolls past the movement cards
  // to reach it — so the logging surface gets the full screen. `.cp-main`
  // already reserves ~96px bottom padding, so it clears the fixed bottom nav.
  return (
    <div
      ref={barRef}
      data-testid={testId}
      data-armed={effectiveDisabled ? "false" : "true"}
      style={{
        marginInline: -16,
        marginTop: 16,
        paddingTop: 16,
        borderTop: "1px solid var(--cp-border)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        paddingInline: 16,
      }}
    >
      {effectiveDisabled ? (
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
      ) : savedOffline ? (
        <span
          data-testid="finish-saved-offline"
          className="cp-btn big"
          style={{ flex: 1, textAlign: "center", opacity: 0.8 }}
        >
          Saved offline — finishes when you reconnect
        </span>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ flex: 1, display: "flex" }}
        >
          <input type="hidden" name="sessionId" value={sessionId} />
          <button
            type="submit"
            disabled={finishing}
            className="cp-btn primary big"
            style={{ flex: 1, textAlign: "center" }}
          >
            {finishing ? "Finishing…" : "Finish session →"}
          </button>
        </form>
      )}
      {effectiveSubtitle && (
        <div
          data-testid="finish-subtitle"
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textAlign: "center",
            paddingTop: 2,
          }}
        >
          {effectiveSubtitle}
        </div>
      )}
      {finishError && (
        <div role="alert" style={{ color: "var(--cp-danger)", fontSize: 12 }}>
          {finishError}
        </div>
      )}
    </div>
  );
}
