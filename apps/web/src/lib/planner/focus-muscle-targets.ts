/**
 * Per-muscle weekly set targets — substitution-with-cap focus bias.
 *
 * Consumed by `assemblePrescriptionItems` → `pickAccessoriesForSession`
 * via the `perMuscleTargets` parameter. The picker uses these numbers
 * to decide how many accessory sets per aesthetic muscle a session
 * should cover; biasing them shifts the picker's allocation without
 * changing the total set count.
 *
 * Substitution-with-cap model (CP-2):
 *  - Baseline: every aesthetic muscle gets `DEFAULT_MUSCLE_TARGET`
 *    sets/week (MV floor for trained lifters per Schoenfeld 2017 Sports
 *    Med 47, HIGH).
 *  - For each user-chosen focus muscle, the engine sets its target to
 *    `min(LANDMARKS[m].productive, round(LANDMARKS[m].limit * concurrentLoadMod))`
 *    — "MAV under concurrent stress" per Israetel 2017 RP volume
 *    landmarks + Wilson 2012 concurrent-training interference.
 *  - Non-focus targets are scaled DOWN proportionally so
 *    `sum(biased targets) === sum(baseline targets)` within ±1 set
 *    (rounding tolerance). Floor per muscle is
 *    `LANDMARKS[m].maintenance` — never pull a muscle below its
 *    detraining threshold (Bickel 2011 Med Sci Sports Exerc 43, HIGH).
 *  - Forearm tendon-gate: if `forearms` is a focus muscle AND
 *    `elbowForearmAtlRatio > 1 + REGION_SPIKE_THRESHOLD` (= 1.25), the
 *    forearm target is silently capped at `LANDMARKS.forearms.building`
 *    (no MAV escalation that week). The UI surfaces a small banner via
 *    `forearmGateActive: true`. Per Wernbom 2007 Sports Med 37 + Baar
 *    2017 Sports Med 47 — tendon adaptation lags muscle by 6–12 wk and
 *    can't tolerate rapid weekly load escalation.
 *
 * The substitution invariant is THE critical correctness property: if
 * it breaks, the engine's stress budget silently overflows by tens of
 * sets/week and the concurrent_modifier (~0.7) is bypassed. Pinned by
 * `focus-muscle-targets.test.ts`.
 */
import { REGION_SPIKE_THRESHOLD } from "@/lib/engine/region-spike-detector";

/**
 * Per-muscle volume landmarks (sets/week). Mirror of the curated
 * defaults in `apps/web/src/lib/stats/muscle-volume.ts` — kept inline
 * here so the engine module doesn't import the UI-chart module and
 * carry its Supabase deps into the planner code path.
 *
 * Numbers are practitioner consensus (Renaissance Periodization /
 * Israetel / Helms, 2017–2024), tagged [DEF→cal] per the calibration
 * policy — Stage A heuristic, pending in-app validation. See
 * `hybrid-training-design-constraints.md` CP-2 row "focus-muscle bias".
 */
// per Israetel 2017 (RP volume landmarks) + Schoenfeld 2017 (Sports Med 47, MEDIUM) — Stage A heuristic
export const FOCUS_LANDMARKS: Record<
  string,
  { maintenance: number; building: number; productive: number; limit: number }
> = {
  upper_chest: { maintenance: 4, building: 6, productive: 12, limit: 18 },
  front_delts: { maintenance: 0, building: 6, productive: 12, limit: 18 },
  side_delts: { maintenance: 6, building: 8, productive: 20, limit: 26 },
  rear_delts: { maintenance: 6, building: 8, productive: 18, limit: 24 },
  triceps: { maintenance: 5, building: 8, productive: 14, limit: 20 },
  traps: { maintenance: 0, building: 6, productive: 12, limit: 20 },
  biceps: { maintenance: 5, building: 8, productive: 14, limit: 20 },
  forearms: { maintenance: 0, building: 4, productive: 10, limit: 16 },
  quads: { maintenance: 6, building: 8, productive: 16, limit: 22 },
  hamstrings: { maintenance: 6, building: 8, productive: 14, limit: 20 },
  glutes: { maintenance: 4, building: 6, productive: 12, limit: 18 },
  calves: { maintenance: 6, building: 8, productive: 14, limit: 20 },
  // Non-focus-able aesthetic muscles kept in the baseline so the
  // substitution math has a non-zero pool to redistribute into.
  abs: { maintenance: 0, building: 6, productive: 16, limit: 24 },
  lats: { maintenance: 8, building: 10, productive: 18, limit: 24 },
  mid_back: { maintenance: 6, building: 10, productive: 18, limit: 24 },
};

