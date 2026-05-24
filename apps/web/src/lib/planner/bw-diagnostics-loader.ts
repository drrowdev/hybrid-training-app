/**
 * Server-side loader for the bodyweight diagnostics engine.
 *
 * Shapes the raw Supabase rows (bw_progress, movement_nodes,
 * bw_progression_events, sessions + planned_sessions) into the input
 * `runDiagnostics` expects, then returns the ranked result list.
 *
 * Pure orchestration — never writes to bw_progress or any user-state
 * table. The diagnostics-snapshot persistence path lives in
 * `bw-diagnostics-snapshot.ts` and is the only writer of the output.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BwProgress,
  MovementFamily,
  MovementNode,
  PrescriptionItem,
} from "@hta/db";
import { MOVEMENT_FAMILIES } from "@hta/db";
import {
  runDiagnostics,
  type DiagnosticResult,
  type RecentSessionRecord,
} from "@/lib/planner/bw-diagnostics";

type GenericSupabase = Pick<SupabaseClient, "from"> & SupabaseClient;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SKILL_FAMILIES: ReadonlyArray<MovementFamily> = [
  "planche",
  "lever_front",
  "lever_back",
  "handstand",
  "human_flag",
  "muscle_up",
];

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
    defaultTempoSeconds: (row.default_tempo_seconds as number) ?? 4,
    tutPerRepSeconds: (row.tut_per_rep_seconds as number) ?? 4,
    difficultyAnchor: row.difficulty_anchor as number,
    createdAt: row.created_at as unknown as Date,
  };
}

/**
 * Build a RecentSessionRecord list from the user's last 30 days of
 * completed (or skipped) planned-sessions. We treat each
 * planned-session row as one "session" — if it has a
 * `completed_session_id`, every BW prescription item is considered
 * completed; otherwise (the user skipped or hasn't done it yet), the
 * items count as `completed: false`. The skill-focus flag is derived
 * from the prescription items' families.
 */
function reshapeSessions(
  rows: Array<{
    completed_at: string | null;
    planned_for: string | null;
    completed_session_id: string | null;
    prescription: { items?: PrescriptionItem[] } | null;
  }>,
): RecentSessionRecord[] {
  const out: RecentSessionRecord[] = [];
  for (const r of rows) {
    const items = (r.prescription?.items ?? []) as PrescriptionItem[];
    const movements = items
      .filter((it) => it.bw?.family != null)
      .map((it) => {
        const fam = it.bw!.family as MovementFamily;
        return {
          family: fam,
          isSkillFocused: SKILL_FAMILIES.includes(fam),
          completed: r.completed_session_id != null,
        };
      });
    if (movements.length === 0) continue;
    const ts = r.completed_at ?? r.planned_for ?? null;
    if (!ts) continue;
    out.push({ sessionDate: ts, movements });
  }
  return out;
}

/**
 * Fetch + run diagnostics for the given user. Returns an empty list
 * on any read error (diagnostics are decorative — never block a page
 * load on a transient Supabase failure).
 */
export async function loadAndRunBwDiagnostics(args: {
  supabase: GenericSupabase;
  userId: string;
  now?: Date;
}): Promise<DiagnosticResult[]> {
  const now = args.now ?? new Date();
  const sinceIso = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
  const since90 = new Date(now.getTime() - 90 * MS_PER_DAY).toISOString();

  const [progressRes, catalogRes, eventsRes, sessionsRes] = await Promise.all([
    args.supabase
      .from("bw_progress")
      .select(
        "user_id, family, current_node_id, accumulated_tut_seconds, weeks_at_node, clean_rep_history, updated_at",
      )
      .eq("user_id", args.userId),
    args.supabase
      .from("movement_nodes")
      .select(
        "id, family, node_key, display_name, prerequisites, external_load_capable, isometric_capable, unilateral, default_tempo_seconds, tut_per_rep_seconds, difficulty_anchor, created_at",
      ),
    args.supabase
      .from("bw_progression_events")
      .select("family, occurred_at, reason")
      .eq("user_id", args.userId)
      .gte("occurred_at", since90),
    args.supabase
      .from("planned_sessions")
      .select(
        "completed_at, planned_for, completed_session_id, prescription, week_index, day_index, block_id",
      )
      .eq("user_id", args.userId)
      .gte("planned_for", sinceIso.slice(0, 10)),
  ]);

  if (progressRes.error || catalogRes.error) return [];

  const progressByFamily = Object.fromEntries(
    MOVEMENT_FAMILIES.map((f) => [f, null]),
  ) as Record<MovementFamily, BwProgress | null>;
  for (const r of (progressRes.data ?? []) as Array<Record<string, unknown>>) {
    const fam = r.family as MovementFamily;
    progressByFamily[fam] = {
      userId: r.user_id as string,
      family: fam,
      currentNodeId: r.current_node_id as string,
      accumulatedTutSeconds: (r.accumulated_tut_seconds as number) ?? 0,
      weeksAtNode: (r.weeks_at_node as number) ?? 0,
      cleanRepHistory: (r.clean_rep_history as BwProgress["cleanRepHistory"]) ?? [],
      updatedAt: new Date(r.updated_at as string),
    };
  }

  const nodeById: Record<string, MovementNode> = {};
  for (const row of (catalogRes.data ?? []) as Array<Record<string, unknown>>) {
    const n = hydrateNode(row);
    nodeById[n.id] = n;
  }

  const events =
    ((eventsRes.data ?? []) as Array<{
      family: MovementFamily;
      occurred_at: string;
      reason: string;
    }>).map((e) => ({
      family: e.family,
      occurredAt: e.occurred_at,
      reason: e.reason,
    }));

  const sessions = reshapeSessions(
    (sessionsRes.data ?? []) as Array<{
      completed_at: string | null;
      planned_for: string | null;
      completed_session_id: string | null;
      prescription: { items?: PrescriptionItem[] } | null;
    }>,
  );

  return runDiagnostics({
    bwProgressByFamily: progressByFamily,
    nodeById,
    progressionEventsLast90Days: events,
    recentSessionsLast30Days: sessions,
    now,
  });
}
