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

/**
 * Native keep-awake bridge (Capacitor `@capacitor-community/keep-awake`),
 * called over the injected `window.Capacitor` bridge — same convention as
 * `lib/feedback` and `lib/native/splash`. This is the ONLY path that keeps the
 * screen on inside the iOS Capacitor shell: WKWebView does NOT implement the
 * W3C Screen Wake Lock API, so `navigator.wakeLock` is undefined there and the
 * web path below silently no-ops. On plain web (no native bridge) this returns
 * false and we fall back to `navigator.wakeLock`.
 */
interface KeepAwakeBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    KeepAwake?: {
      keepAwake?: () => unknown;
      allowSleep?: () => unknown;
    };
  };
}

type KeepAwakePlugin = NonNullable<NonNullable<KeepAwakeBridge["Plugins"]>["KeepAwake"]>;

function nativeKeepAwake(): KeepAwakePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: KeepAwakeBridge }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  const plugin = cap.Plugins?.KeepAwake;
  if (!plugin || typeof plugin.keepAwake !== "function") return null;
  return plugin;
}

export type WakeLockController = {
  /** Acquire the screen lock if supported and not already held. */
  acquire: () => Promise<void>;
  /** Release the lock if held. Safe to call when nothing is held. */
  release: () => Promise<void>;
  /** True when a live sentinel is currently held. */
  isHeld: () => boolean;
};

export function isWakeLockSupported(): boolean {
  if (nativeKeepAwake()) return true;
  if (typeof navigator === "undefined") return false;
  return typeof (navigator as WakeLockNavigator).wakeLock?.request === "function";
}

export function createWakeLockController(): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  let nativeHeld = false;
  let acquiring = false;

  const acquire = async (): Promise<void> => {
    // Native Capacitor shell (iOS WKWebView has no navigator.wakeLock) — prefer
    // the KeepAwake plugin. Idempotent, so re-calling while held is harmless.
    const native = nativeKeepAwake();
    if (native) {
      try {
        await Promise.resolve(native.keepAwake!());
        nativeHeld = true;
      } catch {
        nativeHeld = false;
      }
      return;
    }
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
    if (nativeHeld) {
      nativeHeld = false;
      const native = nativeKeepAwake();
      try {
        if (native?.allowSleep) await Promise.resolve(native.allowSleep());
      } catch {
        // Best-effort.
      }
      return;
    }
    const current = sentinel;
    sentinel = null;
    if (!current || current.released) return;
    try {
      await current.release();
    } catch {
      // Best-effort.
    }
  };

  const isHeld = (): boolean => nativeHeld || (!!sentinel && !sentinel.released);

  return { acquire, release, isHeld };
}
