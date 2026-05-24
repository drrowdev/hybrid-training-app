"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isStandalonePwa } from "@/lib/pwa/standalone";

/**
 * Pull-to-refresh affordance for installed PWAs.
 *
 * iOS standalone mode (and Chromium PWAs running fullscreen) deliberately
 * disable the browser's native pull-to-refresh, leaving users with no way
 * to force a soft reload short of closing and reopening the app. This
 * component rolls our own: listen for a downward swipe from the very top
 * of the page, show a rubber-banded indicator, and on release call
 * `router.refresh()` so App Router refetches server components for the
 * current route without losing client state.
 *
 * Gated by `isStandalonePwa()` so the component is a no-op in tabbed
 * browsers — it must not double-fire alongside Safari's native gesture.
 */
export function PullToRefresh(): React.ReactElement | null {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullRef = useRef(0);

  // px the user must drag before release triggers a refresh.
  const THRESHOLD = 80;
  // Visual cap — past this point the indicator stops moving even if the
  // finger keeps travelling (rubber-band).
  const MAX_PULL = 120;

  // Detect standalone after mount; SSR has no `window`. We deliberately
  // setState from inside the effect because the only safe place to read
  // `window` / `navigator.standalone` is after hydration — the value is
  // stable for the lifetime of the document, so there's no cascading
  // re-render concern the lint rule is normally guarding against.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from window after mount
    setEnabled(isStandalonePwa());
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function onTouchStart(e: TouchEvent) {
      // Only engage when the page is already scrolled to the very top —
      // otherwise the gesture is a normal scroll-up.
      const root = document.scrollingElement || document.documentElement;
      if (root.scrollTop > 0) return;
      startYRef.current = e.touches[0]?.clientY ?? null;
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current == null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startYRef.current;
      if (dy <= 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Easing factor < 1 so dragging feels weighted — the indicator
      // lags the finger and resists past MAX_PULL.
      const eased = Math.min(MAX_PULL, dy * 0.5);
      pullRef.current = eased;
      setPull(eased);
    }

    function onTouchEnd() {
      if (pullRef.current >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        router.refresh();
        // Hold the spinner long enough to read as a refresh, then snap
        // back. router.refresh() is fire-and-forget — there's no promise
        // to await — so a fixed delay is the pragmatic choice.
        setTimeout(() => {
          setRefreshing(false);
          pullRef.current = 0;
          setPull(0);
        }, 600);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
      startYRef.current = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [enabled, router]);

  if (!enabled) return null;

  const indicatorOpacity = Math.min(1, pull / THRESHOLD);

  return (
    <div
      aria-hidden="true"
      data-testid="pull-to-refresh-indicator"
      style={{
        position: "fixed",
        top: `max(env(safe-area-inset-top), 8px)`,
        left: 0,
        right: 0,
        zIndex: 100,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        transform: `translateY(${pull - 32}px)`,
        transition: refreshing ? "none" : "transform 0.18s ease-out",
        opacity: indicatorOpacity,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 999,
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
        }}
      >
        <Spinner spinning={refreshing} />
      </div>
    </div>
  );
}

function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--cp-text)"
      strokeWidth="2"
      style={{
        animation: spinning ? "cp-ptr-spin 0.7s linear infinite" : "none",
      }}
    >
      <path d="M21 12a9 9 0 1 1-9-9" strokeLinecap="round" />
      <style>{`@keyframes cp-ptr-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
