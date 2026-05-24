/**
 * Research-grounded RIR / RPE / tempo guidance for accessory items.
 *
 * Why this exists
 * ───────────────
 * The strength engine prescribes main lifts as a percent of training-max
 * (standard practitioner-consensus linear-periodisation practice; Helms
 * 2018 covers the autoregulation half of the same toolkit). That model
 * doesn't transfer to accessories: isolation 1RMs aren't reliable, and
 * forcing a %TM on a lateral raise or a banded copenhagen plank is
 * meaningless. The practitioner-consensus replacement is to autoregulate
 * accessories by Reps-in-Reserve (RIR) or RPE — "how many more clean reps
 * could you have done" — and to cue tempo on tendon work.
 *
 * Citations (kept here, never in user-facing UI copy):
 *   - Helms 2018 — autoregulation via RPE/RIR is the appropriate cue for
 *     accessories because 1RM-based load doesn't translate to isolation
 *     work and intra-day strength varies meaningfully.
 *   - Schoenfeld 2017 — 6–12 reps at RPE 7–9 (RIR 1–3) effective for
 *     hypertrophy; 12–20 reps at RPE 7–8 (RIR 2–3) similarly effective
 *     when proximity to failure is controlled.
 *   - Israetel — volume landmarks scale week to week within a wave
 *     (MEV → MAV → MRV); RIR tightens as the user approaches the volume
 *     peak then opens back up on deload.
 *   - Baar 2017 / Kongsgaard 2009 — heavy slow resistance tendon work
 *     needs slow tempo (3 s+ eccentric) at sub-maximal load; the cue is
 *     "control and time-under-tension," NOT failure.
 *   - Behm & Sale 1993 — plyometric / power work uses max intent at low
 *     rep counts; RPE/RIR don't apply because the adaptation is neural
 *     (RFD) rather than metabolic / mechanical-tension driven.
 *
 * Pure module. No I/O. No DB. No React.
 */
import type { ArchetypeId } from "./archetypes";

/**
 * The five accessory buckets. Bucket detection runs off movement metadata
 * + the picker's `reason` tag (see `inferAccessoryBucket`).
 */
export type AccessoryBucket =
  | "compound"
  | "isolation"
  | "isometric"
  | "plyometric"
  | "tendon";

/** Minimal movement shape needed to infer a bucket. */
export type AccessoryBucketInput = {
  /** Picker rationale tag (durability / functional / aesthetic / power). */
  reason?: "durability" | "functional" | "aesthetic" | "power";
  /** Movement slug (lower-cased before keyword matching). */
  slug?: string;
  /** Primary region tag from the movement catalog (e.g. "lumbar_trunk"). */
  primaryRegion?: string;
  /** Primary muscles array — single entry implies isolation when not compound. */
  primaryMuscles?: string[];
  /** True for multi-joint barbell / dumbbell movements. */
  isCompound?: boolean;
  /** Bulletproof role tags from the catalog. */
  bulletproofRoles?: ReadonlyArray<string>;
  /** Functional role tags from the catalog. */
  functionalRoles?: ReadonlyArray<string>;
  /** Catalog flag for high-strain tendon work (jumps on a sore tendon, etc.). */
  highStrainTendon?: boolean;
};

/**
 * Slug-keyword tables. Kept short + descriptive — broader than the
 * picker's role tags so legacy / custom-block items still classify
 * correctly when role metadata is missing.
 */
const ISOMETRIC_KEYWORDS = [
  "carry",
  "plank",
  "wall-sit",
  "wall_sit",
  "wall sit",
  "dead-bug",
  "dead_bug",
  "dead bug",
  "deadbug",
  "side-plank",
  "side_plank",
  "side plank",
  "copenhagen-hold",
  "hold",
];

const PLYOMETRIC_KEYWORDS = [
  "jump",
  "throw",
  "plyo",
  "ballistic",
  "bound",
  "hop",
  "pogo",
  "med-ball",
  "med ball",
  "medicine-ball",
  "broad-jump",
  "depth-jump",
  "power-clean",
  "power clean",
];

