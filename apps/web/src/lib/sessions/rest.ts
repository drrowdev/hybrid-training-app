/**
 * Inter-set rest defaults (Phase 1 B4 auto rest-timer).
 *
 * No DC mandates exact rest periods in `design-constraints.md`; these
 * defaults follow the practitioner consensus surfaced in the research
 * papers (Schoenfeld 2016 strength rest ≥ 2 min; accessory hypertrophy
 * 60–90 s; cardio = self-paced / no timer).
 *
 * Keeping this in `lib/sessions/` rather than `packages/engine` because
 * the value is UI-only — it never reaches the planner or the engine.
 */

import type { PrescriptionItemKind } from "@hta/db";

export type RestableSetKind =
  | "warmup"
  | "main"
  | "back_off"
  | "accessory"
  | "tendon";

/**
 * Default rest-timer seconds for a logged set, inferred from the set
 * kind. Cardio kinds return 0 — the rest timer doesn't fire.
 */
export function restSecondsForKind(kind: PrescriptionItemKind | RestableSetKind): number {
  switch (kind) {
    case "warmup":
      return 60;
    case "main":
      return 180;
    case "back_off":
      // Supplemental volume after the main work — 2 min keeps the bar
      // moving without dragging the session out.
      return 120;
    case "tendon":
      // Long-duration isometric / HSR holds: ~2 min between sets keeps
      // the tissue stack productive without dragging the session out.
      return 120;
    case "accessory":
      return 90;
    default:
      // cardio_* and anything unknown — no countdown.
      return 0;
  }
}

/**
 * Rest seconds for a set, honouring the lifter's opt-out.
 *
 * The three loggers all go through this rather than calling
 * `restSecondsForKind` directly, so "should a countdown start?" has one
 * answer in one place instead of three copies of the same `if`.
 *
 * Disabled returns 0, which every caller already handles: `RestTimer`
 * documents `seconds=0` as "render nothing", and the call sites guard on
 * `secs > 0` before arming a deadline. It is the same state a superset
 * already produces mid-round, so it is well-trodden rather than novel.
 *
 * This suppresses the COUNTDOWN, not the rest. Nothing downstream keys off
 * the timer — saving a set drives auto-advance and completion — so a lifter
 * who turns it off simply rests untimed.
 *
 * Note what deliberately does NOT consult the preference: the session-duration
 * estimate (`estimate-duration.ts`) keeps calling `restSecondsForKind`. The
 * lifter still rests when the countdown is off, so an estimate that dropped
 * rest would model a session nobody performs — the same reason ADR 0071 forbids
 * the superset presentation from feeding the duration governor.
 */
export function restSecondsForSet(
  kind: PrescriptionItemKind | RestableSetKind,
  opts: { restTimerEnabled: boolean },
): number {
  if (!opts.restTimerEnabled) return 0;
  return restSecondsForKind(kind);
}
