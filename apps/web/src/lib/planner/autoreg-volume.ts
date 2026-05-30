/**
 * ADR 0013 — within-block volume autoregulation.
 *
 * Pure, deterministic read-time transform that trims *discretionary*
 * strength volume from a single materialized prescription when the user
 * has accepted an over-budget volume nudge. The trim is stored as a
 * single `prescription.autoregVolumeScale` field (see
 * `packages/db/src/schema/planner.ts`) so that:
 *
 *   - absent / >= 1  → no-op, byte-identical to legacy prescriptions
 *     (the regression invariant for users who never trigger the offer),
 *   - present (< 1)  → the discretionary items are sliced down,
 *     reversibly (clearing the field restores the full list).
 *
 * Applied at the two read seams that turn a stored prescription into
 * what the user sees / logs: `fillSessionFromPlan` (set_logs) and the
 * session / plan renderers. Both call `applyAutoregVolumeScale` so the
 * trim is computed in exactly one place.
 *
 * Mirrors the per-week `strengthVolumeScale` deload shape in
 * `archetypes.ts` (`items.slice(0, round(n·scale))`, dropping from the
 * end) — but applied to one session and confined to the discretionary
 * kinds, never the mains.
 */
import type { Prescription, PrescriptionItem, PrescriptionItemKind } from "@hta/db";
import type { CeilingBand } from "@/lib/stats/ceiling-queries";

/**
 * Discretionary strength kinds eligible for an autoregulation trim.
 * Mains, back-off, warm-ups and all cardio kinds are protected.
 */
const DISCRETIONARY_KINDS: ReadonlySet<PrescriptionItemKind> = new Set([
  "accessory",
  "tendon",
  "power_potentiation",
]);

/**
 * Per-band trim scale. CP-2 — both CP-5 heuristic / LOW confidence:
 * no study quantifies the optimal within-block volume-trim fraction.
 * Anchored to the deload-scale family (0.5–0.75) but gentler, since
 * this is a mid-week nudge rather than a programmed deload. Revisit
 * once adherence / outcome data exists.
 */
export const AUTOREG_VOLUME_SCALE_OVER = 0.8; // ceiling band "over" (110–130%)
export const AUTOREG_VOLUME_SCALE_WAYOVER = 0.66; // ceiling band "way-over" (≥130%)

/**
 * Map a strength ceiling band to the trim scale we would OFFER. Returns
 * null for bands that should not trigger an offer (under / on-budget /
 * at-line). Pure — the caller decides whether to surface the banner.
 */
export function autoregScaleForBand(band: CeilingBand): number | null {
  if (band === "over") return AUTOREG_VOLUME_SCALE_OVER;
  if (band === "way-over") return AUTOREG_VOLUME_SCALE_WAYOVER;
  return null;
}

function isDiscretionary(item: PrescriptionItem): boolean {
  return DISCRETIONARY_KINDS.has(item.kind);
}

/** True when a prescription carries at least one discretionary item to trim. */
export function hasDiscretionaryVolume(prescription: Prescription): boolean {
  return (prescription.items ?? []).some(isDiscretionary);
}

/**
 * Apply the stored `autoregVolumeScale` to a prescription, returning a
 * trimmed copy. No-op (returns the input unchanged) when the field is
 * absent, >= 1, or there are no discretionary items.
 *
 * The trim keeps `round(d · scale)` discretionary items in their
 * original order (dropping from the end of the discretionary subsequence)
 * and leaves every protected item exactly where it was.
 */
export function applyAutoregVolumeScale(prescription: Prescription): Prescription {
  const scale = prescription.autoregVolumeScale;
  if (typeof scale !== "number" || !(scale < 1) || scale <= 0) {
    return prescription;
  }
  const items = prescription.items;
  const discretionaryCount = items.reduce(
    (n, it) => (isDiscretionary(it) ? n + 1 : n),
    0,
  );
  if (discretionaryCount === 0) return prescription;

  const keep = Math.max(0, Math.min(discretionaryCount, Math.round(discretionaryCount * scale)));
  if (keep === discretionaryCount) return prescription;

  let seen = 0;
  const trimmed: PrescriptionItem[] = [];
  for (const it of items) {
    if (!isDiscretionary(it)) {
      trimmed.push(it);
      continue;
    }
    if (seen < keep) trimmed.push(it);
    seen++;
  }
  return { ...prescription, items: trimmed };
}