const TENDON_KEYWORDS = [
  "hsr",
  "isometric-hold",
  "tendon",
  "eccentric-heel",
  "copenhagen-plank",
];

function slugHas(slug: string | undefined, keywords: string[]): boolean {
  if (!slug) return false;
  const s = slug.toLowerCase();
  return keywords.some((k) => s.includes(k));
}

/**
 * Infer the accessory bucket for an item.
 *
 * Precedence (first match wins):
 *   1. Tendon — `bulletproofRoles` includes "hsr" OR slug matches a
 *      tendon keyword (e.g. "hsr-rdl", "copenhagen-plank").
 *   2. Plyometric — `reason === "power"`, OR bulletproof plyo roles,
 *      OR slug matches a plyo keyword. Honours the catalog's
 *      `highStrainTendon` flag as a separate plyo signal.
 *   3. Isometric — bulletproof "carry" / "heavy_isometric" roles, or
 *      slug matches an isometric keyword.
 *   4. Isolation — single-muscle, non-compound movement.
 *   5. Compound — everything else (default).
 */
export function inferAccessoryBucket(
  input: AccessoryBucketInput,
): AccessoryBucket {
  const slug = input.slug?.toLowerCase();
  const bulletproof = new Set(input.bulletproofRoles ?? []);
  const functional = new Set(input.functionalRoles ?? []);

  // 1. Tendon
  if (bulletproof.has("hsr") || slugHas(slug, TENDON_KEYWORDS)) {
    return "tendon";
  }

  // 2. Plyometric / power
  if (
    input.reason === "power" ||
    bulletproof.has("plyometric_low") ||
    bulletproof.has("plyometric_high") ||
    functional.has("ballistic") ||
    functional.has("plyometric") ||
    slugHas(slug, PLYOMETRIC_KEYWORDS)
  ) {
    return "plyometric";
  }

  // 3. Isometric
  if (
    bulletproof.has("carry") ||
    bulletproof.has("heavy_isometric") ||
    slugHas(slug, ISOMETRIC_KEYWORDS)
  ) {
    return "isometric";
  }

  // 4. Isolation — single primary muscle, not compound
  const muscles = input.primaryMuscles ?? [];
  if (
    input.isCompound === false &&
    muscles.length === 1 &&
    muscles[0] !== undefined
  ) {
    return "isolation";
  }
  // Conservative fallback when isCompound is unknown: treat known
  // isolation regions (single-joint surfaces) as isolation.
  if (
    input.isCompound !== true &&
    muscles.length === 1 &&
    isIsolationMuscle(muscles[0]!)
  ) {
    return "isolation";
  }

  // 5. Compound (default).
  return "compound";
}

const ISOLATION_MUSCLES = new Set([
  "biceps",
  "triceps",
  "side_delts",
  "rear_delts",
  "front_delts",
  "calves",
  "forearms",
  "abs",
  "obliques",
  "hamstrings_isolation",
]);

function isIsolationMuscle(m: string): boolean {
  return ISOLATION_MUSCLES.has(m);
}

// ─── Intensity matrix ──────────────────────────────────────────────

/** Numeric RIR range. `min === max` for single-value targets. */
export type RirRange = { min: number; max: number };

export type AccessoryIntensity = {
  targetRir?: RirRange;
  targetRpe?: RirRange;
  /** Eccentric tempo in seconds (tendon items). */
  tempoEccentricSec?: number;
  /** Hold duration range for isometric items. */
  holdSec?: { min: number; max: number };
  /** Plain-English coaching cue. ≤ 80 chars. */
  intensityCue?: string;
};

/** Archetype IDs that participate in the matrix. Custom blocks fall back to compound/strength_anchor defaults. */
type MatrixArchetype = Exclude<ArchetypeId, "custom">;

