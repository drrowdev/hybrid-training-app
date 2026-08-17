/**
 * Time-in-HR-zones — intensity-distribution analytics over logged cardio.
 *
 * v1 simplification: we don't have per-second HR streams, only the
 * `avg_hr_bpm` rollup persisted per cardio_logs row (plus, on historical
 * rows, a stored `hr_zones` distribution). We bucket the entire activity
 * into whichever zone the average HR falls into when no stored
 * distribution exists. This over-credits Z2 and under-credits transient
 * spikes — flagged as "approximated from session average".
 *
 * Zone thresholds:
 *   - If the user has saved zones in `profiles.intake.hrZones`, use those.
 *   - Else if a single `profiles.intake.hrMax` is set, derive Z1–Z5 as
 *     %max bands (Z1 < 60%, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥ 90 —
 *     middle-of-the-road defaults used in practitioner guides).
 *   - Else: no zone config → empty-state branch.
 *
 * The Seiler 2010 polarised model targets ~80% time in Z1–Z2 + ~20% in
 * Z4–Z5 with minimal Z3 — we surface the principle and the user's own
 * split as a one-liner below the bar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd, todayYmd } from "@/lib/dates";

export type Zone = "Z1" | "Z2" | "Z3" | "Z4" | "Z5";

export type ZoneBands = {
  /** Upper bound (exclusive) of Z1, in bpm. */
  z1Max: number;
  /** Upper bound (exclusive) of Z2. */
  z2Max: number;
  /** Upper bound (exclusive) of Z3. */
  z3Max: number;
  /** Upper bound (exclusive) of Z4 — anything at/above is Z5. */
  z4Max: number;
};

export type ActivitySummary = {
  durationSec: number;
  avgHrBpm: number | null;
};

export type ZoneTotals = Record<Zone, number>;

const ZONES: Zone[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];

/**
 * Build default zone bands from a max-HR value. Uses the % HRmax
 * bands common in entry-level coaching templates (Z1 < 60%,
 * Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 ≥ 90%) unless an explicit
 * `pcts` override is supplied.
 */
export function zoneBandsFromMaxHr(hrMax: number, pcts?: ZonePercents): ZoneBands {
  const p = pcts ?? DEFAULT_ZONE_PCTS.max;
  return {
    z1Max: hrMax * p.z1,
    z2Max: hrMax * p.z2,
    z3Max: hrMax * p.z3,
    z4Max: hrMax * p.z4,
  };
}

/** Method the user picked for defining their zones. */
export type HrMethod = "max" | "hrr" | "lthr";

/**
 * Zone breakpoint percentages — each value is the upper bound of the
 * named zone, expressed as a fraction of the method's anchor (HRmax,
 * HRR, or LTHR). Z5 is the implicit `> z4` bucket. Values must be
 * strictly ascending: z1 < z2 < z3 < z4.
 */
export type ZonePercents = {
  z1: number;
  z2: number;
  z3: number;
  z4: number;
};

/** Default breakpoint percentages per method (the previous hard-coded constants). */
export const DEFAULT_ZONE_PCTS: Record<HrMethod, ZonePercents> = {
  max: { z1: 0.6, z2: 0.7, z3: 0.8, z4: 0.9 },
  hrr: { z1: 0.5, z2: 0.6, z3: 0.7, z4: 0.85 },
  lthr: { z1: 0.81, z2: 0.89, z3: 0.93, z4: 0.99 },
};

/** Allowed range for a single breakpoint percentage. */
const PCT_LOW_EXCLUSIVE = 0;
const PCT_HIGH_INCLUSIVE = 1.5;

/**
 * Validate a partial `ZonePercents` payload. Returns the typed
 * `ZonePercents` when every field is finite, in `(0, 1.5]`, and the
 * four values are strictly ascending. Returns null otherwise.
 *
 * The upper bound is 1.5 to allow methods (notably %LTHR) where Z4's
 * anchor sits at the LTHR itself — users can set Z4 just under 1.0 and
 * we don't want to reject sane edge values, while still rejecting
 * obvious garbage like 200%.
 */
export function validateZonePercents(p: Partial<ZonePercents>): ZonePercents | null {
  const keys: Array<keyof ZonePercents> = ["z1", "z2", "z3", "z4"];
  for (const k of keys) {
    const v = p[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v <= PCT_LOW_EXCLUSIVE || v > PCT_HIGH_INCLUSIVE) return null;
  }
  const z1 = p.z1 as number;
  const z2 = p.z2 as number;
  const z3 = p.z3 as number;
  const z4 = p.z4 as number;
  if (!(z1 < z2 && z2 < z3 && z3 < z4)) return null;
  return { z1, z2, z3, z4 };
}

