/**
 * True when running inside the Capacitor native shell (our iOS/Android app).
 * The remote-loaded WKWebView is NOT a home-screen PWA, so neither
 * `display-mode: standalone` nor `navigator.standalone` is true there — we
 * must detect the injected `Capacitor` bridge explicitly. Inlined (rather
 * than imported from the cardio geo-provider) to keep this pwa helper
 * dependency-free.
 */
function isCapacitorNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

/**
 * Returns true when the app is running as an installed app — either a
 * home-screen PWA in standalone (full-screen, no browser chrome) mode, or
 * inside our Capacitor native shell.
 *
 *  - iOS Safari "Add to Home Screen" reports via the non-standard
 *    `navigator.standalone` boolean — `matchMedia("(display-mode: standalone)")`
 *    is unreliable there as of iOS 17.
 *  - Chromium / modern engines report via the CSS media query.
 *  - The Capacitor iOS/Android shell reports via the injected `Capacitor`
 *    bridge (it's a remote-loaded webview, so the two signals above are both
 *    false inside it).
 *
 * Used to (a) suppress the "install this app" nudge when we're already an
 * app, and (b) gate affordances like our custom pull-to-refresh, which must
 * not double-fire alongside Safari's native pull-to-refresh in tab mode.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosFlag =
    (window.navigator as { standalone?: boolean }).standalone === true;
  return mq || iosFlag || isCapacitorNativeShell();
}
