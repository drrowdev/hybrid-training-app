export function activeProgramTmPercent(
  programFamily: string | null | undefined,
  instance: unknown,
): number | null {
  if (
    programFamily !== "tactical-barbell" &&
    programFamily !== "tactical-barbell-green"
  ) {
    return null;
  }
  const value = instance as {
    useTrainingMax?: boolean;
    tmPercent?: number;
  } | null;
  if (
    value?.useTrainingMax &&
    typeof value.tmPercent === "number" &&
    Number.isFinite(value.tmPercent)
  ) {
    return Math.round(value.tmPercent * 1000) / 10;
  }
  return 100;
}
