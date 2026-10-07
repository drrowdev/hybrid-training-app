import type { BlockProgramKind } from "./program-ownership";
import type { ProgramLoadBasis } from "./program-load-basis";
import { resolveTargetLoadKg } from "./target-load";
import { isSystemLoadMovementSlug } from "./movement-load-identity";

export type ProgramActivity = BlockProgramKind;

export type MovementDose =
  | { kind: "reps"; reps: number | string }
  | { kind: "hold"; seconds: number }
  | { kind: "distance"; metres: number };

export type AuthoredLoad = { kind: "pct" | "kg" | "rir"; value: number | string };
export type AuthoredTestAfter = "updateFromLoggedSet" | "fixedIncrease" | "keep";
/** What a logged test set does to the account 1RM. "keep" is never marked. */
export type AuthoredTestRule = { after: "updateFromLoggedSet" } | { after: "fixedIncrease"; stepKg: number };

export interface AuthoredWeek {
  type: "Build" | "Deload" | "Test";
  sets: string;
  reps: string;
  pct: number;
  fewer?: boolean;
  after?: AuthoredTestAfter;
  stepKg?: number;
}
export interface AuthoredMovementOverride {
  sets?: string;
  reps?: string;
  load?: AuthoredLoad | null;
}

export interface AuthoredMovement {
  id: string;
  movementId: string;
  role: "main" | "accessory" | "tendon";
  sets: number | string;
  dose: MovementDose;
  weightKg?: number;
  load?: AuthoredLoad | null;
  overrides?: Record<string, AuthoredMovementOverride>;
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
  | {
      id: string; kind: "circuit"; name: string; rounds: number; movements: AuthoredMovement[];
      weeks?: { rounds: number; runMetres?: number }[];
      runMovementId?: string;
    }
  | {
      id: string;
      kind: "cardio";
      movementId: string;
      modality: "run" | "bike" | "row" | "ski";
      intensity: "z2" | "threshold" | "vo2" | "alactic";
      repeats: number;
      intervals: AuthoredInterval[];
      notes: string;
      duration?: string;
      effort?: string;
    };

export interface AuthoredWorkout {
  id: string;
  name: string;
  weekday: number;
  parts: AuthoredWorkoutPart[];
}

export interface AuthoredProgramDefinitionV1 {
  version: 1;
  activity: ProgramActivity;
  name: string;
  weeks: number;
  workouts: AuthoredWorkout[];
}

export interface AuthoredProgramDefinitionV2 extends Omit<AuthoredProgramDefinitionV1, "version" | "weeks"> {
  version: 2;
  weeks: AuthoredWeek[];
}
export type AuthoredProgramDefinition = AuthoredProgramDefinitionV1 | AuthoredProgramDefinitionV2;

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
  setRange?: { min: number; max: number };
  optional?: boolean;
  reps?: number;
  repRange?: { min: number; max: number };
  holdSec?: { min: number; max: number };
  distanceM?: { min: number; max: number };
  targetWeightKg?: number;
  percentTm?: number;
  targetRir?: { min: number; max: number };
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
    programLoadBasis?: ProgramLoadBasis;
    authoredLoadRoundingKg?: number;
    authoredReps?: string;
    authoredTest?: AuthoredTestRule;
  };
}

