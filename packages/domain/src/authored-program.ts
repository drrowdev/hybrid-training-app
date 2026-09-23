import type { BlockProgramKind } from "./program-ownership";

export type ProgramActivity = BlockProgramKind;

export type MovementDose =
  | { kind: "reps"; reps: number }
  | { kind: "hold"; seconds: number }
  | { kind: "distance"; metres: number };

export interface AuthoredMovement {
  id: string;
  movementId: string;
  role: "main" | "accessory" | "tendon";
  sets: number;
  dose: MovementDose;
  weightKg?: number;
  restSeconds: number;
  notes: string;
}

export interface AuthoredInterval {
  id: string;
  label: string;
  target: { kind: "time"; seconds: number } | { kind: "distance"; metres: number };
  effort: "easy" | "steady" | "hard" | "recovery";
}

export type AuthoredWorkoutPart =
  | { id: string; kind: "movement"; movement: AuthoredMovement }
  | { id: string; kind: "rehab"; protocolId: string }
  | { id: string; kind: "circuit"; name: string; rounds: number; movements: AuthoredMovement[] }
  | {
      id: string;
      kind: "cardio";
      movementId: string;
      modality: "run" | "bike" | "row" | "ski";
      intensity: "z2" | "threshold" | "vo2" | "alactic";
      repeats: number;
      intervals: AuthoredInterval[];
      notes: string;
    };

export interface AuthoredWorkout {
  id: string;
  name: string;
  weekday: number;
  parts: AuthoredWorkoutPart[];
}

export interface AuthoredProgramDefinition {
  version: 1;
  activity: ProgramActivity;
  name: string;
  weeks: number;
  workouts: AuthoredWorkout[];
}

export interface AuthoredCatalogMovement {
  id: string;
  slug: string;
  displayName: string;
  pattern: string;
  modality?: string | null;
}

export interface AuthoredPrescriptionItem {
  movementId: string;
  movementSlug: string;
  movementName: string;
  kind: "main" | "accessory" | "tendon" | "cardio_z2" | "cardio_vo2" | "cardio_threshold" | "cardio_alactic";
  sets?: number;
  reps?: number;
  repRange?: { min: number; max: number };
  holdSec?: { min: number; max: number };
  distanceM?: { min: number; max: number };
  targetWeightKg?: number;
  isAmrap?: false;
  durationMin?: number;
  notes?: string;
  circuit?: { id: string; name: string; position: number; size: number; rounds: number; round: number };
  cardioPlan?: {
    summary: string;
    meta: string;
    segments: { label: string; detail: string }[];
    effort: string;
  };
  meta: {
    authoredPartId: string;
    authoredMovementId?: string;
    restSeconds?: number;
    intervals?: AuthoredInterval[];
    repeats?: number;
    modality?: string;
    rehab?: boolean;
  };
}

export function authoredMovementIds(definition: AuthoredProgramDefinition): string[] {
  return [...new Set(definition.workouts.flatMap((workout) => workout.parts.flatMap((part) =>
    part.kind === "rehab" ? [] : part.kind === "movement" ? [part.movement.movementId]
      : part.kind === "circuit" ? part.movements.map((movement) => movement.movementId)
        : [part.movementId],
  )))];
}

export function authoredRehabProtocolIds(definition: AuthoredProgramDefinition): string[] {
  return [...new Set(definition.workouts.flatMap((workout) => workout.parts.flatMap((part) =>
    part.kind === "rehab" ? [part.protocolId] : [])))];
}

export function authoredWorkoutActivities(workout: AuthoredWorkout): ("strength" | "running")[] {
  const activities = new Set<"strength" | "running">();
  for (const part of workout.parts) {
    if (part.kind === "rehab") continue;
    if (part.kind !== "cardio") activities.add("strength");
    else if (part.modality === "run") activities.add("running");
  }
  return [...activities];
}

export function formatAuthoredInterval(interval: AuthoredInterval): string {
  const target = interval.target.kind === "distance"
    ? `${interval.target.metres} m`
    : interval.target.seconds % 60 === 0
      ? `${interval.target.seconds / 60} min`
      : `${interval.target.seconds} sec`;
  return `${target} ${interval.effort}`;
}

