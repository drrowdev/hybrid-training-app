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
  | "carry"
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
/**
 * Slug fragments that identify a loaded-carry variant. Carries are
 * programmed by distance (meters) or time — never by reps — per the
 * trunk-endurance literature (McGill 2014: loaded carries train the
 * trunk to resist motion under load over a meaningful work bout).
 */
const CARRY_KEYWORDS = [
  "carry",
  "farmer_walk",
  "farmer-walk",
  "farmer walk",
  "suitcase_walk",
  "suitcase-walk",
  "loaded-walk",
  "loaded_walk",
];

const ISOMETRIC_KEYWORDS = [
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
 *      tendon keyword (e.g. "hsr-rdl", "eccentric-heel-raise"). The
 *      Copenhagen plank was listed here and so was dosed as rep-based
 *      HSR (ADR 0041's `HSR_REPS = 8` plus a 3 s eccentric cue). It is a
 *      hold, not a rep-and-tempo lift, so it now falls through to the
 *      isometric bucket below and is prescribed for time.
 *   2. Plyometric — `reason === "power"`, OR bulletproof plyo roles,
 *      OR slug matches a plyo keyword. Honours the catalog's
 *      `highStrainTendon` flag as a separate plyo signal.
 *   3. Carry — loaded-carry variants (farmer / suitcase / overhead /
 *      front-loaded / Zercher). Programmed as distance, not reps —
 *      McGill 2014 + practitioner consensus.
 *   4. Isometric — bulletproof "heavy_isometric" role, or slug matches
 *      a plank / wall-sit / dead-bug / hold keyword.
 *   5. Isolation — single-muscle, non-compound movement.
 *   6. Compound — everything else (default).
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
    functional.has("power_ballistic") ||
    functional.has("power_plyometric") ||
    slugHas(slug, PLYOMETRIC_KEYWORDS)
  ) {
    return "plyometric";
  }

  // 3. Carry — must precede isometric so the "carry" bulletproof
  //    role lands in the distance-prescribed bucket rather than the
  //    legacy hold-time bucket.
  if (
    bulletproof.has("carry") ||
    slugHas(slug, CARRY_KEYWORDS)
  ) {
    return "carry";
  }

  // 4. Isometric
  if (
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
  /**
   * Distance range in metres for loaded-carry items. Carries are
   * programmed as distance (or time), never reps — McGill 2014
   * (trunk-endurance under load) + practitioner consensus.
   */
  distanceM?: { min: number; max: number };
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
  /** Per-week distance range for carries (one entry per week index 0..3). */
  distance?: { min: number; max: number };
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
  // Carries are handled out-of-band via CARRY_DISTANCE_MATRIX below —
  // distance prescriptions vary explicitly per week rather than via a
  // uniform week offset.
  carry: {
    strength_anchor: {},
    hypertrophy_anchor: {},
    endurance_anchor: {},
    concurrent_hybrid: {},
    rebuild: {},
    maintenance: {},
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
 * Per-week distance prescription for loaded carries, in metres.
 * Index 0..2 maps to the three wave positions; index 3 is the deload
 * (ADR 0030 — selected by the explicit deload flag, not an absolute index).
 *
 * Sources:
 *   - McGill 2014 — loaded carries train trunk endurance under load;
 *     work intervals are time / distance based, not rep based.
 *   - Practitioner consensus for hybrid blocks: 20–50 m per trip, 2–4
 *     trips, with the heaviest week landing in week 2 or 3 and a
 *     reduced bout on the deload week.
 *
 * Maintenance archetype only runs two prescribed weeks (3 / 4 fall
 * through to the same minimal distance as week 1/2).
 */
const CARRY_DISTANCE_MATRIX: Record<MatrixArchetype, ReadonlyArray<{ min: number; max: number }>> = {
  strength_anchor: [
    { min: 20, max: 30 },
    { min: 30, max: 40 },
    { min: 30, max: 40 },
    { min: 20, max: 20 },
  ],
  hypertrophy_anchor: [
    { min: 30, max: 40 },
    { min: 40, max: 50 },
    { min: 40, max: 50 },
    { min: 25, max: 25 },
  ],
  endurance_anchor: [
    { min: 30, max: 40 },
    { min: 30, max: 40 },
    { min: 30, max: 40 },
    { min: 20, max: 20 },
  ],
  concurrent_hybrid: [
    { min: 25, max: 35 },
    { min: 30, max: 40 },
    { min: 30, max: 40 },
    { min: 20, max: 20 },
  ],
  rebuild: [
    { min: 15, max: 20 },
    { min: 20, max: 25 },
    { min: 20, max: 25 },
    { min: 15, max: 15 },
  ],
  maintenance: [
    { min: 20, max: 20 },
    { min: 20, max: 20 },
    { min: 20, max: 20 },
    { min: 20, max: 20 },
  ],
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
  if (bucket === "carry") {
    return "Brace hard. Walk heavy with controlled steps. Set the load down between trips.";
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
/**
 * Wave-relative week role. The loading wave is 3 weeks; a standard block runs
 * one or more waves (ADR 0030) then a single deload. `weekRirOffset` shapes
 * the RIR by position WITHIN the wave (so a repeated wave shapes identically),
 * and the deload is signalled explicitly by the caller rather than inferred
 * from an absolute index.
 *   - wave position 0 — ramp (lighter / introductory): +1 RIR
 *   - wave position 1/2 — build / push: +0
 *   - deload: +2 RIR; isometric holds drop to 60% duration.
 * The main lift already provides the heavy stimulus; we don't compete with it
 * on accessories (Israetel volume-landmark wave).
 */
const ACCESSORY_WAVE_LENGTH = 3;

function weekRirOffset(weekIndex: number, isDeload: boolean): number {
  if (isDeload) return 2;
  return weekIndex % ACCESSORY_WAVE_LENGTH === 0 ? 1 : 0;
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
  /**
   * True on the block's volume-led deload week. Defaults to the legacy
   * single-wave convention (`weekIndex === 3`) so existing callers and unit
   * tests stay byte-identical; multi-wave callers (ADR 0030) pass it
   * explicitly because the deload is no longer at a fixed index.
   */
  isDeload?: boolean;
}): AccessoryIntensity {
  const archetype: MatrixArchetype =
    args.archetype === "custom" ? "strength_anchor" : args.archetype;
  const bucket = args.bucket;
  const base = BASE_MATRIX[bucket][archetype];
  const isDeload = args.isDeload ?? args.weekIndex === 3;
  const offset = weekRirOffset(args.weekIndex, isDeload);
  const cue = cueFor(bucket, archetype);

  const out: AccessoryIntensity = { intensityCue: cue };

  if (bucket === "plyometric") {
    // Max-intent — encode as RPE 10 with no week modifier.
    if (base.rpe) out.targetRpe = { ...base.rpe };
    return out;
  }

  if (bucket === "carry") {
    // Distance-based prescription — McGill 2014 + practitioner consensus.
    // Build weeks read the escalating wave distances (wave-relative 0..2);
    // the deload reads the reduced final-row distance.
    const idx = isDeload
      ? CARRY_DISTANCE_MATRIX[archetype].length - 1
      : Math.min(ACCESSORY_WAVE_LENGTH - 1, args.weekIndex % ACCESSORY_WAVE_LENGTH);
    const row = CARRY_DISTANCE_MATRIX[archetype][idx];
    if (row) out.distanceM = { ...row };
    return out;
  }

  if (bucket === "isometric") {
    if (base.hold) {
      if (isDeload) {
        // Deload: drop hold time to 60% of base (rounded).
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

/**
 * Build the autoregulation slice of a `PrescriptionItem` from the
 * matrix output. Keeps the picker-path and legacy-pool-path in
 * actions.ts in sync, and crucially enforces the carry contract:
 * carries are programmed by distance, never reps, so we strip the
 * caller's tentative rep target when the bucket is `"carry"`.
 *
 * Returns a partial — the caller layers it on top of the movement
 * identifier + set count fields it owns.
 */
export function accessoryItemPrescription(args: {
  bucket: AccessoryBucket;
  intensity: AccessoryIntensity;
  /** Tentative rep target from the picker. Dropped for carries. */
  reps: number | undefined;
}): {
  reps: number | undefined;
  targetRir?: RirRange;
  targetRpe?: RirRange;
  tempoEccentricSec?: number;
  holdSec?: { min: number; max: number };
  distanceM?: { min: number; max: number };
  intensityCue?: string;
} {
  const isCarry = args.bucket === "carry";
  return {
    reps: isCarry ? undefined : args.reps,
    targetRir: args.intensity.targetRir,
    targetRpe: args.intensity.targetRpe,
    tempoEccentricSec: args.intensity.tempoEccentricSec,
    holdSec: args.intensity.holdSec,
    distanceM: args.intensity.distanceM,
    intensityCue: args.intensity.intensityCue,
  };
}
