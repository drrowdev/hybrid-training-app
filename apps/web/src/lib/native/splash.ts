/**
 * Native splash-screen bridge.
 *
 * The iOS Capacitor shell shows a branded launch image (configured with
 * `launchAutoHide: false`) that stays up across the WKWebView cold-start and
 * the remote fetch of getsxc.app. The web shell dismisses it once interactive.
 *
 * We call the `@capacitor/splash-screen` plugin over the injected
 * `window.Capacitor` bridge rather than importing the package, so the web
 * bundle stays free of native deps under remote-load (same convention as
 * `lib/feedback`). Safe to import on the server — guards on `typeof window`.
 */

interface SplashBridge {
  isNativePlatform?: () => boolean;
  Plugins?: {
    SplashScreen?: {
      hide?: (opts?: { fadeOutDuration?: number }) => unknown;
    };
  };
}

/**
 * Hide the native splash screen via the Capacitor bridge, cross-fading over
 * `fadeOutDuration` ms. Returns true if a native hide was dispatched, false on
 * plain web (no bridge) or if the plugin is unavailable. Never throws.
 */
export function hideNativeSplash(fadeOutDuration = 250): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: SplashBridge }).Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  const hide = cap.Plugins?.SplashScreen?.hide;
  if (typeof hide !== "function") return false;
  try {
    void Promise.resolve(hide({ fadeOutDuration })).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
