import { readProgramLoadBasis } from "./program-load-basis";

export type ProgressionMovement = {
  pattern: string;
  primaryRegion: string;
  primaryMuscles: readonly string[];
};

/** Owner-selected metric increments, not a calibrated physiological model. */
export function scheduledProgressionIncrement(movement: ProgressionMovement): number | null {
  const upper = ["shoulder_scapular", "elbow_forearm"].includes(movement.primaryRegion);
  const lower = ["knee", "hamstring_posterior", "adductor_groin", "foot_ankle_calf"].includes(movement.primaryRegion);
  if (["press", "pull", "row"].includes(movement.pattern)) return upper ? 1.5 : null;
  if (["squat", "deadlift", "hinge", "lunge"].includes(movement.pattern)) {
    return lower || movement.primaryRegion === "lumbar_trunk" ? 2.5 : null;
  }
  if (movement.pattern === "isolation" && movement.primaryRegion === "foot_ankle_calf" &&
    movement.primaryMuscles.length > 0 && movement.primaryMuscles.every((muscle) => muscle === "calves")) return 2.5;
  return null;
}

export type ProgressionProgram = {
  active: boolean;
  owned?: boolean;
  items: readonly { movementId: string; percentTm?: number | null; meta?: Record<string, unknown> }[];
};

export function accountMaxMovementIds(programs: readonly ProgressionProgram[]): Set<string> {
  return new Set(programs.filter((program) => program.active).flatMap((program) =>
    program.items.filter((item) => {
      if (typeof item.percentTm !== "number" || !Number.isFinite(item.percentTm) || item.percentTm <= 0) return false;
      const basis = readProgramLoadBasis(item.meta?.programLoadBasis);
      return basis?.kind === "one-rm" || (!program.owned && basis === null);
    })
      .map((item) => item.movementId)));
}

export type ProgressionSuggestion = {
  movementId: string;
  source: string;
  status: string;
  resolvedAt: string | null;
};

export function scheduledProgressionCandidates(input: {
  now: Date;
  enabled: boolean;
  units: string;
  programs: readonly ProgressionProgram[];
  maxes: readonly {
    movementId: string; oneRmKg: number; updatedAt: string; movement: ProgressionMovement;
  }[];
  suggestions: readonly ProgressionSuggestion[];
}): { movementId: string; currentOneRmKg: number; proposedOneRmKg: number; updatedAt: string }[] {
  if (!input.enabled || input.units !== "metric") return [];
  const activeIds = accountMaxMovementIds(input.programs);
  const cutoff = input.now.getTime() - 21 * 24 * 60 * 60 * 1000;
  return input.maxes.flatMap((max) => {
    if (!activeIds.has(max.movementId) || !Number.isFinite(max.oneRmKg) || max.oneRmKg <= 0) return [];
    const suggestions = input.suggestions.filter((row) => row.movementId === max.movementId);
    if (suggestions.some((row) => row.status === "pending" && row.source === "scheduled_progression")) return [];
    const clocks = [max.updatedAt, ...suggestions.filter((row) => row.status === "dismissed" || row.status === "accepted")
      .map((row) => row.resolvedAt ?? "")].map((value) => Date.parse(value));
    if (clocks.some((clock) => !Number.isFinite(clock)) || Math.max(...clocks) > cutoff) return [];
    const increment = scheduledProgressionIncrement(max.movement);
    if (increment === null || max.oneRmKg + increment > 1000) return [];
    return [{
      movementId: max.movementId, currentOneRmKg: max.oneRmKg,
      proposedOneRmKg: Math.round((max.oneRmKg + increment) * 100) / 100, updatedAt: max.updatedAt,
    }];
  });
}

/** Input is newest first; derived advice wins without duplicating a lift. */
export function preferredMaxSuggestions<T extends { movementId: string; source: string }>(rows: readonly T[]): T[] {
  const selected = new Map<string, T>();
  for (const row of rows) {
    const previous = selected.get(row.movementId);
    if (!previous || (previous.source === "scheduled_progression" && row.source !== "scheduled_progression")) {
      selected.set(row.movementId, row);
    }

  }
  return [...selected.values()];
}

export function suggestedAccountOneRm(suggestionKg: number, source: string, effectivePercent: number): number {
  return source === "scheduled_progression" ? suggestionKg : Math.round((suggestionKg * 100 / effectivePercent) / 2.5) * 2.5;
}
