/**
 * Pure classifier that turns a cardio activity summary (avg HR + max HR +
 * duration) into a cardio kind, an effective stress load (ESL) value, and
 * a confidence score. No DB access.
 *
 * Consumers: `lib/engine/actual-session-load.ts` (`cardioEslFromKind`
 * drives cardio ESL) and `lib/sessions/link-activity.ts` (`classifyCardio`
 * powers the manual "link a logged activity to a planned cardio slot"
 * flow).
 *
 * Heuristic uses %-of-max-HR thresholds. The user's hrMax is the
 * primary signal; if absent we fall back to the rough 220-age formula
 * and discount confidence by 0.7×. When we can't compute %max at all
 * (no HR data + no age) we return null and the caller leaves the
 * external session's ESL at 0 (Phase 1 behaviour).
 *
 * Kept pure so it's trivially unit-testable: see
 * `__tests__/classify-cardio.test.ts`.
 */
import { zoneBandsFromMaxHr, zoneForBpm } from "@/lib/stats/hr-zones";

export type ClassifiedCardioKind =
  | "cardio_z2"
  | "cardio_threshold"
  | "cardio_vo2"
  | "cardio_alactic"
  | "cardio_mixed";

export type ClassifiedCardio = {
  kind: ClassifiedCardioKind;
  /**
   * Effective stress load for this cardio activity (engine units —
   * minutes × intensity-modifier; e.g. Z2 = 0.5 × min, VO2 = 2.0 × min).
   *
   * Note on scale: this is independent of the strength `effective_stress_load`
   * column. Internal cardio sessions today have ESL = 0 because the
   * engine treats prescribed cardio as already accounted for in the
   * archetype budget. External cardio (this path) needs an explicit
   * number so the engine can see "moderate work happened today" — the
   * value here gets written to `planned_sessions.effective_stress_load`
   * for external days specifically. Unifying internal + external cardio
   * onto a single ESL scale is a follow-up.
   */
  effectiveStressLoad: number;
  /** 0..1; lower when only avg HR is present or hrMax came from 220-age. */
  confidence: number;
  /** Human-readable label rendered on the session card. */
  label: string;
  /** One-line reason ("avg 142 bpm (Z2) for 45 min"). */
  reason: string;
};

export type ClassifyInput = {
  avgHrBpm: number | null;
  maxHrBpm: number | null;
  durationSec: number;
  /** From profile (`intake.hrMax`). Null falls back to 220 − userAge. */
  hrMax: number | null;
  /** Age in years; only used when `hrMax` is null. */
  userAge: number | null;
};

const LABELS: Record<ClassifiedCardioKind, string> = {
  cardio_z2: "Easy Z2",
  cardio_threshold: "Threshold",
  cardio_vo2: "VO2 intervals",
  cardio_alactic: "Sprint / alactic",
  cardio_mixed: "Mixed intensity",
};

/**
 * ESL per cardio kind, in engine units (minutes × intensity modifier).
 * Exported for reuse by the post-completion recompute path
 * (`lib/engine/actual-session-load.ts`) so internal + external cardio
 * land on the same ESL scale. See classify-cardio.ts class doc for the
 * ESL-scale unification follow-up.
 */
export function cardioEslFromKind(
  kind: ClassifiedCardioKind,
  durationMin: number,
): number {
  switch (kind) {
    case "cardio_z2":
      return 0.5 * durationMin;
    case "cardio_threshold":
      return 1.3 * durationMin;
    case "cardio_vo2":
      return 2.0 * durationMin;
    case "cardio_alactic":
      return 1.0 * durationMin;
    case "cardio_mixed":
      return 1.0 * durationMin;
  }
}

function eslFor(kind: ClassifiedCardioKind, durationMin: number): number {
  return cardioEslFromKind(kind, durationMin);
}

/**
 * Pick the kind from the (avgPct, maxPct, durationSec) triple. The
 * order matters: alactic must run before VO2 because the high-max +
 * short-duration cohort would otherwise be swallowed by the vo2
 * branch.
 */
