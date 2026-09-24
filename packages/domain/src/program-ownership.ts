export const PROGRAM_KINDS = ["strength", "running", "swimming", "hybrid"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];
export type BlockProgramKind = Exclude<ProgramKind, "swimming">;

export const PROGRAM_KIND_LABELS: Readonly<Record<ProgramKind, string>> = {
  strength: "Strength",
  running: "Running",
  swimming: "Swimming",
  hybrid: "Hybrid",
};

export function isBlockProgramKind(value: unknown): value is BlockProgramKind {
  return value === "strength" || value === "running" || value === "hybrid";
}

export interface ActiveBlockIdentity {
  id: string;
  programKind: BlockProgramKind | null;
}

export type ProgramActivationDecision =
  | { ok: true; replaceBlockId: string | null }
  | { ok: false; reason: "legacy-active" | "replacement-required" | "replacement-mismatch" | "duplicate-kind" };

/** Called with visible active owned blocks, never with a guessed legacy kind. */
export function reviewProgramActivation(
  kind: BlockProgramKind,
  active: readonly ActiveBlockIdentity[],
  replaceBlockId?: string,
): ProgramActivationDecision {
  if (active.some((program) => program.programKind === null)) return { ok: false, reason: "legacy-active" };
  const sameKind = active.filter((program) => program.programKind === kind);
  if (sameKind.length > 1) return { ok: false, reason: "duplicate-kind" };
  const existing = sameKind[0];
  if (replaceBlockId && existing?.id !== replaceBlockId) return { ok: false, reason: "replacement-mismatch" };
  if (existing && !replaceBlockId) return { ok: false, reason: "replacement-required" };
  return { ok: true, replaceBlockId: existing?.id ?? null };
}

export type ProgramPartActivity = "strength" | "run" | "bike" | "row" | "ski" | "rehab";

/** Rehab is an owned library attachment, not a user-selected movement role. */
export function programKindAllowsActivity(kind: ProgramKind, activity: ProgramPartActivity): boolean {
  if (activity === "rehab") return true;
  if (kind === "hybrid") return true;
  if (kind === "strength") return activity === "strength";
  if (kind === "running") return activity === "run";
  return false;
}
