"use client";

import { useEffect } from "react";
import { triggerStaleStravaSync } from "@/lib/integrations/strava/actions";

/**
 * Fires a stale-check sync once after mount. The server action exits
 * cheaply if last_synced_at is <24h old, so this is safe to render
 * unconditionally on the Today page when the user has a connection.
 *
 * Renders nothing.
 */
export function StravaStaleSyncTrigger() {
  useEffect(() => {
    void triggerStaleStravaSync().catch(() => {
      // Best-effort. Manual sync remains available from settings.
    });
  }, []);
  return null;
}
