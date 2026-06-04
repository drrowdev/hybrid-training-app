"use client";

/**
 * Holds a screen wake lock while a workout session is active so the
 * phone doesn't auto-lock mid-session (killing the visible rest timer
 * and set logger). Renders no UI.
 *
 * Mounted on the session detail page gated on `active` (= session not
 * complete). Acquires on mount, re-acquires whenever the page returns
 * to the foreground (iOS/Android auto-release the lock when hidden),
 * and releases on unmount or when the session completes.
 *
 * Best-effort: silently no-ops on browsers without the Screen Wake Lock
 * API (older iOS < 16.4, desktop Firefox). See `lib/pwa/wake-lock.ts`.
 */

import { useEffect } from "react";
import { createWakeLockController } from "@/lib/pwa/wake-lock";

export function SessionWakeLock({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;

    const controller = createWakeLockController();
    void controller.acquire();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void controller.acquire();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void controller.release();
    };
  }, [active]);

  return null;
}
