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
    case "back_off":
      return 180;
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