/** Discriminated inputs for `computeZoneBands`. */
export type HrZoneInputs =
  | { method: "max"; hrMax: number; pcts?: ZonePercents }
  | { method: "hrr"; hrMax: number; hrResting: number; pcts?: ZonePercents }
  | { method: "lthr"; hrLthr: number; pcts?: ZonePercents };

/** Plausibility ranges for self-reported HR values. */
export const HR_MAX_RANGE = { min: 100, max: 220 } as const;
export const HR_RESTING_RANGE = { min: 30, max: 100 } as const;
export const HR_LTHR_RANGE = { min: 100, max: 200 } as const;

function inRange(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
}

/**
 * Validate raw user inputs for a given method. Returns null when any
 * required field is missing or out of range. Useful for previewing
 * computed bands in the settings UI without throwing on every keystroke.
 */
export function validateHrZoneInputs(inputs: Partial<HrZoneInputs> & { method: HrMethod }):
  | HrZoneInputs
  | null {
  // Pcts are optional — but if provided, they must validate. An invalid
  // pcts payload falls back to the method's defaults rather than failing
  // the whole input.
  const pcts =
    inputs.pcts !== undefined ? validateZonePercents(inputs.pcts) ?? undefined : undefined;
  if (inputs.method === "max") {
    if (!inRange(inputs.hrMax, HR_MAX_RANGE.min, HR_MAX_RANGE.max)) return null;
    return { method: "max", hrMax: inputs.hrMax, pcts };
  }
  if (inputs.method === "hrr") {
    if (!inRange(inputs.hrMax, HR_MAX_RANGE.min, HR_MAX_RANGE.max)) return null;
    if (!inRange(inputs.hrResting, HR_RESTING_RANGE.min, HR_RESTING_RANGE.max)) return null;
    // Karvonen is only meaningful when max > resting.
    if (inputs.hrResting >= inputs.hrMax) return null;
    return { method: "hrr", hrMax: inputs.hrMax, hrResting: inputs.hrResting, pcts };
  }
  if (inputs.method === "lthr") {
    if (!inRange(inputs.hrLthr, HR_LTHR_RANGE.min, HR_LTHR_RANGE.max)) return null;
    return { method: "lthr", hrLthr: inputs.hrLthr, pcts };
  }
  return null;
}

/**
 * Compute Z1–Z5 upper-edge boundaries from method inputs. Throws on
 * invalid inputs — call `validateHrZoneInputs` first when you want
 * silent failure (the settings UI does this on every keystroke).
 *
 * Formulas:
 *  - `max`: Z1<60%, Z2 60–70, Z3 70–80, Z4 80–90, Z5 ≥ 90 of HRmax.
 *  - `hrr` (Karvonen): bands expressed as %HRR, anchored at resting:
 *      bpm = resting + pct × (max − resting). Z1<50%, Z2 50–60,
 *      Z3 60–70, Z4 70–85, Z5 ≥ 85.
 *  - `lthr` (Friel, 5-zone simplified): %LTHR breakpoints
 *      Z1<81%, Z2 81–89, Z3 90–93, Z4 94–99, Z5 ≥ 100. Friel's full
 *      system has Z5a/5b/5c — we collapse those to a single Z5 to
 *      match the rest of the app's 5-zone model.
 */
export function computeZoneBands(inputs: HrZoneInputs): ZoneBands {
  const validated = validateHrZoneInputs(inputs);
  if (!validated) throw new Error("Invalid heart-rate zone inputs");
  if (validated.method === "max") {
    return zoneBandsFromMaxHr(validated.hrMax, validated.pcts);
  }
  if (validated.method === "hrr") {
    const { hrMax, hrResting, pcts } = validated;
    const p = pcts ?? DEFAULT_ZONE_PCTS.hrr;
    const r = hrResting;
    const span = hrMax - hrResting;
    return {
      z1Max: r + p.z1 * span,
      z2Max: r + p.z2 * span,
      z3Max: r + p.z3 * span,
      z4Max: r + p.z4 * span,
    };
  }
  const { hrLthr, pcts } = validated;
  const p = pcts ?? DEFAULT_ZONE_PCTS.lthr;
  return {
    z1Max: hrLthr * p.z1,
    z2Max: hrLthr * p.z2,
    z3Max: hrLthr * p.z3,
    z4Max: hrLthr * p.z4,
  };
}

