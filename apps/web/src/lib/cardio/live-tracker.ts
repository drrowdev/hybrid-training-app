/**
 * Pure, browser-free helpers for the live cardio tracker.
 *
 * All GPS math, jitter filtering, pace and clock formatting live here so
 * they can be unit-tested deterministically without a DOM, geolocation,
 * or wake-lock. The React component (`LiveCardioTracker`) owns the browser
 * APIs and side effects; this module owns the arithmetic.
 *
 * Distance is accumulated in METRES internally (GPS-native) and converted
 * to the user's display unit only at the edge. The captured total is
 * submitted to the existing `logCardioSession` server action in km, so no
 * new server path, migration, or RLS surface is introduced.
 */

const MI_PER_M = 1 / 1609.344;
const KM_PER_M = 1 / 1000;

export type GpsSample = {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lon: number;
  /** Reported horizontal accuracy in metres (lower is better). */
  accuracyM: number;
  /** Sample timestamp in epoch ms. */
  t: number;
};

export type TrackState = {
  /** Accumulated distance in metres. */
  totalMeters: number;
  /** Last accepted anchor sample, or null before the first good fix. */
  anchor: GpsSample | null;
  /** Count of samples that passed the accuracy gate and advanced distance. */
  accepted: number;
  /** Count of samples rejected by the accuracy or jitter gate. */
  rejected: number;
};

export type AccumulateOptions = {
  /**
   * Reject any sample whose reported accuracy is worse (larger) than this.
   * Urban/foliage GPS routinely reports 30–50 m; 35 m keeps usable fixes
   * while dropping the worst noise.
   */
  maxAccuracyM?: number;
  /**
   * Absolute floor for a segment to count, in metres. Below this we treat
   * the movement as standing-still drift.
   */
  minSegmentMeters?: number;
  /**
   * The effective movement gate is `max(minSegmentMeters, accuracyM *
   * accuracyGateFactor)` measured from the current anchor. A real run/ride
   * crosses it within a sample or two; a stationary athlete never does, so
   * drift is rejected without dropping genuine slow movement (the anchor
   * holds until movement actually exceeds the gate, then the full segment
   * counts).
   */
  accuracyGateFactor?: number;
};

const DEFAULTS: Required<AccumulateOptions> = {
  maxAccuracyM: 35,
  minSegmentMeters: 5,
  accuracyGateFactor: 0.5,
};

export function initTrackState(): TrackState {
  return { totalMeters: 0, anchor: null, accepted: 0, rejected: 0 };
}

/**
 * Great-circle distance between two lat/lon points in metres (haversine).
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371008.8; // mean Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Fold a new GPS sample into the running track state, applying the
 * accuracy + jitter gates. Returns a NEW state object (never mutates the
 * input), so it is safe to drive a React reducer or `setState(prev => …)`.
 */
export function accumulateSample(
  state: TrackState,
  sample: GpsSample,
  options?: AccumulateOptions,
): TrackState {
  const opts = { ...DEFAULTS, ...options };

  // Drop fixes we can't trust at all.
  if (
    !Number.isFinite(sample.lat) ||
    !Number.isFinite(sample.lon) ||
    !Number.isFinite(sample.accuracyM) ||
    sample.accuracyM > opts.maxAccuracyM
  ) {
    return { ...state, rejected: state.rejected + 1 };
  }

  // First trusted fix becomes the anchor; no distance yet.
  if (!state.anchor) {
    return { ...state, anchor: sample, accepted: state.accepted + 1 };
  }

  const seg = haversineMeters(
    state.anchor.lat,
    state.anchor.lon,
    sample.lat,
    sample.lon,
  );
  const gate = Math.max(
    opts.minSegmentMeters,
    sample.accuracyM * opts.accuracyGateFactor,
  );

  // Below the gate: treat as drift. Hold the anchor so real movement is
  // still measured in full once it crosses the gate.
  if (seg < gate) {
    return { ...state, rejected: state.rejected + 1 };
  }

  return {
    totalMeters: state.totalMeters + seg,
    anchor: sample,
    accepted: state.accepted + 1,
    rejected: state.rejected,
  };
}

/** Convert metres to the user's display distance unit. */
export function metersToDisplay(
  meters: number,
  units: "metric" | "imperial",
): number {
  return meters * (units === "imperial" ? MI_PER_M : KM_PER_M);
}

/** Convert accumulated metres to kilometres for the server submission. */
export function metersToKm(meters: number): number {
  return meters * KM_PER_M;
}

/**
 * Average pace in seconds per display-distance-unit (per km or per mi).
 * Returns null when there isn't enough distance to be meaningful.
 */
export function paceSecPerUnit(
  elapsedSec: number,
  meters: number,
  units: "metric" | "imperial",
): number | null {
  const dist = metersToDisplay(meters, units);
  if (!(dist > 0) || !(elapsedSec > 0)) return null;
  return elapsedSec / dist;
}

/**
 * Instantaneous pace from a GPS-reported speed (m/s), in seconds per
 * display unit. Returns null when speed is unavailable or effectively
 * stationary.
 */
export function speedToPaceSecPerUnit(
  speedMps: number | null | undefined,
  units: "metric" | "imperial",
): number | null {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps <= 0.3) {
    return null;
  }
  const metersPerUnit = units === "imperial" ? 1609.344 : 1000;
  return metersPerUnit / speedMps;
}

/** Format seconds-per-unit pace as "m:ss". Null → "—". */
export function formatPace(secPerUnit: number | null): string {
  if (secPerUnit == null || !Number.isFinite(secPerUnit) || secPerUnit <= 0) {
    return "—";
  }
  const total = Math.round(secPerUnit);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Format an elapsed duration in seconds as a clock string: "m:ss" under an
 * hour, "h:mm:ss" at or above one hour.
 */
export function formatClock(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Round a display distance to a sensible 2 dp for the UI. */
export function formatDistance(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0.00";
  return value.toFixed(2);
}

/** Whole minutes elapsed, clamped to the server's [1, 600] range. */
export function elapsedToDurationMin(elapsedSec: number): number {
  const min = Math.round(elapsedSec / 60);
  return Math.min(600, Math.max(1, min));
}