export function authoredRange(value: string | number, max = 500): { min: number; max: number } {
  const match = /^(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?(?:\s*\/\s*(?:side|leg))?$/.exec(String(value).trim());
  if (!match) throw new Error("Enter a number or range, such as 6–10.");
  const low = Number(match[1]), high = Number(match[2] ?? match[1]);
  if (low < 0 || high < low || high > max) throw new Error(`Enter a range between 0 and ${max}.`);
  return { min: low, max: high };
}

export function parseAuthoredLoad(value: string): AuthoredLoad | null {
  if (!value.trim()) return null;
  const match = /^(?:(RIR)\s+)?(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(%|kg)?$/i.exec(value.trim());
  if (!match || (match[1] && match[3]) || (!match[1] && !match[3])) {
    throw new Error("Enter a load such as 75%, 80 kg or RIR 2.");
  }
  const kind = match[1] ? "rir" : match[3] === "%" ? "pct" : "kg";
  const text = match[2]!.replaceAll(",", ".");
  const range = authoredRange(text, kind === "rir" ? 10 : kind === "pct" ? 100 : 1000);
  if (kind !== "rir" && range.min !== range.max) throw new Error("Enter one percentage or weight.");
  return { kind, value: range.min === range.max ? range.min : text };
}

export function formatAuthoredLoad(load: AuthoredLoad | null | undefined): string {
  return !load ? "" : load.kind === "rir" ? `RIR ${load.value}` : `${load.value}${load.kind === "pct" ? "%" : " kg"}`;
}

export function authoredLoadDisplay(
  load: AuthoredLoad | null | undefined, movement: Pick<AuthoredCatalogMovement, "slug"> | undefined,
  oneRmKg?: number, bodyweightKg?: number,
): { text: string; note: string; rounded: boolean } {
  if (load?.kind !== "pct") return { text: formatAuthoredLoad(load), note: "", rounded: false };
  const system = isSystemLoadMovementSlug(movement?.slug);
  const kg = resolveTargetLoadKg({
    percentTm: Number(load.value), meta: {
      programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null }, authoredLoadRoundingKg: 2.5,
    },
  }, { oneRmKg, bodyweightKg, isSystemLoad: system });
  if (kg === null) return { text: formatAuthoredLoad(load), note: "", rounded: false };
  const unrounded = resolveTargetLoadKg({ percentTm: Number(load.value), meta: {
    programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null },
  } }, { oneRmKg, bodyweightKg, isSystemLoad: system });
  const text = `${system ? "+" : ""}${kg} kg`;
  return {
    text,
    rounded: unrounded !== null && Math.abs(unrounded - kg) > 0.001,
    note: system && bodyweightKg != null && oneRmKg != null
      ? `${load.value}% of ${oneRmKg} kg (${bodyweightKg} kg bodyweight + ${Math.round((oneRmKg - bodyweightKg) * 100) / 100} kg) = ${text}`
      : `${load.value}% of ${oneRmKg} kg = ${text}`,
  };
}

export function authoredWeekCount(definition: AuthoredProgramDefinition): number {
  return definition.version === 1 ? definition.weeks : definition.weeks.length;
}

/** Upgrades in memory only. Every legacy main lift retains its own fixed dose. */
export function upgradeAuthoredProgram(definition: AuthoredProgramDefinition): AuthoredProgramDefinitionV2 {
  if (definition.version === 2) return definition;
  const weeks: AuthoredWeek[] = Array.from({ length: definition.weeks }, () => ({ type: "Build", sets: "3", reps: "5", pct: 75 }));
  const movement = (entry: AuthoredMovement, followsWeek: boolean): AuthoredMovement => {
    const { weightKg, ...rest } = entry;
    const load: AuthoredLoad | null = weightKg === undefined ? null : { kind: "kg", value: weightKg };
    return {
      ...rest, sets: String(entry.sets), load,
      ...(followsWeek && entry.role === "main" ? { overrides: Object.fromEntries(weeks.map((_, index) => [index, {
        sets: String(entry.sets), ...(entry.dose.kind === "reps" ? { reps: String(entry.dose.reps) } : {}), load,
      }])) } : {}),
    };
  };
  return {
    ...definition, version: 2, weeks,
    workouts: definition.workouts.map((workout) => ({ ...workout, parts: workout.parts.map((part) =>
      part.kind === "movement" ? { ...part, movement: movement(part.movement, true) }
        : part.kind === "circuit" ? { ...part, movements: part.movements.map((entry) => movement(entry, false)),
          weeks: weeks.map(() => ({ rounds: part.rounds })) } : part) })),
  };
}

export function effectiveAuthoredMovement(movement: AuthoredMovement, week?: AuthoredWeek, weekIndex = 0) {
  const followsWeek = movement.role === "main" && movement.dose.kind === "reps" && week != null;
  const override = movement.overrides?.[weekIndex] ?? {};
  let sets = followsWeek ? week.sets : String(movement.sets);
  const fewer = week?.type === "Deload" && week.fewer && movement.role === "accessory";
  if (fewer) sets = sets.replace(/\d+/g, (value) => String(Math.max(1, Number(value) - 1)));
  return {
    sets: override.sets ?? sets,
    reps: override.reps ?? (followsWeek ? week.reps : movement.dose.kind === "reps" ? String(movement.dose.reps) : ""),
    load: override.load !== undefined ? override.load : followsWeek ? { kind: "pct" as const, value: week.pct }
      : movement.load ?? (movement.weightKg === undefined ? null : { kind: "kg" as const, value: movement.weightKg }),
    overridden: Object.keys(override).length > 0,
    deload: !!fewer && override.sets === undefined,
  };
}

