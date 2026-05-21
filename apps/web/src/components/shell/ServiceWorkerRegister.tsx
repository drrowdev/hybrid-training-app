"use client";

import { useEffect } from "react";

/**
 * Registers the service worker on first mount. Silent in dev (NEXT_DATA
 * indicates the runtime environment). Renders no UI.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production builds so HMR isn't broken.
    if (process.env.NODE_ENV !== "production") return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // Swallow — failing to register a SW shouldn't break the app.
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}