function pickKind(
  avgPct: number | null,
  maxPct: number | null,
  durationSec: number,
): ClassifiedCardioKind {
  // Alactic gate: maxPct ≥ 0.95 AND duration < 300 s (5 min).
  //
  // Calibration status (CP-5): physiology-informed threshold per Gastin
  // 2001, Sports Medicine 31(10) — phosphagen (ATP-PCr) system depletion
  // at ~10 s of all-out effort; glycolytic dominance from ~30 s; aerobic
  // dominance crosses over from ~75 s and is dominant well before the
  // 5-min mark. True alactic work is sub-10-s efforts with extended
  // recovery, which whole-session HR-summary classification cannot
  // resolve (we can't see per-rep recovery structure from avg+max HR
  // alone). 5 min is therefore used as an upper-bound proxy: the longest
  // session window in which alactic-dominant work is physiologically
  // plausible. Sessions longer than 5 min that still peak ≥ 95% max HR
  // are by elimination glycolytic/aerobic mix and fall through to the
  // VO2 branch (maxPct ≥ 0.92).
  //
  // Previous threshold was `< 1200` (20 min), which mis-bucketed long
  // hard intervals (e.g. a 19-min Z4 ride peaking at 95%) as alactic.
  // Tightened to `< 300` 2026-Q4 per external scientific critique;
  // see PR chore/engine-critique-1to4.
  if (maxPct != null && maxPct >= 0.95 && durationSec < 300) {
    return "cardio_alactic";
  }
  if ((avgPct != null && avgPct >= 0.8) || (maxPct != null && maxPct >= 0.92)) {
    return "cardio_vo2";
  }
  if (
    avgPct != null &&
    avgPct >= 0.7 &&
    avgPct < 0.8 &&
    (maxPct == null || maxPct < 0.9)
  ) {
    return "cardio_threshold";
  }
  if (avgPct != null && avgPct < 0.7) {
    return "cardio_z2";
  }
  // Only maxHr is available, and it's modest: best guess is easy aerobic.
  if (avgPct == null && maxPct != null && maxPct < 0.85) {
    return "cardio_z2";
  }
  return "cardio_mixed";
}

function zoneLabelFor(bpm: number, hrMax: number): string {
  return zoneForBpm(bpm, zoneBandsFromMaxHr(hrMax));
}

function buildReason(
  kind: ClassifiedCardioKind,
  avgHr: number | null,
  maxHr: number | null,
  durationMin: number,
  hrMax: number,
): string {
  const parts: string[] = [];
  if (avgHr != null) {
    parts.push(`avg ${avgHr} bpm (${zoneLabelFor(avgHr, hrMax)})`);
  }
  if (maxHr != null) {
    parts.push(`max ${maxHr} bpm`);
  }
  const head = parts.length > 0 ? parts.join(", ") : `${durationMin} min`;
  const tail =
    kind === "cardio_vo2"
      ? " — likely VO2 work"
      : kind === "cardio_alactic"
      ? " — short power session"
      : kind === "cardio_threshold"
      ? " — threshold effort"
      : kind === "cardio_z2"
      ? ` for ${durationMin} min`
      : ` — mixed intensity over ${durationMin} min`;
  return `${head}${tail}`;
}

export function classifyCardio(input: ClassifyInput): ClassifiedCardio | null {
  const { avgHrBpm, maxHrBpm, durationSec } = input;
  if (durationSec <= 0) return null;
  if (avgHrBpm == null && maxHrBpm == null) return null;

  let hrMax = input.hrMax;
  let usedAgeFallback = false;
  if (hrMax == null || !Number.isFinite(hrMax) || hrMax <= 60) {
    if (input.userAge == null || input.userAge <= 0) return null;
    hrMax = 220 - input.userAge;
    usedAgeFallback = true;
  }
  if (hrMax <= 60) return null;

  const avgPct = avgHrBpm != null ? avgHrBpm / hrMax : null;
  const maxPct = maxHrBpm != null ? maxHrBpm / hrMax : null;

  const kind = pickKind(avgPct, maxPct, durationSec);
  const durationMin = Math.max(1, Math.round(durationSec / 60));
  const effectiveStressLoad = Number(eslFor(kind, durationMin).toFixed(2));

  // Base confidence: both HR fields known → 0.85, one → 0.6.
  const bothKnown = avgHrBpm != null && maxHrBpm != null;
  let confidence = bothKnown ? 0.85 : 0.6;
  if (usedAgeFallback) confidence *= 0.7;
  confidence = Number(confidence.toFixed(2));

  return {
    kind,
    effectiveStressLoad,
    confidence,
    label: LABELS[kind],
    reason: buildReason(kind, avgHrBpm, maxHrBpm, durationMin, hrMax),
  };
}
