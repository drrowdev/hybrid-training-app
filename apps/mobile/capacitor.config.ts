import type { CapacitorConfig } from "@capacitor/cli";

// Remote-load configuration: the native WKWebView loads the live production
// site (getsxc.app) and Capacitor injects its native bridge so in-page JS can
// call native plugins (geolocation, BLE, etc.). The app is server-rendered and
// cannot be statically exported, so there is no bundled web build to ship — the
// `www` dir holds only a fallback shell shown if the remote URL is unreachable.
const config: CapacitorConfig = {
  appId: "app.getsxc.hybrid",
  appName: "SxC",
  webDir: "www",
  server: {
    // Launch directly at /app, not the site root. The root path `/` is the
    // public marketing/sign-in landing; for a signed-in user it only runs an
    // auth check and `redirect("/app")`, costing an extra device↔server
    // round-trip + Supabase auth call on every cold launch before the real
    // page renders. Booting at /app skips that hop: signed-in users land on
    // Today immediately (showing /app's loading skeleton while it renders), and
    // signed-out users are sent by middleware to /login?next=/app — the
    // preferred native first-run anyway (no marketing page for an installed
    // app). Auth is unaffected: OAuth callbacks use absolute /api paths and the
    // Supabase cookies are path-`/` scoped.
    url: "https://getsxc.app/app",
    cleartext: false,
  },
  ios: {
    // `never`: the web layer owns all safe-area padding via CSS env(safe-area-inset-*)
    // (viewport-fit=cover). Letting the native scroll view ALSO add safe-area content
    // inset double-pads and, at the bottom, leaves a scrollable inset region painted
    // with the native webview background — the dark "gutter" revealed when pulling up
    // past the bottom tab bar. Disabling native inset adjustment removes that gutter.
    contentInset: "never",
  },
  plugins: {
    // The branded SxC launch image (iron-dark #1A1A1A, white S×C wordmark) is
    // shown by the iOS LaunchScreen storyboard the instant the icon is tapped.
    // Remote-load means the WKWebView then spends a few seconds booting and
    // fetching getsxc.app over the network — a gap that would otherwise reveal a
    // blank webview. `launchAutoHide: false` keeps the splash up across that gap;
    // the web shell calls `SplashScreen.hide()` (via the Capacitor bridge in
    // `SplashScreenController`) once the first route has hydrated and painted.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#1A1A1A",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