/**
 * Aesthetic-target universe — the muscles whose per-week set counts
 * the accessory picker tries to fulfil. Preserved from the pre-PR
 * `AESTHETIC_TARGET_MUSCLES` list so the no-focus baseline is
 * byte-identical to the legacy behaviour.
 */
// per practitioner consensus + audit of `accessory-picker.ts` muscle gap-fill — Stage A heuristic
export const AESTHETIC_TARGET_MUSCLES: readonly string[] = [
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "calves",
  "abs",
  "upper_chest",
  "lats",
  "mid_back",
  "hamstrings",
  "forearms",
];

/**
 * Default per-muscle weekly target (MV-floor for trained lifter). Kept
 * exported so the legacy single-arg call site keeps producing the same
 * numbers it always did.
 */
// per Schoenfeld 2017 Sports Med 47 (MEDIUM) — MEV floor for trained lifters
export const DEFAULT_MUSCLE_TARGET = 6;

/** Forearm tendon-gate threshold — 25% above 4-wk trailing ATL. */
// per Soligard 2016 IOC consensus (HIGH) — re-uses the engine's existing region-spike threshold (heuristic 0.25)
export const FOREARM_GATE_ATL_THRESHOLD = 1 + REGION_SPIKE_THRESHOLD; // = 1.25

export type MuscleTargetsResult = {
  targetsByMuscle: Record<string, number>;
  /** True when the forearm tendon-gate downgraded the forearm bias this week. */
  forearmGateActive: boolean;
  /** True iff any focus muscle pulled volume from non-focus muscles. */
  substituted: boolean;
};

export type MuscleTargetsOpts = {
  /** 0–2 muscles from the FOCUS_MUSCLE_ALLOWLIST. */
  focusMuscles?: readonly string[];
  /** Existing concurrent-training scalar (1.0 = no compression, ~0.7 under load). */
  concurrentLoadMod?: number;
  /**
   * `current ATL / 4-week trailing ATL` for the elbow_forearm region,
   * already computed at prescription time by
   * `getElbowForearmAtlRatio`. Defaults to 1.0 (no spike) so callers
   * without history data short-circuit the gate cleanly.
   */
  elbowForearmAtlRatio?: number;
};

/**
 * Compute per-muscle weekly set targets for the accessory picker.
 *
 * Substitution invariant (test-pinned):
 *   |sum(result.targetsByMuscle) - sum(baseline)| <= 1
 *
 * Where `baseline` is the no-focus map produced by this function with
 * `focusMuscles = []`.
 *
 * Pure — no I/O, no Date.now(). Safe to call from tests.
 */
