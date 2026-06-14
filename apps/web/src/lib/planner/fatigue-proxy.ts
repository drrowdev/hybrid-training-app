/**
 * ADR 0032 (Phase 3) — combined-load fatigue proxy + early-deload gate (PURE).
 *
 * The reactive auto-deload (`engine/deload.ts`) catches acute strength failure
 * (2 AMRAP misses → TM −10%). It is blind to ACCUMULATED COMBINED load — in
 * particular the systemic fatigue of concurrent endurance volume, which never
 * shows up as an AMRAP miss. This proxy fills that gap: a single normalised
 * [0,1] fatigue estimate from signals the app already collects, weighted by the
 * block's dominant load type, used to ADVISE bringing a deload forward.
 *
 * It is deliberately conservative and advisory: the scheduled deload always
 * remains (the fixed fallback); a high proxy only ever SURFACES a choice. All
 * weights/thresholds are CP-1 / Stage-A heuristics — the principle
 * (deload-cadence ∝ accumulated combined load) is grounded (ADR 0030
 * citations), the magnitudes are not yet calibrated.
 *
 * No I/O — unit-tested. The server gather lives in `early-deload-offer.ts`.
 */

export type FatigueArchetypeKey = "strength" | "endurance" | "balanced" | "low";

/** Map an archetype id to its dominant accumulated-load character. */
export function fatigueArchetypeKey(archetype: string): FatigueArchetypeKey {
  switch (archetype) {
    case "strength_anchor":
    case "hypertrophy_anchor":
      return "strength"; // intensity / tonnage-ramp dominant
    case "endurance_anchor":
      return "endurance"; // aerobic-volume / interference dominant
    case "concurrent_hybrid":
      return "balanced";
    case "rebuild":
    case "maintenance":
      return "low"; // low-load by design — rarely triggers
    default:
      return "balanced"; // custom
  }
}

/** The archetypes whose load character is known up-front (native/Hybrid blocks). */
const KNOWN_FATIGUE_ARCHETYPES = new Set([
  "strength_anchor",
  "hypertrophy_anchor",
  "endurance_anchor",
  "concurrent_hybrid",
  "rebuild",
  "maintenance",
]);

/**
 * Derive the load character from the user's ACTUAL strength-vs-cardio day mix
 * (ADR 0046 Phase 3). Foreign programs (5/3/1, Tactical Barbell) prescribe a
 * fixed number of strength days but the user adds however much cardio they want,
 * so a hardcoded per-program "strength / endurance / mixed" label is wrong — the
 * character is whatever the user is actually doing. Mostly strength → tonnage-
 * weighted; lots of cardio → interference-weighted; little training → low.
 * [DEF→cal] CP-1 — heuristic fractions.
 */
export function fatigueKeyFromMix(strengthDays: number, cardioDays: number): FatigueArchetypeKey {
  const total = strengthDays + cardioDays;
  if (total < 2) return "low"; // barely training — the proxy rarely matters
  const cardioFrac = cardioDays / total;
  if (cardioFrac < 0.25) return "strength";
  if (cardioFrac > 0.6) return "endurance";
  return "balanced";
}

/**
 * Resolve the fatigue load character. Native/Hybrid blocks keep their archetype-
 * tuned key (byte-identical). Foreign programs (no known archetype) derive it
 * from the actual strength:cardio day mix when available, else fall back to the
 * archetype map (which yields "balanced" for an unknown id).
 */
export function resolveFatigueKey(
  archetype: string,
  mix?: { strengthDays: number; cardioDays: number },
): FatigueArchetypeKey {
  if (KNOWN_FATIGUE_ARCHETYPES.has(archetype)) return fatigueArchetypeKey(archetype);
  if (mix) return fatigueKeyFromMix(mix.strengthDays, mix.cardioDays);
  return fatigueArchetypeKey(archetype);
}

/**
 * Per-character term weights {loadRamp, cardio, subjective}, summing to 1.
 * This is where Phase 3 earns the archetype differentiation ADR 0030 / Phase 1
 * deliberately deferred: endurance blocks weight the cardio-interference term
 * heaviest; strength blocks weight the tonnage-ramp + subjective terms.
 * [DEF→cal] CP-2 — Stage-A heuristic magnitudes.
 */
