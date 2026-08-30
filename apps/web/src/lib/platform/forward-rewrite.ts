/**
 * Pure forward-only rewrite planner for the "Edit plan" path.
 *
 * Given today's (week, day) boundary, a freshly materialised set of sessions,
 * and the block's existing rows from the current week onward, it decides —
 * without touching the DB — which untouched upcoming rows to delete and which
 * new rows to insert. Past rows and any touched row are preserved; everything
 * from today forward that the user has not invested in is regenerated.
 *
 * "Forward-only" means past calendar slots are frozen. Today is NOT frozen:
 * saving a program edit is an explicit instruction, and a pristine unstarted
 * workout today should follow it like any other day. `touched` is what keeps a
 * workout the user has started, rescheduled, annotated or customised safe —
 * see the caller, which is where that predicate is assembled.
 */

export interface ExistingFutureRow {
  id: string;
  weekIndex: number;
  dayIndex: number;
  slot: string;
  role?: string;
  /** Stable engine identity, when this row came from a platform program. */
  programRef?: string;
  /** True when the user has invested in this row or its placement. */
  touched: boolean;
}

export interface NewSessionLite {
  weekIndex: number;
  dayIndex: number;
  slot: string;
  role?: string;
  /** Stable engine identity, when this row came from a platform program. */
  programRef?: string;
}

export interface ForwardRewritePlan {
  /** Ids of untouched future rows to delete. */
  deleteIds: string[];
  /** Indices into the input `newSessions` to insert (future + not preserved). */
  insertIndices: number[];
  /** The block's new total week count. */
  newWeeks: number;
}

function key(r: { weekIndex: number; dayIndex: number; slot: string }): string {
  return `${r.weekIndex}-${r.dayIndex}-${r.slot}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((recordKey) => `${JSON.stringify(recordKey)}:${stableJson(record[recordKey])}`)
    .join(",")}}`;
}

export function prescriptionsEquivalent(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function planForwardOnlyRewrite(args: {
  currentWeekIndex: number;
  currentDayIndex: number;
  writeWeeks: number;
  existingFuture: ExistingFutureRow[];
  newSessions: NewSessionLite[];
}): ForwardRewritePlan {
  const {
    currentWeekIndex,
    currentDayIndex,
    writeWeeks,
    existingFuture,
    newSessions,
  } = args;
  const isPast = (row: { weekIndex: number; dayIndex: number }) =>
    row.weekIndex < currentWeekIndex ||
    (row.weekIndex === currentWeekIndex &&
      row.dayIndex < currentDayIndex);

  const freshByProgramRef = new Map(
    newSessions.flatMap((session) =>
      session.programRef ? [[session.programRef, session] as const] : [],
    ),
  );
  const preservedSlots = new Set<string>();
  const preservedProgramRefs = new Set<string>();
  let latestPreservedWeek = -1;
  const deleteIds: string[] = [];
  for (const r of existingFuture) {
    if (isPast(r)) continue;
    const freshReplacement = r.programRef
      ? freshByProgramRef.get(r.programRef)
      : undefined;
    // Legacy moved rows have no durable marker. Never delete one when its only
    // generated replacement is already behind today's forward-only boundary.
    const replacementWouldBeLost =
      freshReplacement != null &&
      freshReplacement.weekIndex === r.weekIndex &&
      isPast(freshReplacement);
    if (r.touched || replacementWouldBeLost) {
      preservedSlots.add(key(r));
      if (r.programRef) preservedProgramRefs.add(r.programRef);
      latestPreservedWeek = Math.max(latestPreservedWeek, r.weekIndex);
      continue;
    }
    deleteIds.push(r.id);
  }

  const insertIndices: number[] = [];
  newSessions.forEach((s, i) => {
    if (isPast(s)) return;
    if (preservedSlots.has(key(s))) return;
    if (s.programRef && preservedProgramRefs.has(s.programRef)) return;
    insertIndices.push(i);
  });

  return {
    deleteIds,
    insertIndices,
    newWeeks: Math.max(
      writeWeeks,
      currentWeekIndex + 1,
      latestPreservedWeek + 1,
    ),
  };
}