/** The 1RM rule a Test week attaches to its main lifts; null when nothing should be proposed. */
export function authoredTestRule(week: AuthoredWeek | undefined): AuthoredTestRule | null {
  if (week?.type !== "Test") return null;
  if (week.after === "updateFromLoggedSet") return { after: "updateFromLoggedSet" };
  if (week.after === "fixedIncrease" && typeof week.stepKg === "number" && Number.isFinite(week.stepKg) && week.stepKg > 0) {
    return { after: "fixedIncrease", stepKg: week.stepKg };
  }
  return null;
}

export function authoredMovementIds(definition: AuthoredProgramDefinition): string[] {
  return [...new Set(definition.workouts.flatMap((workout) => workout.parts.flatMap((part) =>
    part.kind === "rehab" ? [] : part.kind === "movement" ? [part.movement.movementId]
      : part.kind === "circuit" ? [...part.movements.map((movement) => movement.movementId), ...(part.runMovementId ? [part.runMovementId] : [])]
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

export function authoredWorkoutActivity(workout: AuthoredWorkout, catalog: readonly AuthoredCatalogMovement[]): ProgramActivity {
  const movements = workout.parts.flatMap((part) => part.kind === "movement" ? [part.movement]
    : part.kind === "circuit" ? part.movements : []);
  const cardio = workout.parts.some((part) => part.kind === "cardio" || part.kind === "circuit" && part.weeks?.some((week) => week.runMetres))
    || movements.some((movement) => catalog.find((entry) => entry.id === movement.movementId)?.pattern === "cardio");
  const strength = movements.some((movement) => catalog.find((entry) => entry.id === movement.movementId)?.pattern !== "cardio");
  return cardio ? strength ? "hybrid" : "running" : "strength";
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
  week?: AuthoredWeek,
  weekIndex = 0,
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
    if (selected.pattern === "cardio") {
      if (!circuit || movement.dose.kind !== "distance") throw new Error("Add running or machine intervals as a cardio part.");
      return Array.from({ length: circuit.rounds }, (_, round) => ({
        movementId: selected.id, movementSlug: selected.slug, movementName: selected.displayName,
        kind: "cardio_threshold", distanceM: { min: movement.dose.kind === "distance" ? movement.dose.metres : 0, max: movement.dose.kind === "distance" ? movement.dose.metres : 0 },
        circuit: { ...circuit, round },
        cardioPlan: { summary: selected.displayName, meta: "", segments: [{ label: selected.displayName, detail: `${movement.dose.kind === "distance" ? movement.dose.metres : 0} m` }], effort: "" },
        meta: { authoredPartId: partId, authoredMovementId: movement.id, ...(selected.modality ? { modality: selected.modality } : {}) },
      }));
    }
    const effective = effectiveAuthoredMovement(movement, circuit ? undefined : week, weekIndex);
    const sets = authoredRange(effective.sets, 20);
    const reps = movement.dose.kind === "reps" ? authoredRange(effective.reps) : null;
    const load = effective.load;
    const testRule = !circuit && movement.role === "main" && movement.dose.kind === "reps" && !effective.overridden && load?.kind === "pct"
      ? authoredTestRule(week) : null;
    return Array.from({ length: circuit?.rounds ?? sets.max }, (_, round) => ({
      movementId: selected.id, movementSlug: selected.slug, movementName: selected.displayName,
      kind: movement.role, sets: 1, isAmrap: false,
      ...(sets.min !== sets.max && !circuit ? { setRange: sets, optional: round >= sets.min } : {}),
      ...(reps ? reps.min === reps.max ? { reps: reps.min } : { repRange: reps }
        : movement.dose.kind === "hold" ? { holdSec: { min: movement.dose.seconds, max: movement.dose.seconds } }
          : movement.dose.kind === "distance" ? { distanceM: { min: movement.dose.metres, max: movement.dose.metres } } : {}),
      ...(load?.kind === "pct" ? { percentTm: Number(load.value), intensityLabel: `${load.value}% 1RM` }
        : load?.kind === "kg" ? { targetWeightKg: Number(load.value) }
          : load?.kind === "rir" ? { targetRir: authoredRange(load.value, 10) } : {}),
      ...(movement.notes ? { notes: movement.notes } : {}),
      ...(circuit ? { circuit: { ...circuit, round } } : {}),
      meta: { authoredPartId: partId, authoredMovementId: movement.id, restSeconds: movement.restSeconds,
        ...(load?.kind === "pct" ? { programLoadBasis: { version: 1 as const, kind: "one-rm" as const, percent: 100, roundingKg: null }, authoredLoadRoundingKg: 2.5 } : {}),
        ...(reps ? { authoredReps: effective.reps } : {}),
        ...(testRule ? { authoredTest: testRule } : {}),
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
      const plan = part.weeks?.[weekIndex] ?? { rounds: part.rounds };
      if (plan.runMetres !== undefined) {
        const running = part.runMovementId ? resolve(part.runMovementId) : null;
        if (!running || running.pattern !== "cardio" || running.modality !== "run") throw new Error("Choose a running exercise for this circuit.");
        return Array.from({ length: plan.rounds }, (_, round) => {
          const station = part.movements[round % part.movements.length];
          if (!station) throw new Error("Add a circuit station.");
          const runItem: AuthoredPrescriptionItem = {
            movementId: running.id, movementSlug: running.slug, movementName: running.displayName, kind: "cardio_threshold",
            distanceM: { min: plan.runMetres!, max: plan.runMetres! },
            cardioPlan: { summary: running.displayName, meta: "", segments: [{ label: "Run", detail: `${plan.runMetres} m` }], effort: "" },
            meta: { authoredPartId: `${part.id}:run:${round}`, modality: "run" },
          };
          return [runItem, ...compileMovement(station, `${part.id}:station:${round}`, {
            id: `${part.id}:${round}`, name: part.name, position: 0, size: 1, rounds: 1,
          })];
        }).flat();
      }
      if (part.movements.some((movement) => resolve(movement.movementId).pattern === "cardio")) {
        return Array.from({ length: plan.rounds }, (_, round) =>
          part.movements.flatMap((movement, position) => compileMovement(movement, `${part.id}:${round}:${position}`, {
            id: `${part.id}:${round}:${position}`, name: part.name, position: 0, size: 1, rounds: 1,
          }))).flat();
      }
      return part.movements.flatMap((movement, position) => compileMovement(movement, part.id, {
        id: part.id, name: part.name, position, size: part.movements.length, rounds: plan.rounds,
      }));
    }
    const selected = resolve(part.movementId);
    if (selected.pattern !== "cardio" || selected.modality !== part.modality) {
      throw new Error("Choose a matching cardio activity from the library.");
    }
    const timed = part.intervals.every((interval) => interval.target.kind === "time");
    const seconds = part.intervals.reduce((sum, interval) =>
      sum + (interval.target.kind === "time" ? interval.target.seconds : 0), 0) * part.repeats;
    const duration = part.duration ? authoredRange(part.duration.replace(/\s*min$/, ""), 600) : null;
    const intervals: AuthoredInterval[] = duration ? [{ id: part.intervals[0]?.id ?? part.id,
      label: selected.displayName, effort: part.intervals[0]?.effort ?? "easy", target: { kind: "time", seconds: duration.min * 60 } }] : part.intervals;
    return [{
      movementId: selected.id, movementSlug: selected.slug, movementName: selected.displayName,
      kind: `cardio_${part.intensity}`,
      ...(duration ? { durationMin: duration.min } : timed ? { durationMin: seconds / 60 } : {}),
      ...(part.notes ? { notes: part.notes } : {}),
      cardioPlan: {
        summary: selected.displayName,
        meta: part.duration ? `${part.duration.replace(/\s*min$/, "")} min` : `${part.repeats} ${part.repeats === 1 ? "round" : "rounds"}`,
        segments: intervals.map((interval) => ({ label: interval.label, detail: duration
          ? `${part.duration!.replace(/\s*min$/, "")} min${part.effort ? ` ${part.effort}` : ""}` : formatAuthoredInterval(interval) })),
        effort: part.effort ?? "",
      },
      meta: { authoredPartId: part.id, intervals, repeats: duration ? 1 : part.repeats, modality: part.modality },
    }];
  });
  return { items, meta: { authoredWorkout: workout } };
}

/** A weekly plan starts on the selected date, not the preceding Monday. */
export function authoredProgramDates(definition: AuthoredProgramDefinition, startedOn: string) {
  const weeks = authoredWeekCount(definition);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 16) {
    throw new Error("Choose between 1 and 16 weeks.");
  }
  const start = new Date(`${startedOn}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== startedOn) {
    throw new Error("Choose a valid start date.");
  }
  const startWeekday = (start.getUTCDay() + 6) % 7;
  return Array.from({ length: weeks }, (_, week) =>
    [...definition.workouts].sort((a, b) => a.weekday - b.weekday).map((workout) => {
      const offset = (workout.weekday - startWeekday + 7) % 7 + week * 7;
      const date = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
      return {
        date, workout, ref: `authored:${workout.id}:${week}`, authoredWeekIndex: week,
        weekIndex: Math.floor((startWeekday + offset) / 7), dayIndex: workout.weekday,
      };
    }),
  ).flat().sort((a, b) => a.date.localeCompare(b.date));
}

export function canChangeAuthoredStartDate(args: {
  available: boolean; scope: "program" | "workout" | "future"; hasBegunWorkout: boolean;
}): boolean {
  return args.available && args.scope === "program" && !args.hasBegunWorkout;
}

/** Reconcile an unused program by authored identity, not its previous calendar week. */
export function reconcileAuthoredStartDate(args: {
  startedOn: string;
  proposed: readonly { ref: string; date: string; weekIndex: number; dayIndex: number }[];
  existing: readonly {
    id: string; programRef?: string; date: string; slot: string;
    preserveContent: boolean; preserveDate: boolean;
  }[];
}) {
  const start = new Date(`${args.startedOn}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== args.startedOn) {
    throw new Error("Choose a valid start date.");
  }
  const monday = start.getTime() - ((start.getUTCDay() + 6) % 7) * 86_400_000;
  const proposedByRef = new Map(args.proposed.map((row, index) => [row.ref, index]));
  if (proposedByRef.size !== args.proposed.length) throw new Error("The program has duplicate workouts. Reload before editing.");
  const matched = new Set<number>();
  const identities = new Set<string>();
  const slots = new Set<string>();
  const retained: { existingIndex: number; proposedIndex: number | undefined; date: string; weekIndex: number; dayIndex: number }[] = [];
  const deleteIndices: number[] = [];
  const insertIndices: number[] = [];
  let weeks = 1;
  const occupy = (date: string, slot: string) => {
    const instant = new Date(`${date}T00:00:00Z`);
    const offset = (instant.getTime() - monday) / 86_400_000;
    if (!Number.isInteger(offset) || instant.toISOString().slice(0, 10) !== date || offset < 0) {
      throw new Error("A saved workout falls before the new program week. Move that workout before changing the start date.");
    }
    const weekIndex = Math.floor(offset / 7), dayIndex = offset % 7;
    if (weekIndex >= 52) throw new Error("A saved workout falls outside this program. Move that workout before changing the start date.");
    const key = `${weekIndex}:${dayIndex}:${slot}`;
    if (slots.has(key)) throw new Error("The new dates overlap a moved workout. Move that workout before changing the start date.");
    slots.add(key);
    weeks = Math.max(weeks, weekIndex + 1);
    return { weekIndex, dayIndex };
  };
  args.existing.forEach((row, existingIndex) => {
    if (identities.has(row.id) || (row.programRef && identities.has(row.programRef))) {
      throw new Error("The program has duplicate workouts. Reload before editing.");
    }
    identities.add(row.id);
    if (row.programRef) identities.add(row.programRef);
    const proposedIndex = row.programRef ? proposedByRef.get(row.programRef) : undefined;
    const proposed = proposedIndex === undefined ? undefined : args.proposed[proposedIndex];
    if (!proposed && !row.preserveContent && !row.preserveDate) {
      deleteIndices.push(existingIndex);
      return;
    }
    if (proposedIndex !== undefined) matched.add(proposedIndex);
    const date = row.preserveDate || !proposed ? row.date : proposed.date;
    retained.push({ existingIndex, proposedIndex, date, ...occupy(date, row.slot) });
  });
  args.proposed.forEach((row, index) => {
    if (matched.has(index)) return;
    occupy(row.date, "single");
    insertIndices.push(index);
  });
  return { retained, deleteIndices, insertIndices, weeks };
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
