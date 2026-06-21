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

/**
 * Whether to SUPPRESS the volume-autoreg offer based purely on the active
 * block's timing. The offer eases *this block's* recent strength volume, so it
 * is meaningless — and misleading — before the block owns any logged work:
 *
 *   - a future-dated block (deployed to start later) has logged nothing yet, so
 *     the rolling "last 7 days" sets belong to a PRIOR/archived block;
 *   - a just-deployed block with zero sessions of its own is the same case.
 *
 * In both, comparing the prior block's sets to the new block's week-1 budget
 * produces a false "over budget" warning (field bug). Pure + deterministic so
 * the timing rule is unit-tested without a Supabase double.
 */
export function suppressAutoregForBlockTiming(args: {
  /** Active block `started_on` (YYYY-MM-DD), or null when unknown. */
  startedOnYmd: string | null;
  /** "now" in epoch ms. */
  nowMs: number;
  /** Count of sessions logged ON/AFTER started_on (i.e. belonging to this block). */
  ownLoggedSessions: number;
}): boolean {
  const { startedOnYmd, nowMs, ownLoggedSessions } = args;
  if (!startedOnYmd) return false; // unknown timing — fall back to the old behaviour
  const startedMs = new Date(`${startedOnYmd}T00:00:00`).getTime();
  if (!Number.isFinite(startedMs)) return false;
  if (startedMs > nowMs) return true; // block hasn't started yet
  if (ownLoggedSessions <= 0) return true; // started, but nothing logged in it yet
  return false;
}

function isDiscretionary(item: PrescriptionItem): boolean {
  return DISCRETIONARY_KINDS.has(item.kind);
}

/** True when a prescription carries at least one discretionary item to trim. */
export function hasDiscretionaryVolume(prescription: Prescription): boolean {
  return (prescription.items ?? []).some(isDiscretionary);
}

/** Count discretionary working sets grouped by movement name. */
function countDiscretionaryByName(items: PrescriptionItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    if (!isDiscretionary(it)) continue;
    const name = it.movementName ?? it.movementSlug ?? "Accessory";
    m.set(name, (m.get(name) ?? 0) + 1);
  }
  return m;
}

export type AutoregTrimChange = { name: string; before: number; after: number };

/**
 * Pure preview of what {@link applyAutoregVolumeScale} would do to one
 * prescription at the given scale: per accessory movement, the before/after
 * working-set count. Only movements that lose sets are returned. Mains,
 * back-off and warm-ups never appear (they're protected).
 */
export function previewAutoregTrim(
  prescription: Prescription,
  scale: number,
): AutoregTrimChange[] {
  const before = countDiscretionaryByName(prescription.items ?? []);
  const trimmed = applyAutoregVolumeScale({
    ...prescription,
    autoregVolumeScale: scale,
  });
  const after = countDiscretionaryByName(trimmed.items ?? []);
  const out: AutoregTrimChange[] = [];
  for (const [name, b] of before) {
    const a = after.get(name) ?? 0;
    if (b !== a) out.push({ name, before: b, after: a });
  }
  return out;
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
