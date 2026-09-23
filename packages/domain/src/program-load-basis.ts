export type ProgramLoadBasis =
  | { version: 1; kind: "one-rm"; percent: number; roundingKg: number | null }
  | { version: 1; kind: "working-max"; kg: number };

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Absent means legacy; malformed program-owned state must not use another program's defaults. */
export function readProgramLoadBasis(value: unknown): ProgramLoadBasis | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || !("version" in value) || value.version !== 1 || !("kind" in value)) {
    throw new Error("The program's load settings could not be read.");
  }
  if (value.kind === "working-max" && "kg" in value && positive(value.kg)) {
    return { version: 1, kind: "working-max", kg: value.kg };
  }
  if (value.kind === "one-rm" && "percent" in value && positive(value.percent) &&
    "roundingKg" in value && (value.roundingKg === null || positive(value.roundingKg))) {
    return { version: 1, kind: "one-rm", percent: value.percent, roundingKg: value.roundingKg };
  }
  throw new Error("The program's load settings could not be read.");
}

export function resolveProgramWorkingMax(
  basis: ProgramLoadBasis,
  oneRmKg: number | null | undefined,
): number | null {
  const checked = readProgramLoadBasis(basis);
  if (!checked) throw new Error("Choose load settings for this program.");
  if (checked.kind === "working-max") return checked.kg;
  if (!positive(oneRmKg)) return null;
  const kg = oneRmKg * checked.percent / 100;
  return checked.roundingKg === null ? kg : Math.round(kg / checked.roundingKg) * checked.roundingKg;
}

export function applyProgramLoadBases<T extends { movementId: string; percentTm?: number; meta?: Record<string, unknown> }>(
  items: readonly T[], bases: ReadonlyMap<string, ProgramLoadBasis | undefined>,
): T[] {
  return items.map((item) => {
    if (item.percentTm === undefined) return item;
    const basis = readProgramLoadBasis(bases.get(item.movementId));
    if (!basis) throw new Error("A programmed load is missing its program settings.");
    return { ...item, meta: { ...item.meta, programLoadBasis: basis } };
  });
}
