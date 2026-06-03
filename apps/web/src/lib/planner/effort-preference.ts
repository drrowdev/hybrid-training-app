/**
 * ADR 0016 — user-facing EFFORT dial for the hypertrophy archetype.
 *
 * A single `profiles.effort_preference` enum (`low | standard | high`) that
 * scales the hypertrophy block's compound proximity-to-failure at
 * block-creation time:
 *
 *   - EFFORT axis (compound proximity-to-failure): the early-set rep bump
 *     (ADR 0015) and the final-set RIR anchor (ADR 0011).
 *
 * NOTE: the original ADR 0016 VOLUME axis (scaling the aesthetic `setsPerItem`
 * the accessory picker emits) has been SUPERSEDED by ADR 0024's accessory-
 * volume level (`accessory-volume.ts`), which generalises a volume lever
 * across every archetype and splits it cleanly from this effort axis (low
 * volume ≠ low effort). This module now owns the EFFORT axis only.
 *
 * `standard` reproduces today's behaviour byte-for-byte. The dial is a
 * generation-time preference: like `training_experience` / `equipment`, a
 * change takes effect on the NEXT created block, never retro-editing an
 * existing block's materialised prescription.
 *
 * SCOPE: the dial is intentionally hypertrophy-only. The conservativeness
 * review (engine-live §10; design-constraints CP-2 rows 41/43) located the
 * sub-failure compound-effort finding in the hypertrophy archetype. For every
 * other archetype the dial is a no-op; a "high" lifter on a concurrent /
 * endurance archetype keeps the concurrent-safe identity untouched.
 *
 * Calibration policy: all magnitudes below are CP-1 [DEF→cal] Stage-A
 * heuristics — directionally grounded (Schoenfeld 2021 dose-response;
 * Refalo 2023 proximity-to-failure; Baz-Valle 2022 weekly-set landmarks)
 * but un-tuned against real user data. They expose a user lever rather than
 * re-hardcoding a single "better" default, per the strategic framing in
 * docs/knowledge/hybrid-training-design-constraints.md.
 */

export type EffortPreference = "low" | "standard" | "high";

export const EFFORT_PREFERENCE_VALUES: readonly EffortPreference[] = [
  "low",
  "standard",
  "high",
] as const;

const EFFORT_PREFERENCE_SET: ReadonlySet<string> = new Set(
  EFFORT_PREFERENCE_VALUES,
);

/**
 * Coerce a raw DB / form value into a valid `EffortPreference`. Anything
 * unrecognised (null, legacy, undeclared) collapses to `"standard"` so the
 * engine keeps byte-identical pre-ADR-0016 behaviour.
 */
export function resolveEffortPreference(
  raw: string | null | undefined,
): EffortPreference {
  return raw != null && EFFORT_PREFERENCE_SET.has(raw)
    ? (raw as EffortPreference)
    : "standard";
}

/**
 * Effort-axis configuration for `applyHypertrophyEffortAnchor`.
 *
 * `earlyRepBonus === 0` means "no early-set transform" — the early compound
 * sets are returned untouched (no rep bump, no cue), reverting to the
 * pre-ADR-0015 fixed-volume shape. That is the `low` path.
 *
 * `finalRirDelta` shifts the ADR 0011 final-set RIR anchor. It is applied to
 * the per-week base RIR and floored at 1 by the caller — the dial NEVER
 * prescribes RIR 0 (training to failure) on a compound lift inside a
 * concurrent block, where the fatigue / running-interference cost is highest.
 */
export interface HypertrophyEffortConfig {
  /** Reps added to each early (non-final) compound set. 0 = skip the bump. */
  earlyRepBonus: number;
  /** Upper bound on early-set reps (the e1RM model's validity ceiling). */
  earlyRepCap: number;
  /** Cue for the bumped early sets. Ignored when `earlyRepBonus === 0`. */
  earlyCue: string;
  /** Signed shift applied to the final-set RIR anchor (floored at 1). */
  finalRirDelta: number;
}

const STANDARD_EARLY_CUE =
  "Build set — make it challenging; stop several reps short of failure.";
const HIGH_EARLY_CUE =
  "Build set — push hard; leave only 2–3 reps in reserve.";

/**
 * Resolve the hypertrophy effort-axis config for a dial setting.
 *
 *   - low      : no early bump; final RIR +1 (more reps in reserve).
 *   - standard : ADR 0015 / 0011 as shipped (+2 cap 12; base RIR).
 *   - high     : larger early bump (+4 cap 15) + a tighter cue; final RIR −1
 *                (floored at 1) — the opt-in "true RIR 1–3 / more volume" path
 *                deferred from ADR 0015.
 */
export function hypertrophyEffortConfig(
  pref: EffortPreference,
): HypertrophyEffortConfig {
  switch (pref) {
    case "low":
      return {
        earlyRepBonus: 0,
        earlyRepCap: 12,
        earlyCue: STANDARD_EARLY_CUE,
        finalRirDelta: 1,
      };
    case "high":
      return {
        earlyRepBonus: 4,
        earlyRepCap: 15,
        earlyCue: HIGH_EARLY_CUE,
        finalRirDelta: -1,
      };
    case "standard":
    default:
      return {
        earlyRepBonus: 2,
        earlyRepCap: 12,
        earlyCue: STANDARD_EARLY_CUE,
        finalRirDelta: 0,
      };
  }
}

