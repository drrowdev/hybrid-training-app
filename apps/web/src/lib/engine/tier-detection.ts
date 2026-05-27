/**
 * Tier-detection query layer.
 *
 * `gatherTierInputs(supabase, userId)` fetches the live observed
 * signals the pure `computeTier` helper needs:
 *
 *  - declaredExperience  ← profiles.training_experience (5-tier scale —
 *                          see `packages/engine/src/tier-detection.ts`
 *                          for the declared → engine-tier projection)
 *  - bodyweightKg        ← profiles.bodyweight_kg
 *  - e1rmKgByRole        ← training_maxes.one_rm_kg per main-lift role,
 *                          mapped from the movement slug catalog in
 *                          `STRENGTH_ROLE_CANDIDATES` (planner archetypes).
 *                          When a user has multiple variants under a role
 *                          (e.g. high-bar AND front squat), we take the
 *                          highest one_rm — the engine's "best estimate"
 *                          of strength for that role.
 *  - anchorAdherenceLast12w
 *                        ← completed planned sessions of role=primary /
 *                          total planned over the last 84 days. "Completed"
 *                          requires a linked session that has at least one
 *                          non-warmup `set_logs` row whose `movement_id`
 *                          belongs to the anchor's main-lift candidate set
 *                          (`STRENGTH_ROLE_CANDIDATES`). Linking a session
 *                          row that contains zero anchor-lift work does not
 *                          count — the user can't get adherence credit for
 *                          a Squat anchor by logging only triceps.
 *  - scheduleRegularity  ← 1 − coefficient-of-variation of weekly
 *                          completed-session counts over the last 12
 *                          full weeks (clamped to 0..1).
 *  - recoveryInputConsistency
 *                        ← fraction of completed sessions in the same
 *                          window that have a pre-session check-in
 *                          filled (sessions.fatigue or .soreness not null,
 *                          per the DC-P1 two-slider check-in).
 *
 * The shape mirrors `TierInputs` from `@hta/engine` — no derived
 * decisions live here, just the reads.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeclaredExperience, MainLift, TierInputs } from "@hta/engine";
import { MAIN_LIFTS } from "@hta/engine";
import { STRENGTH_ROLE_CANDIDATES } from "@/lib/planner/archetypes";

const DECLARED_VALUES: ReadonlySet<DeclaredExperience> = new Set([
  "beginner_lt_6m",
  "novice_6m_2y",
  "intermediate_2y_5y",
  "advanced_5y_10y",
  "highly_advanced_10y_plus",
]);

/** Reverse the planner's STRENGTH_ROLE_CANDIDATES into slug → role. */
const SLUG_TO_ROLE: Map<string, MainLift> = (() => {
  const m = new Map<string, MainLift>();
  for (const role of Object.keys(STRENGTH_ROLE_CANDIDATES) as MainLift[]) {
    for (const slug of STRENGTH_ROLE_CANDIDATES[role]) {
      m.set(slug, role);
    }
  }
  return m;
})();

