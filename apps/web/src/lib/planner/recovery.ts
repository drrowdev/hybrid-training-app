/**
 * Post-race recovery window — symmetric counterpart to the pre-race
 * taper. Given a just-finished priority event, returns how long the
 * engine should down-shift load and how aggressively, including a
 * linear ramp back to baseline.
 *
 * The numbers below are the engine's defaults; the user opts in
 * explicitly via the Recovery banner on Today (no auto-apply). The
 * banner snapshots the full output into prescription_modifications
 * so an Undo reverses exactly what was Applied.
 *
 * Citations are inline next to each constant in
 * "// per Author Year, Journal, ConfidenceTier" form, mirroring
 * lib/planner/taper.ts. ConfidenceTier values:
 *   T1 = strong RCT or meta-analysis
 *   T2 = repeat cohort / well-controlled observational
 *   T3 = mechanistic / single-cohort / extrapolation
 *
 * Top-level synthesis (not per-line):
 *   - Hikida 1983 PMID 6822642 — myofibrillar disruption persists
 *     7–10 days after a marathon (T2).
 *   - Nieman 2007 PMID 17218417 — systemic inflammation, immune
 *     suppression peak 24–72 h post-marathon (T2).
 *   - Howatson 2008 — exercise-induced muscle damage recovery review
 *     (T2). Underpins the strength=0 bracket through 7d.
 *   - Byrne 2002 PMID 12173956 — neuromuscular function loss after
 *     prolonged exercise; partial recovery at 7d, full at 14d (T2).
 *   - Newham 1983 PMID 6875963 — eccentric damage repair timecourse
 *     (T3). Underpins the linear ramp.
 *   - Clarkson & Hubal 2002 — EIMD review, individual variability
 *     (T2). Underpins the tier multipliers.
 *   - Morin 2011 — running mechanics return after marathon (T3).
 *     Underpins distance→days curve at the half/full marathon end.
 *   - Dupuy 2018 PMID 29568270 — meta-analysis on recovery
 *     interventions (T1). Underpins the cardio>strength ordering.
 *   - McHugh 2003 — repeated-bout effect (T2). Underpins the tier=4
 *     scaling (highly trained recover faster from a familiar bout).
 *
 * Ultras (≥50 km) are flagged confidence: "LOW" because the literature
 * thins out fast above marathon distance — Millet 2011 and Easthope
 * 2010 disagree by a factor of 2 on full neuromuscular restoration.
 */

export type EventInput = {
  distanceKm: number | null;
  durationMin: number | null;
  modality: "run" | "bike" | "swim" | "row" | "triathlon" | "other";
  priority: "A" | "B" | "C";
  /** Declared experience tier 0..4 — see profiles.training_experience. */
  userTier: number;
};

export type RecoveryWindow = {
  days: number;
  /** 0..1 multiplier applied to strength + tendon items. */
  strengthLoadScale: number;
  /** 0..1 multiplier applied to cardio durationMin. */
  cardioLoadScale: number;
  /** Length of the linear ramp back to 1.0, in days. */
  rampDays: number;
  /** Set on ultras (≥50 km) where the literature thins out. */
  confidence?: "LOW";
};

// ─── Distance → base days (run-equivalent) ───
// Anchor points then linear interpolation between them. The marathon
// anchor matches Hikida 1983's 7–10 day disruption window doubled to
// account for performance recovery (Byrne 2002) — per Hikida 1983,
// Pflügers Archiv, T2 / per Byrne 2002, Sports Med, T2.
const DISTANCE_ANCHORS_KM: Array<[number, number]> = [
  [5, 2], // per Nieman 2007, Med Sci Sports Exerc, T2
  [10, 4], // per Howatson 2008, Sports Med, T2
  [21.0975, 7], // per Byrne 2002, Sports Med, T2 (half-marathon)
  [42.195, 14], // per Hikida 1983, Pflügers Archiv, T2 (full marathon)
  [50, 21], // per Millet 2011, Sports Med, T3 (ultra entry)
  [100, 28], // per Easthope 2010, Eur J Appl Physiol, T3
  [160, 35], // per Millet 2012, BMC Med, T3 (100-mile)
];

