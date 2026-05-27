/**
 * HR-aware cardio intensity scalar.
 *
 * The bucket-load / region-ledger / muscle-freshness pipelines historically
 * derived cardio intensity from `clamp(rpe / 10)`. After PR #162 we now
 * populate `cardio_logs.hr_zones` (seconds-per-HR-zone) on Strava import via
 * `lib/integrations/strava/zones-from-summary.ts`. When zones are available
 * we can derive a time-in-zone weighted intensity that's much truer to the
 * physiological cost of the session (a 60-min Z2 ride and a 60-min Z5 VO2
 * session should not produce identical load just because the user logged
 * RPE 7 on both).
 *
 * Zone weights (per second of time-in-zone):
 *   z1: 0.5  recovery — barely any stress
 *   z2: 0.8  easy aerobic — bread-and-butter
 *   z3: 1.2  tempo — moderate stress
 *   z4: 1.8  threshold — high stress
 *   z5: 2.2  VO2 — very high stress
 *
 * The returned scalar is `sum(zoneSeconds * weight) / totalZoneSeconds`, so
 * a fully-Z2 session returns 0.8 and a fully-Z5 session returns 2.2. The
 * scalar is then multiplied against the duration-based load formula (the
 * `×8` cardio scalar in bucket-load / region-ledger stays untouched so
 * overall magnitudes remain comparable across the engine).
 *
 * Fall-back: when `hrZones` is null we use `clamp(rpe/10, 0.3, 1.0)`.
 * Note: this unifies on muscle-freshness's pre-#167 behaviour. Legacy
 * bucket-load.ts and region-ledger.ts had NO 0.3 floor, so for RPE 1-2
 * sessions the intensity now floors at 0.3 instead of 0.1-0.2. Counting
 * an RPE-1 cardio session as 10% intensity was almost certainly wrong
 * (it made a 60-min walk weigh less than a 5-min warm-up), so we keep
 * the floor. See cardio-intensity.test.ts for the explicit pins.
 *
 * Citations: audit findings I3, B1, B2 (engine-actual-vs-prescribed-audit.md).
 */
export type HrZones = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
};

export const CARDIO_INTENSITY_MIN = 0.3;
export const CARDIO_INTENSITY_MAX = 2.5;

export const ZONE_INTENSITY_WEIGHTS = {
  z1: 0.5,
  z2: 0.8,
  z3: 1.2,
  z4: 1.8,
  z5: 2.2,
} as const;

/** Default scalar when neither hrZones nor rpe is available. */
const DEFAULT_SCALAR = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Coerce a free-form `hr_zones` jsonb value into a strict HrZones shape, or
 * null if the input is unusable. Accepts either lowercase (`z1`..`z5`, the
 * shape written by `zones-from-summary.ts`) or capitalised keys, and
 * tolerates missing keys (treated as 0 seconds).
 */
export function normaliseHrZones(
  value: unknown,
): HrZones | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const pick = (k: string): number => {
    const lower = obj[k.toLowerCase()];
    const upper = obj[k.toUpperCase()];
    const raw = lower ?? upper;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const z: HrZones = {
    z1: pick("z1"),
    z2: pick("z2"),
    z3: pick("z3"),
    z4: pick("z4"),
    z5: pick("z5"),
  };
  if (z.z1 + z.z2 + z.z3 + z.z4 + z.z5 <= 0) return null;
  return z;
}

/**
 * Returns a per-cardio-log intensity scalar in [0.3, 2.5], suitable for
 * multiplication against the duration-based load formula. Uses time-in-zone
 * weights when `hrZones` is available; falls back to the legacy `rpe/10`
 * heuristic otherwise.
 *
 *   - hrZones present, total > 0  → weighted average of zone weights
 *   - hrZones null, rpe present   → clamp(rpe/10, 0.3, 1.0)  [legacy path]
 *   - hrZones null, rpe null      → 0.5                      [legacy default]
 *   - durationSec <= 0            → 0  (caller should short-circuit anyway)
 */
export function cardioIntensityScalar(input: {
  hrZones: HrZones | null;
  durationSec: number;
  rpe: number | null;
}): number {
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) return 0;

  const zones = input.hrZones;
  if (zones) {
    const totalZoneSec =
      zones.z1 + zones.z2 + zones.z3 + zones.z4 + zones.z5;
    if (totalZoneSec > 0) {
      const weighted =
        zones.z1 * ZONE_INTENSITY_WEIGHTS.z1 +
        zones.z2 * ZONE_INTENSITY_WEIGHTS.z2 +
        zones.z3 * ZONE_INTENSITY_WEIGHTS.z3 +
        zones.z4 * ZONE_INTENSITY_WEIGHTS.z4 +
        zones.z5 * ZONE_INTENSITY_WEIGHTS.z5;
      return clamp(weighted / totalZoneSec, CARDIO_INTENSITY_MIN, CARDIO_INTENSITY_MAX);
    }
  }

  // Fall-back: clamp(rpe/10, 0.3, 1.0) — unified across bucket-load /
  // region-ledger / muscle-freshness on muscle-freshness's pre-#167
  // floor. Intentional behaviour change for RPE 1-2 (see PR body).
  if (input.rpe == null || !Number.isFinite(input.rpe)) return DEFAULT_SCALAR;
  return clamp(input.rpe / 10, CARDIO_INTENSITY_MIN, 1.0);
}