const WINDOW_DAYS = 84; // 12 weeks

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function isoWeekKey(dateIso: string): string {
  // ISO week year-week (e.g., "2026-W18"). Used to bucket sessions.
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "1970-W01";
  // ISO week — Thursday-anchored.
  const target = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export async function gatherTierInputs(
  supabase: SupabaseClient,
  userId: string,
): Promise<TierInputs> {
  const since = isoDaysAgo(WINDOW_DAYS);

  // Flatten main-lift candidate slugs once for the movement-id lookup.
  const allCandidateSlugs = Array.from(
    new Set(
      (Object.values(STRENGTH_ROLE_CANDIDATES) as string[][]).flat(),
    ),
  );

  const [profileRes, tmsRes, plannedRes, sessionsRes, candidateMovementsRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("training_experience, bodyweight_kg")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("training_maxes")
        .select("one_rm_kg, movements(slug)")
        .eq("user_id", userId),
      supabase
        .from("planned_sessions")
        .select(
          "id, role, completed_session_id, skipped_at, created_at, prescription",
        )
        .eq("user_id", userId)
        .gte("created_at", since),
      supabase
        .from("sessions")
        .select("id, performed_at, completed_at, fatigue, soreness")
        .eq("user_id", userId)
        .gte("performed_at", since)
        .not("completed_at", "is", null)
        .is("deleted_at", null),
      supabase
        .from("movements")
        .select("id, slug")
        .in("slug", allCandidateSlugs),
    ]);

  // ── declared experience + bodyweight ────────────────────────────
  const profile = profileRes.data ?? null;
  const declaredRaw = profile?.training_experience as string | null | undefined;
  const declaredExperience: DeclaredExperience | null =
    declaredRaw && DECLARED_VALUES.has(declaredRaw as DeclaredExperience)
      ? (declaredRaw as DeclaredExperience)
      : null;
  const bwRaw = profile?.bodyweight_kg;
  const bodyweightKg =
    bwRaw != null && Number.isFinite(Number(bwRaw)) && Number(bwRaw) > 0
      ? Number(bwRaw)
      : null;

  // ── e1RM per main-lift role (max across variants in the role) ───
  const e1rmKgByRole: Partial<Record<MainLift, number>> = {};
  for (const row of tmsRes.data ?? []) {
    const m = (Array.isArray(row.movements) ? row.movements[0] : row.movements) ?? null;
    const slug = (m as { slug?: string } | null)?.slug;
    if (!slug) continue;
    const role = SLUG_TO_ROLE.get(slug);
    if (!role) continue;
    const oneRm = Number(row.one_rm_kg);
    if (!Number.isFinite(oneRm) || oneRm <= 0) continue;
    const prev = e1rmKgByRole[role];
    if (prev == null || oneRm > prev) {
      e1rmKgByRole[role] = oneRm;
    }
  }

  // ── anchor adherence (primary-role planned sessions, last 12 w) ─
  //
  // A planned anchor session only counts as adherent when the linked
  // `sessions` row carries at least one non-warmup `set_logs` entry
  // whose `movement_id` is in the candidate set for the anchor's role.
  // Linking a real session that contains zero anchor-lift work (e.g.
  // a Squat anchor where the user only logged a triceps extension)
  // does **not** earn credit — fix for `engine-actual-vs-prescribed-
  // audit.md` finding H1.
  const planned = plannedRes.data ?? [];
  const anchors = planned.filter((p) => p.role === "primary");
  const totalAnchors = anchors.length;

  // Map main-lift candidate movement_id → role, and role → set of ids.
  const movementIdToRole = new Map<string, MainLift>();
  const roleToMovementIds = new Map<MainLift, Set<string>>();
  for (const role of MAIN_LIFTS) roleToMovementIds.set(role, new Set());
  for (const row of candidateMovementsRes.data ?? []) {
    const id = (row as { id?: string }).id;
    const slug = (row as { slug?: string }).slug;
    if (!id || !slug) continue;
    const role = SLUG_TO_ROLE.get(slug);
    if (!role) continue;
    movementIdToRole.set(id, role);
    roleToMovementIds.get(role)!.add(id);
  }

  // Inspect each linked anchor session's prescription to determine its
  // main-lift role (first prescription item whose movementId resolves
  // to a main-lift candidate).
  type LinkedAnchor = { sessionId: string; role: MainLift };
  const linkedAnchors: LinkedAnchor[] = [];
  for (const p of anchors) {
    const sessionId = (p as { completed_session_id?: string | null })
      .completed_session_id;
    if (!sessionId) continue;
    const presc = (p as { prescription?: unknown }).prescription;
    const items =
      (presc as { items?: Array<{ movementId?: string }> } | null)?.items ?? [];
    let role: MainLift | null = null;
    for (const it of items) {
      const mid = it?.movementId;
      if (mid && movementIdToRole.has(mid)) {
        role = movementIdToRole.get(mid)!;
        break;
      }
    }
    if (!role) continue; // No main-lift prescription item → can't validate.
    linkedAnchors.push({ sessionId, role });
  }

  // Batch-fetch the non-warmup set_logs for those linked sessions,
  // restricted to candidate main-lift movement ids.
  const linkedSessionIds = Array.from(
    new Set(linkedAnchors.map((a) => a.sessionId)),
  );
  const allCandidateMovementIds = Array.from(movementIdToRole.keys());
  const loggedMovementIdsBySession = new Map<string, Set<string>>();
  if (linkedSessionIds.length > 0 && allCandidateMovementIds.length > 0) {
    const setLogsRes = await supabase
      .from("set_logs")
      .select("session_id, movement_id, set_kind")
      .in("session_id", linkedSessionIds)
      .in("movement_id", allCandidateMovementIds)
      .neq("set_kind", "warmup");
    for (const row of setLogsRes.data ?? []) {
      const sid = (row as { session_id?: string }).session_id;
      const mid = (row as { movement_id?: string }).movement_id;
      if (!sid || !mid) continue;
      let s = loggedMovementIdsBySession.get(sid);
      if (!s) {
        s = new Set();
        loggedMovementIdsBySession.set(sid, s);
      }
      s.add(mid);
    }
  }

  let completedAnchors = 0;
  for (const a of linkedAnchors) {
    const logged = loggedMovementIdsBySession.get(a.sessionId);
    if (!logged || logged.size === 0) continue;
    const required = roleToMovementIds.get(a.role);
    if (!required || required.size === 0) continue;
    for (const id of logged) {
      if (required.has(id)) {
        completedAnchors++;
        break;
      }
    }
  }

  const anchorAdherenceLast12w: number | null =
    totalAnchors > 0 ? completedAnchors / totalAnchors : null;

  // ── schedule regularity (1 − CV of weekly completed-session count) ─
  const sessions = sessionsRes.data ?? [];
  const weekBuckets = new Map<string, number>();
  for (const s of sessions) {
    const key = isoWeekKey(String(s.performed_at));
    weekBuckets.set(key, (weekBuckets.get(key) ?? 0) + 1);
  }
  // Pad with zero-weeks across the 12-week window so a "trained 4 weeks
  // then dropped off" user gets a high CV. Walk back 12 weeks from now.
  const weekKeysWindow: string[] = [];
  for (let i = 0; i < 12; i++) {
    weekKeysWindow.push(isoWeekKey(isoDaysAgo(i * 7)));
  }
  const weeklyCounts = weekKeysWindow.map((k) => weekBuckets.get(k) ?? 0);
  // Only compute CV if we have ≥ 3 weeks with any data — otherwise it's
  // not informative.
  const nonEmptyWeeks = weeklyCounts.filter((n) => n > 0).length;
  let scheduleRegularity: number | null = null;
  if (nonEmptyWeeks >= 3) {
    const cv = coefficientOfVariation(weeklyCounts);
    scheduleRegularity = Math.max(0, Math.min(1, 1 - cv));
  }

  // ── recovery input consistency (fraction with fatigue OR soreness) ─
  const totalSessions = sessions.length;
  const withCheckIn = sessions.filter(
    (s) => s.fatigue != null || s.soreness != null,
  ).length;
  const recoveryInputConsistency: number | null =
    totalSessions > 0 ? withCheckIn / totalSessions : null;

  return {
    declaredExperience,
    bodyweightKg,
    e1rmKgByRole,
    anchorAdherenceLast12w,
    scheduleRegularity,
    recoveryInputConsistency,
  };
}