/**
 * Base RIR / hold / tempo prescriptions per (bucket × archetype).
 * Week modifier is applied on top in `accessoryIntensity()`.
 *
 * Matrix sources:
 *   - Compound + isolation RIR — Schoenfeld 2017 (effective hypertrophy
 *     ranges at RPE 7–9 / RIR 1–3) + Helms 2018 (lighter cue on
 *     endurance / rebuild blocks where recovery is the bottleneck).
 *   - Isometric hold times — practitioner consensus for trunk-bracing
 *     work (20–60 s under control); hypertrophy block gets the upper
 *     end of the range to drive time-under-tension.
 *   - Plyo — Behm & Sale 1993: 3–5 reps max-intent, 2–3 min rest;
 *     reused for the concurrent-hybrid power day.
 *   - Tendon — Baar 2017 / Kongsgaard 2009: 3 s+ eccentric at RIR 2–3.
 */
type BaseEntry = {
  rir?: RirRange;
  /** Used in lieu of `rir` for plyometric. */
  rpe?: RirRange;
  hold?: { min: number; max: number };
  tempoEccentricSec?: number;
};

const BASE_MATRIX: Record<AccessoryBucket, Record<MatrixArchetype, BaseEntry>> = {
  compound: {
    strength_anchor: { rir: { min: 2, max: 3 } },
    hypertrophy_anchor: { rir: { min: 1, max: 2 } },
    endurance_anchor: { rir: { min: 3, max: 3 } },
    concurrent_hybrid: { rir: { min: 2, max: 2 } },
    rebuild: { rir: { min: 3, max: 3 }, tempoEccentricSec: 3 },
    maintenance: { rir: { min: 3, max: 3 } },
  },
  isolation: {
    strength_anchor: { rir: { min: 2, max: 2 } },
    // Hypertrophy: 0–1 RIR — last set to failure cue lives in `intensityCue`.
    hypertrophy_anchor: { rir: { min: 0, max: 1 } },
    endurance_anchor: { rir: { min: 3, max: 3 } },
    concurrent_hybrid: { rir: { min: 2, max: 2 } },
    rebuild: { rir: { min: 2, max: 2 } },
    maintenance: { rir: { min: 3, max: 3 } },
  },
  isometric: {
    strength_anchor: { hold: { min: 20, max: 40 } },
    hypertrophy_anchor: { hold: { min: 30, max: 60 } },
    endurance_anchor: { hold: { min: 20, max: 20 } },
    concurrent_hybrid: { hold: { min: 30, max: 30 } },
    rebuild: { hold: { min: 30, max: 30 } },
    maintenance: { hold: { min: 20, max: 20 } },
  },
  plyometric: {
    // RPE phrasing here is conventional — max-intent at low rep counts.
    // Behm & Sale 1993: not autoregulated; we encode the cue separately.
    strength_anchor: { rpe: { min: 10, max: 10 } },
    hypertrophy_anchor: { rpe: { min: 10, max: 10 } },
    endurance_anchor: { rpe: { min: 10, max: 10 } },
    concurrent_hybrid: { rpe: { min: 10, max: 10 } },
    rebuild: { rpe: { min: 10, max: 10 } },
    maintenance: { rpe: { min: 10, max: 10 } },
  },
  tendon: {
    strength_anchor: { rir: { min: 2, max: 2 }, tempoEccentricSec: 3 },
    hypertrophy_anchor: { rir: { min: 2, max: 2 }, tempoEccentricSec: 3 },
    endurance_anchor: { rir: { min: 3, max: 3 }, tempoEccentricSec: 3 },
    concurrent_hybrid: { rir: { min: 2, max: 2 }, tempoEccentricSec: 3 },
    rebuild: { rir: { min: 2, max: 2 }, tempoEccentricSec: 3 },
    maintenance: { rir: { min: 3, max: 3 }, tempoEccentricSec: 3 },
  },
};

