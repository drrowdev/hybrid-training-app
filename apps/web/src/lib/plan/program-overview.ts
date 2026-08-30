import type {
  ProgramEngine,
  ProgramSegment,
  ProgramSegmentKind,
} from "@hta/program-core";

export type PlanProgramSegment = {
  startWeekIndex: number;
  label: string;
  kind?: ProgramSegmentKind;
};

export type PlanPhaseGroup = PlanProgramSegment & {
  endWeekIndex: number;
};

/**
 * Backward-compatible recovery for program instances created before the start
 * offset was persisted in setup_input. Mirrors materializeProgram's consecutive
 * weekLabel grouping and finds the absolute engine week of any first-block ref.
 */
export function inferProgramStartWeekIndex(
  engine: ProgramEngine,
  instance: unknown,
  firstBlockRefs: readonly string[],
): number {
  const refs = new Set(firstBlockRefs.filter(Boolean));
  if (refs.size === 0) return 0;
  let weekIndex = -1;
  let previousWeekKey: string | undefined;
  let started = false;
  for (const spec of engine.timeline(instance)) {
    if (spec.kind === "rest") continue;
    const weekKey = spec.weekLabel ?? `__idx${spec.index}`;
    if (!started || weekKey !== previousWeekKey) {
      weekIndex += 1;
      previousWeekKey = weekKey;
      started = true;
    }
    if (
      refs.has(spec.ref) ||
      (spec.secondSession?.ref && refs.has(spec.secondSession.ref))
    ) {
      return Math.max(0, weekIndex);
    }
  }
  return 0;
}

/**
 * Convert engine-owned absolute program segments to the week indices stored on
 * the active block. Starting a program at a later segment resets the materialized
 * block to week 0, so the segment containing that start becomes the first group.
 */
export function relativeProgramSegments(
  segments: readonly ProgramSegment[],
  startWeekIndex: number,
  weeks: number,
  fallbackLabel: string,
): PlanProgramSegment[] {
  const start = Number.isFinite(startWeekIndex)
    ? Math.max(0, Math.floor(startWeekIndex))
    : 0;
  const length = Math.max(1, Math.floor(weeks));
  const sorted = [...segments]
    .filter(
      (segment) =>
        Number.isFinite(segment.startWeekIndex) &&
        segment.startWeekIndex >= 0,
    )
    .sort((a, b) => a.startWeekIndex - b.startWeekIndex);
  const containing =
    [...sorted].reverse().find((segment) => segment.startWeekIndex <= start) ??
    null;
  const out: PlanProgramSegment[] = [
    {
      startWeekIndex: 0,
      label: containing?.label || fallbackLabel,
      ...(containing?.kind ? { kind: containing.kind } : {}),
    },
  ];
  for (const segment of sorted) {
    if (segment.startWeekIndex <= start) continue;
    const relative = segment.startWeekIndex - start;
    if (relative >= length) continue;
    out.push({
      startWeekIndex: relative,
      label: segment.label,
      ...(segment.kind ? { kind: segment.kind } : {}),
    });
  }
  return out;
}

export function buildPlanPhaseGroups(
  segments: readonly PlanProgramSegment[],
  weeks: number,
): PlanPhaseGroup[] {
  const length = Math.max(1, Math.floor(weeks));
  const byStart = new Map<number, PlanProgramSegment>();
  for (const segment of segments) {
    if (
      !Number.isFinite(segment.startWeekIndex) ||
      segment.startWeekIndex < 0 ||
      segment.startWeekIndex >= length
    ) {
      continue;
    }

    byStart.set(Math.floor(segment.startWeekIndex), segment);
  }
  if (!byStart.has(0)) {
    byStart.set(0, { startWeekIndex: 0, label: "Program" });
  }
  const sorted = [...byStart.values()].sort(
    (a, b) => a.startWeekIndex - b.startWeekIndex,
  );
  return sorted.map((segment, index) => ({
    ...segment,
    endWeekIndex:
      (sorted[index + 1]?.startWeekIndex ?? length) - 1,
  }));
}

/**
 * Off-program recovery weeks are inserted into the materialized block and shift
 * every later engine boundary. Preserve the engine's phase order while moving
 * boundaries past those inserted weeks.
 */
export function shiftWeekIndexForInsertedWeeks(
  weekIndex: number,
  insertedWeekIndices: readonly number[],
): number {
  let shifted = weekIndex;
  for (const insertedWeek of [...new Set(insertedWeekIndices)]
    .filter((week) => Number.isInteger(week) && week >= 0)
    .sort((a, b) => a - b)) {
    if (insertedWeek <= shifted) shifted += 1;
  }
  return shifted;
}

export function shiftSegmentsForInsertedWeeks(
  segments: readonly PlanProgramSegment[],
  insertedWeekIndices: readonly number[],
  weeks: number,
): PlanProgramSegment[] {
  const inserted = [...new Set(insertedWeekIndices)]
    .filter((week) => Number.isInteger(week) && week >= 0 && week < weeks)
    .sort((a, b) => a - b);
  const shifted = segments
    .map((segment) => ({
      ...segment,
      startWeekIndex: shiftWeekIndexForInsertedWeeks(
        segment.startWeekIndex,
        inserted,
      ),
    }))
    .filter((segment) => segment.startWeekIndex < weeks);
  const recoverySegments = inserted.flatMap((startWeekIndex, index) => {
    const nextInserted = inserted[index + 1];
    const afterRecovery = startWeekIndex + 1;
    const containing =
      [...shifted]
        .filter((segment) => segment.startWeekIndex <= startWeekIndex)
        .sort((a, b) => b.startWeekIndex - a.startWeekIndex)[0] ??
      segments[0] ?? { startWeekIndex: 0, label: "Program" };
    const resume =
      afterRecovery < weeks && nextInserted !== afterRecovery
        ? [
            {
              ...containing,
              startWeekIndex: afterRecovery,
            },
          ]
        : [];
    return [
      {
        startWeekIndex,
        label: "Recovery week",
        kind: "deload" as const,
      },
      ...resume,
    ];
  });
  return [
    ...shifted,
    ...recoverySegments,
  ].sort((a, b) => a.startWeekIndex - b.startWeekIndex);
}
