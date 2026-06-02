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
    url: "https://getsxc.app",
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
};

export default config;
