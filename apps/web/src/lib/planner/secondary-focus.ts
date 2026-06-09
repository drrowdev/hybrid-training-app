/**
 * ADR 0020 — secondary-focus volume tilt.
 *
 * The block wizard lets a user pick a PRIMARY goal and a SECONDARY focus
 * (e.g. "Strength + Muscle"). Historically the secondary was discarded at
 * submit — `wizardOutput` threaded only `archetypeId` + `daysPerWeek`, so the
 * materialised block ignored the secondary entirely and the preview (which
 * showed a dedicated hypertrophy day) lied about what would be built.
 *
 * This module turns the secondary into a REAL, bounded engine input. A
 * "muscle" secondary on a non-hypertrophy primary tilts the accessory block
 * toward hypertrophy volume — one extra accessory movement and one extra set
 * per movement — rather than bolting on a standalone hypertrophy session. The
 * tilt is then trimmed by the session-duration governor (ADR 0020 §Governor)
 * so a tilted day still fits the ~60 / hard-max-75-minute budget.
 *
 * SCOPE (v1): only the VOLUME-direction combination tilts —
 *   - Strength primary + Muscle secondary  (archetype `strength_anchor`)
 *   - Cardio   primary + Muscle secondary  (archetype `endurance_anchor`)
 * INTENSITY-direction secondaries (e.g. Strength on a hypertrophy/cardio
 * primary) cannot be expressed as accessory volume and are deferred to a
 * follow-up ADR. Combos that already flip the archetype (X+Cardio →
 * concurrent_hybrid, the maintenance shortcut → maintenance) are honest as-is
 * and need no tilt. A "muscle" primary is already `hypertrophy_anchor` (its
 * own ADR 0016 volume dial owns that surface) so it never tilts here.
 *
 * `none` (and every unrecognised / deferred combination) is a byte-identical
 * no-op, preserving the engine-regression guarantee for existing blocks.
 *
 * Calibration policy: the +1 item / +1 set magnitudes are CP-1 [DEF→cal]
 * Stage-A heuristics — directionally grounded (Schoenfeld 2021 dose-response;
 * Baz-Valle 2022 weekly-set landmarks; Refalo 2023 proximity-to-failure) but
 * un-tuned against real user data. The duration governor is the hard safety
 * bound that keeps the un-calibrated dose from blowing the session budget.
 */
import type { ArchetypeId } from "./archetypes";

/**
 * Engine-level secondary focus. The wizard's richer `Secondary`
 * (`Goal | "skip" | "maintenance"`) collapses to this at the engine boundary:
 * `"skip"`, `"maintenance"` and anything unrecognised all become `"none"`.
 */
export type SecondaryFocus = "none" | "strength" | "muscle" | "cardio";

export const SECONDARY_FOCUS_VALUES: readonly SecondaryFocus[] = [
  "none",
  "strength",
  "muscle",
  "cardio",
] as const;

const SECONDARY_FOCUS_SET: ReadonlySet<string> = new Set(SECONDARY_FOCUS_VALUES);

/**
 * Coerce a raw DB / form value into a valid `SecondaryFocus`. Anything
 * unrecognised (null, the wizard's `"skip"` / `"maintenance"` channels, legacy
 * rows) collapses to `"none"` so the engine keeps byte-identical pre-ADR-0020
 * behaviour.
 */
export function resolveSecondaryFocus(
  raw: string | null | undefined,
): SecondaryFocus {
  return raw != null && SECONDARY_FOCUS_SET.has(raw)
    ? (raw as SecondaryFocus)
    : "none";
}

/**
 * Aesthetic-profile delta produced by a secondary focus. Applied additively to
 * the archetype's accessory aesthetic profile before the dynamic picker runs.
 * `{ 0, 0 }` is the no-op identity.
 */
export interface SecondaryVolumeTilt {
  /** Extra accessory movements per session (added to `itemsPerSession`). */
  itemsPerSessionDelta: number;
  /** Extra working sets per accessory movement (added to `setsPerItem`). */
  setsPerItemDelta: number;
}

/** The byte-identical identity — no movement-selection or set-count change. */
export const NO_TILT: SecondaryVolumeTilt = {
  itemsPerSessionDelta: 0,
  setsPerItemDelta: 0,
};

