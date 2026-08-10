/**
 * Per-movement stats helpers.
 *
 * Reads set_logs for a single movement, derives:
 *  - e1RM curve (Epley)
 *  - weekly volume buckets
 *  - RPE histogram
 *  - PR + last-performed metadata
 *
 * Phase 5 layers on top of the Phase-1 read helpers above:
 *  - per-session top-set rollup with PR flag
 *  - tonnage-per-session volume trend
 *  - per-session avg RPE + 4-week rolling creep detector
 *  - prescription-meta-derived swap history
 *  - sister-movement lookup by pattern / functional_roles
 *
 * Anything fancier (1RM models with RPE adjustment, true PR by rep range)
 * lives in @hta/engine; this is the display layer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveLinkedSessionRelation } from "@/lib/sessions/linked-session-state";
import { createClient } from "@/lib/supabase/server";
import { mondayOfYmd, ymdInTimezone } from "@/lib/dates";
import { bestEstimateOneRm } from "@/lib/engine/one-rm";
import type { Range } from "./range";
import { rangeWindowDays } from "./range";

export type MovementSet = {
  id: string;
  performed_at: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  set_kind: string;
};

export type MovementHeader = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
  is_compound: boolean;
};

/** Epley e1RM. Returns null for sets without weight+reps. */
export function epleyE1RM(weight: number, reps: number): number | null {
  if (!weight || !reps) return null;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

export async function getMovementBySlug(slug: string): Promise<MovementHeader | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("movements")
    .select("id, slug, display_name, primary_region, is_compound")
    .eq("slug", slug)
    .is("user_id", null)
    .maybeSingle();
  return data ?? null;
}

export async function getSetsForMovement(movementId: string): Promise<MovementSet[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("set_logs")
    .select(
      "id, weight_kg, reps, rpe, set_kind, session:sessions(performed_at, completed_at)",
    )
    .eq("movement_id", movementId)
    .eq("skipped", false)
    .order("created_at", { ascending: true });

  if (!data) return [];
  return data
    .filter((r) => {
      const ss = Array.isArray(r.session) ? r.session[0] : r.session;
      return !!ss?.completed_at && r.weight_kg != null && r.reps != null;
    })
    .map((r) => {
      const ss = Array.isArray(r.session) ? r.session[0] : r.session;
      return {
        id: r.id,
        performed_at: ss!.performed_at,
        weight_kg: Number(r.weight_kg),
        reps: r.reps!,
        rpe: r.rpe == null ? null : Number(r.rpe),
        set_kind: r.set_kind,
      };
    });
}

export type WeeklyVolumePoint = { weekStart: string; volume: number; sets: number };

/**
 * Bucket sets into weekly volume rows keyed by the Monday (YYYY-MM-DD)
 * of each set's week. `userTz` is the user's IANA timezone — we want
 * "the Monday of the week the user perceived the workout happening
 * in", which depends on local wall-clock time. Without a tz the bucket
 * key drifts at midnight.
 */
