export type PrescriptionSetWorkInput = {
  reps?: number | null;
  holdSec?: { min: number; max: number } | null;
  distanceM?: { min: number; max: number } | null;
  bw?: {
    prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
    holdSeconds?: number | null;
  } | null;
};

export type PrescriptionSetWork = {
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
};

function rangeMidpoint(
  range: { min: number; max: number },
  step = 5,
): number {
  return Math.round((range.min + range.max) / 2 / step) * step;
}

/**
 * Resolve the concrete work value used when a prescribed set is logged
 * without edits. UI and persistence consumers share this function so
 * "Same as planned" stores exactly what the individual logger displays.
 */
export function resolvePrescriptionSetWork(
  item: PrescriptionSetWorkInput | null | undefined,
): PrescriptionSetWork {
  if (!item) {
    return { reps: null, durationSec: null, distanceM: null };
  }
  if (item.distanceM) {
    return {
      reps: null,
      durationSec: null,
      distanceM: rangeMidpoint(item.distanceM),
    };
  }

  const holdSeconds =
    item.holdSec ??
    (item.bw?.prescriptionType === "isometric_hold" &&
    item.bw.holdSeconds != null
      ? { min: item.bw.holdSeconds, max: item.bw.holdSeconds }
      : null);
  if (holdSeconds) {
    return {
      reps: null,
      durationSec: rangeMidpoint(holdSeconds),
      distanceM: null,
    };
  }

  return {
    reps: item.reps ?? null,
    durationSec: null,
    distanceM: null,
  };
}
