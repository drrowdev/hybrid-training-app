/**
 * ADR 0070 — the canonical prescribed-snapshot resolver.
 *
 * Single home (plan §6.9) for turning a prescription item into "what the app
 * asked for on this set". The live logger, the "Same as planned" bulk fill, and
 * the per-set server action all call this, so what is DISPLAYED and what is
 * STORED cannot drift.
 *
 * Pure: no DB, no I/O, no React. The caller supplies the resolved training max
 * because TM resolution is a platform concern.
 *
 * Deliberately conservative about the load. `targetWeightKg` is emitted ONLY
 * when the prescription genuinely determines it — a percentage of a known
 * working max, or an explicit target weight (5/3/1 warm-up ramps). The logger's
 * "last logged weight" fallback is a UI convenience, NOT a prescription, and
 * must never be recorded as one: doing so would manufacture a fake "on target"
 * result for every unanchored movement.
 */
import { resolvePrescriptionSetWork } from "./prescription-set-work";

/** The subset of a prescription item this resolver reads. */
export type PrescribedSnapshotInput = {
  kind?: string;
  percentTm?: number | null;
  targetWeightKg?: number | null;
  reps?: number | null;
  optional?: boolean;
  isAmrap?: boolean;
  setRange?: { min: number; max: number } | null;
  repRange?: { min: number; max: number } | null;
  /**
   * Reps-in-reserve / RPE targets. Ranges in the app's prescription schema
   * (a single value is encoded as min === max), and mutually exclusive.
   */
  targetRir?: { min: number; max: number } | null;
  targetRpe?: { min: number; max: number } | null;
  movementSlug?: string | null;
  holdSec?: { min: number; max: number } | null;
  distanceM?: { min: number; max: number } | null;
  bw?: {
    prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
    holdSeconds?: number | null;
  } | null;
};

export type PrescribedSnapshotContext = {
  /** Resolved training max in kg for this movement, or null when unanchored. */
  tmKg?: number | null;
  /** What `percentTm` is a percentage of. 5/3/1 → "TM"; TB / GP / HYROX → "1RM". */
  basis?: "TM" | "1RM";
  /** Plate-rounding hook so storage matches the displayed load exactly. */
  roundToPlate?: (kg: number) => number;
  setKind?: string;
};

export type PrescribedSnapshot = {
  optional?: boolean;
  setRange?: { min: number; max: number };
  repRange?: { min: number; max: number };
  /** Intended effort. Ranges (min === max for a single value); mutually exclusive. */
  targetRir?: { min: number; max: number };
  targetRpe?: { min: number; max: number };
  isAmrap?: boolean;
  percentTm?: number;
  basis?: "TM" | "1RM";
  movementSlug?: string;
  setKind?: string;
};

export type ResolvedPrescribed = {
  /** Prescribed load in kg, or null when the prescription doesn't determine one. */
  targetWeightKg: number | null;
  /** Prescribed reps, or null for hold / distance / unspecified work. */
  targetReps: number | null;
  /** Slot semantics, or null when the item carries nothing worth recording. */
  prescribed: PrescribedSnapshot | null;
};

const EMPTY: ResolvedPrescribed = {
  targetWeightKg: null,
  targetReps: null,
  prescribed: null,
};

function num(v: number | null | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Resolve the prescribed snapshot for one set.
 *
 * Returns all-null for a missing item (free-form logging) so callers can pass
 * through unconditionally.
 */
export function resolvePrescribedSnapshot(
  item: PrescribedSnapshotInput | null | undefined,
  ctx: PrescribedSnapshotContext = {},
): ResolvedPrescribed {
  if (!item) return EMPTY;

  const round = ctx.roundToPlate ?? ((kg: number) => kg);

  let targetWeightKg: number | null = null;
  const percentTm = num(item.percentTm);
  const tmKg = num(ctx.tmKg);
  if (percentTm != null && tmKg != null && tmKg > 0) {
    targetWeightKg = round((tmKg * percentTm) / 100);
  } else if (item.targetWeightKg != null && item.targetWeightKg > 0) {
    // Warm-up ramps resolve to a concrete kg at deploy and carry no percentage.
    targetWeightKg = round(item.targetWeightKg);
  }

  // Reuse the existing work resolver so reps/hold/distance selection (and its
  // range-midpoint rule) has exactly one implementation.
  const work = resolvePrescriptionSetWork({
    reps: item.reps ?? null,
    holdSec: item.holdSec ?? null,
    distanceM: item.distanceM ?? null,
    bw: item.bw ?? null,
  });

  const prescribed: PrescribedSnapshot = {};
  if (item.optional === true) prescribed.optional = true;
  if (item.isAmrap === true) prescribed.isAmrap = true;
  if (item.setRange) prescribed.setRange = item.setRange;
  if (item.repRange) prescribed.repRange = item.repRange;
  const rir = item.targetRir;
  if (rir) prescribed.targetRir = rir;
  const rpe = item.targetRpe;
  if (rpe) prescribed.targetRpe = rpe;
  if (percentTm != null) {
    prescribed.percentTm = percentTm;
    // Basis is only meaningful alongside a percentage.
    if (ctx.basis) prescribed.basis = ctx.basis;
  }
  if (item.movementSlug) prescribed.movementSlug = item.movementSlug;
  const setKind = ctx.setKind ?? item.kind;
  if (setKind) prescribed.setKind = setKind;

  return {
    targetWeightKg,
    targetReps: work.reps,
    prescribed: Object.keys(prescribed).length > 0 ? prescribed : null,
  };
}

/**
 * Tolerance used when the server checks a client-submitted target against the
 * prescription it can see. Wide enough to absorb plate-rounding and a stale-by-
 * one-render prescription; narrow enough that a fabricated value is rejected.
 */
export const TARGET_VALIDATION_TOLERANCE = 0.15; // ±15%

/**
 * Server-side guard: accept a client-submitted target only when it is close to
 * what the prescription independently implies. Returns the SUBMITTED value on
 * success (it is the one the user actually saw — that is the whole point) and
 * null when it can't be corroborated.
 *
 * Never throws and never substitutes the server's own figure: a mismatch means
 * "we don't know what was shown", which is exactly what NULL encodes.
 */
export function validateSubmittedTarget(
  submitted: number | null | undefined,
  expected: number | null | undefined,
): number | null {
  const s = num(submitted);
  if (s == null || s < 0) return null;
  const e = num(expected);
  // Nothing to check against (unanchored movement, no TM) — trust the client;
  // it is the only party that knows what was rendered.
  if (e == null) return s;
  if (e === 0) return s === 0 ? s : null;
  const drift = Math.abs(s - e) / e;
  return drift <= TARGET_VALIDATION_TOLERANCE ? s : null;
}