// ─── Modality multipliers ───
// Concentric-dominant modalities (cycling, swimming, rowing) cause
// less eccentric muscle damage than running, so net recovery time is
// shorter even at matched duration — per Clarkson & Hubal 2002,
// Am J Phys Med Rehabil, T2.
const MODALITY_MULT: Record<EventInput["modality"], number> = {
  run: 1.0, // per Hikida 1983, Pflügers Archiv, T2
  bike: 0.5, // per Clarkson & Hubal 2002, Am J Phys Med Rehabil, T2
  swim: 0.35, // per Clarkson & Hubal 2002, Am J Phys Med Rehabil, T2
  row: 0.35, // per Dupuy 2018, Front Physiol, T1 (low eccentric load)
  triathlon: 1.0, // duration-bucket overrides distance entirely
  other: 0.7, // per Dupuy 2018, Front Physiol, T1 (default mixed)
};

// ─── Tier multipliers (0..4) ───
// Repeated-bout effect: highly trained athletes recover faster from a
// familiar bout, untrained athletes need substantially longer. Linear
// scale anchored to Clarkson & Hubal 2002 + McHugh 2003.
const TIER_MULT: number[] = [
  1.5, // tier 0 untrained — per Clarkson & Hubal 2002, Am J Phys Med Rehabil, T2
  1.25, // tier 1 — per Clarkson & Hubal 2002, Am J Phys Med Rehabil, T2
  1.0, // tier 2 baseline — per McHugh 2003, Scand J Med Sci Sports, T2
  0.85, // tier 3 — per McHugh 2003, Scand J Med Sci Sports, T2
  0.75, // tier 4 elite — per McHugh 2003, Scand J Med Sci Sports, T2
];

// ─── Priority multipliers ───
// A-priority events get the full recovery; B-priority is baseline; C
// returns null (engine resumes normal — the user did not need a
// taper for it either).
const PRIORITY_MULT_A = 1.2; // per Mujika 2003, Med Sci Sports Exerc, T1 (taper symmetry)
const PRIORITY_MULT_B = 1.0;

// ─── Triathlon duration buckets ───
// Distance is meaningless for tri (a 226 km Ironman ≠ 226 km on a
// flat road); duration captures total exposure better. Buckets map
// to canonical tri formats — per Bernard 2009, Int J Sports Physiol
// Perform, T2.
const TRI_BUCKETS: Array<{ maxMin: number; days: number }> = [
  { maxMin: 90, days: 4 }, // per Bernard 2009, IJSPP, T2 (sprint)
  { maxMin: 180, days: 6 }, // per Bernard 2009, IJSPP, T2 (Olympic)
  { maxMin: 360, days: 10 }, // per Laursen 2011, Int J Sports Physiol Perform, T3 (half)
  { maxMin: Infinity, days: 14 }, // per Laursen 2011, IJSPP, T3 (full Ironman)
];

function distanceToBaseDays(km: number): number {
  if (km <= DISTANCE_ANCHORS_KM[0][0]) return DISTANCE_ANCHORS_KM[0][1];
  for (let i = 1; i < DISTANCE_ANCHORS_KM.length; i++) {
    const [hiKm, hiDays] = DISTANCE_ANCHORS_KM[i]!;
    const [loKm, loDays] = DISTANCE_ANCHORS_KM[i - 1]!;
    if (km <= hiKm) {
      const t = (km - loKm) / (hiKm - loKm);
      return loDays + t * (hiDays - loDays);
    }
  }
  return DISTANCE_ANCHORS_KM[DISTANCE_ANCHORS_KM.length - 1]![1];
}

function loadScalesFor(days: number): {
  strengthLoadScale: number;
  cardioLoadScale: number;
} {
  // ≤3d bracket: short events, strength fully off, easy aerobic only
  // — per Dupuy 2018, Front Physiol, T1.
  if (days <= 3) return { strengthLoadScale: 0, cardioLoadScale: 0.3 };
  // ≤7d bracket: most marathons / halves — per Howatson 2008, Sports
  // Med, T2.
  if (days <= 7) return { strengthLoadScale: 0, cardioLoadScale: 0.4 };
  // >7d bracket: ultras and high-tier multipliers — per Millet 2011,
  // Sports Med, T3. Cardio held a notch higher than the ≤7d bracket
  // because aerobic restoration outpaces neuromuscular restoration
  // (Dupuy 2018).
  return { strengthLoadScale: 0, cardioLoadScale: 0.5 };
}

