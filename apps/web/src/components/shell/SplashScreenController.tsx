"use client";

import { useEffect } from "react";
import { hideNativeSplash } from "@/lib/native/splash";

/**
 * Dismisses the native (Capacitor) splash screen once the web shell is
 * interactive. Renders no UI.
 *
 * The iOS shell is configured with `launchAutoHide: false`, so the branded SxC
 * splash stays up — masking the WKWebView cold-start and the remote fetch of
 * getsxc.app — until this component mounts (the first route has hydrated) and a
 * frame has painted, then it cross-fades the splash away. On plain web there is
 * no native bridge, so `hideNativeSplash` is a no-op.
 */
export function SplashScreenController() {
  useEffect(() => {
    let done = false;
    const dismiss = () => {
      if (done) return;
      done = true;
      hideNativeSplash();
    };

    // Wait one full frame after layout so the route's content is on-screen
    // before the splash cross-fades away (avoids revealing a blank frame).
    const raf = requestAnimationFrame(() => requestAnimationFrame(dismiss));
    // Safety net: never let the splash hang on a hydration stall — force the
    // hide after 5s regardless.
    const timer = window.setTimeout(dismiss, 5000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
