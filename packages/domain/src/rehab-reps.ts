export const REHAB_REPS_MAX = 500;

export type RehabRepTarget = {
  reps?: number;
  repRange?: { min: number; max: number };
};

export function parseRehabReps(
  text: string,
): { ok: true; value: RehabRepTarget } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  const match = /^(\d+)(?:\s*[-\u2013\u2014]\s*(\d+))?$/.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Enter reps as a whole number or a range, such as 8-10." };
  }
  const min = Number(match[1]);
  const max = match[2] == null ? min : Number(match[2]);
  if (min < 1 || max < 1 || min > REHAB_REPS_MAX || max > REHAB_REPS_MAX) {
    return { ok: false, error: `Use reps between 1 and ${REHAB_REPS_MAX}.` };
  }
  if (min > max) {
    return { ok: false, error: "Enter the lower rep count first." };
  }
  return {
    ok: true,
    value: {
      reps: min,
      ...(min !== max ? { repRange: { min, max } } : {}),
    },
  };
}

export function formatRehabReps(target: RehabRepTarget): string {
  return target.repRange && target.repRange.min !== target.repRange.max
    ? `${target.repRange.min}-${target.repRange.max}`
    : String(target.reps ?? "");
}