/**
 * CP-1 [DEF→cal] — the "fuller bump" the user picked: one extra accessory
 * movement AND one extra set per movement. Bounded above by the duration
 * governor (ADR 0020), never by an open-ended volume ramp.
 */
export const SECONDARY_HYPERTROPHY_ITEM_DELTA = 1;
export const SECONDARY_HYPERTROPHY_SET_DELTA = 1;

/**
 * Resolve the accessory-volume tilt for a (primary archetype, secondary focus)
 * pair. Returns `NO_TILT` for every combination outside the v1 volume-direction
 * set, so callers can apply it unconditionally.
 *
 * Only a `"muscle"` secondary tilts, and only on the two archetypes that carry
 * an accessory block without already being hypertrophy-led:
 *   - `strength_anchor`   (Strength + Muscle)
 *   - `endurance_anchor`  (Cardio + Muscle — tilts the strength-preservation
 *                          days that the endurance archetype already schedules)
 */
export function secondaryVolumeTilt(
  primaryArchetypeId: ArchetypeId,
  secondary: SecondaryFocus,
): SecondaryVolumeTilt {
  if (secondary !== "muscle") return NO_TILT;
  switch (primaryArchetypeId) {
    case "strength_anchor":
    case "endurance_anchor":
      return {
        itemsPerSessionDelta: SECONDARY_HYPERTROPHY_ITEM_DELTA,
        setsPerItemDelta: SECONDARY_HYPERTROPHY_SET_DELTA,
      };
    default:
      return NO_TILT;
  }
}

/** True when a tilt actually changes the aesthetic profile (not the identity). */
export function isActiveTilt(tilt: SecondaryVolumeTilt): boolean {
  return tilt.itemsPerSessionDelta !== 0 || tilt.setsPerItemDelta !== 0;
}

/**
 * Session-duration budget (ADR 0020) — the governor that bounds the tilt.
 *
 * The user's brief: "aim for the gym session to be 60 min and max 75 min
 * (depending on the selection of primary+secondary)." `SESSION_TARGET_MIN` is
 * the soft design aim the base archetype volume is already tuned toward;
 * `SESSION_HARD_CAP_MIN` is the enforceable ceiling the governor trims the
 * tilt to. The governor keeps the FULLEST tilt whose estimated duration stays
 * within the cap (the user explicitly chose the "fuller bump"), dropping the
 * extra item first and then the extra set only when a strength day would
 * otherwise blow the ceiling.
 *
 * CP-1 [DEF→cal] heuristics — practitioner time-budget targets, not yet tuned
 * against logged session durations. The per-combo signature is in place so a
 * future calibration pass can vary the cap by (primary, secondary) without a
 * call-site change; v1 returns a single 75-min cap for every tiltable combo.
 */
export const SESSION_TARGET_MIN = 60; // heuristic, no calibration data
export const SESSION_HARD_CAP_MIN = 75; // heuristic, no calibration data
/**
 * ADR 0045 — duration cap for a HIGH accessory-volume strength day. High is an
 * explicit user opt-in to a longer, higher-volume session, so its governor cap
 * is raised above the default `SESSION_HARD_CAP_MIN` (the comfort default for
 * Low/Medium). The governor still trims High's additive aesthetic floor to fit
 * THIS cap, so it remains the hard bound — High just buys ~15 more minutes of
 * accessory headroom. Heuristic, no calibration data (CP-1 [DEF→cal]); still
 * within typical serious-lifter session lengths (Schoenfeld 2021 high-volume
 * protocols routinely run 75–90 min).
 */
export const HIGH_VOLUME_SESSION_CAP_MIN = 90; // heuristic, no calibration data

/**
 * Hard duration ceiling (minutes) the tilt governor trims a strength day to,
 * for a given (primary archetype, secondary focus). Returns the v1 constant
 * cap for every combination; reserved for per-combo calibration later.
 */
export function sessionDurationCapMinutes(
  _primaryArchetypeId: ArchetypeId,
  _secondary: SecondaryFocus,
): number {
  return SESSION_HARD_CAP_MIN;
}
