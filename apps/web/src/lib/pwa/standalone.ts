/**
 * Returns true when the app is running as an installed PWA in standalone
 * (full-screen, no browser chrome) mode.
 *
 *  - iOS Safari "Add to Home Screen" reports via the non-standard
 *    `navigator.standalone` boolean — `matchMedia("(display-mode: standalone)")`
 *    is unreliable there as of iOS 17.
 *  - Chromium / modern engines report via the CSS media query.
 *
 * Used to gate iOS-only affordances like our custom pull-to-refresh, which
 * must not double-fire alongside Safari's native pull-to-refresh in tab mode.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosFlag =
    (window.navigator as { standalone?: boolean }).standalone === true;
  return mq || iosFlag;
}
