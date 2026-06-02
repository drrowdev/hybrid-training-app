/**
 * Geolocation provider abstraction for the cardio tracker.
 *
 * The live tracker doesn't care HOW it gets position fixes — it just wants
 * a stream of normalized samples. This module picks the best available
 * source at runtime:
 *
 *   - **native**  — when running inside the Capacitor iOS/Android shell, use
 *     `@capacitor-community/background-geolocation`, which keeps tracking
 *     when the screen locks or the app is backgrounded (the whole reason
 *     the app goes native). The plugin ships native-only (no JS entry), so it
 *     is bound at runtime via Capacitor's `registerPlugin` from a dynamically
 *     imported `@capacitor/core` — the native package is referenced only as a
 *     type, never imported as a runtime module.
 *   - **browser** — otherwise use the standard `navigator.geolocation`
 *     `watchPosition`. Foreground only (iOS suspends a backgrounded web
 *     view), which is the documented PWA limitation.
 *   - **none**    — no geolocation at all → caller falls back to timer-only.
 *
 * Both sources are normalized to {@link CardioPositionSample} so the
 * component and the pure accumulation helpers stay source-agnostic.
 */

import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

export type CardioPositionSample = {
  lat: number;
  lon: number;
  /** Horizontal accuracy in metres (lower is better). */
  accuracyM: number;
  /** Ground speed in m/s if the source reports it, else null. */
  speedMps: number | null;
  /** Fix timestamp in epoch ms. */
  t: number;
};

export type GeoStatus = "acquiring" | "ok" | "denied" | "unavailable";

export type GeoWatchCallbacks = {
  onSample: (sample: CardioPositionSample) => void;
  onStatus: (status: GeoStatus) => void;
};

export type GeoWatchHandle = { stop: () => void };

export type GeoProviderKind = "native" | "browser" | "none";

/** True when running inside a Capacitor native shell (iOS/Android). */
export function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return !!(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

/** Pick the geolocation source available in the current runtime. */
export function detectGeoProvider(): GeoProviderKind {
  if (isCapacitorNative()) return "native";
  if (typeof navigator !== "undefined" && navigator.geolocation) return "browser";
  return "none";
}

/** Normalize a browser GeolocationPosition to a CardioPositionSample. */
export function normalizeBrowserPosition(
  pos: GeolocationPosition,
): CardioPositionSample {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    accuracyM: Number.isFinite(c.accuracy) ? c.accuracy : 9999,
    speedMps: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
    t: pos.timestamp,
  };
}

/** Shape of a location object from the background-geolocation plugin. */
export type NativeLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  time?: number | null;
};

/** Normalize a native plugin location to a CardioPositionSample. */
export function normalizeNativeLocation(
  loc: NativeLocation,
): CardioPositionSample {
  return {
    lat: loc.latitude,
    lon: loc.longitude,
    accuracyM:
      loc.accuracy != null && Number.isFinite(loc.accuracy)
        ? loc.accuracy
        : 9999,
    speedMps:
      loc.speed != null && Number.isFinite(loc.speed) ? loc.speed : null,
    t: loc.time != null && Number.isFinite(loc.time) ? loc.time : Date.now(),
  };
}

const BROWSER_WATCH_OPTS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 15000,
};

function startBrowserWatch(cb: GeoWatchCallbacks): GeoWatchHandle {
  cb.onStatus("acquiring");
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      cb.onStatus("ok");
      cb.onSample(normalizeBrowserPosition(pos));
    },
    (err) => {
      cb.onStatus(
        err.code === err.PERMISSION_DENIED ? "denied" : "unavailable",
      );
    },
    BROWSER_WATCH_OPTS,
  );
  return {
    stop: () => {
      if (navigator.geolocation) navigator.geolocation.clearWatch(id);
    },
  };
}

async function startNativeWatch(
  cb: GeoWatchCallbacks,
): Promise<GeoWatchHandle> {
  cb.onStatus("acquiring");

  // `@capacitor-community/background-geolocation` ships only native code +
  // type defs — there is NO JS entry to import. The Capacitor pattern is to
  // register the plugin by name through `@capacitor/core`, which returns a
  // proxy bound to the native implementation at runtime. The plugin type is
  // pulled in as a type-only import (erased at build) so the bundler never
  // tries to resolve the entry-less native package.
  const { registerPlugin } = await import("@capacitor/core");
  const BackgroundGeolocation =
    registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: "Tracking your cardio workout",
      backgroundTitle: "SxC — workout in progress",
      requestPermissions: true,
      stale: false,
      distanceFilter: 5,
    },
    (location, error) => {
      if (error) {
        cb.onStatus(error.code === "NOT_AUTHORIZED" ? "denied" : "unavailable");
        return;
      }
      if (!location) return;
      cb.onStatus("ok");
      cb.onSample(normalizeNativeLocation(location as NativeLocation));
    },
  );

  return {
    stop: () => {
      void BackgroundGeolocation.removeWatcher({ id });
    },
  };
}

const NOOP_HANDLE: GeoWatchHandle = { stop: () => undefined };

/**
 * Start watching position with the best available provider. Resolves to a
 * handle whose `stop()` tears the watch down. On native the underlying
 * import or watcher setup is awaited; the browser path resolves synchronously
 * in effect but is wrapped in a promise for a single call signature.
 *
 * If the native provider throws (plugin missing, permission flow aborted),
 * it falls back to the browser provider so foreground tracking still works.
 */
export async function startGeoWatch(
  cb: GeoWatchCallbacks,
): Promise<GeoWatchHandle> {
  const kind = detectGeoProvider();

  if (kind === "none") {
    cb.onStatus("unavailable");
    return NOOP_HANDLE;
  }

  if (kind === "native") {
    try {
      return await startNativeWatch(cb);
    } catch {
      // Native plugin unavailable at runtime — degrade to the browser API
      // if this webview exposes one.
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        return startBrowserWatch(cb);
      }
      cb.onStatus("unavailable");
      return NOOP_HANDLE;
    }
  }

  return startBrowserWatch(cb);
}
