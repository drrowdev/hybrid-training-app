/**
 * Screen Wake Lock controller.
 *
 * Keeps the device screen awake during an active workout so the rest
 * timer, set logger, and prescription stay visible without the phone
 * auto-locking mid-session. Backed by the W3C Screen Wake Lock API
 * (`navigator.wakeLock.request("screen")`), supported on iOS 16.4+
 * Safari and Android Chrome.
 *
 * Everything here is best-effort: on unsupported browsers (older iOS,
 * Firefox without the flag) every method silently no-ops. The OS also
 * auto-releases the lock whenever the page is hidden (tab switch, screen
 * already off), so callers should re-`acquire()` on `visibilitychange`
 * → visible. The controller is idempotent — calling `acquire()` while a
 * lock is already held does nothing.
 */

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export type WakeLockController = {
  /** Acquire the screen lock if supported and not already held. */
  acquire: () => Promise<void>;
  /** Release the lock if held. Safe to call when nothing is held. */
  release: () => Promise<void>;
  /** True when a live sentinel is currently held. */
  isHeld: () => boolean;
};

export function isWakeLockSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as WakeLockNavigator).wakeLock?.request === "function";
}

export function createWakeLockController(): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  let acquiring = false;

  const acquire = async (): Promise<void> => {
    if (!isWakeLockSupported()) return;
    // Already held, or an acquire is mid-flight — don't double-request.
    if (sentinel && !sentinel.released) return;
    if (acquiring) return;
    acquiring = true;
    try {
      const nav = navigator as WakeLockNavigator;
      const next = await nav.wakeLock!.request("screen");
      // The OS releases the lock on its own when the page is hidden; clear
      // our ref so the next visibility-change re-acquires cleanly.
      next.addEventListener("release", () => {
        if (sentinel === next) sentinel = null;
      });
      sentinel = next;
    } catch {
      // Permission denied, page not visible, or unsupported — no-op.
      sentinel = null;
    } finally {
      acquiring = false;
    }
  };

  const release = async (): Promise<void> => {
    const current = sentinel;
    sentinel = null;
    if (!current || current.released) return;
    try {
      await current.release();
    } catch {
      // Best-effort.
    }
  };

  const isHeld = (): boolean => !!sentinel && !sentinel.released;

  return { acquire, release, isHeld };
}