export function computeRecoveryWindow(event: EventInput): RecoveryWindow | null {
  if (event.priority === "C") return null;

  const tier = Math.max(0, Math.min(4, Math.round(event.userTier)));
  const tierMult = TIER_MULT[tier]!;
  const priorityMult = event.priority === "A" ? PRIORITY_MULT_A : PRIORITY_MULT_B;

  let baseDays: number;

  if (event.modality === "triathlon") {
    const dur = event.durationMin;
    if (dur == null || dur <= 0) {
      // Without duration we can't bucket — fall back to Olympic.
      baseDays = 6;
    } else {
      baseDays = TRI_BUCKETS.find((b) => dur < b.maxMin)?.days ?? 14;
    }
  } else {
    if (event.distanceKm == null || event.distanceKm <= 0) {
      // No distance — fall back to a short bracket. Other-modality
      // events without distance still get *some* recovery rather
      // than zero.
      baseDays = 3;
    } else {
      baseDays = distanceToBaseDays(event.distanceKm);
    }
  }

  const modalityMult =
    event.modality === "triathlon" ? 1.0 : MODALITY_MULT[event.modality];
  const days = Math.max(1, Math.round(baseDays * modalityMult * tierMult * priorityMult));

  const scales = loadScalesFor(days);
  // Ramp days = max(3, days × 0.5) — embedded inside the `days`
  // window for >7d brackets, no-op for ≤7d (rampDays still set so
  // callers can render the curve, but the helper treats days ≤ 7
  // as flat). per Newham 1983, Clin Sci, T3.
  const rampDays = Math.max(3, Math.round(days * 0.5));

  const out: RecoveryWindow = {
    days,
    strengthLoadScale: scales.strengthLoadScale,
    cardioLoadScale: scales.cardioLoadScale,
    rampDays,
  };

  // Ultra confidence flag — distance threshold, not duration, since a
  // slow marathoner's 6-hour finish is still a marathon.
  const isUltra =
    event.modality !== "triathlon" &&
    event.distanceKm != null &&
    event.distanceKm >= 50;
  if (isUltra) out.confidence = "LOW"; // per Millet 2011, Sports Med, T3

  return out;
}

/**
 * Given an applied recovery window and a target date, return the
 * day-of-window scaling. For ≤7d windows, scaling is flat across the
 * whole window. For >7d windows, the second half ramps linearly back
 * to 1.0.
 */
export function scaleForDateInWindow(args: {
  window: RecoveryWindow;
  startDate: string; // YYYY-MM-DD, day after event
  targetDate: string; // YYYY-MM-DD
}): { strengthLoadScale: number; cardioLoadScale: number } | null {
  const { window, startDate, targetDate } = args;
  const start = new Date(`${startDate}T00:00:00Z`);
  const target = new Date(`${targetDate}T00:00:00Z`);
  const dayIdx = Math.floor((target.getTime() - start.getTime()) / 86_400_000);
  if (dayIdx < 0 || dayIdx >= window.days) return null;

  // ≤7d brackets: flat across the whole window.
  if (window.days <= 7) {
    return {
      strengthLoadScale: window.strengthLoadScale,
      cardioLoadScale: window.cardioLoadScale,
    };
  }

  // >7d brackets: first half static, second half linear ramp to 1.0.
  const staticDays = window.days - window.rampDays;
  if (dayIdx < staticDays) {
    return {
      strengthLoadScale: window.strengthLoadScale,
      cardioLoadScale: window.cardioLoadScale,
    };
  }
  const rampPos = dayIdx - staticDays; // 0..rampDays-1
  // Interpolate from bracket value at rampPos=0 toward 1.0 at the
  // *day after* the window ends — so the final day is not yet at 1.0
  // but very close. Engine fully releases on day `window.days`.
  const t = (rampPos + 1) / window.rampDays;
  return {
    strengthLoadScale:
      window.strengthLoadScale + (1.0 - window.strengthLoadScale) * t,
    cardioLoadScale:
      window.cardioLoadScale + (1.0 - window.cardioLoadScale) * t,
  };
}