/** Compiles only executable logger primitives; names always come from the owned catalog. */
export function compileAuthoredWorkout(
  workout: AuthoredWorkout,
  catalog: readonly AuthoredCatalogMovement[],
  compileRehab?: (protocolId: string, partId: string) => AuthoredPrescriptionItem[],
): { items: AuthoredPrescriptionItem[]; meta: { authoredWorkout: AuthoredWorkout } } {
  const byId = new Map(catalog.map((movement) => [movement.id, movement]));
  const resolve = (id: string) => {
    const movement = byId.get(id);
    if (!movement) throw new Error("An exercise is no longer available. Choose it again from the library.");
    return movement;
  };
  const compileMovement = (
    movement: AuthoredMovement, partId: string, circuit?: Omit<NonNullable<AuthoredPrescriptionItem["circuit"]>, "round">,
  ): AuthoredPrescriptionItem[] => {
    const selected = resolve(movement.movementId);
    if (selected.pattern === "cardio") throw new Error("Add running or machine intervals as a cardio part.");
    return Array.from({ length: circuit?.rounds ?? movement.sets }, (_, round) => ({
      movementId: selected.id, movementSlug: selected.slug, movementName: selected.displayName,
      kind: movement.role, sets: 1, isAmrap: false,
      ...(movement.dose.kind === "reps" ? { reps: movement.dose.reps }
        : movement.dose.kind === "hold" ? { holdSec: { min: movement.dose.seconds, max: movement.dose.seconds } }
          : { distanceM: { min: movement.dose.metres, max: movement.dose.metres } }),
      ...(movement.weightKg !== undefined ? { targetWeightKg: movement.weightKg } : {}),
      ...(movement.notes ? { notes: movement.notes } : {}),
      ...(circuit ? { circuit: { ...circuit, round } } : {}),
      meta: { authoredPartId: partId, authoredMovementId: movement.id, restSeconds: movement.restSeconds,
        ...(movement.role === "tendon" ? { rehab: true } : {}) },
    }));
  };
  const items = workout.parts.flatMap((part): AuthoredPrescriptionItem[] => {
    if (part.kind === "rehab") {
      if (!compileRehab) throw new Error("Choose an available rehab protocol from your library.");
      return compileRehab(part.protocolId, part.id);
    }
    if (part.kind === "movement") return compileMovement(part.movement, part.id);
    if (part.kind === "circuit") {
      return part.movements.flatMap((movement, position) => compileMovement(movement, part.id, {
        id: part.id, name: part.name, position, size: part.movements.length, rounds: part.rounds,
      }));
    }
    const selected = resolve(part.movementId);
    if (selected.pattern !== "cardio" || selected.modality !== part.modality) {
      throw new Error("Choose a matching cardio activity from the library.");
    }
    const timed = part.intervals.every((interval) => interval.target.kind === "time");
    const seconds = part.intervals.reduce((sum, interval) =>
      sum + (interval.target.kind === "time" ? interval.target.seconds : 0), 0) * part.repeats;
    return [{
      movementId: selected.id, movementSlug: selected.slug, movementName: selected.displayName,
      kind: `cardio_${part.intensity}`,
      ...(timed ? { durationMin: seconds / 60 } : {}),
      ...(part.notes ? { notes: part.notes } : {}),
      cardioPlan: {
        summary: selected.displayName,
        meta: `${part.repeats} ${part.repeats === 1 ? "round" : "rounds"}`,
        segments: part.intervals.map((interval) => ({ label: interval.label, detail: formatAuthoredInterval(interval) })),
        effort: "",
      },
      meta: { authoredPartId: part.id, intervals: part.intervals, repeats: part.repeats, modality: part.modality },
    }];
  });
  return { items, meta: { authoredWorkout: workout } };
}

/** A weekly plan starts on the selected date, not the preceding Monday. */
export function authoredProgramDates(definition: AuthoredProgramDefinition, startedOn: string) {
  if (!Number.isInteger(definition.weeks) || definition.weeks < 1 || definition.weeks > 16) {
    throw new Error("Choose between 1 and 16 weeks.");
  }
  const start = new Date(`${startedOn}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startedOn) {
    throw new Error("Choose a valid start date.");
  }
  const startWeekday = (start.getUTCDay() + 6) % 7;
  return Array.from({ length: definition.weeks }, (_, week) =>
    [...definition.workouts].sort((a, b) => a.weekday - b.weekday).map((workout) => {
      const offset = (workout.weekday - startWeekday + 7) % 7 + week * 7;
      const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      return {
        date, workout, ref: `authored:${workout.id}:${week}`,
        weekIndex: Math.floor((startWeekday + offset) / 7), dayIndex: workout.weekday,
      };
    }),
  ).flat().sort((a, b) => a.date.localeCompare(b.date));
}

export interface AuthoredExecutionPart {
  id: string;
  title: string;
  kind: "movement" | "circuit" | "cardio" | "rehab";
  itemIndices: number[];
}

export function authoredExecutionParts(items: readonly {
  kind: string; movementName?: string; meta?: Record<string, unknown>;
  circuit?: { name?: string };
}[]): AuthoredExecutionPart[] {
  const parts = new Map<string, AuthoredExecutionPart>();
  items.forEach((item, index) => {
    const id = item.meta?.authoredPartId;
    if (typeof id !== "string") return;
    const part = parts.get(id);
    if (part) { part.itemIndices.push(index); return; }
    const protocolName = item.meta?.rehabProtocolName;
    parts.set(id, {
      id, title: typeof protocolName === "string" ? protocolName : item.circuit?.name ?? item.movementName ?? "Workout part",
      kind: typeof protocolName === "string" ? "rehab" : item.kind.startsWith("cardio_") ? "cardio" : item.circuit ? "circuit" : "movement",
      itemIndices: [index],
    });
  });
  return [...parts.values()];
}

export function authoredPartComplete(part: AuthoredExecutionPart, setIndices: ReadonlySet<number>, cardioBlockIndices: ReadonlySet<number>): boolean {
  return part.itemIndices.every((index) => part.kind === "cardio" ? cardioBlockIndices.has(index + 1) : setIndices.has(index));
}