const FATIGUE_WEIGHTS: Record<FatigueArchetypeKey, { load: number; cardio: number; subj: number }> = {
  strength: { load: 0.5, cardio: 0.1, subj: 0.4 },
  endurance: { load: 0.2, cardio: 0.5, subj: 0.3 },
  balanced: { load: 0.35, cardio: 0.35, subj: 0.3 },
  low: { load: 0.3, cardio: 0.3, subj: 0.4 },
};

/** Proxy at / above this → recommend an early deload. [DEF→cal] CP-2. */
export const EARLY_DELOAD_THRESHOLD = 0.7;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Tonnage-ramp term (ACWR-style). acute = most-recent completed week's
 * tonnage, chronic = trailing mean. ramp 1.0 → 0, 1.5+ → 1. A sharp acute
 * spike over the chronic baseline is the classic injury/overreach signal
 * (Soligard 2016 IOC consensus, the same basis as the region-spike banner).
 */
export function loadRampTerm(acuteTonnage: number, chronicTonnage: number): number {
  if (chronicTonnage <= 0) return 0; // no baseline → no ramp signal
  const ramp = acuteTonnage / chronicTonnage;
  return clamp01((ramp - 1) / 0.5);
}

/**
 * Cardio-interference term from the concurrent scalar (1.0 = no cardio →
 * 0.6 = saturated). scalar 1.0 → 0, 0.6 → 1. This is the endurance-load term
 * that nothing else feeds into the deload decision.
 */
export function cardioInterferenceTerm(concurrentScalar: number): number {
  return clamp01((1 - concurrentScalar) / 0.4);
}

/**
 * Subjective-fatigue term from the recent recovery inputs. fatigue/soreness on
 * the 1–5 scale (recovered = < 4); sRPE on 0–10 (overreach = > 9). Takes the
 * worse of the two signals so either an elevated check-in OR a peak hard
 * session registers.
 */
export function subjectiveTerm(args: {
  avgFatigue: number | null;
  avgSoreness: number | null;
  maxSrpe: number | null;
}): number {
  const fatigue = args.avgFatigue ?? 1;
  const soreness = args.avgSoreness ?? 1;
  const fs = clamp01((((fatigue + soreness) / 2) - 2) / 2); // 2 → 0, 4 → 1
  const rpe = clamp01(((args.maxSrpe ?? 0) - 7) / 2); // 7 → 0, 9 → 1
  return Math.max(fs, rpe);
}

export type FatigueProxyInput = {
  archetype: string;
  /**
   * The user's actual strength-vs-cardio day mix, used to derive the load
   * character for foreign programs (no known archetype). Omitted by native/Hybrid
   * callers — they key off the archetype as before.
   */
  loadMix?: { strengthDays: number; cardioDays: number };
  acuteTonnage: number;
  chronicTonnage: number;
  concurrentScalar: number;
  avgFatigue: number | null;
  avgSoreness: number | null;
  maxSrpe: number | null;
};

export type FatigueProxy = {
  proxy: number; // 0..1
  terms: { load: number; cardio: number; subjective: number };
  weights: { load: number; cardio: number; subj: number };
  key: FatigueArchetypeKey;
};

/** Combine the three normalised terms with the resolved load character's weights. */
export function computeFatigueProxy(input: FatigueProxyInput): FatigueProxy {
  const key = resolveFatigueKey(input.archetype, input.loadMix);
  const weights = FATIGUE_WEIGHTS[key];
  const load = loadRampTerm(input.acuteTonnage, input.chronicTonnage);
  const cardio = cardioInterferenceTerm(input.concurrentScalar);
  const subjective = subjectiveTerm(input);
  const proxy = weights.load * load + weights.cardio * cardio + weights.subj * subjective;
  return { proxy: clamp01(proxy), terms: { load, cardio, subjective }, weights, key };
}

/**
 * Gate for surfacing an early-deload recommendation. Conservative by design —
 * the scheduled deload is the fixed fallback, so this only fires when there's
 * meaningful loading left, enough data to trust the proxy, and no deload
 * already happened this block.
 */
export function shouldRecommendEarlyDeload(args: {
  proxy: number;
  dataSufficient: boolean;
  /** Loading weeks remaining before the SCHEDULED deload. */
  loadingWeeksLeft: number;
  /** A reactive OR early deload already fired this block. */
  recentDeloadAlready: boolean;
}): boolean {
  if (!args.dataSufficient) return false;
  if (args.recentDeloadAlready) return false;
  // Within ~1 week of the scheduled deload, just take it — no point pulling it in.
  if (args.loadingWeeksLeft < 2) return false;
  return args.proxy >= EARLY_DELOAD_THRESHOLD;
}