export function defaultMuscleTargets(opts: MuscleTargetsOpts = {}): MuscleTargetsResult {
  const focusMuscles = (opts.focusMuscles ?? []).slice(0, 2);
  const concurrentLoadMod =
    Number.isFinite(opts.concurrentLoadMod) && (opts.concurrentLoadMod as number) > 0
      ? (opts.concurrentLoadMod as number)
      : 1.0;
  const elbowForearmAtlRatio =
    Number.isFinite(opts.elbowForearmAtlRatio) && (opts.elbowForearmAtlRatio as number) > 0
      ? (opts.elbowForearmAtlRatio as number)
      : 1.0;

  // ── Baseline ────────────────────────────────────────────────────
  // The legacy behaviour: every aesthetic muscle at DEFAULT_MUSCLE_TARGET.
  // Focus muscles outside that list (quads / glutes / front_delts /
  // traps) are folded in at DEFAULT_MUSCLE_TARGET so the substitution
  // math has a consistent pre-bias accounting — and so a no-focus
  // result is byte-identical to the pre-PR baseline.
  const baseline: Record<string, number> = {};
  for (const m of AESTHETIC_TARGET_MUSCLES) baseline[m] = DEFAULT_MUSCLE_TARGET;
  for (const m of focusMuscles) {
    if (baseline[m] == null) baseline[m] = DEFAULT_MUSCLE_TARGET;
  }

  // Early-out: no focus muscles → return the baseline verbatim. This
  // is the regression-guard path for every user who hasn't opted into
  // the feature.
  if (focusMuscles.length === 0) {
    return {
      targetsByMuscle: { ...baseline },
      forearmGateActive: false,
      substituted: false,
    };
  }

  // ── Focus targets ───────────────────────────────────────────────
  // For each focus muscle: target = min(productive, limit * concurrentMod).
  // The min() preserves the productive-zone ceiling so a low concurrent
  // load (=1.0) can't push us above MAV.
  const targetsByMuscle: Record<string, number> = { ...baseline };
  let forearmGateActive = false;
  for (const m of focusMuscles) {
    const lm = FOCUS_LANDMARKS[m];
    if (!lm) continue; // shouldn't happen given Zod allowlist, but defensive
    const concurrentCap = Math.max(lm.maintenance, Math.round(lm.limit * concurrentLoadMod));
    let focusTarget = Math.min(lm.productive, concurrentCap);
    // Forearm tendon-gate. Silently downgrade to the building (MEV)
    // floor when elbow/forearm ATL is materially elevated.
    if (m === "forearms" && elbowForearmAtlRatio > FOREARM_GATE_ATL_THRESHOLD) {
      focusTarget = Math.min(focusTarget, lm.building);
      forearmGateActive = true;
    }
    targetsByMuscle[m] = focusTarget;
  }

  // ── Substitution: pull volume from non-focus muscles ────────────
  const baseTotal = sumValues(baseline);
  const focusSet = new Set(focusMuscles);
  const focusDelta =
    focusMuscles.reduce((acc, m) => acc + (targetsByMuscle[m] - baseline[m]), 0);

  // Available pool to pull from: every aesthetic muscle that isn't a
  // focus target. Each entry has a `floor` (maintenance) and a
  // `current` value we can subtract from down to that floor.
  const pool = AESTHETIC_TARGET_MUSCLES.filter((m) => !focusSet.has(m));
  let remainingDelta = focusDelta;
  // Even subtraction over the pool — Δ per non-focus muscle. We keep
  // going round-robin while there's still delta to distribute AND any
  // muscle has headroom above its maintenance floor; this guarantees
  // the invariant holds whenever the focus pull is feasible.
  if (remainingDelta > 0 && pool.length > 0) {
    let safety = remainingDelta * pool.length + 1;
    while (remainingDelta > 0 && safety > 0) {
      safety -= 1;
      let madeProgress = false;
      for (const m of pool) {
        if (remainingDelta <= 0) break;
        const lm = FOCUS_LANDMARKS[m];
        const floor = lm?.maintenance ?? 0;
        if (targetsByMuscle[m] > floor) {
          targetsByMuscle[m] -= 1;
          remainingDelta -= 1;
          madeProgress = true;
        }
      }
      if (!madeProgress) break; // every non-focus muscle is at its floor
    }
  }

  // If the pool ran out of headroom (e.g. user picked two
  // high-volume focus muscles and the floors are tight), we cap the
  // focus targets so the invariant still holds. This keeps the engine
  // stress budget intact at the cost of slightly lowering the focus
  // ceiling — preferable to silently over-prescribing.
  if (remainingDelta > 0) {
    for (const m of focusMuscles) {
      if (remainingDelta <= 0) break;
      const baseline_m = baseline[m];
      const headroom = targetsByMuscle[m] - baseline_m;
      const give = Math.min(headroom, remainingDelta);
      if (give > 0) {
        targetsByMuscle[m] -= give;
        remainingDelta -= give;
      }
    }
  }

  // Invariant sanity-check (no-throw in prod; the test pins it). The
  // ±1-set tolerance accommodates int rounding inside the focus cap.
  // When the forearm gate fires it intentionally compresses total
  // volume (let elbow load settle) — that's a deliberate exception
  // to the invariant, so we don't warn for it.
  // istanbul ignore next — defensive only
  if (
    !forearmGateActive &&
    process.env.NODE_ENV !== "production"
  ) {
    const finalTotal = sumValues(targetsByMuscle);
    if (Math.abs(finalTotal - baseTotal) > 1) {
      console.warn(
        `[defaultMuscleTargets] substitution invariant drift: baseline=${baseTotal} biased=${finalTotal} focus=${focusMuscles.join(",")}`,
      );
    }
  }

  return {
    targetsByMuscle,
    forearmGateActive,
    substituted: focusDelta > 0,
  };
}

function sumValues(o: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(o)) s += v;
  return s;
}