/**
 * Cue copy per (bucket × archetype). Plain English, ≤ 80 chars per line,
 * no methodology names or external program references. The few
 * archetype-specific variants live inline; everything else falls through
 * to the generic bucket cue.
 */
function cueFor(
  bucket: AccessoryBucket,
  archetype: MatrixArchetype,
): string {
  if (bucket === "compound") {
    return "Pick a weight you can finish cleanly. 2–3 in the tank on the last set.";
  }
  if (bucket === "isolation") {
    if (archetype === "hypertrophy_anchor") {
      return "Last set to failure. Drop weight if form breaks.";
    }
    return "Clean reps. Leave 1–2 in the tank.";
  }
  if (bucket === "isometric") {
    return "Hold steady. Stop when bracing breaks.";
  }
  if (bucket === "tendon") {
    return "3-second lowering. Smooth and controlled — load adapts, not fatigue.";
  }
  // plyometric
  return "Maximum intent on every rep. Long rest between sets.";
}

/**
 * Week-of-block modifier. The 4-week wave shape used by every archetype
 * (see `archetypes.ts` weekProfiles) is:
 *   - weekIndex 0 — ramp (lighter / introductory)
 *   - weekIndex 1 — build (baseline)
 *   - weekIndex 2 — push / peak (volume + intensity high)
 *   - weekIndex 3 — recover / deload (lightest)
 *
 * Per Israetel volume-landmark theory: the main lift takes the
 * peak-week intensity; we don't compete with it on accessories. So:
 *   - Week 0: +1 RIR (leave more in the tank during ramp)
 *   - Week 1: baseline
 *   - Week 2: baseline
 *   - Week 3 (deload): +2 RIR; isometric holds drop to 60% duration.
 *
 * Plyometric items ignore the RIR modifier — they're cued by intent,
 * not by proximity to failure (Behm & Sale 1993).
 */
function weekRirOffset(weekIndex: number): number {
  if (weekIndex === 0) return 1;
  if (weekIndex === 3) return 2;
  return 0;
}

function clampRir(r: number): number {
  if (r < 0) return 0;
  if (r > 5) return 5;
  return r;
}

function applyRirOffset(base: RirRange, offset: number): RirRange {
  return { min: clampRir(base.min + offset), max: clampRir(base.max + offset) };
}

/**
 * Compute the intensity prescription for an accessory item.
 *
 * Pure function — input determines output. `weekIndex` is 0-indexed
 * (week 1 of the block = index 0). Custom archetypes fall back to the
 * strength-anchor row of the matrix.
 */
export function accessoryIntensity(args: {
  archetype: ArchetypeId;
  bucket: AccessoryBucket;
  weekIndex: number;
}): AccessoryIntensity {
  const archetype: MatrixArchetype =
    args.archetype === "custom" ? "strength_anchor" : args.archetype;
  const bucket = args.bucket;
  const base = BASE_MATRIX[bucket][archetype];
  const offset = weekRirOffset(args.weekIndex);
  const cue = cueFor(bucket, archetype);

  const out: AccessoryIntensity = { intensityCue: cue };

  if (bucket === "plyometric") {
    // Max-intent — encode as RPE 10 with no week modifier.
    if (base.rpe) out.targetRpe = { ...base.rpe };
    return out;
  }

  if (bucket === "isometric") {
    if (base.hold) {
      if (args.weekIndex === 3) {
        // Week 4 (deload): drop hold time to 60% of base (rounded).
        out.holdSec = {
          min: Math.max(5, Math.round(base.hold.min * 0.6)),
          max: Math.max(5, Math.round(base.hold.max * 0.6)),
        };
      } else {
        out.holdSec = { ...base.hold };
      }
    }
    return out;
  }

  if (base.rir) out.targetRir = applyRirOffset(base.rir, offset);
  if (base.tempoEccentricSec != null) {
    out.tempoEccentricSec = base.tempoEccentricSec;
  }
  return out;
}