/**
 * Same as `computeZoneBands` but returns null instead of throwing.
 * Handy for live previews where partially-filled forms shouldn't crash.
 */
export function computeZoneBandsSafe(
  inputs: Partial<HrZoneInputs> & { method: HrMethod },
): ZoneBands | null {
  const validated = validateHrZoneInputs(inputs);
  if (!validated) return null;
  return computeZoneBands(validated);
}

/** Map a single avg-HR value to a zone using the configured bands. */
export function zoneForBpm(bpm: number, bands: ZoneBands): Zone {
  if (bpm < bands.z1Max) return "Z1";
  if (bpm < bands.z2Max) return "Z2";
  if (bpm < bands.z3Max) return "Z3";
  if (bpm < bands.z4Max) return "Z4";
  return "Z5";
}

/**
 * Bucket activities into total seconds-per-zone using session-average
 * HR. Activities without an avg HR are skipped (the card surfaces a
 * dropped-count footnote when needed).
 */
export function bucketByZone(
  activities: ActivitySummary[],
  bands: ZoneBands,
): { totals: ZoneTotals; skipped: number } {
  const totals: ZoneTotals = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let skipped = 0;
  for (const a of activities) {
    if (a.avgHrBpm == null || !Number.isFinite(a.avgHrBpm) || a.avgHrBpm <= 0) {
      skipped += 1;
      continue;
    }
    const zone = zoneForBpm(a.avgHrBpm, bands);
    totals[zone] += a.durationSec;
  }
  return { totals, skipped };
}

/**
 * Coerce a free-form `cardio_logs.hr_zones` jsonb value into per-zone
 * seconds as `ZoneTotals`, or null if unusable. Accepts the lowercase
 * `z1`..`z5` shape persisted on historical rows (also tolerates
 * capitalised keys); missing keys count as 0 seconds.
 */
export function coerceStoredZones(value: unknown): ZoneTotals | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const pick = (k: string): number => {
    const raw = obj[k.toLowerCase()] ?? obj[k.toUpperCase()];
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const totals: ZoneTotals = {
    Z1: pick("z1"),
    Z2: pick("z2"),
    Z3: pick("z3"),
    Z4: pick("z4"),
    Z5: pick("z5"),
  };
  if (ZONES.reduce((acc, z) => acc + totals[z], 0) <= 0) return null;
  return totals;
}

/** One cardio row as consumed by the zone accumulator. */
export type ZoneActivity = {
  durationSec: number;
  avgHrBpm: number | null;
  /** Stored per-zone seconds (measured stream or summary approximation). */
  hrZones?: unknown;
};

export type ZoneSource = "measured" | "approximated" | "mixed";

/**
 * Accumulate seconds-per-zone across activities, preferring each row's
 * **stored** `hr_zones` distribution (the same value the engine doses
 * off, ADR 0009 Decision 2) and falling back to single-avg-HR bucketing
 * only for rows that lack a stored distribution. This unifies the card
 * with the engine: the number the user sees is the number the engine acts
 * on.
 *
 *  - `contributing` — activities that added time to a zone.
 *  - `skipped`      — activities with neither stored zones nor a usable
 *                     avg HR.
 *  - `source`       — "measured" if every contributing row used stored
 *                     zones, "approximated" if every contributing row fell
 *                     back to avg-HR bucketing, "mixed" otherwise.
 */
export function accumulateZoneTotals(
  activities: ZoneActivity[],
  bands: ZoneBands,
): { totals: ZoneTotals; contributing: number; skipped: number; source: ZoneSource } {
  const totals: ZoneTotals = { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 };
  let contributing = 0;
  let skipped = 0;
  let measured = 0;
  let approximated = 0;

  for (const a of activities) {
    const stored = coerceStoredZones(a.hrZones);
    if (stored) {
      for (const z of ZONES) totals[z] += stored[z];
      contributing += 1;
      measured += 1;
      continue;
    }
    if (a.avgHrBpm != null && Number.isFinite(a.avgHrBpm) && a.avgHrBpm > 0) {
      totals[zoneForBpm(a.avgHrBpm, bands)] += a.durationSec;
      contributing += 1;
      approximated += 1;
      continue;
    }
    skipped += 1;
  }

  const source: ZoneSource =
    measured > 0 && approximated === 0
      ? "measured"
      : approximated > 0 && measured === 0
        ? "approximated"
        : "mixed";

  return { totals, contributing, skipped, source };
}

