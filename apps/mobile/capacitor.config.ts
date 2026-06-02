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
    contentInset: "always",
  },
};

export default config;
