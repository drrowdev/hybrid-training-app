import { greenStrengthBasis, type GreenInstance } from "@hta/green";

/**
 * The percentage of the true 1RM the ACTIVE program loads against, for a max
 * the lifter enters after deployment. `null` when the program family does not
 * seed a basis, so the caller keeps its own default.
 *
 * Green carries no basis of its own — it delegates strength to nested engines —
 * so it is read through the same canonical reader the alignment pass uses.
 *
 * This returns the program's declared percentage, not the per-movement rounded
 * ratio `computeTmAlignment` seeds, because no 1RM is in hand here to round
 * against. Both write `training_maxes.tm_percent`; they agree at the default
 * plate step, and the deployment pass takes precedence when it next runs.
 */
export function activeProgramTmPercent(
  programFamily: string | null | undefined,
  instance: unknown,
): number | null {
  if (programFamily === "tactical-barbell-green") {
    const basis = greenStrengthBasis(instance as GreenInstance);
    if (basis == null) return null;
    return basis.kind === "one-rm" ? 100 : Math.round(basis.tmPercent * 1000) / 10;
  }
  if (programFamily !== "tactical-barbell") {
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