export function bucketWeeklyVolume(sets: MovementSet[], userTz: string): WeeklyVolumePoint[] {
  if (sets.length === 0) return [];
  const buckets = new Map<string, { volume: number; sets: number }>();
  for (const s of sets) {
    const localYmd = ymdInTimezone(new Date(s.performed_at), userTz);
    const key = mondayOfYmd(localYmd);
    const existing = buckets.get(key) ?? { volume: 0, sets: 0 };
    existing.volume += s.weight_kg * s.reps;
    existing.sets += 1;
    buckets.set(key, existing);
  }
  return Array.from(buckets.entries())
    .map(([weekStart, v]) => ({ weekStart, ...v }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function rpeHistogram(sets: MovementSet[]): { rpe: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (s.rpe == null) continue;
    const bucket = Math.round(s.rpe);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const result: { rpe: number; count: number }[] = [];
  for (let i = 1; i <= 10; i++) result.push({ rpe: i, count: counts.get(i) ?? 0 });
  return result;
}

export type E1rmPoint = { date: string; e1rm: number; weight: number; reps: number };

export function e1rmCurve(sets: MovementSet[]): E1rmPoint[] {
  return sets
    .map((s) => {
      const e1 = epleyE1RM(s.weight_kg, s.reps);
      if (e1 == null) return null;
      return {
        date: s.performed_at.slice(0, 10),
        e1rm: e1,
        weight: s.weight_kg,
        reps: s.reps,
      };
    })
    .filter((x): x is E1rmPoint => x != null);
}

/** Top-level summary tiles. */
export function summarise(sets: MovementSet[]) {
  if (sets.length === 0) {
    return {
      totalSets: 0,
      totalVolume: 0,
      bestE1rm: null as number | null,
      heaviestSingle: 0,
      lastPerformed: null as string | null,
    };
  }
  let bestE1rm = 0;
  let heaviestSingle = 0;
  let totalVolume = 0;
  for (const s of sets) {
    totalVolume += s.weight_kg * s.reps;
    const e1 = epleyE1RM(s.weight_kg, s.reps);
    if (e1 != null && e1 > bestE1rm) bestE1rm = e1;
    if (s.reps === 1 && s.weight_kg > heaviestSingle) heaviestSingle = s.weight_kg;
  }
  const last = sets[sets.length - 1]!;
  return {
    totalSets: sets.length,
    totalVolume: Math.round(totalVolume),
    bestE1rm: bestE1rm || null,
    heaviestSingle,
    lastPerformed: last.performed_at,
  };
}

/** Top movements by hard-set count for the current user. */
export type MovementListRow = {
  movementId: string;
  slug: string;
  displayName: string;
  setCount: number;
  lastPerformed: string;
};

export async function listMovementsRanked(): Promise<MovementListRow[]> {
  const supabase = await createClient();
  // We can't do a group-by from PostgREST easily; pull recent sets and aggregate in JS.
  const { data } = await supabase
    .from("set_logs")
    .select(
      "movement_id, session:sessions(performed_at, completed_at), movement:movements(slug, display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (!data) return [];

  const map = new Map<string, MovementListRow>();
  for (const r of data) {
    const ss = Array.isArray(r.session) ? r.session[0] : r.session;
    if (!ss?.completed_at) continue;
    const mv = Array.isArray(r.movement) ? r.movement[0] : r.movement;
    if (!mv) continue;
    const existing = map.get(r.movement_id);
    if (existing) {
      existing.setCount += 1;
      if (ss.performed_at > existing.lastPerformed) existing.lastPerformed = ss.performed_at;
    } else {
      map.set(r.movement_id, {
        movementId: r.movement_id,
        slug: mv.slug,
        displayName: mv.display_name,
        setCount: 1,
        lastPerformed: ss.performed_at,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.setCount - a.setCount);
}

// ──────────────────────────────────────────────────────────────────────
// Phase 5 — per-movement deep-dive helpers.
//
// All of these accept the already-fetched per-session "top set" list
// produced by `rollupTopSetsPerSession`, so the pure derivations are
// trivially unit-testable. The thin I/O wrappers below pull the raw
// rows and feed them in.
// ──────────────────────────────────────────────────────────────────────

/** A working-set row joined with its session's performed_at. */
export type WorkingSetRow = {
  sessionId: string;
  performedAt: string;
  weight: number;
  reps: number;
  rpe: number | null;
};

/** The top set in a single session (heaviest weight, tiebreak more reps). */
export type TopSetPoint = {
  sessionId: string;
  performedAt: string;
  weight: number;
  reps: number;
  rpe: number | null;
  /** Conservative e1RM (Epley clamped to display-friendly 0.1 kg). */
  e1rm: number;
  /** True when the e1RM strictly beat every previous session's e1RM. */
  isPR: boolean;
};

/**
 * Roll a flat list of working sets into one row per session — the
 * session's top set, with a PR flag set on rows where the e1RM exceeded
 * every prior session's e1RM. Pure function; expects rows pre-sorted
 * oldest-first. Caller is responsible for filtering out warmups.
 */
export function rollupTopSetsPerSession(rows: WorkingSetRow[]): TopSetPoint[] {
  if (rows.length === 0) return [];
  type Acc = {
    sessionId: string;
    performedAt: string;
    weight: number;
    reps: number;
    rpe: number | null;
    e1rm: number;
  };
  const bySession = new Map<string, Acc>();
  for (const r of rows) {
    const e1 = epleyE1RM(r.weight, r.reps);
    if (e1 == null) continue;
    const existing = bySession.get(r.sessionId);
    if (!existing) {
      bySession.set(r.sessionId, {
        sessionId: r.sessionId,
        performedAt: r.performedAt,
        weight: r.weight,
        reps: r.reps,
        rpe: r.rpe,
        e1rm: e1,
      });
      continue;
    }
    if (
      r.weight > existing.weight ||
      (r.weight === existing.weight && r.reps > existing.reps)
    ) {
      existing.weight = r.weight;
      existing.reps = r.reps;
      existing.rpe = r.rpe;
      existing.e1rm = e1;
    }
  }
  // Order chronologically and flag PRs.
  const ordered = Array.from(bySession.values()).sort(
    (a, b) => +new Date(a.performedAt) - +new Date(b.performedAt),
  );
  let bestSoFar = -Infinity;
  return ordered.map((a) => {
    const isPR = a.e1rm > bestSoFar + 0.05;
    if (isPR) bestSoFar = a.e1rm;
    return { ...a, isPR };
  });
}

/**
 * Simple linear regression slope (kg per day) over a series of
 * (date, e1rm) points. Returns null when fewer than two points or all
 * dates collapse to the same x.
 */
export function linearRegressionSlopePerDay(
  points: Array<{ performedAt: string; e1rm: number }>,
): number | null {
  if (points.length < 2) return null;
  const t0 = +new Date(points[0]!.performedAt);
  const xs = points.map((p) => (+new Date(p.performedAt) - t0) / 86_400_000);
  const ys = points.map((p) => p.e1rm);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/** Format the regression slope as a kg-per-week string for display. */
export function formatSlopePerWeek(slopePerDay: number): string {
  const perWeek = slopePerDay * 7;
  const sign = perWeek > 0 ? "+" : "";
  return `${sign}${perWeek.toFixed(1)} kg/week`;
}

/** Volume per session: sum of (weight × reps) across all working sets. */
export type VolumePoint = {
  sessionId: string;
  performedAt: string;
  tonnage: number;
};

export function rollupVolumePerSession(rows: WorkingSetRow[]): VolumePoint[] {
  const by = new Map<string, VolumePoint>();
  for (const r of rows) {
    const existing = by.get(r.sessionId);
    const t = r.weight * r.reps;
    if (existing) existing.tonnage += t;
    else by.set(r.sessionId, { sessionId: r.sessionId, performedAt: r.performedAt, tonnage: t });
  }
  return Array.from(by.values()).sort(
    (a, b) => +new Date(a.performedAt) - +new Date(b.performedAt),
  );
}

/** Avg RPE per session (working sets, RPE-bearing only). */
export type RpePoint = {
  sessionId: string;
  performedAt: string;
  /** Mean of the RPE values logged on this session for the movement, or null. */
  rpe: number | null;
  /** Heaviest weight on the session — used by RPE-creep detection. */
  topWeight: number;
};

export function rollupRpePerSession(rows: WorkingSetRow[]): RpePoint[] {
  type Acc = { sessionId: string; performedAt: string; sum: number; n: number; topWeight: number };
  const by = new Map<string, Acc>();
  for (const r of rows) {
    const acc =
      by.get(r.sessionId) ??
      ({ sessionId: r.sessionId, performedAt: r.performedAt, sum: 0, n: 0, topWeight: 0 } as Acc);
    if (r.rpe != null) {
      acc.sum += r.rpe;
      acc.n += 1;
    }
    if (r.weight > acc.topWeight) acc.topWeight = r.weight;
    by.set(r.sessionId, acc);
  }
  return Array.from(by.values())
    .map((a) => ({
      sessionId: a.sessionId,
      performedAt: a.performedAt,
      rpe: a.n > 0 ? Math.round((a.sum / a.n) * 10) / 10 : null,
      topWeight: a.topWeight,
    }))
    .sort((a, b) => +new Date(a.performedAt) - +new Date(b.performedAt));
}

export type RpeCreepDetection = {
  flagged: boolean;
  /**
   * The two 4-week (28-day) windows compared. `null` if the series is
   * too short / lacks RPE on one side.
   */
  earlier: { from: string; to: string; meanRpe: number; meanTopWeight: number } | null;
  recent: { from: string; to: string; meanRpe: number; meanTopWeight: number } | null;
  /** RPE delta recent - earlier. */
  rpeDelta: number | null;
  /** Weight delta recent - earlier. Used for the "weight stayed flat OR dropped" gate. */
  weightDelta: number | null;
};

/**
 * RPE-creep detector.
 *
 *   "If the 4-week rolling average RPE rises by ≥ 1 while weight stays
 *    the same OR drops, flag a warning."
 *
 * We compare the most recent 28-day window against the previous 28-day
 * window over the per-session RPE series. Need at least one
 * RPE-bearing session in each window or the comparison is undefined and
 * `flagged` is false. Sessions whose RPE is null contribute their
 * topWeight to the weight comparison but not the RPE comparison.
 */
export function detectRpeCreep(series: RpePoint[]): RpeCreepDetection {
  if (series.length < 2) {
    return {
      flagged: false,
      earlier: null,
      recent: null,
      rpeDelta: null,
      weightDelta: null,
    };
  }
  const last = series[series.length - 1]!;
  const cutRecent = +new Date(last.performedAt) - 28 * 86_400_000;
  const cutEarlier = cutRecent - 28 * 86_400_000;
  const recent = series.filter((p) => +new Date(p.performedAt) > cutRecent);
  const earlier = series.filter(
    (p) =>
      +new Date(p.performedAt) > cutEarlier &&
      +new Date(p.performedAt) <= cutRecent,
  );

  function summariseWindow(window: RpePoint[]) {
    if (window.length === 0) return null;
    const rpes = window.map((p) => p.rpe).filter((r): r is number => r != null);
    const weights = window.map((p) => p.topWeight).filter((w) => w > 0);
    if (rpes.length === 0 || weights.length === 0) return null;
    return {
      from: window[0]!.performedAt.slice(0, 10),
      to: window[window.length - 1]!.performedAt.slice(0, 10),
      meanRpe: rpes.reduce((a, b) => a + b, 0) / rpes.length,
      meanTopWeight: weights.reduce((a, b) => a + b, 0) / weights.length,
    };
  }

  const sEarlier = summariseWindow(earlier);
  const sRecent = summariseWindow(recent);
  if (!sEarlier || !sRecent) {
    return {
      flagged: false,
      earlier: sEarlier,
      recent: sRecent,
      rpeDelta: null,
      weightDelta: null,
    };
  }
  const rpeDelta = sRecent.meanRpe - sEarlier.meanRpe;
  const weightDelta = sRecent.meanTopWeight - sEarlier.meanTopWeight;
  // Tiny floor on the weight side so floating-point dust doesn't trip
  // the "weight stayed flat" branch.
  const flagged = rpeDelta >= 1 && weightDelta <= 0.5;
  return { flagged, earlier: sEarlier, recent: sRecent, rpeDelta, weightDelta };
}

/**
 * Filter a per-session series to a `Range` window. `null` window =
 * all-time = no-op.
 */
export function filterSeriesToRange<T extends { performedAt: string }>(
  series: T[],
  range: Range,
): T[] {
  const days = rangeWindowDays(range);
  if (days == null) return series;
  const cutoff = Date.now() - days * 86_400_000;
  return series.filter((p) => +new Date(p.performedAt) >= cutoff);
}

// ── I/O wrappers ───────────────────────────────────────────────────

/**
 * Pull every non-warmup working set for `(userId, movementId)` joined
 * with its session's performed_at. Excludes soft-deleted sessions and
 * incomplete sessions. Ordered oldest-first for the chronological
 * rollups above.
 */
export async function getWorkingSetsForMovement(
  supabase: SupabaseClient,
  userId: string,
  movementId: string,
): Promise<WorkingSetRow[]> {
  const { data } = await supabase
    .from("set_logs")
    .select(
      "weight_kg, reps, rpe, sessions!inner(id, user_id, performed_at, completed_at, deleted_at)",
    )
    .eq("movement_id", movementId)
    .eq("sessions.user_id", userId)
    .is("sessions.deleted_at", null)
    .not("sessions.completed_at", "is", null)
    .eq("skipped", false)
    .neq("set_kind", "warmup")
    .not("weight_kg", "is", null)
    .not("reps", "is", null)
    .gt("reps", 0)
    .order("performed_at", { ascending: true, referencedTable: "sessions" });

  if (!data) return [];
  type Row = {
    weight_kg: number | string | null;
    reps: number | null;
    rpe: number | string | null;
    sessions:
      | { id: string; performed_at: string }
      | { id: string; performed_at: string }[]
      | null;
  };
  const rows: WorkingSetRow[] = [];
  for (const r of data as Row[]) {
    const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
    if (!s) continue;
    const w = Number(r.weight_kg);
    const reps = Number(r.reps);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(reps) || reps <= 0) continue;
    rows.push({
      sessionId: s.id,
      performedAt: s.performed_at,
      weight: w,
      reps,
      rpe: r.rpe == null ? null : Number(r.rpe),
    });
  }
  return rows;
}

/** Current e1RM = the most-recent session's top-set e1RM. */
export function getCurrentE1rmFromSeries(series: TopSetPoint[]): number | null {
  if (series.length === 0) return null;
  return series[series.length - 1]!.e1rm;
}

/** All-time best e1RM across the series. */
export function getBestEverE1rmFromSeries(
  series: TopSetPoint[],
): { e1rm: number; performedAt: string } | null {
  if (series.length === 0) return null;
  let best = series[0]!;
  for (const p of series) if (p.e1rm > best.e1rm) best = p;
  return { e1rm: best.e1rm, performedAt: best.performedAt };
}

// ── Swap history ──────────────────────────────────────────────────

export type SwapEvent = {
  /** Direction relative to the deep-dive movement. */
  direction: "to" | "from";
  /** The other movement involved in the swap. */
  otherMovementId: string;
  otherMovementName: string;
  otherMovementSlug?: string;
  /** ISO timestamp the swap was recorded. */
  swappedAt: string;
  /** Linked completed session, if the planned_session has been logged. */
  completedSessionId: string | null;
};

type PlannedRowForSwap = {
  completed_session_id: string | null;
  prescription: { items?: Array<unknown> } | null;
  sessions?:
    | { deleted_at: string | null }
    | Array<{ deleted_at: string | null }>
    | null;
};

type SwappedFromMeta = { movementId: string; movementName: string };

/**
 * Walk the user's planned_sessions and surface every prescription item
 * with `meta.swappedFrom` that touches `movementId` — either:
 *   - direction "to":   the user swapped some other movement → this one
 *   - direction "from": the user swapped this movement → some other one
 *
 * Pure derivation; the I/O wrapper below feeds in the rows.
 */
export function deriveSwapHistory(
  movementId: string,
  rows: PlannedRowForSwap[],
): SwapEvent[] {
  const events: SwapEvent[] = [];
  for (const r of rows) {
    const items = Array.isArray(r.prescription?.items) ? r.prescription.items : [];
    for (const raw of items) {
      const item = raw as {
        movementId?: string;
        movementName?: string;
        movementSlug?: string;
        meta?: Record<string, unknown>;
      };
      const meta = item.meta ?? {};
      const swappedFrom = meta.swappedFrom as SwappedFromMeta | undefined;
      const swappedAt = typeof meta.swappedAt === "string" ? (meta.swappedAt as string) : null;
      if (!swappedFrom || !swappedAt) continue;

      // Direction "to": user landed on this movement after a swap.
      if (item.movementId === movementId) {
        events.push({
          direction: "to",
          otherMovementId: swappedFrom.movementId,
          otherMovementName: swappedFrom.movementName,
          swappedAt,
          completedSessionId: r.completed_session_id ?? null,
        });
      }
      // Direction "from": user swapped away from this movement.
      if (swappedFrom.movementId === movementId && item.movementId !== movementId) {
        events.push({
          direction: "from",
          otherMovementId: item.movementId ?? "",
          otherMovementName: item.movementName ?? item.movementSlug ?? "unknown",
          otherMovementSlug: item.movementSlug,
          swappedAt,
          completedSessionId: r.completed_session_id ?? null,
        });
      }
    }
  }
  events.sort((a, b) => +new Date(b.swappedAt) - +new Date(a.swappedAt));
  return events;
}

/** I/O wrapper for `deriveSwapHistory`. */
export async function getMovementSwapHistory(
  supabase: SupabaseClient,
  userId: string,
  movementId: string,
): Promise<SwapEvent[]> {
  const { data } = await supabase
    .from("planned_sessions")
    .select("completed_session_id, prescription, sessions(deleted_at)")
    .eq("user_id", userId);
  const rows = ((data ?? []) as PlannedRowForSwap[]).map((row) => ({
    ...row,
    completed_session_id: resolveLinkedSessionRelation(
      row.completed_session_id,
      row.sessions,
    ).completedSessionId,
  }));
  return deriveSwapHistory(movementId, rows);
}

// ── Sister movements ───────────────────────────────────────────────

export type SisterMovement = {
  id: string;
  slug: string;
  displayName: string;
  /** Most-recent top-set e1RM if the user has logged this one, else null. */
  e1rm: number | null;
};

type MovementRowForSisters = {
  id: string;
  slug: string;
  display_name: string;
  pattern: string | null;
  functional_roles: string[] | null;
};

/**
 * Pure sister picker. Given the deep-dive movement's `pattern` +
 * `functionalRoles`, find peers that share either:
 *   - the same `pattern` (preferred — squat / horizontal_press / etc), OR
 *   - at least one shared entry in `functional_roles[]` (cardio /
 *     accessory fallback when pattern is missing or generic).
 *
 * Excludes the deep-dive movement itself. Returns at most `limit`
 * unique peers, ordered by pattern-match (true sisters) first, then by
 * functional-role overlap, then alphabetically.
 *
 * Gracefully degrades when `pattern` is null and `functionalRoles` is
 * empty — returns an empty list rather than throwing.
 */
export function pickSisters(
  self: { id: string; pattern: string | null; functionalRoles: string[] },
  candidates: MovementRowForSisters[],
  limit = 6,
): Array<{ id: string; slug: string; displayName: string }> {
  const selfRoles = new Set(self.functionalRoles ?? []);
  const scored: Array<{ row: MovementRowForSisters; score: number }> = [];
  for (const c of candidates) {
    if (c.id === self.id) continue;
    let score = 0;
    if (self.pattern && c.pattern && c.pattern === self.pattern) score += 10;
    const cRoles = c.functional_roles ?? [];
    let roleOverlap = 0;
    for (const r of cRoles) if (selfRoles.has(r)) roleOverlap += 1;
    score += roleOverlap;
    if (score > 0) scored.push({ row: c, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score || a.row.display_name.localeCompare(b.row.display_name),
  );
  return scored.slice(0, limit).map(({ row }) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
  }));
}

/** I/O wrapper: pull global catalog peers + each sister's current e1RM. */
export async function getSisterMovements(
  supabase: SupabaseClient,
  userId: string,
  self: { id: string; pattern: string | null; functionalRoles: string[] },
  limit = 6,
): Promise<SisterMovement[]> {
  const { data } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern, functional_roles")
    .is("user_id", null);
  const peers = pickSisters(self, (data ?? []) as MovementRowForSisters[], limit);

  // Each peer's working-set fetch is an independent read; resolve them
  // in parallel rather than awaiting six round-trips serially (was the
  // dominant cost on `/app/stats/movements/[slug]` per perf audit F6).
  const peerSets = await Promise.all(
    peers.map((p) => getWorkingSetsForMovement(supabase, userId, p.id)),
  );
  const results: SisterMovement[] = peers.map((p, i) => {
    const series = rollupTopSetsPerSession(peerSets[i] ?? []);
    const cur = getCurrentE1rmFromSeries(series);
    return { id: p.id, slug: p.slug, displayName: p.displayName, e1rm: cur };
  });
  return results;
}

/** Compose a movement's pattern + functional_roles in one round-trip. */
export async function getMovementMeta(
  supabase: SupabaseClient,
  movementId: string,
): Promise<{ pattern: string | null; functionalRoles: string[] } | null> {
  const { data } = await supabase
    .from("movements")
    .select("pattern, functional_roles")
    .eq("id", movementId)
    .maybeSingle();
  if (!data) return null;
  return {
    pattern: (data.pattern as string | null) ?? null,
    functionalRoles: ((data.functional_roles as string[] | null) ?? []) as string[],
  };
}

/** Current training-max for `(user, movement)`, in kg. Null = no TM set. */
export async function getCurrentTm(
  supabase: SupabaseClient,
  userId: string,
  movementId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, tm_percent")
    .eq("user_id", userId)
    .eq("movement_id", movementId)
    .maybeSingle();
  if (!data) return null;
  // TMs are stored as the user's working 1RM in kg + an optional %TM
  // override; the "training max" we surface lines up with how
  // prescription generation reads the same row (1RM × tmPercent%,
  // defaulting to 90%).
  const oneRm = Number(data.one_rm_kg);
  if (!Number.isFinite(oneRm)) return null;
  const pct = data.tm_percent != null ? Number(data.tm_percent) : 90;
  if (!Number.isFinite(pct)) return null;
  return Math.round(oneRm * (pct / 100) * 10) / 10;
}

/** Conservative current-e1RM wrapper (Phase 5 — re-exports the Epley path). */
export function currentEstimateOneRm(weight: number, reps: number, rpe: number | null): number | null {
  return bestEstimateOneRm({ weight, reps, rpe });
}
