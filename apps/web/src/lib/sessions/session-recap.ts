/**
 * What a lifter actually did, grouped for display.
 *
 * Pure aggregation of a session's `set_logs` rows — no DB, no React — so it is
 * unit-tested directly. Sits beside `cardio-summary.ts`, which does the same job
 * for `cardio_logs`.
 *
 * The one rule that matters here: **never collapse sets that were not identical.**
 * A lifter reading a recap wants to know which weight went with which reps, so
 * `100 kg × 5` then `110 kg × 3` stays two entries. Runs are merged only when the
 * load AND the work match exactly, and only when they were consecutive — merging
 * across a gap would reorder the session.
 *
 * Weights come out in kg, the unit they are stored in. Conversion to the lifter's
 * unit happens where it is rendered.
 */

/** `set_logs.set_kind`. */
export type RecapSetKind = "warmup" | "main" | "back_off" | "accessory" | "tendon";

/**
 * A set records reps × weight, a hold, or a carry — the three the `set_logs`
 * CHECK constraint allows.
 */
export type RecapMeasure =
  | { type: "reps"; reps: number }
  | { type: "duration"; seconds: number }
  | { type: "distance"; metres: number };

export type RecapEntry = {
  /** How many consecutive identical sets this stands for. */
  sets: number;
  measure: RecapMeasure;
  /** Stored kg. Null when the set carried no external load. */
  weightKg: number | null;
};

export type RecapGroup = {
  kind: RecapSetKind;
  entries: RecapEntry[];
};

export type RecapMovement = {
  movementId: string;
  name: string;
  /** Working groups, in the order the kinds were first logged. */
  groups: RecapGroup[];
  /** Warm-up sets, counted but not itemised. */
  warmupSets: number;
  skippedSets: number;
  skipReasons: string[];
};

/** One `set_logs` row, as PostgREST returns it (numerics arrive as strings). */
export type RecapSetRow = {
  movement_id: string | null;
  movement_name?: string | null;
  set_index: number | null;
  weight_kg: number | string | null;
  reps: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  set_kind: string | null;
  skipped: boolean | null;
  skip_reason: string | null;
};

const KIND_ORDER: RecapSetKind[] = ["main", "back_off", "accessory", "tendon", "warmup"];

function isRecapKind(v: string | null): v is RecapSetKind {
  return (
    v === "warmup" || v === "main" || v === "back_off" || v === "accessory" || v === "tendon"
  );
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * What this set recorded. Distance wins over reps because a loaded carry is
 * logged with `reps: 0`, and duration wins over reps for the same reason on a
 * hold — reading reps first would drop both.
 */
function measureOf(row: RecapSetRow): RecapMeasure | null {
  const distance = num(row.distance_m);
  if (distance != null && distance > 0) return { type: "distance", metres: distance };
  const duration = num(row.duration_sec);
  if (duration != null && duration > 0) return { type: "duration", seconds: duration };
  const reps = num(row.reps);
  if (reps != null && reps > 0) return { type: "reps", reps };
  return null;
}

function sameMeasure(a: RecapMeasure, b: RecapMeasure): boolean {
  if (a.type === "reps" && b.type === "reps") return a.reps === b.reps;
  if (a.type === "duration" && b.type === "duration") return a.seconds === b.seconds;
  if (a.type === "distance" && b.type === "distance") return a.metres === b.metres;
  return false;
}

function sameLoad(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) < 0.001;
}

/**
 * Group a session's logged sets by movement, then by set kind.
 *
 * Movements appear in the order they were first logged. Rows with no movement,
 * and rows that recorded nothing, are dropped — they cannot be rendered
 * truthfully and a session should not gain a blank line because of one.
 */
export function buildSessionRecap(rows: readonly RecapSetRow[] | null | undefined): RecapMovement[] {
  if (!rows || rows.length === 0) return [];

  const ordered = [...rows].sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0));

  const byMovement = new Map<string, RecapMovement>();
  // Groups are keyed separately so the "first logged" kind order survives.
  const groupsFor = new Map<string, Map<RecapSetKind, RecapGroup>>();

  for (const row of ordered) {
    const movementId = row.movement_id;
    if (!movementId) continue;

    let movement = byMovement.get(movementId);
    if (!movement) {
      movement = {
        movementId,
        name: row.movement_name?.trim() || "Movement",
        groups: [],
        warmupSets: 0,
        skippedSets: 0,
        skipReasons: [],
      };
      byMovement.set(movementId, movement);
      groupsFor.set(movementId, new Map());
    }

    if (row.skipped) {
      movement.skippedSets += 1;
      const reason = row.skip_reason?.trim();
      if (reason && !movement.skipReasons.includes(reason)) movement.skipReasons.push(reason);
      continue;
    }

    const kind = isRecapKind(row.set_kind) ? row.set_kind : "main";
    if (kind === "warmup") {
      movement.warmupSets += 1;
      continue;
    }

    const measure = measureOf(row);
    if (!measure) continue;
    const weight = num(row.weight_kg);
    const weightKg = weight != null && weight > 0 ? weight : null;

    const groups = groupsFor.get(movementId)!;
    let group = groups.get(kind);
    if (!group) {
      group = { kind, entries: [] };
      groups.set(kind, group);
      movement.groups.push(group);
    }

    const last = group.entries[group.entries.length - 1];
    if (last && sameMeasure(last.measure, measure) && sameLoad(last.weightKg, weightKg)) {
      last.sets += 1;
    } else {
      group.entries.push({ sets: 1, measure, weightKg });
    }
  }

  const out = [...byMovement.values()];
  for (const movement of out) {
    movement.groups.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }
  // A movement with nothing to show at all would render as a bare name.
  return out.filter(
    (m) => m.groups.length > 0 || m.warmupSets > 0 || m.skippedSets > 0,
  );
}
