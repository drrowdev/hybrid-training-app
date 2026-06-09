/**
 * Bodyweight set-logging + session-completion hooks.
 *
 * Phase 4 plan §B. Called from `lib/sessions/actions.ts`:
 *
 *   - `applyBwSetSideEffects` runs after persisting one set whose
 *     parent `PrescriptionItem.bw` is present. Accumulates TUT and
 *     appends to `clean_rep_history` (capped at 50).
 *   - `applyBwSessionCompletionSideEffects` runs after the session
 *     row is marked complete. For each unique BW family touched in
 *     the session it bumps `weeks_at_node` when this is the second
 *     session of the ISO week, then calls `evaluateProgression` and
 *     persists the advance + `bw_progression_events` row when the
 *     gate opens.
 *
 * Failures here MUST NOT block the user's logging or completion
 * flow — they're side-effects, the canonical truth is the set_logs
 * + bw_progress rows themselves. The caller wraps both helpers in
 * try/catch and console.errors any failure.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BwProgress,
  MovementFamily,
  MovementNode,
  PrescriptionItem,
} from "@hta/db";
import {
  evaluateProgression,
  tutThreshold,
  type RecentSessionStat,
} from "@/lib/planner/bw-progression";

const CLEAN_REP_HISTORY_CAP = 50;

type GenericSupabase = Pick<SupabaseClient, "from"> & SupabaseClient;

// ── TUT delta ────────────────────────────────────────────────────────

/**
 * Time-under-tension contribution of a single logged set, per Phase 4
 * plan §B.1:
 *   - reps:        actual_reps × tempo_eccentric_sec
 *   - hold:        actual_seconds
 *   - tempo_reps:  actual_reps × tempo_eccentric_sec × 1.5
 *
 * Defensive: returns 0 when inputs are missing so a malformed set
 * never accidentally credits TUT.
 */
export function tutDeltaForSet(args: {
  prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
  actualReps: number | null;
  actualSeconds: number | null;
  tempoEccentricSec: number;
}): number {
  const tempo = Math.max(0, args.tempoEccentricSec);
  if (args.prescriptionType === "isometric_hold") {
    return Math.max(0, args.actualSeconds ?? 0);
  }
  const reps = Math.max(0, args.actualReps ?? 0);
  if (args.prescriptionType === "tempo_reps") {
    return Math.round(reps * tempo * 1.5);
  }
  return Math.round(reps * tempo);
}

// ── ISO week helpers ─────────────────────────────────────────────────

/**
 * ISO-week (Monday-start) bucket for a given ISO timestamp + IANA
 * timezone. Returns `YYYY-Www` so two sessions in the same calendar
 * week return the same string.
 *
 * Falls back to UTC when the supplied timezone string is empty.
 */
