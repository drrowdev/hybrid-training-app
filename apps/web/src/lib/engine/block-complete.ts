/**
 * Block-complete TM bump trigger.
 *
 * When a user's most-recently-completed block ends without any AMRAP-
 * driven or PR-driven TM bump firing, offer a conservative default
 * bump per the small-progression cadence used by most strength
 * templates (RTS, Helms, Sheiko, Cube methodology).
 *
 * Defaults (practitioner consensus):
 *   Squat / Deadlift: +5 kg
 *   Bench / OHP / other: +2.5 kg
 *
 * Surface points:
 *   /app/plan/new — top-of-picker card when last block qualifies
 *   /app/plan     — landing card when no active block exists but the
 *                   most-recent archived block qualifies
 *
 * Hard gates:
 *   - The block actually ran enough sessions (skipped/missed sessions
 *     don't count; we require ≥75% of planned sessions completed)
 *   - For each strength movement: no tm_history entry inside the
 *     block's date window (idempotency + no-double-bump)
 *   - For each strength movement: 28-day cooldown still respected
 *   - Active limitation on the movement's region suppresses that lift
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysToYmd } from "@/lib/dates";

export type BlockCompleteBump = {
  blockId: string;
  blockArchetype: string;
  blockEndedOn: string;
  /** One entry per strength movement that's eligible for the default bump. */
  lifts: Array<{
    movementId: string;
    movementSlug: string;
    movementDisplayName: string;
    currentTm: number;
    proposedTm: number;
    increment: number;
    triggerKey: string;
  }>;
};

const COMPLETION_THRESHOLD = 0.75;
const COOLDOWN_DAYS = 28;

/** Returns the +kg increment for a pattern (kg, practitioner-consensus). */
function defaultIncrementForPattern(pattern: string | null): number {
  if (!pattern) return 2.5;
  const p = pattern.toLowerCase();
  if (p === "squat" || p === "hinge") return 5;
  return 2.5;
}

/**
 * Find a block-complete bump for the user, if one qualifies.
 *
 * Returns null when:
 *   - No prior block exists
 *   - The most-recent block is still active
 *   - The block didn't run enough sessions
 *   - Every eligible lift already had a TM bump within the block
 *   - The cooldown gates suppress everything
 */
export async function findBlockCompleteBump(
  supabase: SupabaseClient,
  userId: string,
): Promise<BlockCompleteBump | null> {
  // 1. Most-recent non-active block (archived or completed).
  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, archetype, started_on, weeks, status, days_per_week")
    .eq("user_id", userId)
    .neq("status", "active")
    .is("deleted_at", null)
    .order("started_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!block) return null;

  // Block window. started_on + weeks*7 days = end date.
  //
  // `blockEndedOn` is a pure calendar-date calculation off the stored
  // start date and an integer week count — genuinely UTC-internal,
  // because both inputs are already TZ-anchored and no wall-clock
  // "now" is involved. The startedAt/endedAt Date objects below are
  // only used to build ISO bounds for the tm_history range query.
  const weeks = Number(block.weeks ?? 4);
  const blockEndedOn = addDaysToYmd(block.started_on, weeks * 7);
  const startedAt = new Date(`${block.started_on}T00:00:00Z`);
  const endedAt = new Date(`${blockEndedOn}T00:00:00Z`);
  const startIso = startedAt.toISOString();
  const endIso = endedAt.toISOString();

  // 2. Block completion check — at least COMPLETION_THRESHOLD of planned
  // sessions actually got linked to a completed session.
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, role, completed_session_id, skipped_at, prescription")
    .eq("block_id", block.id);
  const total = planned?.length ?? 0;
  if (total === 0) return null;
  const completed = (planned ?? []).filter((p) => p.completed_session_id != null).length;
  if (completed / total < COMPLETION_THRESHOLD) return null;

  // 3. Identify strength movements used in the block. We read the movement
  // ids out of the planned prescriptions' main items.
  type Mv = { id: string; slug: string; displayName: string; pattern: string | null };
  const movementsById = new Map<string, Mv>();
  for (const p of planned ?? []) {
    const items = ((p.prescription as { items?: Array<{ movementId?: string; kind?: string }> } | null)?.items) ?? [];
    for (const item of items) {
      if (item.kind !== "main") continue;
      if (!item.movementId) continue;
      if (movementsById.has(item.movementId)) continue;
      movementsById.set(item.movementId, { id: item.movementId, slug: "", displayName: "", pattern: null });
    }
  }
  if (movementsById.size === 0) return null;

  // Fetch display names + patterns.
  const { data: mvRows } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern, primary_region")
    .in("id", Array.from(movementsById.keys()));
  for (const m of mvRows ?? []) {
    const existing = movementsById.get(m.id);
    if (!existing) continue;
    existing.slug = m.slug;
    existing.displayName = m.display_name;
    existing.pattern = m.pattern;
  }

  // 4. For each movement, apply hard gates and compute the proposal.
  const lifts: BlockCompleteBump["lifts"] = [];

  for (const mv of movementsById.values()) {
    // Gate: cooldown / no-duplicate (any tm_history in last 28 days).
    const twentyEightDaysAgo = new Date(Date.now() - COOLDOWN_DAYS * 86_400_000).toISOString();
    const { count: recentChanges } = await supabase
      .from("tm_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("movement_id", mv.id)
      .gte("changed_at", twentyEightDaysAgo);
    if ((recentChanges ?? 0) > 0) continue;

    // Gate: any tm_history inside the block's window means progression
    // already happened — no need for a default bump.
    const { count: inWindow } = await supabase
      .from("tm_history")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("movement_id", mv.id)
      .gte("changed_at", startIso)
      .lte("changed_at", endIso);
    if ((inWindow ?? 0) > 0) continue;

    // Gate: active limitation on movement region.
    if (mv.pattern) {
      const { data: movementRow } = await supabase
        .from("movements")
        .select("primary_region")
        .eq("id", mv.id)
        .maybeSingle();
      if (movementRow?.primary_region) {
        const { count: limCount } = await supabase
          .from("limitations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("resolved_at", null)
          .eq("region", movementRow.primary_region);
        if ((limCount ?? 0) > 0) continue;
      }
    }

    // Look up the current TM. Movements with no TM set are skipped — the
    // user hasn't actually used this lift in the planner yet.
    const { data: tmRow } = await supabase
      .from("training_maxes")
      .select("one_rm_kg, tm_percent")
      .eq("user_id", userId)
      .eq("movement_id", mv.id)
      .maybeSingle();
    if (!tmRow) continue;
    const tmPct = tmRow.tm_percent != null ? Number(tmRow.tm_percent) / 100 : 0.9;
    const safePct = tmPct > 0 && tmPct <= 1 ? tmPct : 0.9;
    const currentTm = Number(tmRow.one_rm_kg) * safePct;
    if (!Number.isFinite(currentTm) || currentTm <= 0) continue;

    const increment = defaultIncrementForPattern(mv.pattern);
    const proposedTm = Math.round((currentTm + increment) * 2) / 2;

    lifts.push({
      movementId: mv.id,
      movementSlug: mv.slug,
      movementDisplayName: mv.displayName,
      currentTm,
      proposedTm,
      increment,
      triggerKey: `${block.id}:${mv.id}:block_complete`,
    });
  }

  if (lifts.length === 0) return null;
  return {
    blockId: block.id,
    blockArchetype: block.archetype,
    blockEndedOn,
    lifts,
  };
}