export type PolarisedSplit = {
  easyPct: number;      // Z1 + Z2
  thresholdPct: number; // Z3
  hardPct: number;      // Z4 + Z5
};

/** Compute the easy / threshold / hard percentage split for the polarised one-liner. */
export function polarisedSplit(totals: ZoneTotals): PolarisedSplit {
  const total = ZONES.reduce((acc, z) => acc + totals[z], 0);
  if (total === 0) return { easyPct: 0, thresholdPct: 0, hardPct: 0 };
  return {
    easyPct: (totals.Z1 + totals.Z2) / total,
    thresholdPct: totals.Z3 / total,
    hardPct: (totals.Z4 + totals.Z5) / total,
  };
}

export type HrZoneState =
  | { kind: "no-zones" }
  | { kind: "no-hr-data" }
  | {
      kind: "ok";
      totals: ZoneTotals;
      split: PolarisedSplit;
      bands: ZoneBands;
      activityCount: number;
      droppedCount: number;
      windowDays: number;
      /** Whether the distribution came from measured streams, the summary approximation, or a mix. */
      source: ZoneSource;
    };

/**
 * Read the user's HR-zone configuration off the profile `intake` blob.
 * The blob is intentionally untyped (`jsonb`) so we narrow defensively.
 */
export function readZoneConfig(intake: Record<string, unknown> | null | undefined): ZoneBands | null {
  if (!intake) return null;
  const explicit = intake.hrZones as Partial<ZoneBands> | undefined;
  if (
    explicit &&
    typeof explicit.z1Max === "number" &&
    typeof explicit.z2Max === "number" &&
    typeof explicit.z3Max === "number" &&
    typeof explicit.z4Max === "number"
  ) {
    return {
      z1Max: explicit.z1Max,
      z2Max: explicit.z2Max,
      z3Max: explicit.z3Max,
      z4Max: explicit.z4Max,
    };
  }
  const hrMax = intake.hrMax;
  if (typeof hrMax === "number" && hrMax > 60 && hrMax < 260) {
    return zoneBandsFromMaxHr(hrMax);
  }
  return null;
}

/**
 * Server fetcher — returns the discriminated state the card renders
 * directly. windowDays defaults to 28 (≈ 4 weeks).
 */
export async function getHrZones(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  windowDays = 28,
): Promise<HrZoneState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("intake")
    .eq("id", userId)
    .maybeSingle();
  const bands = readZoneConfig((profile?.intake as Record<string, unknown> | null) ?? null);

  const today = todayYmd(tz);
  const since = addDaysToYmd(today, -windowDays);

  const { data: logs } = await supabase
    .from("cardio_logs")
    .select(
      "duration_sec, avg_hr_bpm, hr_zones, session:sessions!inner(performed_at, deleted_at, user_id)",
    )
    .eq("session.user_id", userId)
    .is("session.deleted_at", null)
    .gte("session.performed_at", `${since}T00:00:00Z`);

  const activities: ZoneActivity[] = [];
  for (const row of logs ?? []) {
    const session = Array.isArray(row.session) ? row.session[0] : row.session;
    if (!session) continue;
    activities.push({
      durationSec: row.duration_sec ?? 0,
      avgHrBpm: row.avg_hr_bpm == null ? null : Number(row.avg_hr_bpm),
      hrZones: row.hr_zones,
    });
  }

  // An activity counts as "HR-tagged" if it has either a stored zone
  // distribution or a usable average HR.
  const hasHr = activities.filter(
    (a) =>
      coerceStoredZones(a.hrZones) != null ||
      (a.avgHrBpm != null && Number.isFinite(a.avgHrBpm) && a.avgHrBpm > 0),
  );
  if (hasHr.length === 0) return { kind: "no-hr-data" };
  if (!bands) return { kind: "no-zones" };

  const { totals, contributing, skipped, source } = accumulateZoneTotals(activities, bands);
  return {
    kind: "ok",
    totals,
    split: polarisedSplit(totals),
    bands,
    activityCount: contributing,
    droppedCount: skipped,
    windowDays,
    source,
  };
}