export function isoWeekKey(timestampIso: string, timezone?: string): string {
  const tz = timezone && timezone.length > 0 ? timezone : "UTC";
  // Render the timestamp into the user's TZ as a Y/M/D triple, then
  // re-interpret as a UTC date for the ISO-week math. Intl provides
  // the deterministic rendering across runtimes.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(timestampIso));
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const date = new Date(Date.UTC(y, m - 1, d));
  // ISO week: Thursday determines the year + week number.
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ── Per-set side effect ─────────────────────────────────────────────

/**
 * After a strength set lands in `set_logs`, mirror it into
 * `bw_progress.clean_rep_history` and bump `accumulated_tut_seconds`.
 *
 * Called inside `addStrengthSet` only when the parent prescription
 * item carries a `bw` block. Skipped sets contribute zero (TUT delta
 * is bounded below by 0, and a skipped set's reps/seconds are zero).
 */
export async function applyBwSetSideEffects(args: {
  supabase: GenericSupabase;
  userId: string;
  bw: NonNullable<PrescriptionItem["bw"]>;
  actualReps: number | null;
  actualSeconds: number | null;
  rir: number;
  cleanForm: boolean;
  setDateIso: string;
  skipped: boolean;
  /**
   * Phase 7 — actual external load applied (vest / belt / ankle /
   * band assist). Null/undefined ⇒ bodyweight only. Mirrored into
   * `clean_rep_history[i].external_load_kg` so future prescriptions
   * can read the user's progression and bump load accordingly.
   */
  externalLoadKg?: number | null;
}): Promise<{ family: string; tutAccumulated: number } | null> {
  if (args.skipped) return null;
  const family = args.bw.family as MovementFamily | undefined;
  if (!family) return null;

  const { data: rowRaw, error: readErr } = await args.supabase
    .from("bw_progress")
    .select("accumulated_tut_seconds, clean_rep_history")
    .eq("user_id", args.userId)
    .eq("family", family)
    .maybeSingle();
  if (readErr) {
    console.error("bw_progress read failed:", readErr.message);
    return null;
  }
  if (!rowRaw) return null; // user isn't on the BW path for this family

  const row = rowRaw as {
    accumulated_tut_seconds: number;
    clean_rep_history: unknown;
  };

  const delta = tutDeltaForSet({
    prescriptionType: args.bw.prescriptionType,
    actualReps: args.actualReps,
    actualSeconds: args.actualSeconds,
    tempoEccentricSec: args.bw.tempoEccentricSec,
  });

  const existing = Array.isArray(row.clean_rep_history)
    ? (row.clean_rep_history as Array<Record<string, unknown>>)
    : [];

  const entry: Record<string, unknown> = {
    date: args.setDateIso.slice(0, 10),
    rir: args.rir,
    clean_form: args.cleanForm,
  };
  if (args.actualReps != null) entry.reps = args.actualReps;
  if (args.actualSeconds != null) entry.seconds = args.actualSeconds;
  if (args.bw.reps != null) entry.prescribed_reps = args.bw.reps;
  if (args.bw.holdSeconds != null) entry.prescribed_hold = args.bw.holdSeconds;
  if (args.externalLoadKg != null && Number.isFinite(args.externalLoadKg)) {
    entry.external_load_kg = args.externalLoadKg;
  }
  if (args.bw.loadSource) entry.load_source = args.bw.loadSource;

  const next = [...existing, entry].slice(-CLEAN_REP_HISTORY_CAP);

  const nextTut = (row.accumulated_tut_seconds ?? 0) + delta;
  const { error: upErr } = await args.supabase
    .from("bw_progress")
    .update({
      accumulated_tut_seconds: nextTut,
      clean_rep_history: next,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", args.userId)
    .eq("family", family);
  if (upErr) {
    console.error("bw_progress update failed:", upErr.message);
    return null;
  }
  // Return the new TUT so the caller can hand it back to the client, which
  // overlays the "Next:" chip counter without a per-set page revalidation.
  return { family, tutAccumulated: nextTut };
}

// ── Per-session side effect ─────────────────────────────────────────

type SessionRowForFamily = {
  family: MovementFamily;
  setRows: ReadonlyArray<{
    prescribedReps?: number;
    prescribedHoldSec?: number;
    actualReps: number | null;
    actualSeconds: number | null;
    rir: number;
    cleanForm: boolean;
  }>;
};

/**
 * Collapse a session's BW sets per family into a single
 * RecentSessionStat: prescribed value = the most common prescribed
 * value across logged sets; actual = sum of (reps or seconds);
 * rir = min observed; cleanForm = all sets clean.
 *
 * The conservative aggregation matches the gate's intent — one
 * sloppy set should NOT credit the user with an over-completed
 * session.
 */
function aggregateSessionStat(
  date: string,
  rows: SessionRowForFamily["setRows"],
): RecentSessionStat | null {
  if (rows.length === 0) return null;
  const sumReps = rows.reduce((a, r) => a + (r.actualReps ?? 0), 0);
  const sumSec = rows.reduce((a, r) => a + (r.actualSeconds ?? 0), 0);
  const prescribedReps = rows.find((r) => r.prescribedReps != null)?.prescribedReps;
  const prescribedHold = rows.find((r) => r.prescribedHoldSec != null)?.prescribedHoldSec;
  const minRir = rows.reduce((a, r) => Math.min(a, r.rir), Number.POSITIVE_INFINITY);
  const allClean = rows.every((r) => r.cleanForm);
  return {
    sessionDate: date,
    prescribedReps: prescribedReps ?? undefined,
    prescribedHoldSec: prescribedHold ?? undefined,
    actualReps: prescribedReps != null ? sumReps : undefined,
    actualHoldSec: prescribedHold != null ? sumSec : undefined,
    rir: Number.isFinite(minRir) ? (minRir as number) : 0,
    cleanForm: allClean,
  };
}

/**
 * Hook fired from `completeSession`. For each BW family in the just-
 * completed session:
 *   1. Increment weeks_at_node when this is the second session of
 *      the current ISO week.
 *   2. Pull current_node + candidate next nodes + last 2 same-family
 *      session stats, call evaluateProgression.
 *   3. On advance: update bw_progress (reset accumulators, set new
 *      current_node_id) and insert a bw_progression_events row.
 */
export async function applyBwSessionCompletionSideEffects(args: {
  supabase: GenericSupabase;
  userId: string;
  sessionId: string;
  timezone?: string;
}): Promise<void> {
  // 1. Resolve the planned-session linked to this session and harvest
  //    its BW main-lift items. We only consider items with `kind in
  //    (main, back_off)` carrying a `bw.family`.
  const { data: planned } = await args.supabase
    .from("planned_sessions")
    .select("prescription")
    .eq("completed_session_id", args.sessionId)
    .maybeSingle();
  const items =
    ((planned?.prescription as { items?: PrescriptionItem[] } | null)?.items ??
      []) as PrescriptionItem[];
  const bwItems = items.filter(
    (it) =>
      it.bw != null &&
      it.bw.family != null &&
      (it.kind === "main" || it.kind === "back_off"),
  );
  if (bwItems.length === 0) return;

  const familiesInSession = new Set<MovementFamily>();
  for (const it of bwItems) {
    if (it.bw?.family) familiesInSession.add(it.bw.family as MovementFamily);
  }

  // 2. Pull the session timestamp for ISO-week math + the user's
  //    other sessions in the same ISO week so we can decide whether
  //    THIS completion is the second of the week.
  const { data: sess } = await args.supabase
    .from("sessions")
    .select("completed_at, started_at")
    .eq("id", args.sessionId)
    .maybeSingle();
  const sessionTs =
    (sess?.completed_at as string | undefined) ??
    (sess?.started_at as string | undefined) ??
    new Date().toISOString();
  const sessionWeek = isoWeekKey(sessionTs, args.timezone);

  // Other completed sessions belonging to this user — used to count
  // BW-family appearances in the same ISO week.
  const { data: otherSessions } = await args.supabase
    .from("sessions")
    .select(
      "id, completed_at, planned_sessions:planned_sessions!planned_sessions_completed_session_id_fkey(prescription)",
    )
    .eq("user_id", args.userId)
    .not("completed_at", "is", null)
    .neq("id", args.sessionId)
    .order("completed_at", { ascending: false })
    .limit(40);

  type OtherSession = {
    id: string;
    completed_at: string | null;
    planned_sessions: Array<{ prescription: { items?: PrescriptionItem[] } | null }>;
  };
  const otherTyped = (otherSessions ?? []) as unknown as OtherSession[];

  // Family → list of {date, items} for the user's last several
  // completed sessions, INCLUDING the just-completed one (we add it
  // below). Used both for the ISO-week increment and the recent-2
  // over-completion check.
  const familyHistory = new Map<
    MovementFamily,
    Array<{ date: string; weekKey: string; items: PrescriptionItem[] }>
  >();
  for (const fam of familiesInSession) familyHistory.set(fam, []);

  for (const s of otherTyped) {
    const planned = s.planned_sessions?.[0]?.prescription ?? null;
    const its = (planned?.items ?? []) as PrescriptionItem[];
    const ts = s.completed_at ?? "";
    if (!ts) continue;
    const wk = isoWeekKey(ts, args.timezone);
    for (const fam of familiesInSession) {
      if (its.some((it) => it.bw?.family === fam)) {
        familyHistory.get(fam)!.push({ date: ts, weekKey: wk, items: its });
      }
    }
  }

  // Inject the just-completed session at the head of each family's
  // history so the recent-2 check sees the latest performance.
  for (const fam of familiesInSession) {
    familyHistory
      .get(fam)!
      .unshift({ date: sessionTs, weekKey: sessionWeek, items: bwItems });
  }

  // 3. Pull this session's BW set logs (we need actual reps / seconds
  //    / rir / cleanForm to aggregate). We pull all set_logs for the
  //    session and match by prescription_item_index when present.
  const { data: setLogs } = await args.supabase
    .from("set_logs")
    .select(
      "prescription_item_index, weight_kg, reps, duration_sec, rpe, skipped",
    )
    .eq("session_id", args.sessionId);
  const setRowsRaw = (setLogs ?? []) as Array<{
    prescription_item_index: number | null;
    weight_kg: number | null;
    reps: number | null;
    duration_sec: number | null;
    rpe: number | null;
    skipped: boolean | null;
  }>;

  // 4. Pull bw_progress + candidate next nodes for every affected
  //    family.
  const { data: progressRows } = await args.supabase
    .from("bw_progress")
    .select(
      "user_id, family, current_node_id, accumulated_tut_seconds, weeks_at_node, clean_rep_history, updated_at",
    )
    .eq("user_id", args.userId)
    .in("family", Array.from(familiesInSession));
  const progressByFamily = new Map<MovementFamily, BwProgress>();
  for (const r of (progressRows ?? []) as Array<Record<string, unknown>>) {
    const fam = r.family as MovementFamily;
    progressByFamily.set(fam, {
      userId: r.user_id as string,
      family: fam,
      currentNodeId: r.current_node_id as string,
      accumulatedTutSeconds: r.accumulated_tut_seconds as number,
      weeksAtNode: r.weeks_at_node as number,
      cleanRepHistory: (r.clean_rep_history as BwProgress["cleanRepHistory"]) ?? [],
      targetExternalLoadKg: null,
      updatedAt: new Date(r.updated_at as string),
    });
  }

  const currentNodeIds = Array.from(progressByFamily.values()).map(
    (p) => p.currentNodeId,
  );
  const { data: currentNodes } = await args.supabase
    .from("movement_nodes")
    .select(
      "id, family, node_key, display_name, prerequisites, external_load_capable, isometric_capable, unilateral, default_tempo_seconds, tut_per_rep_seconds, difficulty_anchor, created_at",
    )
    .in("id", currentNodeIds);
  const currentNodeById = new Map<string, MovementNode>();
  for (const n of (currentNodes ?? []) as Array<Record<string, unknown>>) {
    currentNodeById.set(n.id as string, hydrateNode(n));
  }

  // Candidate next nodes — children of each family's current node.
  const { data: candidateRowsRaw } = await args.supabase
    .from("movement_nodes")
    .select(
      "id, family, node_key, display_name, prerequisites, external_load_capable, isometric_capable, unilateral, default_tempo_seconds, tut_per_rep_seconds, difficulty_anchor, created_at",
    )
    .overlaps("prerequisites", currentNodeIds);
  const allCandidates = ((candidateRowsRaw ?? []) as Array<Record<string, unknown>>).map(
    hydrateNode,
  );

  for (const fam of familiesInSession) {
    const progress = progressByFamily.get(fam);
    if (!progress) continue;
    const currentNode = currentNodeById.get(progress.currentNodeId);
    if (!currentNode) continue;

    // 4a. Bump weeks_at_node when THIS session is the second in
    //     the current ISO week for this family.
    const sameWeek = familyHistory
      .get(fam)!
      .filter((h) => h.weekKey === sessionWeek);
    const isSecondOfWeek = sameWeek.length === 2;
    let weeksAtNode = progress.weeksAtNode;
    if (isSecondOfWeek) {
      weeksAtNode = (progress.weeksAtNode ?? 0) + 1;
      await args.supabase
        .from("bw_progress")
        .update({
          weeks_at_node: weeksAtNode,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", args.userId)
        .eq("family", fam);
    }

    // 4b. Build RecentSessionStat list from the last 2 sessions of
    //     this family (any week). For the just-completed session we
    //     aggregate from this session's set_logs; for older sessions
    //     we fall back to a synthesised "neutral" stat where we don't
    //     have raw data — the engine treats those as non-over-
    //     completed which is the safe default.
    const last2 = familyHistory.get(fam)!.slice(0, 2);
    const stats: RecentSessionStat[] = [];
    for (const h of last2) {
      if (h.date === sessionTs) {
        const famItems = h.items.filter((it) => it.bw?.family === fam);
        const rows = famItems.map((it) => {
          // Find the index of this item in the session's prescription
          // by reference (the planned-session items array we already
          // loaded). Then match set_logs by prescription_item_index.
          const idx = items.indexOf(it);
          const matching = setRowsRaw.filter(
            (s) => s.prescription_item_index === idx && !s.skipped,
          );
          const actualReps = matching.reduce(
            (a, s) => a + (s.reps ?? 0),
            0,
          );
          const actualSec = matching.reduce(
            (a, s) => a + (s.duration_sec ?? 0),
            0,
          );
          const rpe = matching.reduce(
            (a, s) => Math.max(a, s.rpe ?? 0),
            0,
          );
          const rir = rpe > 0 ? Math.max(0, 10 - rpe) : 2;
          return {
            prescribedReps: it.bw?.reps,
            prescribedHoldSec: it.bw?.holdSeconds,
            actualReps: it.bw?.reps != null ? actualReps : null,
            actualSeconds: it.bw?.holdSeconds != null ? actualSec : null,
            rir,
            cleanForm: rir >= 1,
          };
        });
        const stat = aggregateSessionStat(h.date.slice(0, 10), rows);
        if (stat) stats.push(stat);
      } else {
        // Older session — synthesise a non-over-completing stat from
        // the prescription alone. The engine will refuse to advance
        // unless THIS session and the previous one both over-complete;
        // since we can't cheaply hydrate older sessions' actual reps
        // here without N more queries, we conservatively bias against
        // advancing on cold history. The Phase 4 plan's "2 weeks at
        // node" guard makes this conservative bias non-blocking in
        // practice.
        const famItems = h.items.filter((it) => it.bw?.family === fam);
        const it = famItems[0];
        if (!it) continue;
        stats.push({
          sessionDate: h.date.slice(0, 10),
          prescribedReps: it.bw?.reps,
          prescribedHoldSec: it.bw?.holdSeconds,
          actualReps: it.bw?.reps,
          actualHoldSec: it.bw?.holdSeconds,
          rir: 1,
          cleanForm: true,
        });
      }
    }
    // Engine reads chronologically ascending; we built descending.
    const chronological = [...stats].reverse();

    const candidates = allCandidates.filter(
      (n) =>
        n.family === fam && n.prerequisites.includes(currentNode.id),
    );

    const decision = evaluateProgression({
      bwProgress: { ...progress, weeksAtNode },
      currentNode,
      candidateNextNodes: candidates,
      recentSessions: chronological,
    });

    if (decision.advance) {
      await args.supabase
        .from("bw_progress")
        .update({
          current_node_id: decision.toNodeId,
          accumulated_tut_seconds: 0,
          weeks_at_node: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", args.userId)
        .eq("family", fam);

      await args.supabase.from("bw_progression_events").insert({
        user_id: args.userId,
        family: fam,
        from_node_id: currentNode.id,
        to_node_id: decision.toNodeId,
        reason: decision.reason,
      });
    }
  }
  // Silence the unused-var lint when set logs are loaded but never
  // touched (defensive — they're consumed inside the loop above).
  void setRowsRaw;
  void tutThreshold;
}

function hydrateNode(row: Record<string, unknown>): MovementNode {
  return {
    id: row.id as string,
    family: row.family as MovementFamily,
    nodeKey: row.node_key as string,
    displayName: row.display_name as string,
    prerequisites: (row.prerequisites as string[]) ?? [],
    externalLoadCapable: Boolean(row.external_load_capable),
    isometricCapable: Boolean(row.isometric_capable),
    unilateral: Boolean(row.unilateral),
    defaultTempoSeconds: row.default_tempo_seconds as number,
    tutPerRepSeconds: row.tut_per_rep_seconds as number,
    difficultyAnchor: row.difficulty_anchor as number,
    createdAt: row.created_at as unknown as Date,
  };
}
