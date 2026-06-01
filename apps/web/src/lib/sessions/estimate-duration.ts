/**
 * Set-aware session duration estimate.
 *
 * Replaces the legacy `strengthCount * 5 min` flat-per-item heuristic (which
 * was set-count-blind and therefore useless for budgeting). This model prices
 * each working set as `work + rest`, so adding sets or items raises the
 * estimate monotonically — the property the ADR 0020 volume-tilt governor
 * relies on to keep a session inside the user's time budget.
 *
 * Shared by:
 *   - the Plan + Preview surfaces (the `~N min` the user sees), and
 *   - the planner's volume-tilt governor (the budget the tilt is trimmed to),
 * so the number the engine budgets against and the number the user sees are
 * the same.
 *
 * **Bias is intentionally conservative (slight over-count).** Every set is
 * charged its full inter-set rest, including the final set of an item and
 * sets a lifter might superset in practice. For a *governor* that must not
 * blow a hard 75-min ceiling, over-estimating is the safe direction.
 *
 * Calibration: `WORK_SEC_PER_SET` and the power-primer rest are CP-1 Stage-A
 * heuristics (no calibration data). Rest-per-kind reuses the single source of
 * truth in `./rest` (Schoenfeld 2016 strength rest ≥ 2 min; accessory 60–90 s).
 * Refine `WORK_SEC_PER_SET` against logged set timestamps once available.
 */

import type { PrescriptionItem, PrescriptionItemKind } from "@hta/db";
import { restSecondsForKind } from "./rest";

/**
 * Per-set working time (concentric + eccentric + bar setup), independent of
 * load. ~40 s is a practitioner estimate spanning a heavy triple and a
 * 12-rep accessory. // heuristic, no calibration data
 */
export const WORK_SEC_PER_SET = 40;

/**
 * `power_potentiation` primers (explosive submaximal doubles with full
 * recovery) have no entry in `restSecondsForKind` — it returns 0 for them.
 * Price the rest here so primers aren't counted as free.
 * // heuristic, no calibration data
 */
const POWER_POTENTIATION_REST_SEC = 90;

function isCardio(kind: PrescriptionItemKind | undefined): boolean {
  return (kind ?? "").startsWith("cardio_");
}

function workSecForItem(it: PrescriptionItem): number {
  // Isometric / tendon holds are time-under-tension, not rep-paced: charge
  // the hold midpoint rather than the generic per-set estimate.
  if (it.holdSec) return (it.holdSec.min + it.holdSec.max) / 2;
  return WORK_SEC_PER_SET;
}

function restSecForItem(kind: PrescriptionItemKind): number {
  if (kind === "power_potentiation") return POWER_POTENTIATION_REST_SEC;
  return restSecondsForKind(kind);
}

/**
 * Total estimated wall-clock seconds for a planned session's items.
 * Cardio items contribute their planned `durationMin`; strength-family items
 * contribute `sets × (work + rest)`. `cardio_external` (no duration) and
 * empty inputs contribute nothing.
 */
export function estimateSessionSeconds(
  items: readonly PrescriptionItem[] | null | undefined,
): number {
  if (!items || items.length === 0) return 0;
  let sec = 0;
  for (const it of items) {
    if (isCardio(it.kind)) {
      sec += (it.durationMin ?? 0) * 60;
      continue;
    }
    const sets = Math.max(1, it.sets ?? 1);
    sec += sets * (workSecForItem(it) + restSecForItem(it.kind));
  }
  return sec;
}

/**
 * Estimated session duration in whole minutes, or `null` when there's nothing
 * to price (no items, or an external-cardio-only session with no logged
 * duration) — matching the legacy "unknown ⇒ null" contract the preview UI
 * already handles.
 */
export function estimateSessionMinutes(
  items: readonly PrescriptionItem[] | null | undefined,
): number | null {
  if (!items || items.length === 0) return null;
  const sec = estimateSessionSeconds(items);
  if (sec <= 0) return null;
  return Math.round(sec / 60);
}
